/**
 * MobileNavBar — the bar, the More panel and the action, ported from the reference prototype
 * (claude.ai/artifact/NWiS9bYDvcRRDWMQo4K4Ps) value for value.
 *
 * THE BAR. Navigation only. Nothing sits on it, nothing hides a tab. Five slots, never moving:
 *   here      = cream icon + cream label + the dot, which slides to wherever you are
 *   elsewhere = the same icon and label at 52%
 *   waiting   = a small clay count on the icon (the real number, not "9+")
 *
 * MORE. Four places you live in, and one door to everything else. The panel is the bar's own colour
 * and rises out of it, so it reads as the bar opening, not a new screen. Sections are grouped the way
 * a builder thinks: money, site, setup. If the page you are on lives in here, the dot sits under More,
 * the door wears the name of the room, and inside the panel the dot sits beside that page.
 *
 * THE ACTION. One per page, off the bar, and it says what it does: + Transaction · + Bill · + PO ·
 * + Contract · + Party · + Invoice. A page with nothing to create (Review, Payables, Attendance,
 * Settings) has no button at all — it leaves. Scrolling down folds it to the "+"; scrolling up (or the
 * top) unfolds it. Where the page already has the same button in view (the Transactions header) it
 * stays away until that button scrolls off. Its states — working · done · failed · offline · draft —
 * are the same clay capsule and are driven from outside through `navAction` (see below).
 *
 * It renders ONLY the top-level nav — inside a project the app keeps its own project sub-nav (App.tsx).
 * Navigation is URL-driven (react-router). The CSS is scoped under `.mnav` so the reference's exact
 * values live here without leaking into the app.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSoftKeyboard } from '../../lib/useSoftKeyboard';
import { useSheetDrag } from '../../lib/sheetDrag';
import { navAction, type NavActionState } from './navAction';
import { TxComposer } from './TxComposer';
import { BillComposer } from './BillComposer';
import { BILL_CSS } from './billCss';
import { TX_CSS, billDoor, composer, emptyBill, emptyDraft, navTakeover, type BillDoorOpts, type BillState, type TxDraft } from './txDraft';
import { useSheetFlag } from '../../lib/sheetFlag';

// ── icons, exact from the reference (24×24, stroke 1.65, round caps) ──
const I: Record<string, ReactNode> = {
  book: <><path d="M6 3.5h10a2 2 0 0 1 2 2v15H8a2 2 0 0 1-2-2v-15Z" /><path d="M6 18.5a2 2 0 0 1 2-2h10" /><path d="M9.5 7.5h5M9.5 10.5h3" /></>,
  review: <><path d="M4 13.5 6.2 5.6a1.5 1.5 0 0 1 1.5-1.1h8.6a1.5 1.5 0 0 1 1.5 1.1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5Z" /><path d="M4 13.5h4.2l1.2 2.5h5.2l1.2-2.5H20" /></>,
  bills: <><path d="M6.5 3.5h11v17l-2.75-1.6L12 20.5l-2.75-1.6L6.5 20.5v-17Z" /><path d="M9.5 8h5M9.5 11.5h5" /></>,
  pos: <><path d="M6 8.5h12l-.9 10.2a1.5 1.5 0 0 1-1.5 1.3H8.4a1.5 1.5 0 0 1-1.5-1.3L6 8.5Z" /><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" /></>,
  grid: <><circle cx="7.5" cy="7.5" r="1.6" /><circle cx="16.5" cy="7.5" r="1.6" /><circle cx="7.5" cy="16.5" r="1.6" /><circle cx="16.5" cy="16.5" r="1.6" /></>,
  pay: <><path d="M4.5 7.5a2 2 0 0 1 2-2h10v3" /><path d="M4.5 7.5v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-13" /><path d="M15.6 13.5h.01" /></>,
  contracts: <><path d="M7 3.5h7l4 4v13H7v-17Z" /><path d="M14 3.5v4h4" /><path d="M10 13h5M10 16.5h3" /></>,
  parties: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.3a3 3 0 0 1 0 5.4M17.5 14.2a5.5 5.5 0 0 1 3 4.8" /></>,
  attendance: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>,
  work: <><path d="M4 20.5h16" /><path d="M6 20.5V9l6-4.5L18 9v11.5" /><path d="M10 20.5v-6h4v6" /></>,
  problems: <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 10v4.5M12 17.2h.01" /></>,
  team: <><circle cx="12" cy="8.5" r="3.2" /><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" /></>,
  tally: <><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" /><path d="M4 20v-4.5h4.5" /></>,
  settings: <><path d="M5 7h9M18 7h1M5 12h2M11 12h8M5 17h7M16 17h3" /><circle cx="16" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="14" cy="17" r="2" /></>,
  billing: <><rect x="3" y="6.5" width="18" height="11" rx="2.5" /><circle cx="12" cy="12" r="2.4" /><path d="M6.4 12h.01M17.6 12h.01" /></>,
  clients: <><path d="M4 20.5V6.8l7-3.3v17" /><path d="M11 9.8h8.5v10.7" /><path d="M20.5 20.5H3.5" /><path d="M7.2 9.5h.01M7.2 13h.01M7.2 16.5h.01M15 13.5h.01M15 16.8h.01" /></>,
  out: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M15 12H5" /></>,
};

type Role = string;
type Dest = {
  key: string; label: string; to: string; icon: ReactNode;
  /** pathname prefixes that light this destination */
  at: string[];
  show: (r: Role) => boolean;
  /** which live count sits on it, if any */
  count?: string;
};
const all = () => true;
const notSupervisor = (r: Role) => r !== 'supervisor';
const admin = (r: Role) => r === 'principal' || r === 'management';

/** The four you live in. More is the fifth slot and is not a destination. */
const BAR: Dest[] = [
  { key: 'book', label: 'Book', to: '/ledger', icon: I.book, at: ['/ledger'], show: notSupervisor },
  { key: 'review', label: 'Review', to: '/logbook', icon: I.review, at: ['/logbook'], show: all, count: 'review' },
  { key: 'bills', label: 'Bills', to: '/bills', icon: I.bills, at: ['/bills'], show: notSupervisor },
  { key: 'pos', label: 'POs', to: '/purchase-orders', icon: I.pos, at: ['/purchase-orders', '/orders'], show: (r) => r !== 'supervisor' && r !== 'accountant', count: 'pos' },
];

/** Everything that is not on the bar. Grouped the way a builder thinks. */
const MORE: [string, Dest[]][] = [
  ['Money', [
    { key: 'pay', label: 'Payables', to: '/payables', icon: I.pay, at: ['/payables'], show: notSupervisor, count: 'payables' },
    { key: 'billing', label: 'Billing', to: '/billing', icon: I.billing, at: ['/billing', '/invoices'], show: notSupervisor, count: 'billing' },
    { key: 'contracts', label: 'Contracts', to: '/work-orders', icon: I.contracts, at: ['/work-orders'], show: all, count: 'contracts' },
  ]],
  ['Site', [
    { key: 'attendance', label: 'Attendance', to: '/attendance', icon: I.attendance, at: ['/attendance'], show: all },
    { key: 'work', label: 'Work plan', to: '/desk/all/plan', icon: I.work, at: ['/desk', '/site-desk', '/tasks'], show: all },
    { key: 'problems', label: 'Problems', to: '/desk/all/problems', icon: I.problems, at: [], show: all },
  ]],
  ['People', [
    { key: 'parties', label: 'Parties', to: '/stakeholders', icon: I.parties, at: ['/stakeholders'], show: notSupervisor },
    { key: 'clients', label: 'Clients', to: '/stakeholders?tab=client', icon: I.clients, at: [], show: notSupervisor },
    { key: 'team', label: 'Team', to: '/team', icon: I.team, at: ['/team'], show: admin },
  ]],
];

/** The account, at the foot of the panel — not daily work, so not a card in the grid. */
const FOOT: Dest[] = [
  { key: 'settings', label: 'Settings', to: '/profile', icon: I.settings, at: ['/profile', '/settings'], show: all },
];

/** What each page makes, and the word the action wears. Absent = nothing to create, so no button. */
const ACTION: Record<string, { word: string; to: string }> = {
  book: { word: 'Transaction', to: '/ledger/new' },
  bills: { word: 'Bill', to: '/bills?new=1' },
  // POs: no create FAB — the purchase-request list is a review surface; orders are raised from a request.
  contracts: { word: 'Contract', to: '/work-orders/new' },
  parties: { word: 'Party', to: '/stakeholders?new=1' },
  clients: { word: 'Client', to: '/stakeholders?tab=client&new=1' },
  billing: { word: 'Invoice', to: '/billing/new' },
};

const Glyph = ({ children, cls }: { children: ReactNode; cls?: string }) => (
  <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">{children}</svg>
);

export function MobileNavBar({
  role, counts, poBadge = 0, hidden = false, onSignOut,
}: {
  role: Role;
  /** live waiting counts, by destination key */
  counts?: Record<string, number>;
  /** legacy: the PO count, folded into `counts` when `counts` is absent */
  poBadge?: number;
  hidden?: boolean;
  onSignOut?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  const navRef = useRef<HTMLElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);

  const hapt = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

  // While you are typing, the bar and its action get out of the way — anywhere in the app, whatever
  // raised the keyboard. The height it reports is what the composer rides above.
  const kb = useSoftKeyboard();

  const n = useMemo(() => counts ?? { pos: poBadge }, [counts, poBadge]);
  const countOf = useCallback((d: Dest) => (d.count ? (n[d.count] ?? 0) : 0), [n]);

  const bar = useMemo(() => BAR.filter((t) => t.show(role)), [role]);
  const groups = useMemo(
    () => MORE.map(([title, items]) => [title, items.filter((x) => x.show(role))] as [string, Dest[]]).filter(([, items]) => items.length > 0),
    [role],
  );
  const moreItems = useMemo(() => [...groups.flatMap(([, items]) => items), ...FOOT.filter((d) => d.show(role))], [groups, role]);
  const moreCount = useMemo(() => moreItems.reduce((s, d) => s + countOf(d), 0), [moreItems, countOf]);

  const lit = (d: Dest) => d.at.some((p) => path === p || path.startsWith(p + '/'));
  const activeKey = bar.find(lit)?.key ?? moreItems.find(lit)?.key ?? (path.startsWith('/desk/') && path.endsWith('/problems') ? 'problems' : '');
  const inMore = moreItems.find((x) => x.key === activeKey);
  const slot = inMore ? 'more' : activeKey;

  // ── the dot, which slides to wherever you are ──
  const [dotX, setDotX] = useState(0);
  const [dotReady, setDotReady] = useState(false);
  const placeDot = useCallback(() => {
    const el = navRef.current?.querySelector<HTMLElement>(`[data-tab="${slot || '\u0000'}"]`);
    if (el) setDotX(el.offsetLeft + el.offsetWidth / 2);
  }, [slot]);
  useLayoutEffect(() => {
    const r = requestAnimationFrame(() => { placeDot(); requestAnimationFrame(() => setDotReady(true)); });
    return () => cancelAnimationFrame(r);
  }, [placeDot]);
  useEffect(() => {
    window.addEventListener('resize', placeDot);
    document.fonts?.ready.then(placeDot).catch(() => { /* no font metrics: the dot is already placed */ });
    return () => window.removeEventListener('resize', placeDot);
  }, [placeDot]);

  // ── More: the bar opens ──
  const [moreMounted, setMoreMounted] = useState(false);
  const [moreOn, setMoreOn] = useState(false);
  useSheetFlag(moreMounted);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openMore = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    hapt(6); setMoreMounted(true);
  };
  const closeMore = useCallback(() => {
    setMoreOn(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { setMoreMounted(false); closeTimer.current = null; }, 500);
  }, []);
  useEffect(() => {
    if (!moreMounted) return;
    const r = requestAnimationFrame(() => setMoreOn(true));
    return () => cancelAnimationFrame(r);
  }, [moreMounted]);
  useEffect(() => {
    if (!moreOn) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMore(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [moreOn, closeMore]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // Pull it down to close it — the same gesture every sheet in the app has (sheetDrag), which knows
  // not to take over while you are part-way down its own scroll.
  const panelDrag = useSheetDrag<HTMLElement>(closeMore, moreMounted);

  // A page may take the bar for its own actions (Transactions' select mode). The tabs step down,
  // the actions step up, in the same capsule.
  const [lent, setLent] = useState<ReactNode>(null);
  useEffect(() => navTakeover.bind(setLent), []);

  // ── the composer ── the bar opens for a new transaction, exactly as it does for More
  const [draft, setDraft] = useState<TxDraft | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  // close it half-way and nothing is lost: the capsule becomes "Resume draft"
  const closeComposer = useCallback((keep: boolean) => {
    const d = draftRef.current;
    setDraft(null);
    if (keep && d && (d.party || d.amt)) navAction.draft('Resume draft', () => setDraft({ ...d }));
  }, []);

  const [billDraft, setBillDraft] = useState<BillState | null>(null);
  const billRef = useRef(billDraft);
  useEffect(() => { billRef.current = billDraft; });
  // A page may borrow this card (billDoor) and say who is billing; the borrower hears what was filed.
  const [billLock, setBillLock] = useState<BillDoorOpts['lock']>(null);
  const billFiled = useRef<BillDoorOpts['onFiled']>(undefined);
  const closeBill = useCallback((keep: boolean) => {
    const b = billRef.current;
    setBillDraft(null); setBillLock(null); billFiled.current = undefined;
    if (keep && b && b.stage === 'check') navAction.draft('Resume bill', () => setBillDraft({ ...b }));
  }, []);
  useEffect(() => billDoor.bind((o) => {
    setBillLock(o.lock ?? null);
    billFiled.current = o.onFiled;
    closeMore();
    setBillDraft(emptyBill());
    navAction.reset();
  }), [closeMore]);

  const openComposer = useCallback((dir: 'out' | 'in' = 'out') => {
    closeMore(); setDraft((d) => d ?? emptyDraft(dir)); navAction.reset();
  }, [closeMore]);
  useEffect(() => composer.bind(openComposer), [openComposer]);

  // ── the action ──
  const act = ACTION[activeKey];
  const [fab, setFab] = useState<NavActionState>(() => navAction.state);
  useEffect(() => navAction.subscribe(setFab), []);
  const busy = fab.phase !== 'idle';

  const [word, setWord] = useState(act ? act.word : '');
  const [swap, setSwap] = useState(false);
  const [folded, setFolded] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);

  const away = !!lent || (!busy && (!act || ctaVisible || moreOn || !!draft || !!billDraft));
  const awayRef = useRef(away);
  useEffect(() => { awayRef.current = away; });

  // the label hands over when the page changes: the + gives a quarter turn, the word swaps under it
  useEffect(() => {
    if (!act || busy) return;
    if (awayRef.current) { setWord(act.word); return; }
    setSwap(true);
    const t = setTimeout(() => { setWord(act.word); setSwap(false); }, 200);
    return () => clearTimeout(t);
  }, [act, busy]);

  // the width is the word's own width: 54 (the plus) − 6 (its overlap) + the text + 22 of air
  const label = busy ? fab.label : word;
  useLayoutEffect(() => {
    const m = measureRef.current, f = fabRef.current;
    if (!m || !f) return;
    m.textContent = label;
    f.style.setProperty('--w', Math.ceil(54 - 6 + m.getBoundingClientRect().width + 22) + 'px');
  }, [label]);

  // the action is wanted unless this page has none, or the page's own button for the same thing is on screen
  const ctaOnScreen = () => {
    const c = document.querySelector<HTMLElement>('[data-page-cta]');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return r.height > 0 && r.bottom > 8 && r.top < window.innerHeight;
  };
  // fold on the way down, unfold on the way up
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, d = y - last;
      if (Math.abs(d) > 5) { setFolded(d > 0 && y > 40); last = y; }
      if (y < 8) setFolded(false);
      setCtaVisible(ctaOnScreen());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const r = requestAnimationFrame(() => { setFolded(false); setCtaVisible(ctaOnScreen()); });
    const t = setTimeout(() => setCtaVisible(ctaOnScreen()), 200);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [path]);

  const go = (to: string) => { hapt(6); closeMore(); navigate(to); window.scrollTo({ top: 0 }); };
  const onTab = (d: Dest) => {
    if (draft) closeComposer(true);                    // going somewhere puts the half-written entry aside
    if (billDraft) closeBill(true);
    if (d.key === activeKey) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }   // tap the tab you are on: back to the top
    go(d.to);
  };
  const onFab = () => {
    if (fab.phase === 'working' || fab.phase === 'done' || fab.phase === 'offline') return;
    if ((fab.phase === 'failed' || fab.phase === 'draft') && fab.retry) { hapt(8); fab.retry(); return; }
    if (!act) return;
    hapt(8);
    if (activeKey === 'book') { openComposer(); return; }
    if (activeKey === 'bills') { closeMore(); setBillDraft((b) => b ?? emptyBill()); navAction.reset(); return; }
    go(act.to);
  };

  const Count = ({ v }: { v: number }) => <i className="count" aria-label={`${v} waiting`}>{v}</i>;

  return (
    <>
      <style>{CSS + TX_CSS + BILL_CSS}</style>
      <div className={`mnav${kb.open ? ' kb' : ''}${draft || billDraft ? ' over' : ''}`} style={{ ['--kb' as string]: `${kb.height}px` } as React.CSSProperties}>
        <TxComposer key={draft ? "on" : "off"} draft={draft} onDraft={setDraft} onClose={closeComposer} />
        <BillComposer key={billDraft ? "bon" : "boff"} bill={billDraft} onBill={setBillDraft} onClose={closeBill}
          lock={billLock} onFiled={(id) => billFiled.current?.(id)} />
        {moreMounted && (
          <>
            <div className={`mnav-scrim${moreOn ? ' on' : ''}`} onClick={closeMore} />
            <section
              ref={panelDrag} className={`mnav-more${moreOn ? ' on' : ''}`} role="dialog" aria-modal="true" aria-label="All sections"
            >
              <div className="grab" aria-hidden="true"><i /></div>
              {groups.map(([title, items], gi) => (
                <div key={title}>
                  <h2>{title}</h2>
                  <div className="grid">
                    {items.map((d, di) => {
                      const c = countOf(d);
                      return (
                        <button key={d.key} type="button"
                          className={`item${d.key === activeKey ? ' at' : ''}`}
                          aria-current={d.key === activeKey ? 'page' : undefined}
                          style={{ ['--i' as string]: groups.slice(0, gi).reduce((k, [, g]) => k + g.length, 0) + di } as React.CSSProperties}
                          onClick={() => { closeMore(); go(d.to); }}>
                          <Glyph>{d.icon}</Glyph><b>{d.label}</b>
                          {c > 0 && <i className="n" aria-label={`${c} waiting`}>{c}</i>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {FOOT.filter((d) => d.show(role)).map((d) => (
                <button key={d.key} type="button" className={`foot${d.key === activeKey ? ' at' : ''}`}
                  aria-current={d.key === activeKey ? 'page' : undefined}
                  onClick={() => { closeMore(); go(d.to); }}>
                  <Glyph>{d.icon}</Glyph><b>{d.label}</b><span className="ch">›</span>
                </button>
              ))}
              {onSignOut && (
                <button type="button" className="signout" onClick={() => { closeMore(); onSignOut(); }}>
                  <Glyph>{I.out}</Glyph><b>Sign out</b>
                </button>
              )}
            </section>
          </>
        )}

      <div className={`mnav-dock${hidden || kb.open ? ' gone' : ''}`}>
        {/* the action — off the bar, above its right end, saying what it makes */}
        <button
          ref={fabRef} type="button"
          className={`fab ${fab.cls}${away ? ' away' : ''}${folded && !busy ? ' folded' : ''}${swap ? ' swap' : ''}`}
          aria-label={busy ? label : `New ${label.toLowerCase()}`}
          aria-hidden={away ? true : undefined}
          onClick={onFab}
        >
          <span className="plus">
            <Glyph cls="p"><path d="M12 5v14M5 12h14" /></Glyph>
            <Glyph cls="tick"><path d="m6 12.5 4 4 8-9" /></Glyph>
            <i className="pip" aria-hidden="true" />
          </span>
          <span className="lbl">{label}</span>
        </button>
        <span className="measure" ref={measureRef} aria-hidden="true" />
        <div className="live" role="status" aria-live="polite">{busy ? label : ''}</div>

        <nav className={`nav${lent ? ' lent' : ''}`} ref={navRef} aria-label="Sections">
          <div className="set tabs" style={{ gridTemplateColumns: `repeat(${bar.length + 1}, 1fr)` }}>
          {bar.map((d) => {
            const c = countOf(d);
            return (
              <button key={d.key} type="button" className="tab" data-tab={d.key}
                aria-current={slot === d.key ? 'page' : undefined} onClick={() => onTab(d)}>
                <Glyph>{d.icon}</Glyph><span>{d.label}</span>{c > 0 && <Count v={c} />}
              </button>
            );
          })}
          <button type="button" className={`tab${moreOn ? ' open' : ''}`} data-tab="more"
            aria-haspopup="dialog" aria-expanded={moreOn} aria-current={slot === 'more' ? 'page' : undefined}
            onClick={() => { if (draft) closeComposer(true); if (billDraft) closeBill(true); if (moreMounted) closeMore(); else openMore(); }}>
            <Glyph cls="g">{I.grid}</Glyph>
            <i className="x" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17" /></svg></i>
            {/* the door wears the name of the room you are in */}
            <span>{inMore ? inMore.label : 'More'}</span>
            {moreCount > 0 && <i className="count" aria-label={`${moreCount} waiting inside`}>{moreCount}</i>}
          </button>
          <i className="here" aria-hidden="true" style={{ transform: `translateX(${dotX}px)`, transition: dotReady ? undefined : 'none', opacity: slot ? 1 : 0 }} />
          </div>
          {lent && <div className="set acts" role="toolbar" aria-label="With the selected entries">{lent}</div>}
        </nav>
      </div>
      </div>
    </>
  );
}

// ── scoped CSS — the reference's own values, unchanged ──
const CSS = `
.mnav{--sage:#2F5D3A;--night:#170E08;--night-bg:linear-gradient(180deg,#191009,#140D07);--night-edge:#302014;--lift:0 24px 50px -16px rgba(20,13,7,.72),0 0 0 1px rgba(245,240,231,.10),inset 0 1px 0 rgba(245,240,231,0.34);--cream:250,248,243;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;
  --clay:#B5472A;--clay-hi:#D4633E;--ease:cubic-bezier(.22,.8,.24,1);--nav-h:64px;--nav-gap:12px;
  position:fixed;inset:0;z-index:40;pointer-events:none;
  font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
/* While a composer is up it owns the screen — including over a page's own sheet, which is where it
   was opened from and must not be painted over by. */
.mnav.over{z-index:70}
.mnav,.mnav *{box-sizing:border-box}
/* the bar and the action ride together; only they tuck away for a full-screen form */
.mnav-dock{position:absolute;inset:0;pointer-events:none;transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .28s}
.mnav-dock.gone{transform:translateY(200%);opacity:0}
@media (min-width:768px){.mnav{display:none}}

/* =====================================================================
   THE BAR.  Navigation only. Nothing sits on it, nothing hides a tab.
   ===================================================================== */
.mnav .nav{pointer-events:auto;z-index:20;position:absolute;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom));
  max-width:406px;margin:0 auto;height:var(--nav-h);overflow:hidden;
  border-radius:32px;background:var(--night-bg);
  box-shadow:0 18px 36px -14px rgba(20,13,7,.6),inset 0 1px 0 var(--night-edge),inset 0 2px 0 0 rgba(var(--cream),.05)}
/* two sets in one capsule: the tabs, and whatever a page has lent it */
.mnav .nav .set{position:absolute;inset:0;display:grid;padding:0 6px;transition:opacity .28s ease,transform .42s var(--ease)}
.mnav .nav .acts{grid-auto-flow:column;grid-auto-columns:1fr;opacity:0;transform:translateY(14px);pointer-events:none}
.mnav .nav.lent .tabs{opacity:0;transform:translateY(-14px);pointer-events:none}
.mnav .nav.lent .acts{opacity:1;transform:none;pointer-events:auto}
/* a lent action wears the tab's shape, at full strength */
.mnav .nav .acts .tab{color:rgb(var(--cream));padding-bottom:0}
.mnav .nav .acts .tab[disabled]{opacity:.35}
.mnav .tab{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0;padding:0 0 7px;
  border:0;background:none;color:rgba(var(--cream),.52);font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;
  transition:color .3s ease,transform .18s ease}
.mnav .tab:active{transform:scale(.94)}
.mnav .tab[aria-current="page"]{color:rgb(var(--cream))}
.mnav .tab svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.mnav .tab span{font-size:10.5px;font-weight:600;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.mnav .count{font-style:normal;position:absolute;top:8px;left:calc(50% + 5px);min-width:17px;height:17px;padding:0 5px;border-radius:9px;
  background:var(--clay-hi);color:#fff;font-family:'DM Mono',ui-monospace,Menlo,monospace;font-size:10px;font-weight:500;
  display:grid;place-items:center;box-shadow:0 0 0 2px var(--night)}
.mnav .here{position:absolute;left:0;bottom:7px;width:4px;height:4px;margin-left:-2px;border-radius:2px;background:var(--clay-hi);pointer-events:none;
  transition:transform .46s cubic-bezier(.3,1.32,.5,1),opacity .3s ease}
/* the four dots give way to a cross while the panel is open */
.mnav .tab .x{position:absolute;inset:0 0 18px;display:grid;place-items:center;opacity:0;transform:rotate(-45deg) scale(.7);transition:opacity .25s ease,transform .4s var(--ease)}
.mnav .tab .x svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.mnav .tab svg.g{transition:opacity .25s ease,transform .4s var(--ease)}
.mnav .tab.open{color:rgb(var(--cream))}
.mnav .tab.open svg.g{opacity:0;transform:rotate(45deg) scale(.7)}
.mnav .tab.open .x{opacity:1;transform:none}

/* =====================================================================
   THE ACTION.  One per page, off the bar, and it says what it does.
   filled = alive · hollow = not connected · clay = working · sage = done · breath = working · one shake = no
   ===================================================================== */
.mnav .fab{--w:150px;pointer-events:auto;position:absolute;right:16px;bottom:calc(var(--nav-gap) + var(--nav-h) + 14px + env(safe-area-inset-bottom));
  z-index:19;height:54px;width:var(--w);padding:0;border:0;border-radius:27px;cursor:pointer;
  background:var(--clay);color:#fff;display:flex;align-items:center;overflow:hidden;white-space:nowrap;
  box-shadow:0 16px 28px -14px rgba(181,71,42,.95),0 4px 10px -6px rgba(21,16,12,.4);
  transition:width .42s var(--ease),transform .38s var(--ease),opacity .25s ease,background-color .4s ease,box-shadow .4s ease,color .3s ease}
.mnav .fab:active{transform:scale(.96)}
.mnav .fab .plus{position:relative;flex:none;width:54px;height:54px;display:grid;place-items:center}
.mnav .fab .plus svg{position:absolute;inset:0;margin:auto;width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;
  transition:transform .42s var(--ease),opacity .25s ease}
.mnav .fab .lbl{font-size:16px;font-weight:600;margin-left:-6px;padding-right:22px;transition:opacity .22s ease}
.mnav .fab.folded{width:54px}
.mnav .fab.folded .lbl{opacity:0}
.mnav .fab.swap .lbl{opacity:0}
.mnav .fab.swap .plus svg{transform:rotate(90deg)}
.mnav .fab.away{transform:translateY(16px) scale(.7);opacity:0;pointer-events:none}
.mnav .fab .pip{position:absolute;inset:0;margin:auto;width:8px;height:8px;border-radius:50%;background:currentColor;opacity:0;transform:scale(.4);
  transition:opacity .25s ease,transform .4s var(--ease),background-color .3s,box-shadow .3s}
.mnav .fab .pip::after{content:'';position:absolute;inset:0;border-radius:50%;border:1px solid currentColor;opacity:0}
.mnav .fab .tick{stroke-width:2.6!important;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22;opacity:0}
.mnav .fab.working .p,.mnav .fab.done .p,.mnav .fab.hollow .p,.mnav .fab.draft .p{opacity:0;transform:scale(.5) rotate(90deg)}
.mnav .fab.working .pip{opacity:1;transform:none;animation:mnavbreath 1.5s ease-in-out infinite}
.mnav .fab.working .pip::after{animation:mnavping 1.5s var(--ease) infinite}
.mnav .fab.working.slow .pip{animation-duration:2.8s}
.mnav .fab.working.slow .pip::after{animation:none}
.mnav .fab.done{background:var(--sage);box-shadow:0 16px 28px -14px rgba(47,93,58,.9),0 4px 10px -6px rgba(21,16,12,.4)}
.mnav .fab.done .tick{opacity:1;animation:mnavtick .42s .16s ease-out forwards}
.mnav .fab.hollow{background:var(--paper);color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink-2),0 14px 26px -16px rgba(21,16,12,.5)}
.mnav .fab.hollow .pip{opacity:1;transform:none;background:transparent;box-shadow:inset 0 0 0 1.5px var(--ink-2);width:10px;height:10px}
.mnav .fab.no{animation:mnavno .42s ease-in-out 1}
.mnav .fab.draft .pip{opacity:1;transform:none}
@keyframes mnavbreath{0%,100%{transform:scale(1)}50%{transform:scale(.72)}}
@keyframes mnavping{0%{transform:scale(1);opacity:.5}100%{transform:scale(3);opacity:0}}
@keyframes mnavtick{to{stroke-dashoffset:0}}
@keyframes mnavno{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.mnav .measure{position:absolute;visibility:hidden;white-space:nowrap;font-size:16px;font-weight:600}
.mnav .live{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}

/* =====================================================================
   MORE.  The panel is the bar's own colour and rises out of it, so it reads
   as the bar opening, not a new screen.
   ===================================================================== */
.mnav .mnav-scrim{pointer-events:auto;position:absolute;inset:0;z-index:17;background:rgba(9,6,3,.52);backdrop-filter:saturate(.8) blur(1.5px);-webkit-backdrop-filter:saturate(.8) blur(1.5px);opacity:0;transition:opacity .35s ease}
.mnav .mnav-scrim.on{opacity:1}
.mnav .mnav-more{pointer-events:auto;
  position:absolute;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom));z-index:18;
  max-width:406px;margin:0 auto;padding:8px 10px calc(var(--nav-h) + 10px);
  border-radius:32px;background:var(--night-bg);color:rgb(var(--cream));box-shadow:var(--lift);
  transform-origin:50% 100%;transform:translateY(24px) scale(.96);opacity:0;max-height:calc(100% - 80px);overflow:auto;
  transition:transform .46s var(--ease),opacity .28s ease;touch-action:pan-y;-webkit-overflow-scrolling:touch}
.mnav .mnav-more.on{transform:none;opacity:1;transition:transform .5s var(--ease),opacity .3s ease}
.mnav .mnav-more .grab{display:grid;place-items:center;height:22px}
.mnav .mnav-more .grab i{width:36px;height:4px;border-radius:2px;background:rgba(var(--cream),.18)}
.mnav .mnav-more h2{margin:10px 12px 6px;font-size:12.5px;font-weight:600;color:rgba(var(--cream),.5)}
.mnav .mnav-more .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.mnav .mnav-more .item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:78px;padding:8px 4px;
  border:0;border-radius:20px;background:rgba(var(--cream),.055);color:rgba(var(--cream),.9);font:inherit;cursor:pointer;
  opacity:0;transform:translateY(8px);transition:background .2s ease,opacity .35s ease,transform .45s var(--ease)}
.mnav .mnav-more.on .item{opacity:1;transform:none;transition-delay:calc(var(--i) * 20ms + 60ms)}
.mnav .mnav-more .item:active{background:rgba(var(--cream),.12)}
.mnav .mnav-more .item svg{flex:none;width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
.mnav .mnav-more .item b{max-width:100%;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnav .mnav-more .item .n{font-style:normal;position:absolute;top:10px;left:calc(50% + 6px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:var(--clay-hi);color:#fff;font-family:'DM Mono',ui-monospace,Menlo,monospace;font-size:10.5px;display:grid;place-items:center;box-shadow:0 0 0 2px #1E1813}
.mnav .mnav-more .item.at{background:rgba(var(--cream),.12);color:rgb(var(--cream))}
.mnav .mnav-more .item.at::after{content:'';position:absolute;bottom:7px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--clay-hi)}
.mnav .mnav-more .foot{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;margin-top:8px;padding:0 14px;border:0;border-radius:20px;
  background:rgba(var(--cream),.055);color:rgba(var(--cream),.9);font:inherit;font-size:14px;cursor:pointer;text-align:left}
.mnav .mnav-more .foot:active{background:rgba(var(--cream),.12)}
.mnav .mnav-more .foot.at{background:rgba(var(--cream),.12);color:rgb(var(--cream))}
.mnav .mnav-more .foot svg{flex:none;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
.mnav .mnav-more .foot b{font-weight:600}
.mnav .mnav-more .foot .ch{margin-left:auto;color:rgba(var(--cream),.4)}
.mnav .mnav-more .signout{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;margin-top:10px;padding:0 14px;border:0;border-radius:20px;
  background:rgba(212,99,62,.12);color:#E8A184;font:inherit;font-size:14px;cursor:pointer;text-align:left}
.mnav .mnav-more .signout:active{background:rgba(212,99,62,.2)}
.mnav .mnav-more .signout svg{flex:none;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.mnav .mnav-more .signout b{font-weight:600}

@media (prefers-reduced-motion:reduce){
  .mnav .fab .pip,.mnav .fab .pip::after,.mnav .fab.no{animation:none!important}
  .mnav .fab .tick{stroke-dashoffset:0}
}
`;
