/**
 * Bills on a phone — the briklaybillsmobile reference, wired to the register.
 *
 * The reference is one column and one decision: what is still owed, and to whom. A collapsing
 * title, a search, one control (Unpaid / All), and rows carrying the bill's own photograph so you
 * can recognise the paper before you read the words. Its markup, its motion and its stylesheet are
 * ported as they are.
 *
 * Two things it left open, settled with the author:
 *  · TAPPING a row opens the bill's own page — lines, payments, the settle bar — rather than the
 *    mock's read-only sheet, which would have put those out of a phone's reach.
 *  · SWIPING a row right opens the pay sheet, and there Pay is real. Two ways money meets a bill:
 *    record the payment here and now, or point at one already sitting in the ledger, this vendor's
 *    and this site's, with the amount nearest what the bill is asking at the top of the list —
 *    because site offices pay first and file the paper days later.
 *
 * Adding a bill is deliberately absent from the page, as in the reference: the app's own create
 * button carries it, arriving here as ?new=1 — so the URL is what says the wizard is open, and
 * closing it is simply taking the parameter back off.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSignedDocUrl } from '../../lib/storage';
import { useSearchScope } from '../search/searchScope';
import {
  loadBills, payBill, loadLinkablePayments, linkPaymentToBill,
  type BillRow, type LinkablePayment,
} from '../../lib/billsApi';
import NewBillModal from './NewBillModal';
import { useMintBill } from './useMintBill';
import { BLM_CSS } from './blmCss';

type PayMode = 'NEFT' | 'UPI' | 'Cheque' | 'Cash';
const MODES: PayMode[] = ['NEFT', 'UPI', 'Cheque', 'Cash'];

const inr = (n: number) => Math.round(n).toLocaleString('en-IN');
const rupees = (n: number) => '₹' + inr(n);
const hapt = (ms: number | number[]) => { try { navigator.vibrate?.(ms as number); } catch { /* not every phone has it */ } };
const dueOf = (b: BillRow) => Math.max(0, b.amount - b.paid);
const isoToday = () => new Date().toLocaleDateString('en-CA');   // yyyy-mm-dd in the local day

/** "8 Sep" — the way a date is said out loud, which is all a row has room for. The months are
 *  spelled here rather than left to the locale: en-IN's short September is "Sept", four letters
 *  where every other month has three, and a column of dates should not jog. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getDate()} ${MON[dt.getMonth()]}`;
};
/** The caption a run of rows sits under. The year appears only when it isn't this one. */
const monthLabel = (d: string | null) => {
  if (!d) return 'Undated';
  const dt = new Date(d);
  const y = dt.getFullYear() === new Date().getFullYear() ? '' : ` ${dt.getFullYear()}`;
  return dt.toLocaleDateString('en-IN', { month: 'long' }) + y;
};

/**
 * The paper itself, at 44×56.
 *
 * The reference draws a ruled sheet in CSS for a bill that has a photo and a dashed camera for one
 * that doesn't — so the list answers "did anyone actually file this?" before you read a word. Where
 * there IS a photo we put the real thing in that same box; the drawn sheet stays underneath as what
 * you see while the signed URL is still being minted, and as the fallback if it never arrives.
 */
function Thumb({ doc, count }: { doc: string | null; count: number }) {
  const signed = useSignedDocUrl(doc);
  // A failure belongs to the URL it happened on. Remembering WHICH one broke means a fresh signed
  // URL is simply not that one, so nothing has to reset anything.
  const [brokeOn, setBrokeOn] = useState<string | null>(null);
  const failed = !!signed && brokeOn === signed;
  const isPdf = !!doc && /\.pdf(\?|$)/i.test(doc);

  if (!doc) return (
    <div className="th none" aria-label="No copy filed">
      <svg viewBox="0 0 24 24"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3" /></svg>
    </div>
  );
  return (
    <div className={`th${count > 1 ? ' multi' : ''}`} data-n={count > 1 ? `×${count}` : undefined}>
      {signed && !isPdf && !failed && (
        <img src={signed} alt="" onError={() => setBrokeOn(signed)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
      )}
    </div>
  );
}

export default function BillsMobile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: loadBills });

  const [q, setQ] = useState('');
  const [view, setView] = useState<'due' | 'all'>('due');
  const [scrolled, setScrolled] = useState(false);
  // `pay` drives whether the sheet is up; `held` is what it is showing. They part company for the
  // length of the exit, so a sheet sliding away still has its bill in it instead of emptying first.
  const [pay, setPay] = useState<BillRow | null>(null);
  const [held, setHeld] = useState<BillRow | null>(null);
  const holdTimer = useRef<number | null>(null);
  const openPay = (b: BillRow) => { if (holdTimer.current) window.clearTimeout(holdTimer.current); setHeld(b); setPay(b); };
  const closePay = () => { setPay(null); holdTimer.current = window.setTimeout(() => setHeld(null), 460); };

  const rootRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 3, width: 0 });

  // Two things arrive in the URL: ?party=<id> from the search's "Bills" row for one vendor, and
  // ?new=1 from the nav's own New-bill button. The second IS the wizard's open state — no copy of
  // it to keep in sync, and the back gesture closes it the way a person expects.
  const [searchParams, setSearchParams] = useSearchParams();
  const partyId = searchParams.get('party');
  const addOpen = searchParams.get('new') === '1';
  const closeAdd = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  };
  const mint = useMintBill();

  const shown = useMemo(() => bills.filter(b =>
    (!partyId || b.vendorId === partyId) &&
    (view === 'all' || dueOf(b) > 0.5) &&
    (!q || `${b.vendor} ${b.billNo ?? ''} ${b.site ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  ), [bills, view, q, partyId]);

  // The page lends itself to the app's search the same way the desktop list does.
  useSearchScope('Bills', useMemo(() => shown.map(b => ({
    id: b.id, title: b.vendor, sub: `${b.billNo || 'No number'}${b.site ? ' · ' + b.site : ''}`, right: rupees(b.amount),
    onPick: () => navigate(`/bills/${encodeURIComponent(b.id)}`),
  })), [shown, navigate]), setQ);

  const open = useMemo(() => bills.filter(b => dueOf(b) > 0.5), [bills]);
  const openTotal = useMemo(() => open.reduce((s, b) => s + dueOf(b), 0), [open]);

  // The collapsing title — the same 120px the reference uses.
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 120);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // The segmented control's thumb follows the chosen button.
  useEffect(() => {
    const el = segRef.current?.querySelector('button.on') as HTMLElement | null;
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [view, isLoading]);

  const toastTimer = useRef<number | null>(null);
  const toast = useCallback((t: string) => {
    const el = portalRef.current?.querySelector('#blm-toast') as HTMLElement | null; if (!el) return;
    el.textContent = t; el.classList.add('show');
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => el.classList.remove('show'), 2400);
  }, []);

  const afterMoney = useCallback((msg: string) => {
    closePay();
    toast(msg);
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['party_ledger'] });
    qc.invalidateQueries({ queryKey: ['ledger'] });
    qc.invalidateQueries({ queryKey: ['party_topay_map'] });
  }, [qc, toast]);

  return (
    <div className="blm-page">
      <div className="blm" ref={rootRef}>
        <style>{BLM_CSS}</style>

        <div className={`small${scrolled ? ' show' : ''}`}><b>Vendor Bills</b><span>{rupees(openTotal)}</span></div>

        <div className="big">
          <h1>Vendor Bills</h1>
          <div className="line"><CountUp to={openTotal} /> unpaid · <span>{open.length}</span> bill{open.length === 1 ? '' : 's'}</div>
        </div>

        <div className="search">⌕ <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search vendor, number, site" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Search bills" /></div>

        <div className="seg" ref={segRef} role="group">
          <span className="thumb" style={{ left: thumb.left, width: thumb.width }} />
          <button className={view === 'due' ? 'on' : ''} onClick={() => { hapt(4); setView('due'); }}>Unpaid</button>
          <button className={view === 'all' ? 'on' : ''} onClick={() => { hapt(4); setView('all'); }}>All</button>
        </div>

        <div id="list">
          {isLoading ? <div className="nores">Reading the register…</div>
            : shown.length === 0 ? <div className="nores">Nothing here.</div>
            : shown.map((b, i) => {
              const cap = monthLabel(b.billDate);
              const first = i === 0 || monthLabel(shown[i - 1].billDate) !== cap;
              return (
                <div key={b.id}>
                  {first && <div className="cap">{cap}</div>}
                  <BillSlot bill={b} delay={i * 0.03}
                    onOpen={() => navigate(`/bills/${encodeURIComponent(b.id)}`)}
                    onPay={() => { hapt([8, 30, 8]); openPay(b); }} />
                </div>
              );
            })}
        </div>
      </div>

      {createPortal(
        <div className="blm blm-portal" ref={portalRef}>
          <style>{BLM_CSS}</style>
          <div id="vshade" className={pay ? 'show' : ''} onClick={closePay} />
          <PaySheet open={!!pay} bill={held} orgId={orgId} onClose={closePay} onDone={afterMoney} />
          <div id="blm-toast" />
        </div>, document.body)}

      {addOpen && <NewBillModal
        open
        onClose={closeAdd}
        onOpenBill={(id) => { closeAdd(); navigate(`/bills/${encodeURIComponent('bl~' + id)}`); }}
        commit={mint}
      />}
    </div>
  );
}

/** The one number, counted up — the reference's own flourish, and the only motion on the header. */
function CountUp({ to }: { to: number }) {
  const [shownV, setShownV] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    const start = from.current, t0 = performance.now(), D = 550;
    if (start === to) return;
    let raf = 0;
    const tick = (t: number) => {
      const x = Math.min((t - t0) / D, 1), e = 1 - Math.pow(1 - x, 3);
      setShownV(Math.round(start + (to - start) * e));
      if (x < 1) raf = requestAnimationFrame(tick); else from.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <b>{rupees(shownV)}</b>;
}

/**
 * One row, and the gesture over it.
 *
 * A bill with nothing left to pay is a record, not a task: it reads back in a lighter weight and
 * has no swipe under it at all. Everything else can be paid from where it lies — drag it right far
 * enough that the sage panel behind it has clearly committed, and let go.
 */
function BillSlot({ bill, delay, onOpen, onPay }: { bill: BillRow; delay: number; onOpen: () => void; onPay: () => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  const settled = dueOf(bill) <= 0.5;
  const left = dueOf(bill);

  useEffect(() => {
    const row = rowRef.current, under = underRef.current;
    if (!row || settled) return;
    let x0: number | null = null, dx = 0, axis: 'h' | 'v' | null = null, y0 = 0;
    const start = (e: TouchEvent) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; axis = null; dx = 0; row.style.transition = 'none'; };
    const move = (e: TouchEvent) => {
      if (x0 === null) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      // Decide once whether this is a swipe or the page scrolling under a thumb, then stay decided.
      if (!axis) axis = Math.abs(mx) > Math.abs(my) + 6 ? 'h' : Math.abs(my) > Math.abs(mx) + 6 ? 'v' : null;
      if (axis !== 'h') return;
      dx = Math.max(0, mx);
      row.style.transform = `translateX(${Math.min(dx, 110)}px)`;
      if (under) under.style.opacity = String(Math.min(dx / 70, 1));
    };
    const end = () => {
      if (x0 === null) return;
      row.style.transition = '';
      row.style.transform = '';
      if (under) under.style.opacity = '0';
      const go = dx > 85;
      x0 = null; dx = 0; axis = null;
      if (go) onPay();
    };
    row.addEventListener('touchstart', start, { passive: true });
    row.addEventListener('touchmove', move, { passive: true });
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', end);
    return () => {
      row.removeEventListener('touchstart', start);
      row.removeEventListener('touchmove', move);
      row.removeEventListener('touchend', end);
      row.removeEventListener('touchcancel', end);
    };
  }, [settled, onPay]);

  return (
    <div className="slot">
      {!settled && <div className="under" ref={underRef}>✓ Pay</div>}
      <div className={`row${settled ? ' settled' : ''}`} ref={rowRef} style={{ animationDelay: `${delay}s` }}
        onClick={onOpen} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
        <Thumb doc={bill.docUrl} count={bill.docCount} />
        <div className="bm">
          <b>{bill.vendor}</b>
          <span>{bill.billNo ? bill.billNo + ' · ' : ''}{dayLabel(bill.billDate)}{bill.site ? ' · ' + bill.site : ''}</span>
        </div>
        <div className="br">
          <b>₹{inr(settled ? bill.amount : left)}</b>
          {settled ? <span>paid</span>
            : bill.paid > 0.5 ? <span className="part">of ₹{inr(bill.amount)}</span>
            : <span className="due">due</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * The pay sheet — the swipe's destination.
 *
 * Two ways, one sheet, because they are the same question asked in two tenses: is this bill's money
 * going out now, or did it already? Recording writes the payment and points it at this bill in one
 * motion. Linking finds the payments this vendor has on this site with something still unattached
 * and puts the closest amount first, because that is the one being looked for.
 */
function PaySheet({ open, bill, orgId, onClose, onDone }: {
  open: boolean; bill: BillRow | null; orgId: string; onClose: () => void; onDone: (msg: string) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Swipe the sheet down to dismiss — the gesture the reference gives every sheet.
  useEffect(() => {
    const el = sheetRef.current; if (!el) return;
    let y0: number | null = null, dy = 0;
    const start = (e: TouchEvent) => {
      // The body of the sheet holds fields and a list; only the handle and the header drag it.
      if (!(e.target as HTMLElement).closest('.grab, .pv-h')) return;
      y0 = e.touches[0].clientY; dy = 0; el.style.transition = 'none';
    };
    const move = (e: TouchEvent) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); el.style.transform = `translateY(${dy}px)`; };
    const end = () => {
      if (y0 === null) return;
      el.style.transition = ''; el.style.transform = '';
      const go = dy > 100; y0 = null; dy = 0;
      if (go) { hapt(5); onClose(); }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); };
  }, [onClose]);

  return (
    <div className={`sheet${open ? ' show' : ''}`} ref={sheetRef} role="dialog" aria-label="Pay this bill" aria-hidden={!open}>
      {bill && <PayBody key={bill.id} bill={bill} orgId={orgId} onDone={onDone} />}
    </div>
  );
}

/** One bill's worth of pay sheet. Keyed by the bill, so every open is a fresh mount and the
 *  defaults are simply what the fields start as — nothing is ever reset. */
function PayBody({ bill, orgId, onDone }: { bill: BillRow; orgId: string; onDone: (msg: string) => void }) {
  const left = dueOf(bill);
  const [tab, setTab] = useState<'new' | 'link'>('new');
  const [amt, setAmt] = useState(() => String(Math.round(left)));
  const [date, setDate] = useState(isoToday);
  const [mode, setMode] = useState<PayMode>('NEFT');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkablePayment[] | null>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 3, width: 0 });

  useEffect(() => {
    const el = segRef.current?.querySelector('button.on') as HTMLElement | null;
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  // The vendor's loose payments, fetched the first time that side is opened.
  useEffect(() => {
    if (tab !== 'link' || links !== null) return;
    let live = true;
    loadLinkablePayments(bill.vendorId ?? '', bill.projectId, left)
      .then(r => { if (live) setLinks(r); })
      .catch(e => { if (live) { setLinks([]); setErr((e as Error)?.message || 'Could not read this vendor’s payments'); } });
    return () => { live = false; };
  }, [bill, tab, links, left]);

  // Which of the loose payments is nearest what this bill is asking.
  const nearest = useMemo(() => {
    if (!links?.length) return -1;
    let best = 0;
    links.forEach((p, i) => { if (Math.abs(p.free - left) < Math.abs(links[best].free - left)) best = i; });
    return best;
  }, [links, left]);

  const value = Math.round(Number(amt.replace(/[^\d]/g, '')) || 0);
  const overpay = value > left + 0.5;

  const record = async () => {
    if (busy || value <= 0) return;
    setBusy(true); setErr(null);
    try {
      await payBill({
        orgId,
        bill: { id: bill.id, kind: bill.kind === 'consolidated' ? 'bill' : (bill.id.startsWith('po~') ? 'po' : 'bill'), vendorId: bill.vendorId, projectId: bill.projectId },
        amount: value, date, mode,
        remarks: `Bill ${bill.billNo || ''}`.trim(),
      });
      hapt([8, 30, 8]);
      onDone(`${rupees(value)} paid — ${bill.vendor}`);
    } catch (e) { setBusy(false); setErr((e as Error)?.message || 'Could not record that payment'); }
  };

  const link = async (p: LinkablePayment) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      await linkPaymentToBill(orgId, p,
        { id: bill.id, kind: bill.id.startsWith('po~') ? 'po' : 'bill', projectId: bill.projectId },
        Math.min(left, p.free));
      hapt([8, 30, 8]);
      onDone(`${rupees(Math.min(left, p.free))} linked — ${bill.vendor}`);
    } catch (e) { setBusy(false); setErr((e as Error)?.message || 'Could not link that payment'); }
  };

  return (
    <>
      <div className="grab" />
        <div className="pv-h"><b>{bill.vendor}</b><span>{dayLabel(bill.billDate)}</span></div>
        <div className="pv-meta">{bill.billNo ? bill.billNo + ' · ' : ''}{bill.site || 'No site'}</div>

        <div className="pv-due"><span>Still due</span><b>₹{inr(left)}</b></div>
        {bill.paid > 0.5 && <div className="pv-paid"><b>₹{inr(bill.paid)} paid</b><span>of ₹{inr(bill.amount)}</span></div>}

        <div className="seg pv-seg" ref={segRef} role="group">
          <span className="thumb" style={{ left: thumb.left, width: thumb.width }} />
          <button className={tab === 'new' ? 'on' : ''} onClick={() => { hapt(4); setTab('new'); }}>Pay now</button>
          <button className={tab === 'link' ? 'on' : ''} onClick={() => { hapt(4); setTab('link'); }}>Already paid</button>
        </div>

        {tab === 'new' ? (
          <>
            <div className="pv-lab">Amount</div>
            <div className="pv-amt">
              <i>₹</i>
              <input inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ''))} aria-label="Amount" />
              {value !== Math.round(left) && <button onClick={() => setAmt(String(Math.round(left)))}>All of it</button>}
            </div>
            <div className="pv-lab">Paid on, and how</div>
            <div className="pv-row">
              <input className="pv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Payment date" />
            </div>
            <div className="pv-modes" role="group" aria-label="How it was paid">
              {MODES.map(m => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => { hapt(4); setMode(m); }}>{m}</button>
              ))}
            </div>
            {overpay && <div className="lp-err">That is {rupees(value - left)} more than this bill is asking — the rest will sit as an advance.</div>}
            {err && <div className="lp-err">{err}</div>}
            <button className="pv-go" disabled={busy || value <= 0} onClick={() => void record()}>
              {busy ? 'Recording…' : `Pay ₹${inr(value)}`}
            </button>
          </>
        ) : (
          <>
            <div className="pv-lab">Payments to {bill.vendor.split(' ')[0]} with money still loose</div>
            {links === null ? <div className="lp-none">Looking…</div>
              : links.length === 0 ? <div className="lp-none">Nothing unattached for this vendor{bill.site ? ` on ${bill.site}` : ''}.</div>
              : links.map((p, i) => (
                // The badge is worked out here rather than assumed of the first row, so the word
                // "closest" can never be pointing at something that isn't.
                <div key={p.txnId} className={`lp${i === nearest ? ' best' : ''}`} onClick={() => void link(p)} role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') void link(p); }}>
                  <div className="lm">
                    <b>₹{inr(p.free)}</b>
                    <span>{dayLabel(p.date)}{p.mode ? ' · ' + p.mode : ''}{p.free < p.total - 0.5 ? ` · of ₹${inr(p.total)}` : ''}{p.sameProject ? '' : ' · no site yet'}</span>
                  </div>
                  {i === nearest && links.length > 1 && <span className="lt">closest</span>}
                </div>
              ))}
            {err && <div className="lp-err">{err}</div>}
          </>
        )}
    </>
  );
}
