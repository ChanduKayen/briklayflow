/**
 * BillRowCard — a captured BILL, in the SAME language as the mobile payment card (ReviewMobile's
 * `.rvm rcard`): one voucher, the fact up top, the `.kv` collapsible pickers, the `.wal` cash block,
 * one `.cta`. Read-first, like a payment card — you approve, and only the blanks ask for you.
 *
 * The write path is unchanged and proven: it reuses fileBill exactly as the old BillReviewCard did
 * (files into `bills`, plus one attached payment when "also paid" is on). This card only changes the
 * look + interaction so a bill reads and behaves like every other card on the phone.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RoughEntry } from '../../types';
import type { StakeholderLite, ProjectLite } from './ReviewCard';
import { NatureChip } from './atoms';
import { fileBill, createParty, errMessage } from './fileEntry';
import { walletForSender } from '../../lib/walletApi';
import { useSignedDocUrl } from '../../lib/storage';
import { matchPayee } from '../../lib/payeeSearch';

const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const low = (s: string | null | undefined) => (s ?? '').toLowerCase().trim();
const first = (s: string) => (s || '').split(' ')[0];

const CHEV = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
);

function guessVendor(name: string | null | undefined, stakeholders: StakeholderLite[]): StakeholderLite | null {
  const n = low(name);
  if (!n) return null;
  const vendors = stakeholders.filter((s) => !s.type || /vendor|supplier/i.test(s.type));
  const pool = vendors.length ? vendors : stakeholders;
  const m = matchPayee(name, pool.map((s) => ({ stakeholder_id: s.stakeholder_id, name: s.name, type: s.type ?? null, category: s.category ?? null, aliases: s.aliases ?? null })));
  return m.best ? (pool.find((s) => s.stakeholder_id === m.best!.id) ?? null) : null;
}

export function BillRowCard({
  entry, orgId, stakeholders, projects, onFiled, onDismiss, onError, onVendorCreated,
}: {
  entry: RoughEntry;
  orgId: string;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  onFiled: () => void;
  onDismiss: () => void;
  onLightbox: (url: string) => void;
  onError: (message: string) => void;
  onVendorCreated?: () => void;
}) {
  const ai = (entry.ai_extracted || {}) as RoughEntry['ai_extracted'];
  const docUrl = useSignedDocUrl(entry.raw_image_url) ?? entry.raw_image_url ?? null;

  const vendorMatch = useMemo(() => guessVendor(ai.vendor_name, stakeholders), [ai.vendor_name, stakeholders]);
  const projMatch = useMemo(() => {
    const p = low(ai.project_raw);
    return p ? projects.find((x) => low(x.name) === p || low(x.name).includes(p) || p.includes(low(x.name))) ?? null : null;
  }, [ai.project_raw, projects]);
  const capturedPaid = ai.payment?.amount != null && ai.payment.amount > 0 ? ai.payment.amount : null;

  const [vendorId, setVendorId] = useState(vendorMatch?.stakeholder_id ?? '');
  const [vendorName, setVendorName] = useState(vendorMatch?.name ?? (ai.vendor_name ?? ''));
  const [projectId, setProjectId] = useState(projMatch?.project_id ?? '');
  const [amount, setAmount] = useState(ai.bill_total != null ? String(ai.bill_total) : '');
  const [paidOn, setPaidOn] = useState(!!capturedPaid);
  const [paidAmt, setPaidAmt] = useState(capturedPaid != null ? String(capturedPaid) : '');
  const [funding, setFunding] = useState<'wallet' | 'bank' | null>(null);
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState<null | 'vendor' | 'site'>(null);
  const [ddq, setDdq] = useState('');
  const [ddTyping, setDdTyping] = useState(false);   // the field has the real cursor (and the keyboard)
  const [flash, setFlash] = useState<null | 'vendor' | 'site'>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);   // the bill doc, full-screen
  const isPdf = !!docUrl && /\.pdf(\?|$)/i.test(docUrl);
  const openDoc = () => { if (!docUrl) return; if (isPdf) window.open(docUrl, '_blank', 'noopener'); else setLightbox(docUrl); };
  const cardRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLInputElement>(null);

  const { data: senderWallet } = useQuery({ queryKey: ['sender_wallet', orgId, entry.sender_number], queryFn: () => walletForSender(orgId, entry.sender_number), enabled: !!orgId && !!entry.sender_number });
  const fromWallet = funding === 'wallet' ? true : funding === 'bank' ? false : !!(senderWallet && senderWallet.balance > 0);

  const total = parseFloat(String(amount).replace(/[^\d.]/g, '')) || 0;
  const paidVal = parseFloat(String(paidAmt).replace(/[^\d.]/g, '')) || 0;
  const effectivePaid = paidOn && paidVal > 0 ? paidVal : null;

  const projectName = projectId ? projects.find((x) => x.project_id === projectId)?.name ?? null : null;
  const via = entry.source?.startsWith('WHATSAPP') ? 'WhatsApp' : 'Briklay';
  const sentTime = new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const message = (entry.transcribed_text || entry.raw_text || '').trim();
  const isNewVendor = !vendorId && !!vendorName.trim();

  const vendorRows = useMemo(() => {
    const q = ddq.trim(), ql = q.toLowerCase();
    const hit = (n: string) => !ql || n.toLowerCase().includes(ql);
    const isV = (s: StakeholderLite) => !s.type || /vendor|supplier/i.test(s.type);
    const pool = [...stakeholders.filter(isV), ...stakeholders.filter((s) => !isV(s))].filter((s) => hit(s.name)).slice(0, 6);
    const rows: { name: string; id: string | null; tag?: string; create?: boolean }[] = [];
    if (q && !pool.some((s) => s.name.toLowerCase() === ql)) rows.push({ name: q, id: null, tag: 'new vendor', create: true });
    pool.forEach((s) => rows.push({ name: s.name, id: s.stakeholder_id, tag: s.type ?? undefined }));
    return rows;
  }, [ddq, stakeholders]);

  // The same rule the payee picker follows: opening a picker arms its search box, it does not take
  // the keyboard. A tap on the field is what asks for typing.
  const toggleSug = (which: 'vendor' | 'site') => setSug((cur) => (cur === which ? null : which));

  const nudge = (which: 'vendor' | 'site') => {
    cardRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 380, easing: 'ease' },
    );
    setFlash(null);
    requestAnimationFrame(() => setFlash(which));
    if (sug !== which) toggleSug(which);
  };

  async function pickCreateVendor(name: string) {
    const nm = name.trim();
    if (!nm) return;
    try {
      const v = await createParty(nm, 'Vendor', orgId);
      setVendorId(v.id); setVendorName(v.name); onVendorCreated?.();
    } catch (e) { onError(errMessage(e, 'Could not add the vendor')); }
  }

  async function save() {
    if (!vendorId) return nudge('vendor');
    if (!projectId) return nudge('site');
    if (!(total > 0)) { onError('Add the bill amount first.'); return; }
    if (paidOn && !(paidVal > 0)) { onError('Add the amount paid, or turn off “also paid”.'); return; }
    setBusy(true);
    try {
      await fileBill(entry, orgId, { vendorId, projectId, amount: total, paidAmount: effectivePaid, funding: (effectivePaid && senderWallet) ? (fromWallet ? 'wallet' : 'bank') : undefined });
      onFiled();
    } catch (e) { onError(errMessage(e, 'Could not save the bill')); }
    finally { setBusy(false); }
  }

  const saveLabel = busy ? 'Saving…' : (effectivePaid ? `Save bill + log ₹${inr(effectivePaid)}` : 'Save bill');

  return (
    <div className="rcard enter" ref={cardRef}>
      <div className="top">
        <NatureChip label={effectivePaid ? 'Bill · Paid' : 'Bill'} tone="terra" />
        <div className="f">{via} · {sentTime}{ai.bill_no ? ` · Nº ${ai.bill_no}` : ''}</div>
      </div>

      {/* the figure and, beside it, the bill itself — evidence in reach without crowding the fact */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="amt" style={{ flex: 1, minWidth: 0 }}>{total > 0 ? `₹${inr(total)}` : <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink-3)' }}>Enter the amount below</span>}</div>
        {docUrl && (
          <button type="button" onClick={openDoc} title="View the bill"
            style={{ width: 62, height: 62, borderRadius: 12, overflow: 'hidden', flexShrink: 0, padding: 0, cursor: 'pointer', border: '1px solid var(--hair)', background: 'rgba(27,23,19,.04)', position: 'relative' }}>
            {isPdf
              ? <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>PDF</span>
              : <img src={docUrl} alt="Bill" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            <span style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(20,16,12,.62)', color: '#fff', fontSize: 8.5, fontWeight: 700, letterSpacing: '.04em', padding: '2px 4px', borderRadius: 5 }}>BILL</span>
          </button>
        )}
      </div>

      <div className="kvs">
        {/* Vendor */}
        <button type="button" className={`kv tap${sug === 'vendor' ? ' open' : ''}${flash === 'vendor' ? ' flash' : ''}`} onClick={() => toggleSug('vendor')}>
          <div className="k">Vendor</div>
          <div className={`v${vendorName ? '' : ' dim'}`}>{vendorName || 'Add a vendor'}</div>
          <span className="chev">{CHEV}</span>
        </button>
        <div className={`sug${sug === 'vendor' ? ' open' : ''}`}>
          <div className="sug-w">
            <div className={`ddsearch${sug === 'vendor' && !ddTyping && !ddq ? ' armed' : ''}`} onClick={() => ddRef.current?.focus()}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              {sug === 'vendor' && !ddTyping && !ddq && <span className="caret" aria-hidden="true" />}
              <input ref={ddRef} value={ddq} onChange={(e) => setDdq(e.target.value)} placeholder="Search or type a new vendor"
                onFocus={() => setDdTyping(true)} onBlur={() => setDdTyping(false)} />
            </div>
            <div className="ddlist">
              {vendorRows.length === 0
                ? <div className="ddempty">No matches — keep typing to add a new vendor</div>
                : vendorRows.map((r, i) => (
                  <button type="button" className={`dd${r.create ? ' create' : ''}`} key={`${r.name}-${i}`}
                    onClick={() => { if (r.create) { void pickCreateVendor(r.name); } else { setVendorId(r.id ?? ''); setVendorName(r.name); } setSug(null); setDdq(''); }}>
                    <div className="dn">{r.create ? `Add “${r.name}”` : r.name}</div>
                    {r.tag && <div className="dt">{r.tag}</div>}
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Site */}
        <button type="button" className={`kv tap${sug === 'site' ? ' open' : ''}${flash === 'site' ? ' flash' : ''}`} onClick={() => toggleSug('site')}>
          <div className="k">Site</div>
          <div className={`v${projectName ? '' : ' dim'}`}>{projectName || ai.project_raw || 'Pick a site'}</div>
          <span className="chev">{CHEV}</span>
        </button>
        <div className={`sug${sug === 'site' ? ' open' : ''}`}>
          <div className="sug-w">
            <div className="ddlist">
              {projects.map((s) => (
                <button type="button" className="dd" key={s.project_id} onClick={() => { setProjectId(s.project_id); setSug(null); }}>
                  <div className="dn">{s.name}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Amount — editable, in the same row language */}
        <div className="kv">
          <div className="k">Amount</div>
          <input className="v" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Total on the bill"
            style={{ border: 0, background: 'none', outline: 'none', font: 'inherit', fontSize: 15.5, fontWeight: 600 }} />
        </div>
      </div>

      {/* Also paid? — the single toggle; amount + funding reveal only when it's on */}
      <div className="wal">
        <button type="button" className={`walrow${paidOn ? ' on' : ''}`} onClick={() => setPaidOn((v) => !v)}>
          <span className="wl">
            <span className="wt">Also record a payment</span>
            <span className="ws">{paidOn ? 'A payment is logged against this bill' : 'For record only — no money moves'}</span>
          </span>
          <span className="wck">{paidOn ? '✓' : ''}</span>
        </button>
        {paidOn && (
          <div className="walrow fund">
            <span className="wl">
              <span className="wt">Amount paid</span>
              <input inputMode="numeric" value={paidAmt} onChange={(e) => setPaidAmt(e.target.value)} placeholder="How much was paid"
                style={{ marginTop: 6, width: '100%', border: 0, background: 'none', outline: 'none', font: 'inherit', fontSize: 15, fontWeight: 600 }} />
              {total > 0 && paidVal > 0 && paidVal < total && (
                <span className="ws" style={{ marginTop: 4 }}>Partial — ₹{inr(total - paidVal)} stays unpaid on the bill.</span>
              )}
            </span>
            {senderWallet && (
              <span className="seg">
                <button type="button" className={fromWallet ? 'on' : ''} onClick={() => setFunding('wallet')}>{first(senderWallet.holderName)}’s cash</button>
                <button type="button" className={!fromWallet ? 'on' : ''} onClick={() => setFunding('bank')}>Bank</button>
              </span>
            )}
          </div>
        )}
      </div>

      {isNewVendor && (
        <div className="notice newp"><i /><div><b>{vendorName}</b> is new — saved as a vendor when you file.</div></div>
      )}

      {message && (
        <>
          <button type="button" className={`srcline${msgOpen ? ' open' : ''}`} onClick={() => setMsgOpen((o) => !o)}>See the message{CHEV}</button>
          <div className={`msg${msgOpen ? ' open' : ''}`}><div className="msg-w"><div className="m-in">“{message}”</div></div></div>
        </>
      )}

      <div className="ctarow">
        <button type="button" className="cta" disabled={busy} onClick={() => void save()}>{saveLabel}</button>
        <button type="button" className="splitbtn" onClick={onDismiss} aria-label="Not a bill">Not a bill</button>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} role="dialog" aria-label="Bill"
          style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(12,9,6,.92)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <img src={lightbox} alt="Bill" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
          <button type="button" onClick={() => setLightbox(null)} aria-label="Close"
            style={{ position: 'fixed', top: 'calc(14px + env(safe-area-inset-top))', right: 16, width: 42, height: 42, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}
