/**
 * BriklayRail — the two-tier desktop navigation (Supabase-style).
 *
 *   1) THE RAIL — a slim warm-dark icon spine, always present. Hover expands it
 *      to reveal labels; it floats OVER content so the layout never reflows.
 *   2) THE CONTEXT PANEL — a light secondary panel for sections with sub-views.
 *      Today that is Purchase orders (its lifecycle: All / Your move / Waiting /
 *      Done — status views of the real PO list).
 *
 * This replaces the old light SidebarContent. ALL prior behaviour is carried
 * over: role-gated items, live badges (WO / PO / billing / day-book inbox), the
 * +New quick-create menu, the in-project sub-nav, the user menu + sign out, and
 * the day-book icon's WhatsApp tease. The rail is desktop-only (md+); mobile nav
 * lives in App's BottomTabBar / MoreNavSheet.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import {
  IconArrowsExchange, IconNotebook, IconFileInvoice, IconChartPie,
  IconShoppingBag, IconLayoutGrid, IconClipboardList, IconUsersGroup,
  IconBarcode, IconShieldLock, IconAdjustmentsHorizontal,
  IconChevronDown, IconChevronLeft, IconDots,
  IconSettings, IconLogout,
  IconBox, IconListNumbers, IconTruck, IconLoader2, IconChecklist, IconAlertTriangle,
  IconListCheck, IconBell, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react';
import { supabase } from '../../lib/supabase';
import { clearPersistedCache } from '../../lib/queryClient';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useUserProfile } from '../../App';
import { WhatsAppGlyph } from '../day-book/atoms';
import { V, N, font, serif, nums, RAIL_W, RAIL_OPEN, PANEL_W, NAV_ANIM, SITE_MGMT_ROUTES } from './navTokens';

type Role = string;

// ── shared helpers ──────────────────────────────────────────────────────────
const initials = (name: string) =>
  (name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
// One quiet, monochrome avatar treatment for the dark rail — light glass, not a
// coloured blob, so org / user / project monograms sit calmly in the binding.
const railChip = { background: 'rgba(247,243,236,0.09)', color: N.text, border: '1px solid rgba(247,243,236,0.12)' } as const;

// Underline the keyboard-shortcut letter inside a label (T-ransactions, etc.).
const SHORTCUTS: Record<string, string> = {
  '/ledger': 'T', '/work-orders': 'C', '/purchase-orders': 'P', '/logbook': 'L',
};
function RailLabel({ label, route, active }: { label: string; route: string; active: boolean }) {
  const letter = SHORTCUTS[route];
  if (!letter || active) return <>{label}</>;
  const i = label.toUpperCase().indexOf(letter);
  if (i === -1) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span style={{ textDecoration: 'underline', textUnderlineOffset: 2, textDecorationStyle: 'dotted', textDecorationColor: 'rgba(247,243,236,0.3)' }}>{label[i]}</span>
      {label.slice(i + 1)}
    </>
  );
}

// The day-book mark teases its WhatsApp origin on each page load.
function DayBookIcon({ size = 17 }: { size?: number }) {
  const { pathname } = useLocation();
  const [wa, setWa] = useState(false);
  useEffect(() => {
    setWa(false);
    const seq = [true, false, true, false, true, false];
    const t = seq.map((v, i) => setTimeout(() => setWa(v), 2500 * (i + 1)));
    return () => t.forEach(clearTimeout);
  }, [pathname]);
  return wa ? <WhatsAppGlyph size={size} /> : <IconNotebook size={size} strokeWidth={1.6} style={{ flexShrink: 0 }} />;
}

function AttentionBadge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center justify-center rounded-md shrink-0"
      style={{ background: 'rgba(224,122,79,0.16)', color: N.terra, minWidth: 19, height: 17, padding: '0 5px', fontSize: 10.5, fontWeight: 600, ...font, ...nums }}>
      {n > 9 ? '9+' : n}
    </span>
  );
}

// ── one rail row (icon spine, label appears on expand) ────────────────────────
type Item = { route: string; label: string; icon?: React.ElementType; node?: React.ReactNode; badge?: number; accent?: boolean; hasPanel?: boolean };

function RailItem({ item, active, open, onNavigate }: { item: Item; active: boolean; open: boolean; onNavigate: () => void }) {
  const [hov, setHov] = useState(false);
  const Icon = item.icon;
  // Active is signalled by the icon + label alone (terra icon, bright label) — no
  // filled chip. Hover gets a soft wash with a clear lift in text/icon contrast.
  const iconColor = active ? N.terra : (hov ? N.text : 'rgba(247,243,236,0.62)');
  const labelColor = active ? N.text : (hov ? N.text : N.textSoft);
  return (
    <Link to={item.route} onClick={onNavigate} title={item.label}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      className="w-full flex items-center"
      style={{
        height: 34, paddingLeft: open ? 10 : 0, paddingRight: open ? 8 : 0, gap: 10,
        justifyContent: open ? 'flex-start' : 'center', borderRadius: 8, textDecoration: 'none',
        background: hov && !active ? 'rgba(247,243,236,0.10)' : 'transparent', transition: 'background .12s ease', ...font,
      }}
    >
      <span className="flex items-center justify-center shrink-0" style={{ width: 28, height: 28, color: iconColor, transition: 'color .12s ease' }}>
        {item.node ?? (Icon ? <Icon size={17} strokeWidth={active ? 1.9 : 1.6} style={{ flexShrink: 0 }} /> : null)}
      </span>
      <span className="truncate" style={{ fontSize: 13, opacity: open ? 1 : 0, transition: open ? 'opacity .18s ease .04s' : 'opacity .08s ease', color: labelColor, fontWeight: active ? 500 : 400, flex: 1, whiteSpace: 'nowrap' }}>
        <RailLabel label={item.label} route={item.route} active={active} />
      </span>
      {(item.badge ?? 0) > 0 && open && <AttentionBadge n={item.badge} />}
    </Link>
  );
}

// ── the assembled desktop navigation ──────────────────────────────────────────
// Default: a STATIC, always-expanded rail. Pass `collapsible` to get the hover
// collapse-to-icons behaviour (kept for screens that pair the rail with a second
// nav and need to reclaim width).
export function BriklayDesktopNav({ session, collapsible = false, railExpanded = false, onToggleRail }: { session: Session; collapsible?: boolean; railExpanded?: boolean; onToggleRail?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile(session.user.id);
  const { orgId, signOut } = useAuth();
  const role: Role = profile?.role ?? '';

  // ── Secondary-nav contexts — BOTH the in-project nav and the Site Management hub use the same
  //    two-tier pattern: the rail collapses to its icon spine and a second column beside it carries
  //    the context's sub-nav. ──
  const projMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId = projMatch?.[1];
  const inProject = !!(activeProjectId && activeProjectId !== 'new');
  const inSiteMgmt = SITE_MGMT_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
  const inSecondary = inProject || inSiteMgmt;

  const [hovered, setHovered] = useState(false);
  // In a secondary-nav context the rail width is the user's toggle (railExpanded: full 220 / spine
  // 56), and both columns push content (no overlay). Elsewhere it's the static full rail (or the
  // legacy hover-collapse when explicitly `collapsible`).
  const open = inSecondary ? railExpanded : (collapsible ? hovered : true);
  const [projOpen, setProjOpen] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [orgName, setOrgName] = useState('');
  const userRef = useRef<HTMLDivElement>(null);

  // Sign out in place — no full-screen veil, no blur. The button shows a calm
  // loader; when the session actually clears, the auth listener swaps in Login.
  const doSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { clearPersistedCache(); } catch { /* private mode */ }
    // S1-2 Part B: sign out through the AuthProvider wrapper so the SIGNED_OUT handler sees this as an
    // EXPLICIT sign-out — logged as explicit (not misclassified as refresh_failed) and taking the pure
    // navigation path, never the storage re-check.
    try { await signOut(); } catch { setSigningOut(false); }
  };
  // Brand wordmark: "Briklay." collapses to "B." — the terracotta dot rides the
  // closing letters home to the B. Measure "riklay" so the dot travels exactly.
  const riklayRef = useRef<HTMLSpanElement>(null);
  const [riklayW, setRiklayW] = useState(0);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (signingOut) return;
      if (userRef.current && !userRef.current.contains(e.target as Node)) setShowUser(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [signingOut]);

  useEffect(() => {
    if (!orgId) return;
    supabase.from('organizations').select('name').eq('org_id', orgId).single()
      .then(({ data }) => { if (data?.name) setOrgName(data.name); });
  }, [orgId]);

  useEffect(() => {
    const measure = () => { if (riklayRef.current) setRiklayW(riklayRef.current.scrollWidth); };
    measure();
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    fonts?.ready?.then(measure).catch(() => {});
  }, []);

  // ── live badges (same query keys as the mobile bar → React Query dedupes) ──
  const { data: woPending = 0 } = useQuery({
    queryKey: ['nav_wo_pending'],
    queryFn: async () => (await supabase.from('work_orders').select('*', { count: 'exact', head: true }).eq('status', 'Draft')).count ?? 0,
    staleTime: 60_000, enabled: role === 'management' || role === 'principal',
  });
  const { data: poUntallied = 0 } = useQuery({
    queryKey: ['nav_po_untallied'],
    queryFn: async () => (await supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).not('status', 'in', '("Tallied","Cancelled","Draft")')).count ?? 0,
    staleTime: 60_000, enabled: role !== 'supervisor' && role !== 'accountant',
  });
  const { data: billOverdue = 0 } = useQuery({
    queryKey: ['nav_bill_overdue'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      return (await supabase.from('client_invoices').select('*', { count: 'exact', head: true }).lt('due_date', today).not('status', 'in', '("Paid","Void","Cancelled")')).count ?? 0;
    },
    staleTime: 60_000, enabled: role !== 'supervisor',
  });
  const { data: inbox = 0 } = useQuery({
    queryKey: ['inbox_badge'],
    queryFn: async () => (await supabase.from('rough_entries').select('*', { count: 'exact', head: true }).eq('status', 'PENDING')).count ?? 0,
    staleTime: 30_000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['sidebar_projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name');
      return (data ?? []) as { project_id: string; name: string }[];
    },
    staleTime: 10 * 60 * 1000,
  });

  const can = (cond: boolean) => cond;
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  // ── sections (semantic grouping; all real routes + roles + badges) ──
  const SECTIONS: { label?: string; items: Item[] }[] = [
    {
      label: 'The books',
      items: ([
        can(role !== 'supervisor') && { route: '/ledger', label: 'Transactions', icon: IconArrowsExchange, accent: true },
        { route: '/logbook', label: 'Day book', node: <DayBookIcon />, badge: inbox },
        // Site Management — clicking enters its own secondary nav (Task Manager / To-dos & Issues /
        // Follow-up Rules); /site-desk is the hub's landing page.
        { route: '/site-desk', label: 'Site management', icon: IconAlertTriangle },
        can(role !== 'supervisor') && { route: '/billing', label: 'Client billing', icon: IconFileInvoice, badge: billOverdue },
        { route: '/insights', label: 'Insights', icon: IconChartPie },
      ].filter(Boolean) as Item[]),
    },
    {
      label: 'Orders & work',
      items: ([
        can(role !== 'supervisor' && role !== 'accountant') && { route: '/purchase-orders', label: 'Purchase orders', icon: IconShoppingBag, badge: poUntallied, hasPanel: true },
        can(role !== 'supervisor' && role !== 'accountant') && { route: '/inward-register', label: 'Inward register', icon: IconLayoutGrid },
        { route: '/work-orders', label: 'Contracts', icon: IconClipboardList, badge: woPending },
      ].filter(Boolean) as Item[]),
    },
    {
      label: 'Workspace',
      items: ([
        can(role !== 'supervisor' && role !== 'accountant') && { route: '/stakeholders', label: 'Parties', icon: IconUsersGroup },
        can(role === 'principal' || role === 'management') && { route: '/sku-directory', label: 'SKU directory', icon: IconBarcode },
        can(role === 'principal' || role === 'management') && { route: '/team', label: 'Team & access', icon: IconShieldLock },
        can(role === 'principal' || role === 'management') && { route: '/settings', label: 'Settings', icon: IconAdjustmentsHorizontal },
      ].filter(Boolean) as Item[]),
    },
  ];

  // ── in-project sub-nav (rendered in the secondary navbar; inProject/activeProjectId hoisted up) ──
  const activeProj = projects.find(p => p.project_id === activeProjectId);
  const projName = activeProj?.name ?? '…';
  const projBase = `/projects/${activeProjectId}`;
  const projItems: Item[] = inProject ? [
    { route: projBase, label: 'Overview', icon: IconLayoutGrid },
    { route: `${projBase}/tasks`, label: 'Task Manager', icon: IconChecklist },
    // Issues + To-dos are first-class, distinct entries (P1.3) — both ride the same surface,
    // scoped by ?view=. Issues ride heavy (cause/timing/thread); to-dos light (checkable).
    { route: `${projBase}/issues?view=issues`, label: 'Issues', icon: IconAlertTriangle },
    { route: `${projBase}/issues?view=todos`, label: 'To-dos', icon: IconListCheck },
    { route: `${projBase}/transactions`, label: 'Transactions', icon: IconArrowsExchange },
    { route: `${projBase}/work-orders`, label: 'Contracts', icon: IconClipboardList },
    { route: `${projBase}/purchase-orders`, label: 'Purchase orders', icon: IconShoppingBag },
    { route: `${projBase}/inventory`, label: 'Inventory', icon: IconBox },
    { route: `${projBase}/boqs`, label: 'BOQs', icon: IconListNumbers },
    { route: `${projBase}/inward`, label: 'Inward register', icon: IconTruck },
  ] : [];

  // ── Site Management secondary navbar — the items shown in the second column (see inSiteMgmt). ──
  const siteMgmtItems: Item[] = [
    { route: '/tasks', label: 'Task Manager', icon: IconChecklist },
    { route: '/site-desk', label: 'To-dos & Issues', icon: IconAlertTriangle },
    ...(role === 'principal' || role === 'management'
      ? [{ route: '/follow-up-rules', label: 'Follow-up Rules', icon: IconBell } as Item]
      : []),
  ];

  // ── secondary navbar config — one panel, two contexts (project / Site Management) ──
  const panelCfg = inProject
    ? {
        backTo: '/projects', backLabel: 'All projects',
        chip: initials(projName) as React.ReactNode, title: projName, subtitle: 'Active project',
        items: projItems, isItemActive: (route: string) => projItemActive(route, projBase, location),
        footer: null as string | null,
      }
    : inSiteMgmt
    ? {
        backTo: role === 'supervisor' ? '/projects' : '/ledger', backLabel: 'Menu',
        chip: <IconChecklist size={17} strokeWidth={1.7} /> as React.ReactNode, title: 'Site Management', subtitle: 'Across every site',
        items: siteMgmtItems, isItemActive: (route: string) => isActive(route),
        footer: 'Plan work, track issues, and tune how follow-ups are chased — across all your sites.' as string | null,
      }
    : null;

  // Any navigation also settles open menus + collapses the projects tray, so
  // selecting a project drops straight to that project + its internal links.
  const close = () => { setShowUser(false); setProjOpen(false); };
  const pad = { paddingLeft: open ? 8 : 14, paddingRight: open ? 8 : 14 };

  return (
    <>
      <style>{NAV_ANIM}</style>

      {/* the rail */}
      <aside
        onMouseEnter={collapsible ? () => setHovered(true) : undefined}
        onMouseLeave={() => { setHovered(false); if (!signingOut) { setProjOpen(false); close(); } }}
        className="hidden md:flex flex-col py-4"
        style={{
          position: 'fixed', top: 0, left: 0, height: '100vh',
          width: open ? RAIL_OPEN : RAIL_W, background: N.bg,
          // width animates on toggle/collapse; the spine and panel both push content.
          transition: 'width .26s cubic-bezier(.32,.72,0,1), box-shadow .22s ease',
          borderRight: collapsible ? 'none' : `1px solid ${N.keyline}`,
          overflow: 'hidden', zIndex: 50,
          boxShadow: collapsible && open ? '6px 0 28px rgba(20,16,12,0.28)' : 'none',
          ...font,
        }}
      >
        {/* brand — the logo wordmark; "Briklay." ⇄ "B." with the dot riding home */}
        <div className="flex items-center" style={{ height: 32, paddingLeft: open ? 12 : 0, paddingRight: open ? 8 : 0, justifyContent: open ? 'flex-start' : 'center' }}>
          <span className="font-semibold" style={{ ...font, fontSize: 19, letterSpacing: '-0.01em', color: N.text, whiteSpace: 'nowrap', userSelect: 'none', display: 'inline-flex', alignItems: 'baseline' }}>
            <span>B</span>
            <span ref={riklayRef} style={{
              overflow: 'hidden', whiteSpace: 'nowrap', flex: '0 0 auto',
              width: open ? riklayW : 0, opacity: open ? 1 : 0,
              transition: open
                ? 'width .26s cubic-bezier(.32,.72,0,1), opacity .2s ease .06s'
                : 'width .44s cubic-bezier(.16,1,.3,1), opacity .18s ease',
            }}>riklay</span>
            <span style={{ color: N.terra }}>.</span>
          </span>
        </div>

        {/* workspace plaque — hover reveals the active-projects list inline,
            pushing the sections below down; collapses on mouse-away */}
        <div className="mt-5" style={pad} onMouseEnter={() => setProjOpen(true)} onMouseLeave={() => setProjOpen(false)}>
          <button onClick={() => { navigate('/projects'); close(); }} title={orgName || 'Workspace'}
            className="w-full flex items-center rounded-xl"
            style={{ height: 42, background: open && projOpen ? 'rgba(247,243,236,0.08)' : open ? 'rgba(247,243,236,0.05)' : 'transparent', border: open ? `1px solid ${N.keyline}` : 'none', paddingLeft: open ? 6 : 0, paddingRight: open ? 8 : 0, justifyContent: open ? 'flex-start' : 'center', gap: 9, transition: 'background .12s ease' }}>
            <span className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 28, height: 28, ...railChip, ...serif, fontSize: 12.5 }}>{initials(orgName || 'B')}</span>
            <span className="min-w-0 text-left" style={{ opacity: open ? 1 : 0, transition: 'opacity .15s', overflow: 'hidden', flex: open ? '1 1 0%' : '0 0 0px', width: open ? 'auto' : 0 }}>
              <span className="block truncate" style={{ fontSize: 13, color: N.text }}>{orgName || 'Briklay'}</span>
              <span className="block truncate" style={{ fontSize: 11, color: N.textFaint }}>{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>
            </span>
            <IconChevronDown size={13} style={{ color: N.textFaint, opacity: open ? 1 : 0, transition: 'opacity .15s, transform .18s', transform: projOpen ? 'rotate(180deg)' : 'none', flexShrink: 0, display: open ? 'block' : 'none' }} />
          </button>

          {/* inline accordion */}
          <div style={{ overflow: 'hidden', maxHeight: open && projOpen ? Math.min(projects.length * 34 + 46, 326) : 0, opacity: open && projOpen ? 1 : 0, transition: 'max-height .24s cubic-bezier(.32,.72,0,1), opacity .18s ease' }}>
            <div className="nav-scroll mt-2" style={{ maxHeight: 286, overflowY: 'auto', background: N.recess, boxShadow: `inset 0 1px 0 ${N.recessLine}`, borderRadius: 11, padding: 5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {projects.length === 0 && <p style={{ padding: '6px 10px', fontSize: 12, color: N.textFaint }}>No active projects</p>}
              {projects.map(p => {
                const on = location.pathname.startsWith(`/projects/${p.project_id}`);
                return (
                  <Link key={p.project_id} to={`/projects/${p.project_id}`} onClick={close} title={p.name}
                    className="flex items-center"
                    style={{ height: 32, gap: 9, paddingLeft: 6, paddingRight: 8, borderRadius: 7, textDecoration: 'none', background: on ? 'rgba(247,243,236,0.08)' : 'transparent', transition: 'background .12s ease' }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'rgba(247,243,236,0.06)'; }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                    <span className="flex items-center justify-center shrink-0" style={{ width: 22, height: 22, fontSize: 9.5, fontWeight: 500, borderRadius: 6, ...railChip }}>{initials(p.name)}</span>
                    <span className="truncate" style={{ fontSize: 12.5, color: on ? N.text : N.textSoft }}>{p.name}</span>
                  </Link>
                );
              })}
              <Link to="/projects" onClick={close} className="flex items-center" style={{ height: 30, gap: 9, paddingLeft: 6, borderRadius: 7, textDecoration: 'none' }}>
                <span className="shrink-0" style={{ width: 22 }} />
                <span style={{ fontSize: 12, color: N.textFaint }}>All projects →</span>
              </Link>
            </div>
          </div>
        </div>

        {/* sections — the PRIMARY rail always shows the top-level nav (icon spine when collapsed).
            In-project / Site-Management sub-navs live in the secondary navbar beside it. */}
        <nav className="nav-scroll flex-1 overflow-y-auto overflow-x-hidden mt-4" style={pad}>
          {SECTIONS.map((s, i) => (
            s.items.length === 0 ? null : (
              <div key={i} style={{ marginTop: i > 0 ? (open ? 18 : 0) : 0 }}>
                {s.label && (
                  <p className="uppercase font-medium truncate" style={{ color: N.textFaint, letterSpacing: '0.11em', fontSize: 10.5, paddingLeft: 10, marginBottom: open ? 7 : 0, height: open ? 12 : 0, overflow: 'hidden', opacity: open ? 1 : 0, transition: 'opacity .15s' }}>{s.label}</p>
                )}
                {!open && i > 0 && <div style={{ height: 16 }} />}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {s.items.map(it => (
                    <RailItem key={it.route} item={it} open={open} active={it.route === '/site-desk' ? inSiteMgmt : isActive(it.route)} onNavigate={close} />
                  ))}
                </div>
              </div>
            )
          ))}
        </nav>

        {/* user identity + menu */}
        <div className="mt-2" style={{ ...pad, position: 'relative' }} ref={userRef}>
          <button onClick={() => setShowUser(o => !o)} title={profile?.name ?? 'Account'}
            className="w-full flex items-center" style={{ gap: 9, paddingLeft: open ? 6 : 0, justifyContent: open ? 'flex-start' : 'center', background: 'transparent', height: 38, borderRadius: 8 }}>
            <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: 28, height: 28, ...railChip, fontWeight: 500, fontSize: 11, ...font }}>{initials(profile?.name ?? 'U')}</span>
            <span className="min-w-0 text-left" style={{ opacity: open ? 1 : 0, transition: 'opacity .15s', overflow: 'hidden', flex: open ? '1 1 0%' : '0 0 0px', width: open ? 'auto' : 0 }}>
              <span className="block truncate" style={{ fontSize: 13, color: N.text }}>{profile?.name ?? 'User'}</span>
              <span className="block truncate capitalize" style={{ fontSize: 11, color: N.textFaint }}>{role}</span>
            </span>
            <IconDots size={14} style={{ color: N.textFaint, opacity: open ? 1 : 0, transition: 'opacity .15s', flexShrink: 0, display: open ? 'block' : 'none' }} />
          </button>
          {showUser && (
            <div className="nav-pop" style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: open ? 8 : 6, minWidth: 188, background: V.surface, border: `1px solid ${V.line}`, borderRadius: 10, boxShadow: '0 -8px 28px rgba(20,16,12,0.18)', overflow: 'hidden', zIndex: 60 }}>
              <button onClick={() => { navigate('/settings'); setShowUser(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left" style={{ fontSize: 13, color: V.inkSoft, background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = V.field)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <IconSettings size={15} strokeWidth={1.7} style={{ color: V.faint }} /> Settings
              </button>
              <div style={{ borderTop: `1px solid ${V.line}` }} />
              <button onClick={doSignOut} disabled={signingOut} aria-busy={signingOut}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left relative overflow-hidden"
                style={{ fontSize: 13, color: signingOut ? V.terraDeep : '#B2402A', background: 'transparent', cursor: signingOut ? 'default' : 'pointer', transition: 'color .2s ease' }}
                onMouseEnter={e => { if (!signingOut) e.currentTarget.style.background = V.terraWash; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                {signingOut
                  ? <><IconLoader2 size={15} strokeWidth={2} className="nav-spin" /> Signing out…</>
                  : <><IconLogout size={15} strokeWidth={1.7} /> Sign out</>}
                {signingOut && <span className="nav-indet" />}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── SECONDARY NAVBAR — a literal second column beside the rail, in the SAME dark family
            (one shade warmer, faint terra glow). Carries the active context's sub-nav (a project's
            internal pages, or the Site Management hub). The toggle collapses/expands the rail. ── */}
      {panelCfg && (
        <aside
          key="secondary-panel"
          className="hidden md:flex flex-col nav-panel-in py-4"
          style={{
            position: 'fixed', top: 0, left: open ? RAIL_OPEN : RAIL_W, height: '100vh', width: PANEL_W,
            // solid dark fill + (glow over panel gradient) stacked in ONE property — never split a
            // `background` shorthand and `backgroundImage`, the latter wipes the former's image.
            backgroundColor: '#342B23',
            backgroundImage: `${N.panelGlow}, ${N.panel}`,
            borderRight: `1px solid ${N.keyline}`,
            boxShadow: `inset 1px 0 0 ${N.recessLine}`, zIndex: 40,
            transition: 'left .26s cubic-bezier(.32,.72,0,1)', ...font,
          }}
        >
          {/* header — context identity (rail typography) + collapse/expand toggle + back-out */}
          <div style={{ padding: '0 14px 12px', borderBottom: `1px solid ${N.keyline}` }}>
            <div className="flex items-center" style={{ height: 32, justifyContent: 'space-between' }}>
              <Link to={panelCfg.backTo} onClick={close}
                className="inline-flex items-center" style={{ gap: 5, fontSize: 11.5, fontWeight: 500, color: N.textFaint, textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = N.textSoft)} onMouseLeave={e => (e.currentTarget.style.color = N.textFaint)}>
                <IconChevronLeft size={13} strokeWidth={2} /> {panelCfg.backLabel}
              </Link>
              {onToggleRail && (
                <button onClick={onToggleRail} title={open ? 'Collapse menu' : 'Expand menu'} aria-label={open ? 'Collapse menu' : 'Expand menu'}
                  className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: 7, background: 'transparent', color: N.textFaint, transition: 'background .12s ease, color .12s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = N.hover; e.currentTarget.style.color = N.textSoft; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = N.textFaint; }}>
                  {open ? <IconLayoutSidebarLeftCollapse size={17} strokeWidth={1.7} /> : <IconLayoutSidebarLeftExpand size={17} strokeWidth={1.7} />}
                </button>
              )}
            </div>
            <div className="flex items-center" style={{ gap: 10, marginTop: 6 }}>
              <span className="flex items-center justify-center shrink-0" style={{ width: 30, height: 30, borderRadius: 8, fontSize: 11, fontWeight: 500, ...railChip }}>
                {panelCfg.chip}
              </span>
              <div className="min-w-0">
                <p className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: N.text }}>{panelCfg.title}</p>
                <p className="truncate" style={{ fontSize: 10.5, color: N.textFaint }}>{panelCfg.subtitle}</p>
              </div>
            </div>
          </div>

          {/* items — the rail's OWN row component, so font/sizing/states match exactly */}
          <nav className="nav-scroll flex-1 overflow-y-auto" style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {panelCfg.items.map(it => (
              <RailItem key={it.route} item={it} open active={panelCfg.isItemActive(it.route)} onNavigate={close} />
            ))}
          </nav>

          {panelCfg.footer && (
            <p style={{ padding: '12px 16px 0', fontSize: 10.5, lineHeight: 1.5, color: N.textFaint, borderTop: `1px solid ${N.keyline}` }}>
              {panelCfg.footer}
            </p>
          )}
        </aside>
      )}
    </>
  );
}

// Active-state for in-project sub-nav, query-aware so the split Issues/To-dos entries (which
// share the /issues pathname and differ only by ?view=) highlight independently. A bare /issues
// visit (no view) reads as the default 'all' and highlights Issues.
function projItemActive(route: string, projBase: string, location: { pathname: string; search: string }): boolean {
  const [path, query] = route.split('?');
  if (path === projBase) return location.pathname === projBase;
  if (!location.pathname.startsWith(path)) return false;
  if (!query) return true;
  const want = new URLSearchParams(query).get('view');
  const have = new URLSearchParams(location.search).get('view') ?? 'all';
  return want === have || (want === 'issues' && have === 'all');
}

export { RAIL_W } from './navTokens';
