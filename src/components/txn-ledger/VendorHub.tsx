/**
 * VendorHub — the contents of the panel that opens from the material-vendor
 * "Are you tracking this purchase?" trigger. Ports the reference (vendor-easy.html):
 * one plain question, the vendor's open bills underneath, "bought something else"
 * inline, and "hold as advance" as the separate untracked escape. One confirm.
 *
 * Allocation is MANUAL per PO: each bill/purchase has a ₹ field, pre-filled oldest-first
 * but freely adjustable; whatever isn't placed is held as an advance. (Earlier this ran
 * invisibly oldest-first; product chose explicit per-PO amounts.)
 *
 * Feels like one system with the job hub (ContractHub): same container (from TrackChip),
 * tokens, and confirmation shell (reuses ch-confirm / ch-seal / ch-cf-*). Human-first:
 * the bill / GST / stock are optional and deferred, never a gate. MONEY ONLY — nothing
 * here writes GRN/stock; balance is read from the ledger. Data flows through
 * ../../lib/vendorTrackingApi. Scope: material VENDORS (PO side) only.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { V, font, serif, nums } from './ledgerTokens';
import {
  getVendorHub, readVendorBill, createVendorPurchase, commitVendorPayment,
  type VendorHubData,
} from '../../lib/vendorTrackingApi';
import type { TrackTxn } from '../../lib/trackingApi';

const rupee = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

function tweenVal(from: number, to: number, dur: number, onStep: (v: number) => void) {
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    onStep(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// An allocation target: an existing PO bill, or a declared new purchase (a quick PO).
interface Target { key: string; name: string; ref: string; due: number; total: number; paid: number; kind: 'bill' | 'buy' }
type Declared = { name: string; pending: number; hasBill: boolean; gst?: number; poId: string };

interface ConfirmHit { key: string; name: string; applied: number; left: number; kind: 'bill' | 'buy' }
interface ConfirmPayload {
  title: string; vendor: string; pay: number;
  hits: ConfirmHit[]; advance: number; balBefore: number; balAfter: number;
}

export function VendorHub({ txn, onClose, onLinked }: { txn: TrackTxn; onClose: () => void; onLinked: () => void }) {
  const orgId = useOrgId();
  const amount = Number(txn?.total_amount) || 0;
  const project = txn?.txn_allocations?.[0]?.projects?.name || null;

  const { data, isLoading } = useQuery({
    queryKey: ['vendorHub', txn?.txn_id],
    queryFn: () => getVendorHub(txn),
    staleTime: 0,
  });

  const [declared, setDeclared] = useState<Declared[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addedPo, setAddedPo] = useState<string | null>(null);
  const [billState, setBillState] = useState<null | 'reading' | 'attached'>(null);
  const [billData, setBillData] = useState<{ total: number; gst: number } | null>(null);
  const [buyName, setBuyName] = useState('');
  const [buyAmt, setBuyAmt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmPayload | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) setTimeout(() => nameRef.current?.focus(), 30); }, [adding]);

  if (confirm) return <VendorConfirm p={confirm} onDone={() => { onLinked(); onClose(); }} />;
  if (isLoading || !data) {
    return <div className="vh-root" style={{ ...font }}><p className="vh-looking">Looking…</p></div>;
  }

  const v: VendorHubData = data;
  const hasBills = v.bills.length > 0;

  const targets: Target[] = [
    ...v.bills.map((b) => ({ key: `bill:${b.id}`, name: b.name, ref: b.po, due: b.due, total: b.total, paid: b.paid, kind: 'bill' as const })),
    ...declared.map((d, i) => ({ key: `buy:${i}`, name: d.name, ref: d.poId, due: d.pending, total: d.pending, paid: 0, kind: 'buy' as const })),
  ];
  const parseAmt = (k: string) => parseInt((amounts[k] || '').replace(/[^0-9]/g, ''), 10) || 0;
  const placed = targets.reduce((s, t) => s + parseAmt(t.key), 0);
  const totalDue = targets.reduce((s, t) => s + t.due, 0); // total balance across the listed bills/purchases
  const leftover = Math.max(0, amount - placed);

  // Tap a bill → the WHOLE payment lands on it (like linking the payment to one contract).
  // If it exceeds the bill it over-clears into a credit on that PO — no separate "advance".
  const onSelect = (t: Target) => setAmounts({ [t.key]: String(Math.round(amount)) });

  const startDeclare = () => { setAdding(true); setBillState(null); setBillData(null); setBuyName(''); setBuyAmt(''); };
  const cancelDeclare = () => { setAdding(false); setSaving(false); setBillState(null); setBillData(null); };
  const attach = () => fileRef.current?.click();
  const onFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    setBillState('reading'); setErr(null);
    try {
      const base64 = await fileToBase64(f);
      const r = await readVendorBill(base64, f.type);
      const typed = parseInt(buyAmt.replace(/[^0-9]/g, ''), 10) || 0;
      const total = r.total > 0 ? r.total : typed;
      const gst = r.gst || (total > 0 ? Math.round(total - total / 1.18) : 0);
      setBillData({ total, gst });
      setBillState('attached');
      if (!buyAmt && total > 0) setBuyAmt(String(total));
    } catch {
      setBillState(null);
      setErr("Couldn't read the bill — enter the amount and we'll keep the file.");
    }
  };
  const addDeclare = async () => {
    if (saving) return;
    const name = buyName.trim() || 'Other purchase';
    const am = parseInt(buyAmt.replace(/[^0-9]/g, ''), 10) || 0;
    if (am <= 0) { cancelDeclare(); return; }
    setSaving(true); setErr(null);
    try {
      // Record the purchase as a real PO now, so its id can be shown straight away.
      const { poId } = await createVendorPurchase(txn, orgId, { name, amount: am, hasBill: !!billData, gst: billData?.gst });
      const idx = declared.length;
      setDeclared((d) => [...d, { name, pending: am, hasBill: !!billData, gst: billData?.gst, poId }]);
      const remaining = Math.max(0, amount - placed);
      const applied = Math.min(remaining, am);
      setAmounts((a) => ({ ...a, [`buy:${idx}`]: applied > 0 ? String(Math.round(applied)) : '' }));
      setAddedPo(poId);
      setTimeout(() => setAddedPo(null), 4000);
      cancelDeclare();
    } catch (e) { setErr((e as { message?: string })?.message || 'Could not record the purchase'); setSaving(false); }
  };

  const confirmAll = async () => {
    if (busy || placed === 0) return; setBusy(true); setErr(null);
    const hits: ConfirmHit[] = targets
      .map((t) => ({ key: t.key, name: t.name, kind: t.kind, applied: parseAmt(t.key), left: t.due - parseAmt(t.key) }))
      .filter((h) => h.applied > 0);
    const advance = leftover;
    const anyBill = hits.some((h) => h.kind === 'bill');
    const anyBuy = declared.length > 0;
    const title = (advance > 0 && hits.length === 0) ? 'Advance held'
      : advance > 0 ? 'Placed, rest held'
      : (anyBuy && !anyBill) ? 'Purchase recorded'
      : 'Payment placed';
    try {
      await commitVendorPayment(txn, orgId, {
        payment: amount,
        pos: [
          ...v.bills.map((b) => ({ poId: b.id, applied: parseAmt(`bill:${b.id}`) })),
          ...declared.map((d, i) => ({ poId: d.poId, applied: parseAmt(`buy:${i}`) })),
        ],
      });
      setConfirm({ title, vendor: v.vendor, pay: amount, hits, advance, balBefore: v.siteBal, balAfter: v.siteBal - amount });
    } catch (e) { setErr((e as { message?: string })?.message || 'Could not record that — try again'); setBusy(false); }
  };


  return (
    <div className="vh-root" style={{ ...font }}>
      <div className="ch-h" style={{ ...serif }}>Track this as a purchase with {v.vendor}?</div>
      <div className="ch-help">
        An open bill has an <b>amount due</b> — link this payment to it and its balance burns down as you pay.
        A direct purchase has no bill to clear.
      </div>
      <div className="vh-balq" style={{ ...nums, marginBottom: 8 }}>
        You owe <b>{rupee(v.totalBal)}</b>{v.siteBal !== v.totalBal ? ` · ${rupee(v.siteBal)} on this site` : ''}
      </div>

      {hasBills ? (
        <div className="ch-sub" style={{ marginTop: 4 }}>Add to an open bill</div>
      ) : (
        <p className="ch-empty">
          No open bills with <b>{v.vendor}</b>{project ? <> at <b>{project}</b></> : null} yet.
        </p>
      )}

      {targets.length > 0 && (
        <div className="ch-clist">
          {targets.map((t, i) => {
            const applied = parseAmt(t.key);
            const sel = applied > 0;
            const balLeft = Math.max(0, t.due - applied);
            const overBill = sel && applied > t.due;
            const pct = t.total > 0 ? Math.min(100, Math.round(((t.paid + applied) / t.total) * 100)) : (sel ? 100 : 0);
            return (
              <button type="button" key={t.key} className={`ch-crow2${sel ? ' vh-crow-sel' : ''}`} onClick={() => onSelect(t)}>
                <span className="ch-cnum" style={{ ...nums }}>{i + 1}</span>
                <span className="ch-cnm">
                  <span className="ch-c1">{t.name}</span>
                  <span className="ch-c2" style={{ ...nums }}>{pct}% paid · {v.vendor}{t.kind === 'buy' ? ' · new' : ''}</span>
                </span>
                <span className="ch-cbal">
                  <span className="ch-cb1" style={{ ...nums }}>{rupee(balLeft)} <i>left</i></span>
                  <span className="ch-barm"><i style={{ width: `${pct}%`, transition: 'width .55s cubic-bezier(.22,1,.36,1)' }} /></span>
                  <span className="ch-cbmeta" style={{ ...nums }}>{overBill ? `${rupee(applied - t.due)} over · credit` : sel ? `applied ${rupee(applied)} · of ${rupee(t.total)}` : `of ${rupee(t.total)}`}</span>
                </span>
                <span className="ch-cadd">{sel ? '✓' : '→'}</span>
              </button>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="vh-buyform">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={onFile} />
          <input ref={nameRef} className="vh-fin" value={buyName} onChange={(e) => setBuyName(e.target.value)} placeholder="what — e.g. cement, 40 bags" />
          <div className="vh-finrow">
            <span className="vh-cu">₹</span>
            <input inputMode="numeric" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.replace(/[^0-9]/g, ''))} placeholder="amount" style={{ ...nums }} />
          </div>
          <div className="vh-billrow">
            {billState === 'reading' ? (
              <span className="vh-billatt vh-reading"><span className="vh-spin" /> reading the bill…</span>
            ) : billState === 'attached' && billData ? (
              <span className="vh-billatt vh-ok" style={{ ...nums }}>✓ bill read · GST {rupee(billData.gst)}</span>
            ) : (
              <button type="button" className="vh-billatt" onClick={attach}>📎 Attach the bill <span className="vh-opt">optional · reads items &amp; GST</span></button>
            )}
          </div>
          <div className="vh-bfacts">
            <button type="button" className="vh-cbtn vh-sm" disabled={saving} onClick={addDeclare}>
              {saving ? <><span className="vh-spin" /> Recording…</> : 'Add purchase'}
            </button>
            <button type="button" className="vh-dismiss" onClick={cancelDeclare}>cancel</button>
          </div>
        </div>
      ) : (
        <>
          {addedPo && (
            <div className="vh-added" key={addedPo}>✓ Recorded in Purchase Orders · <b style={{ ...nums }}>{addedPo}</b></div>
          )}
          <button type="button" className="ch-newbtn" onClick={startDeclare}><span className="ch-newbtn-plus">+</span> Add a new bill</button>
        </>
      )}

      {targets.length > 0 && (
        <div className="vh-summary" style={{ ...nums }}>
          <div className="vh-sumrow"><span>Total bills balance</span><span>{rupee(totalDue)}</span></div>
          <div className="vh-sumrow"><span>This payment applied</span><span className="vh-sum-neg">− {rupee(placed)}</span></div>
          <div className="vh-sumdiv" />
          <div className="vh-sumrow vh-sumtotal"><span>Remaining balance</span><span>{rupee(Math.max(0, totalDue - placed))}</span></div>
        </div>
      )}

      <div className="vh-confirmbar">
        <button type="button" className="vh-cbtn" disabled={busy || placed === 0} onClick={confirmAll}>Link payment</button>
        <button type="button" className="vh-dismiss" onClick={onClose}>cancel</button>
      </div>
      {err && <p className="vh-err">{err}</p>}
    </div>
  );
}

const Check = <svg viewBox="0 0 24 24" className="ch-check"><path d="M5 13l4 4L19 7" /></svg>;

function VendorConfirm({ p, onDone }: { p: ConfirmPayload; onDone: () => void }) {
  const numRef = useRef<HTMLElement>(null);
  const credit = p.balAfter < 0;
  const anyPlaced = p.hits.length > 0;
  const amber = p.advance > 0;

  useEffect(() => {
    const target = Math.abs(p.balAfter);
    if (prefersReduced()) { if (numRef.current) numRef.current.textContent = rupee(target); return; }
    tweenVal(p.balBefore, target, 1000, (val) => { if (numRef.current) numRef.current.textContent = rupee(val); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let foot: string;
  if (p.advance > 0 && !anyPlaced) foot = 'Held as credit on the balance. It clears itself the moment a bill lands against it.';
  else if (p.advance > 0) foot = 'Bills updated. The extra is held as credit until a bill claims it.';
  else if (p.hits.some((h) => h.kind === 'buy')) foot = 'Recorded. A bill makes it count for GST and stock.';
  else foot = 'Bills updated. Anything still due stays in your pending list.';

  return (
    <div className="ch-confirm" style={{ ...font }}>
      <div className={`ch-seal${amber ? ' vh-seal-amber' : ''}`}>{Check}</div>
      <div className="ch-cf-title" style={{ ...serif }}>{p.title}</div>
      <div className="ch-cf-sub">{p.vendor}</div>

      {/* a plain statement: this payment → where it went → balance before/after */}
      <div className="ch-cf-card">
        <div className="vh-stmt-top">
          <span>This payment</span>
          <span className="vh-stmt-pay" style={{ ...nums }}>{rupee(p.pay)}</span>
        </div>

        {(anyPlaced || amber) && <div className="vh-stmt-label">Went to</div>}
        {p.hits.map((h) => {
          const cleared = h.left <= 0;
          return (
            <div className="vh-stmt-row" key={h.key}>
              <span className="vh-stmt-l">
                <span className="vh-stmt-nm">{h.name}</span>
                <span className={`vh-stmt-sub${cleared ? ' clr' : ''}`} style={{ ...nums }}>
                  {cleared ? (h.kind === 'buy' ? '✓ paid in full' : '✓ cleared') : `balance ${rupee(h.left)} left`}
                </span>
              </span>
              <span className="vh-stmt-amt" style={{ ...nums }}>{rupee(h.applied)}</span>
            </div>
          );
        })}
        {amber && (
          <div className="vh-stmt-row">
            <span className="vh-stmt-l">
              <span className="vh-stmt-nm">Held as advance</span>
              <span className="vh-stmt-sub">credit with {p.vendor}</span>
            </span>
            <span className="vh-stmt-amt vh-adv" style={{ ...nums }}>{rupee(p.advance)}</span>
          </div>
        )}

        <div className="vh-cf-div" />
        <div className="vh-stmt-bal">
          <span className="vh-stmt-was" style={{ ...nums }}>was {rupee(p.balBefore)}</span>
          <span className="vh-stmt-now">
            <b ref={numRef} style={{ ...serif, ...nums }}>{rupee(p.balBefore)}</b>
            <span>{credit ? 'in credit now' : 'you owe now'}</span>
          </span>
        </div>
      </div>

      <div className="ch-cf-foot">{foot}</div>
      <button type="button" className="ch-cf-done" onClick={onDone}>Done</button>
    </div>
  );
}

// Vendor-hub structural CSS. Confirmation reuses the job hub's ch-confirm/ch-seal/
// ch-cf-* classes (injected via CONTRACT_HUB_CSS) so the two hubs share one motion.
export const VENDOR_HUB_CSS = `
.vh-root{padding:20px}
.vh-looking{color:${V.faint};font-size:12px}
.vh-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.vh-name{font-size:17px;letter-spacing:-.01em;color:${V.ink}}
.vh-balq{font-size:12px;color:${V.faint}}
.vh-balq b{color:${V.sys};font-weight:600}
.vh-qline{font-size:16px;line-height:1.35;margin:15px 0 14px;color:${V.ink}}
.vh-subhead{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${V.faint};display:flex;align-items:center;gap:9px;margin:4px 0 10px}
.vh-subhead::after{content:"";flex:1;height:1px;background:${V.line}}
.vh-shh{font-weight:500;letter-spacing:0;text-transform:none;font-size:11px;color:${V.faint};opacity:.85}
.vh-ctxcard{background:${V.surface};border:1px solid ${V.line};border-radius:12px;padding:13px 15px;margin-bottom:13px}
.vh-ct1{font-size:13px;color:${V.ink}}.vh-ct1 b{font-weight:600}
.vh-ct2{font-size:11.5px;color:${V.faint};margin-top:5px;line-height:1.5}
.vh-bills{display:flex;flex-direction:column;gap:8px}
.vh-bill{display:flex;align-items:center;gap:11px;background:${V.surface};border:1px solid ${V.line};border-left:3px solid ${V.line};border-radius:11px;padding:11px 13px;transition:box-shadow .15s,border-color .15s,transform .12s}
.vh-bill:hover{box-shadow:0 4px 14px -6px rgba(34,26,19,.18);border-color:#dcd2c2}
.vh-bill:active{transform:scale(.995)}
.vh-bill.vh-bill-on{border-left-color:${V.terra}}
.vh-bill.vh-buy{border-top-style:dashed;border-right-style:dashed;border-bottom-style:dashed;border-top-color:#dcb49d;border-right-color:#dcb49d;border-bottom-color:#dcb49d}
.vh-bnum{font-size:11px;font-weight:600;color:${V.faint};min-width:13px;text-align:right;flex:0 0 auto}
.vh-balloc-amt{font-size:14.5px;font-weight:700;color:${V.terraDeep}}
.vh-balloc-none{font-size:13px;color:${V.faint}}
.vh-summary{margin-top:13px;background:${V.surface};border:1px solid ${V.line};border-radius:12px;padding:13px 15px}
.vh-sumrow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12.5px;color:${V.sys};margin:7px 0}
.vh-sumrow:first-child{margin-top:0}
.vh-sumrow>span:last-child{font-weight:600;color:${V.ink}}
.vh-sum-neg{color:${V.terraDeep}!important}
.vh-sumdiv{height:1px;background:${V.line};margin:10px 0}
.vh-sumtotal>span:first-child{font-weight:600;color:${V.ink};font-size:13px}
.vh-sumtotal>span:last-child{font-size:16px;font-weight:700;color:${V.ink}}
.vh-sumnote{margin-top:10px;font-size:11px;color:${V.sage};line-height:1.5}
.vh-crow-sel{border-color:#dba78d !important;border-left-color:${V.terra} !important;background:#fffaf4 !important}
.vh-bl{display:flex;align-items:center;gap:11px;min-width:0;flex:1}
.vh-bic{width:26px;height:26px;border-radius:7px;background:${V.field};display:grid;place-items:center;font-size:13px;flex:0 0 auto}
.vh-bn{font-weight:600;font-size:13.5px;color:${V.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vh-bp{color:${V.faint};font-size:11px;margin-top:2px}
.vh-bd{text-align:right;flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.vh-balloc{font-size:8.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${V.faint};opacity:.75}
.vh-bamt{display:flex;align-items:center;border:1.5px solid ${V.line};border-radius:9px;overflow:hidden;background:${V.surface};width:128px;transition:.14s}
.vh-bamt:focus-within{border-color:${V.terra};box-shadow:0 0 0 3px rgba(192,81,44,.1)}
.vh-bamt-over{border-color:${V.terra}}
.vh-bamt .vh-cu{padding:8px 9px;font-size:12.5px}
.vh-bamt input{flex:1;min-width:0;border:0;outline:0;padding:8px 9px;font-size:13px;font-weight:600;color:${V.ink};background:transparent;text-align:right}
.vh-bamt input::placeholder{color:#c0b6a7;font-weight:400}
.vh-beff{font-size:11px;font-weight:600}
.vh-beff-clr{color:${V.sage}}
.vh-beff-part{color:${V.terraDeep}}
.vh-beff-none{color:${V.faint};font-weight:400}
.vh-added{margin-top:11px;font-size:12px;color:${V.sage};font-weight:500;display:flex;align-items:center;gap:6px;animation:vhAdded .35s cubic-bezier(.22,1,.36,1)}
.vh-added b{color:${V.sage};font-weight:700}
@keyframes vhAdded{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.vh-addrow{margin-top:10px;width:100%;text-align:left;background:${V.surface};border:1.5px dashed ${V.line};border-radius:11px;padding:12px 14px;font-size:13px;font-weight:600;color:${V.terraDeep};cursor:pointer;transition:.14s;font-family:inherit}
.vh-addrow:hover{border-color:${V.terra};background:#fffdfa}
.vh-buyform{margin-top:10px;background:${V.surface};border:1.5px solid ${V.terra};border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:9px;box-shadow:0 0 0 3px rgba(192,81,44,.08)}
.vh-fin{border:1.5px solid ${V.line};border-radius:10px;padding:10px 12px;font-size:13.5px;font-weight:500;color:${V.ink};background:${V.surface};outline:0;transition:.14s;font-family:inherit}
.vh-fin:focus{border-color:${V.terra}}
.vh-fin::placeholder{color:#c0b6a7}
.vh-finrow{display:flex;align-items:center;border:1.5px solid ${V.line};border-radius:10px;overflow:hidden;background:${V.surface}}
.vh-finrow:focus-within{border-color:${V.terra}}
.vh-cu{background:${V.field};color:${V.sys};font-weight:600;border-right:1px solid ${V.line}}
.vh-finrow .vh-cu{padding:10px 12px}
.vh-finrow input{flex:1;border:0;outline:0;padding:10px 12px;font-size:13.5px;font-weight:500;color:${V.ink};min-width:0;background:transparent}
.vh-finrow input::placeholder{color:#c0b6a7}
.vh-billrow{margin-top:1px}
.vh-billatt{background:transparent;border:0;padding:0;font-size:12px;font-weight:500;color:${V.terra};cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-family:inherit}
.vh-billatt:hover{color:${V.terraDeep}}
.vh-opt{color:${V.faint};font-weight:400}
.vh-reading{color:${V.sys};cursor:default}
.vh-ok{color:${V.sage};cursor:default}
.vh-spin{width:13px;height:13px;border-radius:50%;border:2px solid #e3d3c4;border-top-color:${V.terra};animation:vhSp .8s linear infinite;display:inline-block}
@keyframes vhSp{to{transform:rotate(360deg)}}
.vh-bfacts{display:flex;gap:10px;align-items:center;margin-top:2px}
.vh-cbtn{background:${V.terra};color:#fff;border:0;border-radius:11px;padding:12px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:.14s;font-family:inherit}
.vh-cbtn:hover{background:${V.terraDeep}}
.vh-cbtn:disabled{opacity:.6;cursor:default}
.vh-cbtn.vh-sm{padding:8px 14px;font-size:12.5px}
.vh-dismiss{background:transparent;border:0;color:${V.faint};font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit}
.vh-dismiss:hover{color:${V.sys}}
.vh-advsec{margin-top:16px;padding-top:15px;border-top:1px dashed ${V.line};display:flex;align-items:center;gap:12px}
.vh-asl{flex:1}
.vh-ash{font-size:13px;font-weight:600;color:${V.ask}}
.vh-ash.vh-over{color:${V.terra}}
.vh-ass{font-size:11.5px;color:${V.faint};margin-top:3px;line-height:1.45}
.vh-astag{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${V.ask};background:${V.askWash};border:1px solid ${V.askLine};border-radius:7px;padding:4px 8px;flex:0 0 auto}
.vh-confirmbar{margin-top:18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.vh-err{margin-top:10px;color:${V.terra};font-size:11.5px;line-height:1.4}
.vh-cf-div{height:1px;background:${V.line};margin:12px 0}
.vh-stmt-top{display:flex;justify-content:space-between;align-items:baseline}
.vh-stmt-top>span:first-child{font-size:12.5px;color:${V.sys}}
.vh-stmt-pay{font-size:15px;font-weight:700;color:${V.terraDeep}}
.vh-stmt-label{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${V.faint};margin:14px 0 9px}
.vh-stmt-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:9px 0}
.vh-stmt-l{display:flex;flex-direction:column;min-width:0}
.vh-stmt-nm{font-size:13px;font-weight:500;color:${V.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vh-stmt-sub{font-size:11px;color:${V.faint};margin-top:2px}
.vh-stmt-sub.clr{color:${V.sage};font-weight:600}
.vh-stmt-amt{font-size:13.5px;font-weight:600;color:${V.inkSoft};flex:0 0 auto;white-space:nowrap}
.vh-stmt-amt.vh-adv{color:${V.ask}}
.vh-stmt-bal{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.vh-stmt-was{font-size:11.5px;color:${V.faint}}
.vh-stmt-now{display:flex;align-items:baseline;gap:7px}
.vh-stmt-now b{font-size:24px;color:${V.ink};letter-spacing:-.01em}
.vh-stmt-now>span{font-size:11.5px;color:${V.faint}}
.vh-seal-amber{background:#fef3e0}
.vh-seal-amber path{stroke:${V.ask}}
.vh-seal-amber::after{border-color:${V.ask}}
`;
