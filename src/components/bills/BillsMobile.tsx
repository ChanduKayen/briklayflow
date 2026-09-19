/**
 * Bills on a phone — the "Briklay · Bills" reference, wired to the register.
 *
 * A drawer of paper. What is linked against each paper is what turns into vendor credit in Ledgers,
 * so this page feeds that one and never invents money of its own.
 *
 *   the header   what you owe on bills, and how OLD that debt is. Age is the credit story, so the
 *                three buckets (this week · 8 to 30 days · older) are also the filter.
 *   the drawer   every row leads with the bill itself. Status is one word with meaning: due · part
 *                paid · paid — and "looks paid" when a payment already in Book fits it exactly.
 *                A bill with no number wears the hollow ring: it cannot be duplicate-checked.
 *   a vendor     the same drawer read the other way, and their statement: bills add, the payments
 *                linked against them subtract, and every line says what was owed after it.
 *   a bill       the paper is the hero, then: is it paid, what the bill says, its particulars.
 *                Delete is in ⋯ and must be held.
 *   link         nothing is created — it ties the bill to money ALREADY in Book. Eligible is the
 *                same vendor, the same site, not yet claimed by any bill; one quiet switch widens it
 *                to their other sites. A payment bigger than what is left gives only what is needed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSignedDocUrl, openDoc } from '../../lib/storage';
import { useSheetDrag } from '../../lib/sheetDrag';
import { useSheetFlag } from '../../lib/sheetFlag';
import { usePullToRefresh, useLiveCount } from '../../lib/usePullToRefresh';
import { allocateAcross } from '../../lib/billPayMath';
import {
  loadBills, loadBillDetail, deleteBill, loadLinkablePayments, loadLoosePaymentsByVendor,
  loadVendorStatement, linkPaymentToBill, allocTargetOf,
  type BillRow, type LinkablePayment, type StatementEvent,
} from '../../lib/billsApi';
import NewBillModal from './NewBillModal';
import { useMintBill } from './useMintBill';
import { BMX_CSS } from './bmxCss';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const initials = (n: string) => n.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const hapt = (p: number | number[]) => { try { navigator.vibrate?.(p as number); } catch { /* not every phone has it */ } };
const short = (s: string | null) => (s || '').replace(' Residence', '').replace(' Apartments', '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: string | null) => (d ? `${new Date(d).getDate()} ${MON[new Date(d).getMonth()]}` : '—');
const monthKey = (d: string | null) => (d ? d.slice(0, 7) : '0000-00');
const monthName = (k: string) => (k === '0000-00' ? 'Undated'
  : new Date(k + '-01').toLocaleDateString('en-IN', { month: 'long', year: new Date(k + '-01').getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }));
/** Whole days since the bill's date — what "due · 12 days" counts. */
const ageOf = (b: BillRow) => (b.billDate ? Math.max(0, Math.round((Date.now() - new Date(b.billDate).getTime()) / 86400000)) : 0);
const leftOf = (b: BillRow) => Math.max(0, b.amount - b.paid);
/** A stored doc that is a PDF — it is opened, never rendered into an <img>. */
const isPdfDoc = (u: string | null | undefined) => /\.pdf(\?|$)/i.test(u || '');
const bucketOf = (b: BillRow) => { const a = ageOf(b); return a <= 7 ? 0 : a <= 30 ? 1 : 2; };

const TICK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const DOTS = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
const CLOSE = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

/** The drawn stand-in a row wears when the bill has no photograph of its own. */
function SheetArt({ seed }: { seed: string }) {
  const v = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const head = ['#B5472A', '#2B211A', '#2F5D3A', '#5C4F45'][v % 4];
  const rows = [48, 60, 72, 84, 96, 108, 120];
  return (
    <svg viewBox="0 0 128 170" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <rect width="128" height="170" fill="#F4EFE6" />
      {v % 2
        ? <><rect x="12" y="12" width="60" height="8" rx="2" fill={head} opacity=".85" /><rect x="12" y="25" width="40" height="4" rx="2" fill="#2B211A" opacity=".3" /></>
        : <><rect x="84" y="10" width="32" height="18" rx="3" fill={head} opacity=".8" /><rect x="12" y="13" width="52" height="6" rx="2" fill="#2B211A" opacity=".75" /><rect x="12" y="24" width="36" height="4" rx="2" fill="#2B211A" opacity=".3" /></>}
      <rect x="12" y="36" width="104" height="7" fill="#2B211A" opacity=".12" />
      {rows.map((y, i) => (
        <g key={y}><rect x="12" y={y} width={44 + (i * 17 + v * 7) % 30} height="3.5" rx="1.75" fill="#2B211A" opacity=".28" />
          <rect x="94" y={y} width="22" height="3.5" rx="1.75" fill="#2B211A" opacity=".28" /></g>
      ))}
      <path d="M12 133h104" stroke="#2B211A" strokeOpacity=".25" strokeDasharray="3 3" />
      <rect x="80" y="142" width="36" height="8" rx="2" fill="#2B211A" opacity=".8" />
    </svg>
  );
}

/** A PDF cannot be an <img>. It is still a paper, so it is drawn as one — the same sheet, its corner
 *  turned, wearing the format's name. At 44px that reads as a red tag; at reading size it says PDF. */
function PdfArt() {
  return (
    <svg viewBox="0 0 128 170" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <rect width="128" height="170" fill="#F4EFE6" />
      <path d="M92 0h36L92 36z" fill="#E4DACA" />
      <path d="M92 36h36V0z" fill="#EFE8DC" />
      <rect x="12" y="14" width="48" height="7" rx="2" fill="#2B211A" opacity=".6" />
      <rect x="12" y="27" width="30" height="4" rx="2" fill="#2B211A" opacity=".26" />
      <rect x="12" y="44" width="104" height="6" fill="#2B211A" opacity=".1" />
      {/* the format, named, high enough on the sheet to clear the caption a bill page lays over it */}
      <rect x="12" y="60" width="62" height="26" rx="6" fill="#B5472A" />
      <text x="43" y="78" textAnchor="middle" fontFamily="'DM Mono', ui-monospace, monospace" fontSize="15"
        fontWeight="500" letterSpacing="1.4" fill="#F7F2EA">PDF</text>
      {[100, 112, 124].map((y, i) => (
        <g key={y}><rect x="12" y={y} width={48 + i * 14} height="3.5" rx="1.75" fill="#2B211A" opacity=".18" />
          <rect x="94" y={y} width="22" height="3.5" rx="1.75" fill="#2B211A" opacity=".18" /></g>
      ))}
    </svg>
  );
}

/** The paper itself — the filed photograph when there is one, the drawing otherwise.
 *  A PDF never resolves into an <img> (that is the blank box the detail page used to show), and a
 *  photograph that will not load falls back to the drawing rather than to nothing. */
function Paper({ b, className }: { b: { id: string; docUrl: string | null }; className?: string }) {
  const pdf = isPdfDoc(b.docUrl);
  const url = useSignedDocUrl(pdf ? null : b.docUrl);
  const [badUrl, setBadUrl] = useState<string | null>(null);
  return (
    <span className={className ?? 'sheet'}>
      {pdf ? <PdfArt />
        : url && url !== badUrl ? <img src={url} alt="" onError={() => setBadUrl(url)} />
          : <SheetArt seed={b.id} />}
    </span>
  );
}

type Lens = 'bills' | 'vendors';
type Filter = 'open' | 'part' | 'paid' | 'all';
const CHIPS: [Filter, string][] = [['open', 'Unpaid'], ['part', 'Part paid'], ['paid', 'Paid'], ['all', 'All']];

export default function BillsMobile() {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const mintBill = useMintBill();

  const { data: bills } = useQuery({ queryKey: ['bills'], queryFn: loadBills, staleTime: 60_000 });
  const { data: loose } = useQuery({
    queryKey: ['bills_loose', orgId], enabled: !!orgId, queryFn: () => loadLoosePaymentsByVendor(orgId!),
  });

  const B = useMemo(() => bills ?? [], [bills]);

  const [lens, setLens] = useState<Lens>('bills');
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState(-1);
  const [compact, setCompact] = useState(false);
  const [tuck, setTuck] = useState(false);
  const [folded, setFolded] = useState(false);
  const [openBill, setOpenBill] = useState<string | null>(null);
  const [openVendor, setOpenVendor] = useState<string | null>(null);
  const [panel, setPanel] = useState<null | { kind: 'menu' } | { kind: 'link'; billId: string }>(null);
  const [zoom, setZoom] = useState<BillRow | null>(null);
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const [litId, setLitId] = useState('');
  const qRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const newOpen = params.get('new') === '1';
  useSheetFlag(!!panel || !!zoom);

  const say = useCallback((text: string) => setToast({ text }), []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 2400); return () => window.clearTimeout(t); }, [toast]);

  // ── the header: what is owed, and how old it is ────────────────────────────
  const open = useMemo(() => B.filter((b) => leftOf(b) > 0), [B]);
  const totalOwed = open.reduce((a, b) => a + leftOf(b), 0);
  const sums = useMemo(() => { const s = [0, 0, 0]; open.forEach((b) => { s[bucketOf(b)] += leftOf(b); }); return s; }, [open]);
  const oldest = open.reduce((a, b) => Math.max(a, ageOf(b)), 0);

  /** A payment already in Book that fits what is left of this bill exactly — the "looks paid" mark. */
  const fitFor = useCallback((b: BillRow): LinkablePayment | null => {
    if (!b.vendorId || leftOf(b) <= 0) return null;
    const want = leftOf(b);
    return (loose?.[b.vendorId] ?? []).find((t) =>
      Math.abs(t.free - want) < 0.5 && (!b.projectId || !t.projectId || t.projectId === b.projectId)) ?? null;
  }, [loose]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return B.filter((b) => {
      const l = leftOf(b);
      const passFilter = filter === 'all' ? true
        : filter === 'open' ? l > 0
        : filter === 'paid' ? b.status === 'settled'
        : b.status === 'part';
      if (!passFilter) return false;
      if (bucket >= 0 && !(l > 0 && bucketOf(b) === bucket)) return false;
      if (!q) return true;
      return `${b.vendor} ${b.billNo ?? ''} ${b.site ?? ''} ${b.amount}`.toLowerCase().includes(q);
    });
  }, [B, filter, bucket, query]);

  const months = useMemo(() => {
    const seen: string[] = [];
    visible.forEach((b) => { const k = monthKey(b.addedAt || b.billDate); if (!seen.includes(k)) seen.push(k); });
    return seen.map((k) => ({ k, rows: visible.filter((b) => monthKey(b.addedAt || b.billDate) === k) }));
  }, [visible]);

  const vendors = useMemo(() => {
    const q = query.trim().toLowerCase();
    const names = [...new Set(B.map((b) => b.vendor))].filter((v) => !q || v.toLowerCase().includes(q));
    return names.map((v) => {
      const bs = B.filter((x) => x.vendor === v), o = bs.filter((x) => leftOf(x) > 0);
      return {
        v, id: bs[0]?.vendorId ?? null,
        billed: bs.reduce((a, x) => a + x.amount, 0),
        owed: o.reduce((a, x) => a + leftOf(x), 0),
        n: o.length, all: bs.length, old: o.reduce((a, x) => Math.max(a, ageOf(x)), 0),
      };
    }).sort((a, b) => b.owed - a.owed);
  }, [B, query]);

  // ── scroll: slim header, quick-return tools, folding capsule ───────────────
  useEffect(() => {
    let lastY = 0;
    const onScroll = () => {
      const y = window.scrollY, past = y > 240 - 54, d = y - lastY;
      setCompact(past);
      if (Math.abs(d) > 6) {
        setFolded(d > 0 && y > 60);
        setTuck(d > 0 && past && document.activeElement !== qRef.current);
        lastY = y;
      }
      if (!past) setTuck(false);
      if (y < 8) setFolded(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);
  const panelDrag = useSheetDrag<HTMLElement>(closePanel, !!panel);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['bills_loose'] });
    qc.invalidateQueries({ queryKey: ['bill'] });
  }, [qc]);

  // Pull the drawer down from the top and it reads the register again.
  const liveCount = useLiveCount(B.length);
  const { view: pullView } = usePullToRefresh({
    attachTo: rootRef, noun: 'bill', count: liveCount,
    onRefresh: () => qc.refetchQueries({ type: 'active' }),
  });

  const bill = openBill ? B.find((b) => b.id === openBill) ?? null : null;
  const pageOn = !!bill || !!openVendor;

  function statusOf(b: BillRow) {
    const l = leftOf(b), a = ageOf(b);
    if (b.status === 'settled') return <span className="st paid">{TICK}paid</span>;
    if (fitFor(b)) return <span className="st fits"><i />looks paid</span>;
    if (b.status === 'part') return <span className="st part">{inr(l)} left</span>;
    return <span className={`st${a > 30 ? ' old' : a > 7 ? ' late' : ''}`}>due · {a === 0 ? 'today' : `${a} ${a === 1 ? 'day' : 'days'}`}</span>;
  }

  const billRow = (b: BillRow) => (
    <button key={b.id} type="button" className={`bill${b.id === litId ? ' lit' : ''}`}
      onClick={() => { setOpenBill(b.id); setLitId(''); hapt(6); }}>
      <Paper b={b} />
      <span className="bx">
        <span className="b1"><b>{b.vendor}</b><span className="amt">{inr(b.amount)}</span></span>
        <span className="b2">
          <span className="meta">{day(b.billDate)} · {short(b.site) || 'no site'}{b.billNo ? '' : <> · <i className="ring" />no number</>}</span>
          {statusOf(b)}
        </span>
      </span>
    </button>
  );

  return (
    <div className={`bmx${pageOn ? ' deep' : ''}`} ref={rootRef}>
      <style>{BMX_CSS}</style>
      {pullView}

      <div className={`compact${compact && !pageOn ? ' on' : ''}`}><b>Bills</b><span>{inr(totalOwed)}<small>owed</small></span></div>

      <div className="view">
        <header className="hero">
          <div className="hero-top"><h1>Bills</h1>
            <button type="button" className="icb" aria-label="Export and more" onClick={() => setPanel({ kind: 'menu' })}>{DOTS}</button>
          </div>
          <div className="owed"><span>{inr(totalOwed)}</span><small>owed on bills</small></div>
          <p className="sub">{open.length} unpaid bills · {new Set(open.map((b) => b.vendor)).size} vendors · oldest {oldest} days</p>
          <div className="age" aria-hidden="true">
            {sums.map((v, i) => <i key={i} className={`c${i}`} style={{ flex: `${Math.max(v, totalOwed * .015)} 0 0` }} />)}
          </div>
          <div className="ages" role="group" aria-label="How old the unpaid bills are">
            {(['This week', '8 to 30 days', 'Older'] as const).map((l, i) => (
              <button key={l} type="button" aria-pressed={bucket === i}
                onClick={() => { setBucket((x) => (x === i ? -1 : i)); if (bucket !== i) { setFilter('open'); setLens('bills'); } hapt(4); }}>
                <span><i className={`c${i}`} />{l}</span><b>{inr(sums[i])}</b>
              </button>
            ))}
          </div>
        </header>

        <div className={`tools${tuck ? ' tuck' : ''}`}>
          <div className="seg2">
            <span className="th" style={{ transform: `translateX(${lens === 'bills' ? 0 : 100}%)` }} />
            <button type="button" aria-pressed={lens === 'bills'} onClick={() => { setLens('bills'); hapt(4); }}>Bills</button>
            <button type="button" aria-pressed={lens === 'vendors'} onClick={() => { setLens('vendors'); setBucket(-1); hapt(4); }}>Vendors</button>
          </div>
          <label className="find" style={{ marginTop: 10 }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input ref={qRef} type="search" autoComplete="off" enterKeyHint="search"
              placeholder={lens === 'bills' ? 'Vendor, bill number, site or item' : 'Vendor'}
              aria-label="Search bills" value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setTuck(false)} />
          </label>
          {lens === 'bills' && (
            <div className="chips" role="group" aria-label="Show">
              {CHIPS.map(([k, l]) => (
                <button key={k} type="button" className="chip" aria-pressed={k === filter}
                  onClick={() => { setFilter(k); if (k !== 'open') setBucket(-1); hapt(4); }}>{l}</button>
              ))}
            </div>
          )}
          {lens === 'bills' && (query.trim() || bucket >= 0) && (
            <p className="result">
              <b>{visible.length}</b> {visible.length === 1 ? 'bill' : 'bills'} · <b>{inr(visible.reduce((a, b) => a + leftOf(b), 0))}</b> still owed
              {bucket >= 0 ? ' · ' + ['this week', '8 to 30 days old', 'older than 30 days'][bucket] : ''}
            </p>
          )}
        </div>

        <main>
          {lens === 'bills' ? (
            months.length ? months.map(({ k, rows }) => (
              <div key={k}>
                <div className="month"><h2>{monthName(k)}</h2>
                  <span>{rows.length}{rows.length === 1 ? ' bill · ' : ' bills · '}<b>{inr(rows.reduce((a, b) => a + leftOf(b), 0))}</b> owed</span>
                </div>
                <div className="card">{rows.map(billRow)}</div>
              </div>
            )) : <div className="empty"><b>No bills here</b>Try another word, or look under All.</div>
          ) : (
            <VendorLens vendors={vendors} onOpen={(v) => setOpenVendor(v)} />
          )}
        </main>
      </div>

      <section className={`page${pageOn ? ' on' : ''}`} aria-live="polite">
        {bill ? (
          <BillPage b={bill} backTo={openVendor} fit={fitFor(bill)} orgId={orgId}
            onBack={() => { if (openVendor) setOpenBill(null); else { setOpenBill(null); setLitId(bill.id); } }}
            onSay={say} onZoom={() => setZoom(bill)} onLink={() => setPanel({ kind: 'link', billId: bill.id })}
            onLinked={() => { refresh(); }}
            onDeleted={() => { setOpenBill(null); setOpenVendor(null); refresh(); say('Bill deleted · ' + inr(bill.amount)); }}
            onVendor={() => navigate(`/stakeholders/${encodeURIComponent(bill.vendorId ?? '')}`)} />
        ) : openVendor ? (
          <VendorPage name={openVendor} bills={B.filter((b) => b.vendor === openVendor)}
            onBack={() => setOpenVendor(null)} onBill={(id) => setOpenBill(id)} onSay={say} />
        ) : null}
      </section>

      <div className={`scrim${panel ? ' on' : ''}`} onClick={closePanel} />
      {/* A sheet that is parked off-screen is not a dialog, and must not read as one: the pull-to-
          refresh gate treats any on-screen [role="dialog"] as something covering the page, so a
          closed sheet that kept the role silently killed pull-to-refresh for the whole page. */}
      <section className={`panel${panel ? ' on' : ''}`} {...(panel ? { role: 'dialog' as const, 'aria-modal': true } : {})} ref={panelDrag}>
        <div className="grab" aria-hidden="true"><i /></div>
        {panel?.kind === 'menu' && (
          <>
            <div className="p-head"><div className="t"><h2>Bills</h2></div>
              <button type="button" className="x" data-close aria-label="Close" onClick={closePanel}>{CLOSE}</button></div>
            <button type="button" className="opt" onClick={() => say('Exports what is shown as CSV, with the papers')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg><span className="m"><b>Export what is shown</b></span></button>
          </>
        )}
        {panel?.kind === 'link' && bill && (
          <Linker b={bill} orgId={orgId} onClose={closePanel}
            onDone={(msg) => { closePanel(); refresh(); say(msg); }} onFail={(m) => say(m)} />
        )}
      </section>

      <div className={`viewer${zoom ? ' on' : ''}`} {...(zoom ? { role: 'dialog' as const, 'aria-modal': true } : {})} aria-label="The bill"
        onClick={(e) => { if (e.target === e.currentTarget) setZoom(null); }}>
        <div className="big">{zoom && <Paper b={zoom} className="doc" />}</div>
        <button type="button" aria-label="Close" onClick={() => setZoom(null)}>{CLOSE}</button>
      </div>

      {/* One button, one job: a new bill. Linking a payment lives on the bill page itself, where the
          money it is being linked to is — a second, floating copy of it only asked the same question twice. */}
      <button type="button" data-page-cta className={`fab${folded ? ' folded' : ''}${pageOn || panel ? ' away' : ''}`}
        style={{ ['--w' as string]: '120px' }} aria-label="Add a bill" onClick={() => setParams({ new: '1' })}>
        <span className="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span>
        <span className="lbl">Bill</span>
      </button>

      <div className={`toast${toast ? ' on' : ''}`} role="status"><span>{toast?.text ?? ''}</span></div>

      {newOpen && <NewBillModal open commit={mintBill} onClose={() => { setParams({}); refresh(); }} />}
    </div>
  );
}

// ── the vendors lens ──────────────────────────────────────────────────────────
interface VendorAgg { v: string; id: string | null; billed: number; owed: number; n: number; all: number; old: number }
function VendorLens({ vendors, onOpen }: { vendors: VendorAgg[]; onOpen: (v: string) => void }) {
  const owing = vendors.filter((x) => x.owed > 0), clear = vendors.filter((x) => !x.owed);
  const row = (x: VendorAgg) => (
    <button key={x.v} type="button" className="vrow" onClick={() => onOpen(x.v)}>
      <span className="av">{initials(x.v)}</span>
      <span className="bx">
        <span className="b1"><b>{x.v}</b><span className="amt">{x.owed ? inr(x.owed) : ''}</span></span>
        <span className="b2">
          <span className="meta">{x.owed ? `${x.n} ${x.n === 1 ? 'bill' : 'bills'} unpaid · oldest ${x.old} days` : `${x.all} ${x.all === 1 ? 'bill' : 'bills'} · all paid`}</span>
          {x.owed ? null : <span className="st paid">{TICK}clear</span>}
        </span>
        <span className="vbar"><i style={{ width: `${x.billed ? Math.round((1 - x.owed / x.billed) * 100) : 100}%` }} /></span>
      </span>
    </button>
  );
  if (!vendors.length) return <div className="empty"><b>No vendors here</b>Try another word.</div>;
  return (
    <>
      {!!owing.length && (<>
        <div className="month"><h2>You owe</h2><span>{inr(owing.reduce((a, x) => a + x.owed, 0))}</span></div>
        <div className="card">{owing.map(row)}</div>
      </>)}
      {!!clear.length && (<>
        <div className="month"><h2>All clear</h2><span /></div>
        <div className="card">{clear.map(row)}</div>
      </>)}
    </>
  );
}

const PBar = ({ back, name, onBack, onMenu }: { back: string; name?: string; onBack: () => void; onMenu?: () => void }) => (
  <div className="pbar">
    <button type="button" onClick={onBack}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{back}
    </button>
    <b>{name ?? ''}</b>
    {onMenu ? <button type="button" className="dots" aria-label="More" onClick={onMenu}>{DOTS}</button> : <span style={{ width: 44 }} />}
  </div>
);

// ── a bill ────────────────────────────────────────────────────────────────────
function BillPage({ b, backTo, fit, orgId, onBack, onSay, onZoom, onLink, onLinked, onDeleted, onVendor }: {
  b: BillRow; backTo: string | null; fit: LinkablePayment | null; orgId: string | null | undefined;
  onBack: () => void; onSay: (s: string) => void; onZoom: () => void; onLink: () => void;
  onLinked: () => void; onDeleted: () => void; onVendor: () => void;
}) {
  const { data: d } = useQuery({ queryKey: ['bill', b.id], queryFn: () => loadBillDetail(b.id) });
  const [menu, setMenu] = useState(false);
  const [noHint, setNoHint] = useState(false);
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdRef = useRef(0);

  const left = leftOf(b), paidPct = b.amount ? Math.min(100, (b.paid / b.amount) * 100) : 0;
  const cap = b.status === 'settled' ? <span className="cap paid">{TICK}Paid</span>
    : b.status === 'part' ? <span className="cap part">{inr(left)} left</span>
    : <span className="cap due">Unpaid · {ageOf(b)} {ageOf(b) === 1 ? 'day' : 'days'}</span>;

  async function linkTheFit() {
    if (!fit || !orgId || busy) return;
    setBusy(true);
    try {
      await linkPaymentToBill(orgId, fit, allocTargetOf(b), left);
      hapt([10, 40, 18]);
      onSay('Linked. This bill is paid.');
      onLinked();
    } catch (e) { onSay(e instanceof Error ? e.message : 'Could not link that payment'); }
    finally { setBusy(false); }
  }

  const startHold = (e: React.PointerEvent) => {
    e.preventDefault(); setHeld(true); hapt(6);
    holdRef.current = window.setTimeout(async () => {
      setHeld(false); hapt([14, 40, 24]);
      try { await deleteBill(b.id); onDeleted(); } catch (er) { onSay(er instanceof Error ? er.message : 'Could not delete'); }
    }, 1000);
  };
  const stopHold = () => { if (!held) return; window.clearTimeout(holdRef.current); setHeld(false); onSay('Keep holding to delete'); };

  return (
    <>
      <PBar back={backTo ? backTo.split(' ')[0] : 'Bills'} name={b.vendor} onBack={onBack} onMenu={() => setMenu(true)} />
      <div className="phead">
        <h1>{b.vendor}</h1>
        <p>{b.billNo ? `Bill no. ${b.billNo}` : <><i className="ring" />No bill number</>} · {day(b.billDate)} · {b.site || 'no site'}</p>
        <div className="pamt"><b>{inr(b.amount)}</b>{cap}</div>
      </div>

      {fit && !noHint && b.status !== 'settled' && (
        <div className="match">
          <b>This looks paid already</b>
          <p>{inr(fit.free)} to {b.vendor} is in your Book, {day(fit.date)}{fit.mode ? ` · ${fit.mode}` : ''}. Same vendor, same site, same amount.</p>
          <div>
            <button type="button" className="y" disabled={busy} onClick={linkTheFit}>Yes, link it</button>
            <button type="button" className="n" onClick={() => setNoHint(true)}>Not this one</button>
          </div>
        </div>
      )}

      <button type="button" className={`bigsheet${b.docUrl ? '' : ' none'}`}
        onClick={() => (!b.docUrl ? onSay('Opens the camera to add the paper') : isPdfDoc(b.docUrl) ? void openDoc(b.docUrl) : onZoom())}>
        {b.docUrl ? <><i className="pp"><Paper b={b} className="doc" /></i>
          <span>{isPdfDoc(b.docUrl) ? 'A PDF — tap to open it' : 'Tap to see the whole bill'}</span></>
          : <span>No photo. Typed in by hand. Add the paper</span>}
      </button>

      <div className="blk">
        <h3>Paid against this bill<span>{d?.payments.length ? `${d.payments.length} ${d.payments.length === 1 ? 'payment' : 'payments'}` : 'from your Book'}</span></h3>
        <div className="setbar"><i style={{ width: `${paidPct}%` }} /></div>
        <div className="setnum"><span><b>{inr(b.paid)}</b> paid</span><span><b>{inr(left)}</b> left</span></div>
        {d?.payments.length
          ? d.payments.map((p) => (
            <div className="payrow" key={p.txnId}>
              <span className="tickc">{TICK}</span>
              <span className="m"><b>{day(p.date)}{p.mode ? ` · ${p.mode}` : ''}</b><span>In Book · linked to this bill</span></span>
              <em>{inr(p.amount)}</em>
            </div>))
          : <p className="none2">Nothing in Book is linked to it yet.</p>}
        {left > 0 ? <div className="two"><button type="button" className="pri" data-link onClick={onLink}>Link a payment</button></div> : <div style={{ height: 10 }} />}
      </div>

      <div className="blk">
        <h3>On the bill<span>as read from the paper</span></h3>
        {(d?.lines ?? []).map((l, i) => (
          <div className="ln" key={i}><b>{l.name}</b><span>{[l.qty ? `${l.qty}${l.unit ? ' ' + l.unit : ''}` : '', l.rate ? `× ${inr(l.rate)}` : ''].filter(Boolean).join(' ')}</span><em>{inr(l.amount)}</em></div>
        ))}
        {!d?.lines.length && <p className="none2">No lines were read off this paper.</p>}
        <div className="tot"><i>Bill total</i><b>{inr(b.amount)}</b></div>
      </div>

      <div className="blk">
        <h3>Particulars</h3>
        <div className="kv"><span>Bill no.</span><b className={b.billNo ? '' : 'warn'}>{b.billNo || 'No number'}</b></div>
        <div className="kv"><span>Site</span><b>{b.site || 'Not set'}</b></div>
        <div className="kv"><span>Order</span><b className={d?.poId ? '' : 'warn'}>{d?.poId ? `${d.poId} · matches` : 'Not linked'}</b></div>
        {d?.docCount && d.docCount > 1 ? <div className="kv"><span>On this paper</span><b>{d.docCount} invoices</b></div> : null}
      </div>

      <div className="blk"><button type="button" className="kv" style={{ borderTop: 0 }} onClick={onVendor}><span>Vendor</span><b>Open the ledger ›</b></button></div>

      {menu && (
        <>
          <div className="scrim on" onClick={() => setMenu(false)} />
          <section className="panel on" role="dialog" aria-modal="true">
            <div className="grab" aria-hidden="true"><i /></div>
            <div className="p-head"><div className="t"><h2>This bill</h2></div>
              <button type="button" className="x" aria-label="Close" onClick={() => setMenu(false)}>{CLOSE}</button></div>
            <button type="button" className={`opt danger${held ? ' hold' : ''}`}
              onContextMenu={(e) => e.preventDefault()} onPointerDown={startHold}
              onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7" /></svg>
              <span className="m"><b>Hold to delete this bill</b></span>
            </button>
          </section>
        </>
      )}
    </>
  );
}

// ── a vendor's statement ──────────────────────────────────────────────────────
function VendorPage({ name, bills, onBack, onBill, onSay }: {
  name: string; bills: BillRow[]; onBack: () => void; onBill: (id: string) => void; onSay: (s: string) => void;
}) {
  const vendorId = bills[0]?.vendorId ?? null;
  const { data: ev } = useQuery({
    queryKey: ['bill_statement', vendorId], enabled: !!vendorId, queryFn: () => loadVendorStatement(vendorId!),
  });
  const owed = bills.reduce((a, b) => a + leftOf(b), 0);
  const billed = bills.reduce((a, b) => a + b.amount, 0);
  const paid = bills.reduce((a, b) => a + b.paid, 0);
  const byNo: Record<string, string> = {};
  bills.forEach((b) => { if (b.billNo) byNo[b.id] = b.billNo; });

  return (
    <>
      <PBar back="Bills" name={name} onBack={onBack} onMenu={() => onSay('Send this statement to the vendor')} />
      <div className="phead">
        <h1>{name}</h1>
        <p>{bills.length} {bills.length === 1 ? 'bill' : 'bills'} in the drawer · {inr(billed)} billed · {inr(paid)} paid</p>
        <div className="pamt"><b>{inr(owed)}</b>{owed ? <span className="cap due">You owe</span> : <span className="cap paid">{TICK}All clear</span>}</div>
      </div>
      <div className="blk" style={{ marginTop: 18 }}>
        <h3>Statement<span>newest first</span></h3>
        {(ev ?? []).map((x: StatementEvent, i) => x.kind === 'payment' ? (
          <div className="sline" key={i}>
            <span className="k"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            <span className="m"><b>Payment</b><span>{x.label} · against {x.billNo ? `no. ${x.billNo}` : 'the ' + day(x.date) + ' bill'}</span></span>
            <span className="r"><em className="minus">−{inr(-x.amount)}</em><small>owed {inr(x.running)}</small></span>
          </div>
        ) : (
          <button type="button" className="sline" key={i} style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
            onClick={() => x.billId && onBill(x.billId)}>
            <span className="m"><b>Bill{x.billNo ? ` ${x.billNo}` : ''}</b><span>{day(x.date)} · {short(x.site)}</span></span>
            <span className="r"><em>+{inr(x.amount)}</em><small>owed {inr(x.running)}</small></span>
          </button>
        ))}
        {!ev?.length && <p className="none2">Nothing on file yet.</p>}
        <div className="tot"><i>You owe today</i><b>{inr(owed)}</b></div>
      </div>
    </>
  );
}

// ── link a payment ────────────────────────────────────────────────────────────
function Linker({ b, orgId, onClose, onDone, onFail }: {
  b: BillRow; orgId: string | null | undefined; onClose: () => void;
  onDone: (msg: string) => void; onFail: (m: string) => void;
}) {
  const need = leftOf(b);
  const [wide, setWide] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);

  const { data: pool } = useQuery({
    queryKey: ['bill_linkable', b.vendorId, wide ? null : b.projectId, need],
    enabled: !!b.vendorId,
    queryFn: () => loadLinkablePayments(b.vendorId!, wide ? null : b.projectId, need),
  });
  const { data: all } = useQuery({
    queryKey: ['bill_linkable', b.vendorId, null, need],
    enabled: !!b.vendorId,
    queryFn: () => loadLinkablePayments(b.vendorId!, null, need),
  });
  const others = Math.max(0, (all?.length ?? 0) - (pool?.length ?? 0));

  // Each ticked payment pours into the bill, in the order it was ticked; a payment bigger than what
  // is left gives only what is needed and the rest stays free for another bill.
  const alloc = useMemo(() => {
    const byId: Record<string, LinkablePayment> = {};
    (pool ?? []).forEach((t) => { byId[t.txnId] = t; });
    return allocateAcross(picked.map((id) => byId[id]).filter(Boolean), need);
  }, [picked, pool, need]);
  const got = alloc.reduce((a: number, p) => a + p.use, 0);
  const rest = need - got;
  const used = alloc.filter((p: { use: number }) => p.use > 0);

  async function link() {
    if (!orgId || busy || !used.length) return;
    setBusy(true);
    try {
      for (const p of used) {
        await linkPaymentToBill(orgId, p.pay, allocTargetOf(b), p.use);
      }
      hapt([10, 40, 18]);
      onDone(rest <= 0 ? 'Linked. This bill is paid.' : `Linked. ${inr(rest)} still left.`);
    } catch (e) { setBusy(false); onFail(e instanceof Error ? e.message : 'Could not link that payment'); }
  }

  const head = (title: string, sub: string, n: 1 | 2) => (
    <div className="p-head">
      <div className="t"><h2>{title}</h2><span>{sub}</span></div>
      <div className="steps" aria-hidden="true"><i className={n === 1 ? 'now' : 'was'} /><i className={n === 2 ? 'now' : ''} /></div>
      {n === 1
        ? <button type="button" className="x" aria-label="Close" onClick={onClose}>{CLOSE}</button>
        : <button type="button" className="x" aria-label="Back" onClick={() => setStep(1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>}
    </div>
  );

  if (step === 2) return (
    <div className="wz">
      {head('Check the link', 'Nothing new is created. These Book entries get tied to this bill.', 2)}
      <div className="wzbody">
        {used.map((p) => (
          <div className="alloc" key={p.pay.txnId}>
            <span>{day(p.pay.date)}{p.pay.mode ? ` · ${p.pay.mode}` : ''}
              {p.use < p.pay.free && <small>{inr(p.pay.free - p.use)} of it stays free for another bill</small>}</span>
            <b>{inr(p.use)}</b>
          </div>
        ))}
        <div className="becomes"><span>{b.vendor}{b.billNo ? ` · ${b.billNo}` : ''} becomes</span>
          {rest <= 0 ? <span className="cap paid">{TICK}Paid</span> : <span className="cap part">{inr(rest)} left</span>}</div>
        <button type="button" className={`wzbtn${busy ? ' ok' : ''}`} disabled={busy} onClick={link}>
          {busy ? 'Linked' : `Link ${used.length === 1 ? 'this payment' : `${used.length} payments`}`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="wz">
      {head('Which payments paid this?', `${b.vendor} · ${short(b.site)} · in Book, not linked to any bill`, 1)}
      <div className="wzbody">
        <div className="target">
          <div className="fig"><span>₹</span>{Math.round(need).toLocaleString('en-IN')}<small>to cover{b.billNo ? ` · bill ${b.billNo}` : ''}</small></div>
          <div className="pour"><i style={{ width: `${need ? Math.min(100, (got / need) * 100) : 0}%` }} /></div>
          <p className={rest <= 0 && got > 0 ? 'full' : ''}>
            {!got ? 'Tick what paid it. One payment or several.'
              : rest <= 0 ? 'Covered in full.'
              : <><b>{inr(got)}</b> picked · <b>{inr(rest)}</b> still to cover</>}
          </p>
        </div>
        {pool?.length ? (
          <div className="cands">
            {pool.map((t, i) => {
              const a = alloc.find((x) => x.pay.txnId === t.txnId);
              const why = a && a.use < t.free
                ? <span className="why part">{a.use ? `${inr(a.use)} used · ${inr(t.free - a.use)} stays free` : 'not needed'}</span>
                : Math.abs(t.free - need) < 0.5 ? <span className="why">same amount</span>
                : i === 0 && pool.every((x) => Math.abs(x.free - need) >= 0.5) ? <span className="why part">closest date</span> : null;
              return (
                <button key={t.txnId} type="button" className="cand" aria-pressed={picked.includes(t.txnId)}
                  style={{ animationDelay: `${i * 45}ms` }}
                  onClick={() => { setPicked((p) => (p.includes(t.txnId) ? p.filter((x) => x !== t.txnId) : [...p, t.txnId])); hapt(4); }}>
                  <span className="pick">{TICK}</span>
                  <span className="m">
                    <b>{day(t.date)}{t.mode ? ` · ${t.mode}` : ''}</b>
                    <span>{[t.note, !t.sameProject && t.projectId ? short(t.projectId) : '', t.free < t.total ? `${inr(t.total - t.free)} already on another bill` : ''].filter(Boolean).join(' · ') || 'In Book'}</span>
                    <span className="tagslot">{why}</span>
                  </span>
                  <span className="r"><em>{inr(t.free)}</em></span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="nonefound"><b>Nothing to link yet</b>No payment to {b.vendor} at {short(b.site)} is waiting without a bill.
            {others ? '' : ' When one is entered in Book, it will show up here.'}</div>
        )}
        {(others > 0 || wide) && (
          <button type="button" className="widen" aria-pressed={wide}
            onClick={() => { setWide((w) => !w); setPicked([]); hapt(4); }}>
            <span>Also look at {b.vendor.split(' ')[0]}&apos;s other sites{wide ? '' : ` · ${others} more`}</span><i className="sw" />
          </button>
        )}
        <button type="button" className="wzbtn" disabled={!used.length} onClick={() => { hapt(6); setStep(2); }}>
          {used.length ? `Next · ${inr(got)} from ${used.length} ${used.length === 1 ? 'payment' : 'payments'}` : 'Pick a payment'}
        </button>
      </div>
    </div>
  );
}
