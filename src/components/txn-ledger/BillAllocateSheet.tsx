/**
 * BillAllocateSheet — attach a vendor payment to its BILLS (the payment→bill allocation writer).
 *
 * Doctrine (payments settle bills, not POs):
 *   · shows the vendor's unpaid bills with remaining amounts;
 *   · exact-match (payment == one bill's remaining) pre-selects it;
 *   · multi-select to clear several bills with one payment; partial when the payment is smaller;
 *   · "Upload a new one" mid-payment — vendor already known, so extract → mint → allocate in one motion;
 *   · "No bill" is a legal exit — the remainder is the without-bills bucket, untouched;
 *   · advance against an order → an optional inert "towards PO-xxx" memo (tracking, never a money link).
 *
 * Writes via set_txn_allocations (complete-set replace; parts sum to the txn total).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, FileText, Plus, Loader2, Check, Eye } from 'lucide-react';
import { V, font } from './ledgerTokens';
import { openDoc, useSignedDocUrl } from '../../lib/storage';

const BLZ_CSS = `
.blz-row{transition:border-color .14s ease, background .14s ease, box-shadow .16s ease, transform .1s ease}
.blz-row:hover{background:#F8E7DE;border-color:rgba(180,83,47,.55)!important;box-shadow:0 4px 14px -10px rgba(180,83,47,.45)}
.blz-row.on{box-shadow:0 6px 18px -12px rgba(180,83,47,.5)}
.blz-head{transition:background .12s ease}
.blz-peek{opacity:.55;transition:opacity .14s ease, background .14s ease, color .14s ease}
.blz-row:hover .blz-peek{opacity:1}
.blz-peek:hover{color:#B4532F}
.blz-peekwrap{animation:blzPeek .18s cubic-bezier(.2,.8,.2,1) both}
@keyframes blzPeek{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.blz-upload{transition:background .15s ease, border-color .15s ease, transform .1s ease, box-shadow .16s ease}
.blz-upload:hover{background:#F8E7DE;box-shadow:0 6px 16px -10px rgba(180,83,47,.5)}
.blz-upload:active{transform:scale(.99)}
/* skeleton loading rows — shimmer while the vendor's bills load */
.blz-sk{position:relative;overflow:hidden;background:#EFE8DB;border-radius:6px}
.blz-sk::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.6),transparent);animation:blzShimmer 1.25s infinite}
@keyframes blzShimmer{100%{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.blz-sk::after{animation:none}}
`;

// A shimmering placeholder row shown while the vendor's bills load.
function SkeletonRow() {
  return (
    <div className="rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="blz-sk shrink-0" style={{ width: 18, height: 18, borderRadius: 5 }} />
        <span className="min-w-0 flex-1">
          <span className="blz-sk block" style={{ width: '55%', height: 11, marginBottom: 6 }} />
          <span className="blz-sk block" style={{ width: '38%', height: 9 }} />
        </span>
      </div>
    </div>
  );
}

// Inline bill peek — the signed image right in the sheet (no new tab). PDFs get a quiet open link.
function BillPeekImg({ stored }: { stored: string }) {
  const signed = useSignedDocUrl(stored);
  const isPdf = /\.pdf(\?|$)/i.test(stored);
  if (isPdf) return (
    <button type="button" onClick={(e) => { e.stopPropagation(); void openDoc(stored); }} className="text-[12px] underline" style={{ color: V.terraDeep, textUnderlineOffset: 3 }}>Open the PDF bill</button>
  );
  if (!signed) return <div className="text-[11.5px]" style={{ color: V.faint }}>Loading preview…</div>;
  return <img src={signed} alt="Bill" style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, border: `1px solid ${V.line}`, display: 'block' }} />;
}
import {
  loadUnpaidBillsForVendor, extractBill, createBill, findDuplicateBill, saveBillAllocations, setAdvanceMemo,
  type UnpaidBill, type DuplicateBill,
} from '../../lib/billsApi';

const num = (n: unknown) => Number(n) || 0;
const inr = (n: number) => '₹' + Math.round(num(n)).toLocaleString('en-IN');
const errMsg = (e: unknown) => (e instanceof Error ? e.message : '') || 'Something went wrong';

export function BillAllocateSheet({ txnId, orgId, stakeholderId, vendorName, amount, defaultProjectId, onClose, onDone }: {
  txnId: string; orgId: string; stakeholderId: string; vendorName: string; amount: number;
  defaultProjectId: string | null; onClose: () => void; onDone: () => void;
}) {
  const [bills, setBills] = useState<UnpaidBill[] | null>(null);
  const [sel, setSel] = useState<Record<string, number>>({});     // billId → amount allocated
  const [advanceMemoOn, setAdvanceMemoOn] = useState(false);
  const [poMemo, setPoMemo] = useState('');
  const [busy, setBusy] = useState<'idle' | 'reading' | 'saving' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<{ file: string; d: DuplicateBill } | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);   // hover/tap → inline bill preview
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the vendor's unpaid bills; pre-select on an exact remaining match.
  useEffect(() => {
    let live = true;
    loadUnpaidBillsForVendor(stakeholderId).then(bs => {
      if (!live) return;
      setBills(bs);
      const exact = bs.find(b => Math.abs(b.remaining - amount) < 1);
      if (exact) setSel({ [exact.id]: exact.remaining });
    }).catch(e => { if (live) setErr(errMsg(e)); });
    return () => { live = false; };
  }, [stakeholderId, amount]);

  const allocated = useMemo(() => Object.values(sel).reduce((s, v) => s + num(v), 0), [sel]);
  const remainder = Math.round((amount - allocated) * 100) / 100;
  const over = allocated > amount + 0.5;

  const toggle = (b: UnpaidBill) => {
    setSel(s => {
      if (s[b.id] != null) { const n = { ...s }; delete n[b.id]; return n; }
      const leftover = Math.max(0, amount - Object.values(s).reduce((x, v) => x + num(v), 0));
      return { ...s, [b.id]: Math.min(b.remaining, leftover) || b.remaining };
    });
  };
  const setAmt = (b: UnpaidBill, v: number) => setSel(s => ({ ...s, [b.id]: Math.max(0, Math.min(b.remaining, v)) }));

  // Upload a new bill mid-payment — vendor known, so extract → dup-check → mint → select it.
  const onUpload = async (file: File) => {
    setErr(null); setBusy('reading');
    try {
      const ex = await extractBill(file);
      if (ex.billNo) {
        const d = await findDuplicateBill(stakeholderId, ex.billNo);
        if (d) { setDup({ file: file.name, d }); /* still mint below unless they cancel? keep simple: warn + proceed */ }
      }
      const billId = await createBill({
        orgId, stakeholderId, projectId: defaultProjectId, billNo: ex.billNo, billDate: ex.billDate,
        amount: ex.amount, lines: ex.lines, file,
      });
      const remaining = ex.amount;
      const newBill: UnpaidBill = { id: billId, kind: 'bill', billNo: ex.billNo, billDate: ex.billDate, amount: ex.amount, paid: 0, remaining, projectId: defaultProjectId, site: null, docUrl: null };
      setBills(bs => [newBill, ...(bs ?? [])]);
      const leftover = Math.max(0, amount - allocated);
      setSel(s => ({ ...s, [billId]: Math.min(remaining, leftover) || remaining }));
      setBusy('idle');
    } catch (e) { setErr(errMsg(e)); setBusy('idle'); }
  };

  const confirm = async () => {
    if (over) return;
    setBusy('saving'); setErr(null);
    try {
      const picks = Object.entries(sel).filter(([, v]) => num(v) > 0).map(([id, v]) => {
        const b = bills?.find(x => x.id === id);
        return { id, kind: (b?.kind ?? 'bill') as 'bill' | 'po', projectId: b?.projectId ?? defaultProjectId, amount: num(v) };
      });
      await saveBillAllocations(txnId, orgId, amount, picks, defaultProjectId);
      if (advanceMemoOn && poMemo.trim()) await setAdvanceMemo(txnId, poMemo.trim());
      setBusy('done');
      onDone();
      window.setTimeout(onClose, 700);
    } catch (e) { setErr(errMsg(e)); setBusy('saving' === busy ? 'idle' : 'idle'); setBusy('idle'); }
  };

  const noBills = bills && bills.length === 0;

  return (
    <div style={{ ...font }}>
      <style>{BLZ_CSS}</style>
      <div className="flex items-start justify-between px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${V.line}` }}>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold" style={{ color: V.ink }}>Attach bill</p>
          <p className="text-[12px] mt-0.5 truncate" style={{ color: V.sys }}>Paying {vendorName} · <span style={{ color: V.ink, fontWeight: 600 }}>{inr(amount)}</span></p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg shrink-0" style={{ color: V.faint }} aria-label="Close"><X size={16} /></button>
      </div>

      <div className="px-4 py-3.5" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onUpload(f); }} />

        {bills == null ? (
          <>
            <p className="text-[13px] font-medium mb-2" style={{ color: V.faint }}>Finding {vendorName}&apos;s bills…</p>
            <div className="space-y-1.5">
              <SkeletonRow /><SkeletonRow /><SkeletonRow />
            </div>
          </>
        ) : noBills ? (
          /* No existing bills — uploading is the hero; the advance is just the quiet fallback. */
          <div className="text-center py-2">
            <div className="mx-auto grid place-items-center rounded-full mb-3" style={{ width: 44, height: 44, background: V.field }}><FileText size={20} style={{ color: V.faint }} /></div>
            <p className="text-[13px] font-medium" style={{ color: V.ink }}>No bills for {vendorName} yet</p>
            <p className="text-[12px] mt-1 mb-4" style={{ color: V.sys }}>Upload the bill this payment is for.</p>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'reading'}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold"
              style={{ background: V.terra, color: '#fff', opacity: busy === 'reading' ? 0.6 : 1 }}>
              {busy === 'reading' ? <><Loader2 size={16} className="animate-spin" /> Reading the bill…</> : <><Plus size={16} /> Upload a new bill</>}
            </button>
            {dup && <p className="text-[11.5px] mt-2" style={{ color: V.terraDeep }}>Heads up — {vendorName} already has a bill {dup.d.billNo ? <>no. <b>{dup.d.billNo}</b> </> : ''}on file{dup.d.amount ? ` (${inr(dup.d.amount)})` : ''}. Added anyway; remove it from Bills if it&apos;s the same one.</p>}
            <label className="flex items-center justify-center gap-2 mt-4 text-[11.5px]" style={{ color: V.sys }}>
              <input type="checkbox" checked={advanceMemoOn} onChange={(e) => setAdvanceMemoOn(e.target.checked)} style={{ accentColor: V.terra }} />
              No bill — note it&apos;s towards an order
            </label>
            {advanceMemoOn && (
              <input value={poMemo} onChange={(e) => setPoMemo(e.target.value)} placeholder="PO-… (optional memo, not a money link)"
                className="w-full mt-2 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none text-center" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink }} />
            )}
            {err && <p className="text-[12.5px] mt-2" style={{ color: V.terra }}>{err}</p>}
          </div>
        ) : (
          <>
            <p className="text-[13px] font-medium mb-2" style={{ color: V.ink }}>Which bill{bills.length > 1 ? 's' : ''} is this payment for?</p>

            <div className="space-y-1.5">
              {bills.map(b => {
                const on = sel[b.id] != null;
                const showPeek = peekId === b.id && !!b.docUrl;
                return (
                  <div key={b.id} className={`blz-row rounded-xl${on ? ' on' : ''}`} style={{ background: V.surface, border: `1px solid ${on ? V.terra : V.line}` }}
                    onMouseEnter={() => { if (b.docUrl) setPeekId(b.id); }}
                    onMouseLeave={() => setPeekId(p => (p === b.id ? null : p))}>
                    <div className="blz-head flex items-center gap-2.5 px-3 py-2.5">
                      <button type="button" onClick={() => toggle(b)} className="flex items-center gap-2.5 text-left flex-1 min-w-0">
                        <span className="grid place-items-center rounded-md shrink-0" style={{ width: 18, height: 18, border: `1.5px solid ${on ? V.terra : V.faint}`, background: on ? V.terra : 'transparent' }}>{on && <Check size={12} style={{ color: '#fff' }} />}</span>
                        <FileText size={15} className="shrink-0" style={{ color: V.faint }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium truncate" style={{ color: V.ink }}>{b.billNo ? `#${b.billNo}` : 'Bill'}{b.site ? ` · ${b.site}` : ''}{b.kind === 'po' ? ' · on a PO' : ''}</span>
                          <span className="block text-[11px] truncate" style={{ color: V.faint }}>{inr(b.remaining)} remaining{b.paid > 0.5 ? ` · ${inr(b.paid)} paid of ${inr(b.amount)}` : ''}</span>
                        </span>
                      </button>
                      {b.docUrl && (
                        // Tap toggles the inline peek (touch has no hover); hover already reveals it.
                        <button type="button" onClick={(e) => { e.stopPropagation(); setPeekId(p => (p === b.id ? null : b.id)); }} title="Peek the bill"
                          className="blz-peek shrink-0 grid place-items-center rounded-lg" style={{ width: 30, height: 30, color: showPeek ? V.terra : V.faint, background: V.field }}>
                          <Eye size={15} />
                        </button>
                      )}
                    </div>
                    {showPeek && (
                      <div className="blz-peekwrap px-3 pb-3">
                        <BillPeekImg stored={b.docUrl!} />
                      </div>
                    )}
                    {on && (
                      <div className="flex items-center gap-2 px-3 pb-2.5" style={{ marginLeft: 28 }}>
                        <span className="text-[11.5px]" style={{ color: V.sys }}>Apply</span>
                        <span className="inline-flex items-center rounded-lg px-2" style={{ border: `1px solid ${V.line}`, background: V.field }}>
                          <span className="text-[12px]" style={{ color: V.faint }}>₹</span>
                          <input inputMode="numeric" value={String(Math.round(sel[b.id]))} onChange={(e) => setAmt(b, parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0)}
                            className="bg-transparent outline-none text-[12.5px] py-1 w-20 text-right" style={{ color: V.ink, fontVariantNumeric: 'tabular-nums' }} />
                        </span>
                        {sel[b.id] < b.remaining - 0.5 && <span className="text-[11px]" style={{ color: V.faint }}>partial</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Upload a new bill — the hero action, prominent even when bills exist. */}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'reading'}
              className="blz-upload w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl mt-3"
              style={{ background: V.terraWash, border: `1.5px dashed ${V.terra}`, opacity: busy === 'reading' ? 0.6 : 1 }}>
              {busy === 'reading' ? <Loader2 size={16} className="animate-spin shrink-0" style={{ color: V.terraDeep }} /> : <Plus size={16} className="shrink-0" style={{ color: V.terraDeep }} />}
              <span className="text-[13.5px] font-semibold" style={{ color: V.terraDeep }}>{busy === 'reading' ? 'Reading the bill…' : 'Upload a new bill'}</span>
            </button>

            {dup && (
              <p className="text-[11.5px] mt-2" style={{ color: V.terraDeep }}>Heads up — {vendorName} already has a bill {dup.d.billNo ? <>no. <b>{dup.d.billNo}</b> </> : ''}on file{dup.d.amount ? ` (${inr(dup.d.amount)})` : ''}. Added anyway; remove it from Bills if it&apos;s the same one.</p>
            )}

            {/* advance memo */}
            {remainder > 0.5 && (
              <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: V.field, border: `1px solid ${V.line}` }}>
                <p className="text-[12px]" style={{ color: V.sys }}>{inr(remainder)} of this payment isn&apos;t on a bill — it stays as an advance to {vendorName}.</p>
                <label className="flex items-center gap-2 mt-2 text-[12px]" style={{ color: V.ink }}>
                  <input type="checkbox" checked={advanceMemoOn} onChange={(e) => setAdvanceMemoOn(e.target.checked)} style={{ accentColor: V.terra }} />
                  Note it&apos;s towards an order (tracking only)
                </label>
                {advanceMemoOn && (
                  <input value={poMemo} onChange={(e) => setPoMemo(e.target.value)} placeholder="PO-… (optional memo, not a money link)"
                    className="w-full mt-2 rounded-lg px-2.5 py-1.5 text-[12.5px] outline-none" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink }} />
                )}
              </div>
            )}

            {err && <p className="text-[12.5px] mt-2" style={{ color: V.terra }}>{err}</p>}
            {over && <p className="text-[12.5px] mt-2" style={{ color: V.terra }}>That&apos;s {inr(allocated - amount)} more than the payment — trim a bill.</p>}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: `1px solid ${V.line}` }}>
        <span className="text-[12px]" style={{ color: V.sys }}>
          {allocated > 0.5 ? <><b style={{ color: V.ink }}>{inr(allocated)}</b> on bills{remainder > 0.5 ? ` · ${inr(remainder)} advance` : ''}</> : `Stays as an advance to ${vendorName}`}
        </span>
        {allocated > 0.5 ? (
          <button type="button" onClick={() => void confirm()} disabled={over || busy === 'saving' || busy === 'reading'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold" style={{ background: V.terra, color: '#fff', opacity: (over || busy === 'saving' || busy === 'reading') ? 0.5 : 1 }}>
            {busy === 'saving' ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : busy === 'done' ? <><Check size={14} /> Done</> : 'Attach'}
          </button>
        ) : (
          // No bill picked → it's already an advance; a quiet Done that only persists the optional memo.
          <button type="button" onClick={() => void confirm()} disabled={busy === 'saving' || busy === 'reading'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium" style={{ background: V.field, color: V.inkSoft, border: `1px solid ${V.line}` }}>
            {busy === 'saving' ? 'Saving…' : busy === 'done' ? <><Check size={14} /> Done</> : 'Done'}
          </button>
        )}
      </div>
    </div>
  );
}
