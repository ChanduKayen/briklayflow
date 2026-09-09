/**
 * MobileNavBar — the floating glass navigation capsule (top-level mobile nav).
 *
 * A pixel-faithful build of the briklay-mobile-nav reference: a pinned "Book" tab, a horizontally
 * scrollable rail of the rest, a warm "site lamp" that tracks the active tab, a "there's more" chevron,
 * a minimize-to-pill on scroll-down, and a CONTEXTUAL FAB (the page decides what it creates; long-press =
 * universal quick-add). The long tail (Insights, Client Billing, Inward Register, Follow-up rules…) lives
 * behind a "Workspace" tab that opens the reference's hub card-grid, so nothing is unreachable on mobile.
 *
 * It renders ONLY the top-level nav — inside a project the app keeps its own project sub-nav (see App.tsx).
 * Navigation is URL-driven (react-router), matching the rest of the app. The CSS is scoped under `.mnav`
 * so the reference's exact values live here without leaking into the app.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// ── icons (inline, exact from the reference so the glyphs match pixel-for-pixel) ──
const I = {
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 4v13" /><path d="M9.5 9h6M9.5 12.5h6" /></>,
  review: <><path d="M4 13l4 .01c.7 2 2 3 4 3s3.3-1 4-3l4-.01" /><path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" /><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>,
  payables: <><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10h17" /><path d="M7 15h4" /></>,
  bills: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8.5h5M9.5 12h5" /></>,
  pos: <><path d="M5 7h14l-1.5 12h-11z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  att: <><rect x="4" y="5" width="16" height="16" rx="2.5" /><path d="M8 3v4M16 3v4" /><path d="M8.5 14l2.2 2.2 4.8-4.8" /></>,
  contracts: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10.5 13h6M10.5 16.5h4" /></>,
  sitedesk: <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /></>,
  parties: <><circle cx="9" cy="8" r="3" /><path d="M3.6 19c.7-3 2.7-4.6 5.4-4.6s4.7 1.6 5.4 4.6" /><circle cx="16.8" cy="9" r="2.4" /><path d="M15.6 14.7c2.3.3 3.9 1.7 4.5 4.3" /></>,
  team: <><path d="M12 3l7 2.8v5.2c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V5.8z" /><circle cx="12" cy="10" r="2.2" /><path d="M8.8 16c.6-1.8 1.8-2.7 3.2-2.7s2.6.9 3.2 2.7" /></>,
  profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.9-3.6 3.5-5.4 7-5.4s6.1 1.8 7 5.4" /></>,
  workspace: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  insights: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15l3-4 3 2 5-6" /></>,
  billing: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8.5h5M9.5 12h5" /></>,
  inward: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  firm: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.9-3.6 3.5-5.4 7-5.4s6.1 1.8 7 5.4" /></>,
  chevron: <path d="M9 5l7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
};

type Role = string;
type Tab = {
  key: string; label: string; to: string; icon: ReactNode;
  activePaths: string[];        // pathname prefixes that light this tab
  show: (r: Role) => boolean;
};

const ALL_TABS: Tab[] = [
  { key: 'book', label: 'Book', to: '/ledger', icon: I.book, activePaths: ['/ledger'], show: (r) => r !== 'supervisor' },
  { key: 'review', label: 'Review', to: '/logbook', icon: I.review, activePaths: ['/logbook'], show: () => true },
  { key: 'bills', label: 'Bills', to: '/bills', icon: I.bills, activePaths: ['/bills'], show: (r) => r !== 'supervisor' },
  { key: 'pos', label: 'POs', to: '/purchase-orders', icon: I.pos, activePaths: ['/purchase-orders', '/orders'], show: (r) => r !== 'supervisor' && r !== 'accountant' },
  { key: 'payables', label: 'Payables', to: '/payables', icon: I.payables, activePaths: ['/payables'], show: (r) => r !== 'supervisor' },
  { key: 'att', label: 'Attendance', to: '/attendance', icon: I.att, activePaths: ['/attendance'], show: () => true },
  // Contracts, Parties, Site Desk, Team & Profile live in the Workspace hub only — see WORKSPACE_PATHS.
];

// The "Workspace" tab — a hub, not a route. It lights when on any page it holds.
const WORKSPACE_PATHS = ['/insights', '/billing', '/inward-register', '/tasks', '/follow-up-rules', '/site-desk', '/desk', '/team', '/profile', '/work-orders', '/stakeholders'];

// The contextual FAB: what each tab creates. null = nothing to create (the FAB steps aside).
// 'book' is special — it opens a Money-out / Money-in menu (see the FAB handler), not a single route.
const FAB_BY_TAB: Record<string, { label: string; to: string; icon: ReactNode } | null> = {
  book: { label: 'New entry', to: '/ledger/new', icon: I.plus },
  bills: { label: 'New bill', to: '/bills?new=1', icon: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M12 8v6M9 11h6" /></> },
  pos: { label: 'New PO', to: '/purchase-orders/new', icon: <><path d="M5 7h14l-1.5 12h-11z" /><path d="M9 7a3 3 0 0 1 6 0" /><path d="M12 11v5M9.5 13.5h5" /></> },
  review: null, payables: null, att: null, workspace: null,
};

const QUICK_ADD = [
  { label: 'New entry', sub: 'Payment, receipt or note', to: '/ledger/new', icon: I.plus },
  { label: 'New bill', sub: 'Drop a photo — Briklay reads it', to: '/bills/new', icon: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9.5 8.5h5" /></> },
  { label: 'Mark attendance', sub: 'Today, site by site', to: '/attendance', icon: <><rect x="4" y="5" width="16" height="16" rx="2.5" /><path d="M8.5 14l2.2 2.2 4.8-4.8" /></> },
  { label: 'New purchase order', sub: 'Track what’s been ordered', to: '/purchase-orders/new', icon: <><path d="M5 7h14l-1.5 12h-11z" /><path d="M9 7a3 3 0 0 1 6 0" /></> },
];

const Svg = ({ children, w = 22 }: { children: ReactNode; w?: number }) => (
  <svg viewBox="0 0 24 24" style={{ width: w, height: w, stroke: 'currentColor', fill: 'none', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }}>{children}</svg>
);

export function MobileNavBar({ role, poBadge = 0, hidden = false, onSignOut }: { role: Role; poBadge?: number; hidden?: boolean; onSignOut?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const railRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const detentRef = useRef(-1);   // last dial detent crossed while scrolling the rail (for haptics)

  const [scrolled, setScrolled] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [sheet, setSheet] = useState<null | 'workspace' | 'quickadd'>(null);
  const [fabMenu, setFabMenu] = useState(false);   // Book's Money-out / Money-in chooser

  // A short haptic nudge on every nav tap (as in the reference). No-op where unsupported.
  const hapt = (ms: number | number[] = 6) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

  const visible = useMemo(() => ALL_TABS.filter((t) => t.show(role)), [role]);
  const pinned = visible[0];
  const rail = visible.slice(1);

  const path = location.pathname;
  const isTabActive = (t: Tab) => t.activePaths.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
  const workspaceActive = WORKSPACE_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  const activeKey = visible.find(isTabActive)?.key ?? (workspaceActive ? 'workspace' : (pinned?.key ?? ''));
  const fab = FAB_BY_TAB[activeKey] ?? null;

  // enable the ink-draw signature (needs pathLength=1 on every drawn segment)
  useEffect(() => {
    barRef.current?.querySelectorAll('.mnav-tab svg *').forEach((el) => el.setAttribute('pathLength', '1'));
  }, []);

  // rail scroll/resize → edge fades + pin shadow + DIAL-DETENT HAPTICS. The glow is a per-tab CSS effect
  // now (never a JS-positioned element), so there is nothing to reposition — that was the source of the
  // misplacement. As the rail scrolls, each tab crossing a detent gives a tiny "tick" — like a physical dial.
  useEffect(() => {
    const r = railRef.current; if (!r) return;
    const TAB_W = 63;
    const measure = () => {
      const over = r.scrollWidth > r.clientWidth + 4;
      setScrolled(r.scrollLeft > 6);
      setAtEnd(!over || r.scrollLeft + r.clientWidth >= r.scrollWidth - 10);
      const d = Math.round(r.scrollLeft / TAB_W);
      if (d !== detentRef.current) { detentRef.current = d; hapt(3); }   // the dial tick
    };
    measure();
    detentRef.current = Math.round(r.scrollLeft / TAB_W);
    r.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { r.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length]);

  // "There's more" cue — instead of an arrow: once, shortly after load, if the rail overflows and is at the
  // start, give it a gentle peek-nudge (slide a little, then settle) so it's obvious the row slides. The
  // edge fade (see .mnav-rail mask) is the persistent hint; this is the one-time reveal.
  const nudged = useRef(false);
  useEffect(() => {
    const r = railRef.current; if (!r) return;
    const id = window.setTimeout(() => {
      if (nudged.current || r.scrollWidth <= r.clientWidth + 4 || r.scrollLeft > 6) return;
      nudged.current = true;
      r.scrollTo({ left: 40, behavior: 'smooth' });
      window.setTimeout(() => r.scrollTo({ left: 0, behavior: 'smooth' }), 520);
    }, 750);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length]);

  // active tab changed → recentre it in the rail (the glow is per-tab, so it rides along automatically).
  useEffect(() => {
    const bar = barRef.current; if (!bar) return;
    const on = bar.querySelector('.mnav-tab.on') as HTMLElement | null;
    if (on && on.closest('.mnav-rail')) on.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // (The capsule NEVER minimizes on page scroll — that toggle flickered; the bar stays expanded, only
  //  hiding on full-screen forms.)

  // close the FAB menu on any outside tap
  useEffect(() => {
    if (!fabMenu) return;
    const h = () => setFabMenu(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [fabMenu]);

  const go = (to: string) => { hapt(6); setSheet(null); setFabMenu(false); navigate(to); window.scrollTo({ top: 0 }); };
  const goDir = (direction: 'out' | 'in') => { hapt(6); setFabMenu(false); navigate('/ledger/new', { state: { direction } }); window.scrollTo({ top: 0 }); };

  // long-press on the FAB → universal quick-add
  const lp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const fabDown = () => { held.current = false; lp.current = setTimeout(() => { held.current = true; hapt([8, 25, 8]); setSheet('quickadd'); }, 420); };
  const fabUp = () => { if (lp.current) clearTimeout(lp.current); };
  const fabClick = () => {
    if (held.current) return;
    hapt(8);
    // On the Book page the FAB is the money chooser (Out / In) — like the old ledger FAB.
    if (activeKey === 'book') { setFabMenu((v) => !v); return; }
    if (fab) go(fab.to);
  };

  const renderTab = (t: Tab, inRail: boolean) => {
    const on = t.key === activeKey;
    return (
      <button key={t.key} className={`mnav-tab${on ? ' on' : ''}`} data-rail={inRail ? '1' : undefined}
        onClick={() => go(t.to)} type="button" aria-current={on ? 'page' : undefined}>
        <span style={{ position: 'relative' }}>
          <Svg>{t.icon}</Svg>
          {t.key === 'pos' && poBadge > 0 && <span className="mnav-badge">{poBadge > 9 ? '9+' : poBadge}</span>}
        </span>
        <small>{t.label}</small>
      </button>
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div ref={barRef} className={`mnav-bar${scrolled ? ' scrolled' : ''}${atEnd ? ' atend' : ''}${hidden ? ' gone' : ''}`}>
        {/* pinned tab */}
        {pinned && <div className="mnav-pin">{renderTab(pinned, false)}</div>}

        {/* scrollable rail */}
        <div ref={railRef} className="mnav-rail">
          {rail.map((t) => renderTab(t, true))}
          {/* Workspace — the hub for everything else */}
          <button className={`mnav-tab${activeKey === 'workspace' ? ' on' : ''}`} data-rail="1" type="button" onClick={() => { hapt(6); setSheet('workspace'); }}>
            <Svg>{I.workspace}</Svg><small>Workspace</small>
          </button>
        </div>

        {/* contextual FAB */}
        <button className={`mnav-fab${fab ? '' : ' hide'}${fabMenu ? ' open' : ''}`} type="button" aria-label={fab?.label ?? 'Create'}
          onPointerDown={(e) => { e.stopPropagation(); fabDown(); }} onPointerUp={fabUp} onPointerLeave={fabUp} onPointerCancel={fabUp} onClick={fabClick}>
          <Svg w={20}>{fab?.icon ?? I.plus}</Svg>
        </button>
      </div>

      {/* Book's Money-out / Money-in chooser — the old ledger FAB, kept (elegant, two options) */}
      {fabMenu && activeKey === 'book' && (
        <div className="mnav-fabmenu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="mnav-mopt out" onClick={() => goDir('out')}>
            <span>Money <u>O</u>ut</span>
            <span className="mnav-mic"><svg viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8" /></svg></span>
          </button>
          <button type="button" className="mnav-mopt in" onClick={() => goDir('in')}>
            <span>Money <u>I</u>n</span>
            <span className="mnav-mic"><svg viewBox="0 0 24 24"><path d="M17 7L7 17M15 17H7V9" /></svg></span>
          </button>
        </div>
      )}

      {/* sheets */}
      <div className={`mnav-shade${sheet ? ' show' : ''}`} onClick={() => setSheet(null)} />
      <div className={`mnav-sheet${sheet ? ' show' : ''}`}>
        <button type="button" className="mnav-grab" aria-label="Close" onClick={() => setSheet(null)} />
        <button type="button" className="mnav-close" aria-label="Close" onClick={() => setSheet(null)}>
          <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round' }}><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {sheet === 'workspace' && <WorkspaceHub role={role} onGo={go} onSignOut={onSignOut} />}
        {sheet === 'quickadd' && (
          <>
            <div className="mnav-qtitle">Quick add</div>
            {QUICK_ADD.map((q) => (
              <button key={q.label} className="mnav-qrow" type="button" onClick={() => go(q.to)}>
                <span className="mnav-qic"><Svg w={17}>{q.icon}</Svg></span>
                <span><b>{q.label}</b><small>{q.sub}</small></span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}

// ── the Workspace hub (the reference's card grid) ──
function WorkspaceHub({ role, onGo, onSignOut }: { role: Role; onGo: (to: string) => void; onSignOut?: () => void }) {
  const cards = [
    { label: 'Site Desk', sub: 'sites active', to: '/site-desk', icon: I.sitedesk, show: true },
    { label: 'Contracts', sub: 'work orders', to: '/work-orders', icon: I.contracts, show: true },
    { label: 'Parties', sub: 'vendors & workers', to: '/stakeholders', icon: I.parties, show: role !== 'supervisor' },
    { label: 'Insights', sub: 'spend & trends', to: '/insights', icon: I.insights, show: true },
    { label: 'Inward Register', sub: 'deliveries', to: '/inward-register', icon: I.inward, show: role !== 'supervisor' && role !== 'accountant' },
    { label: 'Client Billing', sub: 'invoices', to: '/billing', icon: I.billing, show: role !== 'supervisor' },
    { label: 'Team & Access', sub: 'members', to: '/team', icon: I.team, show: role === 'principal' || role === 'management' },
  ].filter((c) => c.show);
  const account = [
    { label: 'Profile & firm settings', to: '/profile', icon: I.firm },
    { label: 'Follow-up rules', to: '/follow-up-rules', icon: I.clock, show: role === 'principal' || role === 'management' },
  ].filter((c) => c.show !== false);
  return (
    <>
      <div className="mnav-qtitle">Workspace</div>
      <div className="mnav-hubgrid">
        {cards.map((c) => (
          <button key={c.label} className="mnav-hcard" type="button" onClick={() => onGo(c.to)}>
            <span className="mnav-hic"><Svg w={16}>{c.icon}</Svg></span>
            <b>{c.label}</b><span className="mnav-hsub">{c.sub}</span>
          </button>
        ))}
      </div>
      <div className="mnav-hublab">Account</div>
      {account.map((c) => (
        <button key={c.label} className="mnav-hcard wide" type="button" onClick={() => onGo(c.to)}>
          <span className="mnav-hic"><Svg w={16}>{c.icon}</Svg></span>
          <b>{c.label}</b><span className="mnav-ch">›</span>
        </button>
      ))}
      {onSignOut && (
        <button type="button" className="mnav-signout" onClick={onSignOut}>
          <span className="mnav-hic"><svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M15 12H5" /></svg></span>
          <b>Sign out</b>
        </button>
      )}
    </>
  );
}

// ── scoped CSS (the reference, ported verbatim in value) ──
const CSS = `
/* Ground matches the desktop sidenav / transaction-page header: the bitter-chocolate "night binding". */
.mnav-bar{position:fixed; left:14px; right:14px; bottom:calc(14px + env(safe-area-inset-bottom)); max-width:402px; margin:0 auto; z-index:40;
  --b-rule:#302014; --b-soft:rgba(245,240,231,.55); --b-clay:#E8935F;
  background:linear-gradient(180deg,#191009,#140D07);
  border:1px solid rgba(245,240,231,.08); border-radius:999px; overflow:hidden;
  box-shadow:0 22px 44px -18px rgba(20,13,7,.72), inset 0 1px 0 rgba(245,240,231,.06);
  display:flex; align-items:center; padding:6px; transition:padding .3s, transform .28s cubic-bezier(.4,0,.2,1), opacity .28s}
.mnav-bar.gone{transform:translateY(160%); opacity:0; pointer-events:none}
@media (min-width:768px){ .mnav-bar{display:none} }

.mnav-pin{flex:none; display:flex; padding:0 2px; border-right:1px solid var(--b-rule); position:relative; z-index:1; max-width:80px; overflow:hidden;
  transition:box-shadow .25s, max-width .32s, opacity .25s, padding .3s}
.mnav-bar.scrolled .mnav-pin{box-shadow:10px 0 16px -10px rgba(0,0,0,.75)}

.mnav-rail{flex:1; display:flex; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; padding:0 14px 0 2px; max-width:999px;
  transition:max-width .32s, opacity .25s;
  /* The rail owns horizontal gestures: a sideways swipe here scrolls the rail, NEVER the page, and its
     scroll never chains out to the body. Gentle snap + the detent haptic give a physical-dial feel. */
  touch-action:pan-x; overscroll-behavior:contain; scroll-snap-type:x proximity;
  -webkit-mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 30px),transparent);
  mask-image:linear-gradient(to right,#000 0,#000 calc(100% - 30px),transparent)}
.mnav-tab{scroll-snap-align:center}
.mnav-bar.scrolled .mnav-rail{
  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 22px,#000 calc(100% - 34px),transparent);
  mask-image:linear-gradient(to right,transparent 0,#000 22px,#000 calc(100% - 34px),transparent)}
.mnav-rail::-webkit-scrollbar{display:none}

.mnav-tab{flex:none; width:63px; border:0; background:none; display:flex; flex-direction:column; align-items:center; gap:4px;
  cursor:pointer; color:var(--b-soft); padding:7px 0 6px; position:relative; transition:color .3s; font-family:'DM Sans',system-ui,sans-serif}
.mnav-tab svg{shape-rendering:geometricPrecision; position:relative; z-index:1; transition:transform .2s cubic-bezier(.2,.9,.3,1.4)}
.mnav-tab small{font-size:9.5px; font-weight:600; letter-spacing:.02em; white-space:nowrap; position:relative; z-index:1; opacity:.8; transition:opacity .25s}
.mnav-tab:active svg{transform:scale(.85)}
.mnav-tab.on{color:var(--b-clay)}
.mnav-tab.on svg{animation:mnavspring .45s cubic-bezier(.2,.9,.3,1.5) both}
.mnav-tab.on small{opacity:1; font-weight:700}
@keyframes mnavspring{0%{transform:scale(.88)}55%{transform:scale(1.06) translateY(-1px)}100%{transform:scale(1) translateY(-1px)}}
.mnav-tab svg *{stroke-dasharray:1; stroke-dashoffset:0}
.mnav-tab.on svg *{animation:mnavink .5s cubic-bezier(.5,.05,.3,1) both}
.mnav-tab.on svg *:nth-child(2){animation-delay:.07s}
.mnav-tab.on svg *:nth-child(3){animation-delay:.14s}
.mnav-tab.on svg *:nth-child(4){animation-delay:.2s}
@keyframes mnavink{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}

.mnav-badge{position:absolute; top:-5px; right:-9px; min-width:15px; height:15px; padding:0 3px; border-radius:99px; background:#D0432C; color:#FFF7EF;
  font-size:9px; font-weight:700; line-height:15px; text-align:center; box-shadow:0 0 0 1.5px #191009}

/* THE LAMP, PER TAB — a warm pool of light + a filament, drawn behind the ACTIVE tab itself. Because it
   lives on the tab, it is always perfectly centred and rides the rail as it scrolls — no JS positioning,
   so it can never land off (the old misplacement under Payables/Attendance/Workspace is gone). */
.mnav-tab::before{content:''; position:absolute; inset:-1px 0 0; z-index:0; pointer-events:none; opacity:0;
  background:radial-gradient(ellipse 62% 46% at 50% 34%, rgba(232,147,95,.34), rgba(232,147,95,.10) 46%, transparent 64%);
  transition:opacity .3s}
.mnav-tab.on::before{opacity:1}
.mnav-tab.on::after{content:''; position:absolute; top:5px; left:50%; width:22px; height:2px; border-radius:99px; transform:translateX(-50%);
  background:var(--b-clay); opacity:.9; box-shadow:0 0 6px rgba(232,147,95,.55); z-index:0}

.mnav-fab{flex:none; width:46px; height:46px; border-radius:50%; border:0; background:#C75B2B; color:#FFF7EF; margin-left:2px;
  box-shadow:0 8px 18px -8px rgba(199,91,43,.7); cursor:pointer; position:relative; z-index:1; display:grid; place-items:center;
  transition:transform .3s cubic-bezier(.2,.9,.3,1.4), width .3s, height .3s, opacity .25s, margin .3s}
.mnav-fab:active{transform:scale(.9)}
.mnav-fab.hide{width:0; height:0; opacity:0; margin:0; pointer-events:none}
.mnav-fab svg{transition:transform .22s cubic-bezier(.2,.9,.3,1.4)}
.mnav-fab.open svg{transform:rotate(45deg)}

/* Book's Money-out / Money-in chooser — floats above the capsule, right-aligned to the FAB */
.mnav-fabmenu{position:fixed; right:calc(20px + env(safe-area-inset-right)); bottom:calc(84px + env(safe-area-inset-bottom)); z-index:41;
  display:flex; flex-direction:column; align-items:flex-end; gap:10px; font-family:'DM Sans',system-ui,sans-serif; animation:mnavpop .18s cubic-bezier(.2,.9,.3,1.4) both}
@keyframes mnavpop{from{opacity:0; transform:translateY(8px) scale(.96)}to{opacity:1; transform:none}}
.mnav-mopt{display:inline-flex; align-items:center; gap:10px; padding:9px 8px 9px 14px; border-radius:999px; cursor:pointer;
  background:#FFFDF9; border:1px solid #E4DCD0; color:#2F2622; box-shadow:0 10px 26px -12px rgba(47,38,34,.4); font-size:13px; font-weight:600;
  transition:background .15s, color .15s, box-shadow .16s, transform .12s}
.mnav-mopt:active{transform:scale(.97)}
.mnav-mopt u{text-underline-offset:3px; text-decoration-thickness:1px; text-decoration-color:color-mix(in srgb, currentColor 45%, transparent)}
.mnav-mopt.out:hover{background:#C4613A; color:#fff; box-shadow:0 12px 26px -12px rgba(196,97,58,.6)}
.mnav-mopt.in:hover{background:#5F7F5B; color:#fff; box-shadow:0 12px 26px -12px rgba(95,127,91,.6)}
.mnav-mic{display:inline-grid; place-items:center; width:26px; height:26px; border-radius:50%; flex:none}
.mnav-mopt.out .mnav-mic{background:rgba(196,97,58,.14); color:#C4613A}
.mnav-mopt.in .mnav-mic{background:rgba(95,127,91,.16); color:#5F7F5B}
.mnav-mopt:hover .mnav-mic{background:rgba(255,255,255,.22); color:#fff}
.mnav-mic svg{width:15px; height:15px; stroke:currentColor; fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}

.mnav-signout{display:flex; align-items:center; gap:13px; padding:14px 16px; margin-top:9px; width:100%; border-radius:16px; cursor:pointer;
  background:rgba(178,64,42,.06); border:1px solid rgba(178,64,42,.14); color:#B2402A; font-family:'DM Sans',system-ui,sans-serif; text-align:left}
.mnav-signout:active{transform:scale(.98)}
.mnav-signout b{font-size:14px; font-weight:700}
.mnav-signout .mnav-hic{background:rgba(178,64,42,.10); border-color:rgba(178,64,42,.18); color:#B2402A; margin:0}

/* minimized: capsule shrinks to the active tab pill */
.mnav-mini{display:flex; align-items:center; gap:8px; border:0; background:none; color:var(--b-clay); cursor:pointer;
  font-family:'DM Sans',system-ui,sans-serif; font-size:12px; font-weight:700; padding:0; max-width:0; opacity:0; overflow:hidden;
  transition:max-width .32s, opacity .25s, padding .3s; white-space:nowrap; position:relative; z-index:1}
.mnav-bar.min{left:50%; right:auto; transform:translateX(-50%); padding:9px 10px}
.mnav-bar.min .mnav-mini{max-width:190px; opacity:1; padding:0 10px}
.mnav-bar.min .mnav-pin, .mnav-bar.min .mnav-rail{max-width:0; opacity:0; padding:0; border:0; pointer-events:none}
.mnav-bar.min .mnav-fab{width:0; height:0; opacity:0; margin:0; pointer-events:none}

/* sheets */
.mnav-shade{position:fixed; inset:0; background:rgba(30,24,17,.4); opacity:0; pointer-events:none; transition:opacity .3s; z-index:60}
.mnav-shade.show{opacity:1; pointer-events:auto}
.mnav-sheet{position:fixed; left:0; right:0; bottom:0; max-width:430px; margin:0 auto; background:#fff;
  border-radius:22px 22px 0 0; padding:10px 20px calc(22px + env(safe-area-inset-bottom)); z-index:61;
  transform:translateY(105%); transition:transform .38s cubic-bezier(.2,.9,.25,1); font-family:'DM Sans',system-ui,sans-serif;
  /* Never taller than the screen — scroll inside instead of bleeding off the phone. */
  max-height:85vh; overflow-y:auto; -webkit-overflow-scrolling:touch}
.mnav-sheet.show{transform:none}
.mnav-grab{display:block; width:40px; height:5px; border-radius:99px; background:#E4DACB; margin:2px auto 14px; border:0; padding:0; cursor:pointer}
.mnav-close{position:absolute; top:12px; right:14px; width:30px; height:30px; border-radius:50%; border:0; background:#F4F0E8; color:#7A6E61; display:grid; place-items:center; cursor:pointer; z-index:1}
.mnav-close:active{transform:scale(.92)}
.mnav-qtitle{font-family:'Playfair Display',Georgia,serif; font-size:19px; font-weight:600; margin-bottom:12px; color:#221C14}
.mnav-qrow{display:flex; align-items:center; gap:13px; padding:14px 2px; border-bottom:1px solid #EEE5D8; width:100%; border-left:0; border-right:0; border-top:0;
  background:none; text-align:left; font-size:15px; font-weight:600; cursor:pointer; color:#221C14}
.mnav-qrow:last-child{border-bottom:0}
.mnav-qrow:active{background:#FAF5EE}
.mnav-qic{width:36px; height:36px; border-radius:11px; background:#FAF5EE; border:1px solid #EEE5D8; display:grid; place-items:center; color:#C75B2B; flex:none}
.mnav-qrow small{display:block; font-size:11.5px; color:#9A8C77; font-weight:400; margin-top:1px}

.mnav-hubgrid{display:grid; grid-template-columns:1fr 1fr; gap:11px}
.mnav-hcard{background:#fff; border:1px solid #EEE5D8; border-radius:16px; padding:15px 15px 13px; cursor:pointer; text-align:left; transition:transform .15s; color:#221C14}
.mnav-hcard:active{transform:scale(.97)}
.mnav-hic{width:34px; height:34px; border-radius:10px; background:#FAF5EE; border:1px solid #EEE5D8; display:grid; place-items:center; color:#6E5F4C; margin-bottom:10px}
.mnav-hcard b{display:block; font-size:14px; font-weight:700}
.mnav-hsub{display:block; font-size:11.5px; color:#9A8C77; margin-top:3px; font-family:'DM Mono',monospace}
.mnav-hcard.wide{display:flex; align-items:center; gap:13px; padding:14px 16px; margin-top:9px; width:100%}
.mnav-hcard.wide .mnav-hic{margin:0}
.mnav-hcard.wide b{font-size:14px}
.mnav-ch{margin-left:auto; color:#9A8C77}
.mnav-hublab{font-family:'DM Mono',monospace; font-size:9.5px; letter-spacing:.2em; text-transform:uppercase; color:#9A8C77; margin:18px 2px 9px}
`;
