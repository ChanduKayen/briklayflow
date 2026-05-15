import React, { useEffect, useRef, useState } from 'react';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { supabaseAdmin } from './lib/supabase-admin';
import type { Session } from '@supabase/supabase-js';
import { Edit2, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, UserProfile } from './types';
import { SnackbarProvider, useSnackbar } from './components/Snackbar';
import { PeekProvider } from './context/PeekContext';
import { CommandBarProvider, useCommandBar } from './context/CommandBarContext';
import { CommandBar } from './components/CommandBar';
import { LinearProgress } from './components/LinearProgress';
import {
  IconLayoutDashboard, IconArrowsExchange,
  IconNotebook, IconClipboardList, IconShoppingBag, IconCalendarCheck,
  IconBuildingEstate, IconFileInvoice, IconUsersGroup, IconChartBar,
  IconSitemap, IconShieldLock, IconAdjustmentsHorizontal,
  IconLayoutSidebarLeftCollapse, IconLayoutSidebar,
  IconSettings, IconLogout, IconChevronDown, IconChevronLeft, IconDots,
  IconDotsVertical,
} from '@tabler/icons-react';

import Stakeholders from './pages/Stakeholders';
import StakeholderDetail from './pages/StakeholderDetail';
import WorkOrders from './pages/WorkOrders';
import WorkOrderDetail from './pages/WorkOrderDetail';
import ProjectDetail from './pages/ProjectDetail';
import TransactionDetail from './pages/TransactionDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import NewPurchaseOrder from './pages/NewPurchaseOrder';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import Ledger from './pages/Ledger';
import NewTransaction from './pages/NewTransaction';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import NewWorkOrder from './pages/NewWorkOrder';
import Financials from './pages/Financials';
import FinancialsPL from './pages/FinancialsPL';
import FinancialsCashflow from './pages/FinancialsCashflow';
import Invoices from './pages/Invoices';
import NewInvoice from './pages/NewInvoice';
import InvoiceDetail from './pages/InvoiceDetail';
import Billing from './pages/Billing';
import NewBill from './pages/NewBill';
import BillDetail from './pages/BillDetail';
import Logbook from './pages/Logbook';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showMoreSheet, setShowMoreSheet] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <LinearProgress />
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <SnackbarProvider>
    <PeekProvider>
    <CommandBarProvider>
    <div className="bg-background text-on-surface min-h-screen">
      <Sidebar
        session={session}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(o => !o)}
      />
      {/* Desktop reopen button — only when sidebar is collapsed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="hidden md:flex fixed top-4 left-4 z-40 p-1.5 rounded-lg transition-colors items-center justify-center"
          style={{ color: 'var(--nav-text-muted)', background: 'transparent' }}
          title="Open sidebar"
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-text-active)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-text-muted)'}
        >
          <IconLayoutSidebar size={18} strokeWidth={1.5} />
        </button>
      )}
      <main
        className={`min-h-screen mobile-main-pb transition-[margin-left] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)] ${sidebarOpen ? 'md:ml-[220px]' : 'md:ml-0'}`}
      >
        {/* Mobile topbar (phones only — replaces sidebar hamburger) */}
        <MobileTopbar session={session} />
        <Routes>
          <Route path="/" element={<Navigate to="/ledger" replace />} />
          <Route path="/dashboard" element={<Dashboard session={session} />} />
          <Route path="/logbook" element={<Logbook session={session} />} />
          <Route path="/ledger" element={<Ledger session={session} />} />
          <Route path="/ledger/new" element={<NewTransaction session={session} />} />
          <Route path="/ledger/:txnId" element={<TransactionDetail session={session} />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/new" element={<NewInvoice session={session} />} />
          <Route path="/invoices/:invoiceId" element={<InvoiceDetail session={session} />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/billing/new" element={<NewBill session={session} />} />
          <Route path="/billing/:billId" element={<BillDetail session={session} />} />
          <Route path="/projects" element={<Projects session={session} />} />
          <Route path="/projects/:projectId" element={<ProjectDetail session={session} />} />
          <Route path="/stakeholders" element={<Stakeholders session={session} />} />
          <Route path="/stakeholders/:stakeholderId" element={<StakeholderDetail session={session} />} />
          <Route path="/work-orders" element={<WorkOrders session={session} />} />
          <Route path="/work-orders/new" element={<NewWorkOrder session={session} />} />
          <Route path="/work-orders/:woId" element={<WorkOrderDetail session={session} />} />
          <Route path="/purchase-orders" element={<PurchaseOrders session={session} />} />
          <Route path="/purchase-orders/new" element={<NewPurchaseOrder session={session} />} />
          <Route path="/purchase-orders/:poId" element={<PurchaseOrderDetail session={session} />} />
          <Route path="/team" element={<Team session={session} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/financials" element={<PrincipalGuard session={session}><Financials /></PrincipalGuard>} />
          <Route path="/financials/pl" element={<PrincipalGuard session={session}><FinancialsPL /></PrincipalGuard>} />
          <Route path="/financials/cashflow" element={<PrincipalGuard session={session}><FinancialsCashflow /></PrincipalGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Bottom tab bar — mobile only */}
      <BottomTabBar session={session} onMoreTap={() => setShowMoreSheet(true)} />

      {/* More nav sheet — mobile only */}
      <MoreNavSheet
        session={session}
        isOpen={showMoreSheet}
        onClose={() => setShowMoreSheet(false)}
      />
    </div>

    {/* Command bar — rendered outside the scroll container, above everything */}
    <CommandBar />
    <GlobalShortcuts />

    </CommandBarProvider>
    </PeekProvider>
    </SnackbarProvider>
  );
}

// ── Nav shortcut helpers ───────────────────────────────────────────────────────

const SHORTCUT_LETTERS: Record<string, string> = {
  '/ledger':          'T',
  '/work-orders':     'W',
  '/purchase-orders': 'P',
  '/logbook':         'L',
};

const NAV_TOOLTIPS: Record<string, { shortcut: string | null; description: string }> = {
  '/ledger':          { shortcut: 'T', description: 'All payments made — workers, vendors, expenses' },
  '/work-orders':     { shortcut: 'W', description: 'Labour contracts and milestone payments' },
  '/purchase-orders': { shortcut: 'P', description: 'Material orders and vendor bills' },
  '/logbook':         { shortcut: 'L', description: 'Raw entries from WhatsApp and field notes' },
  '/stakeholders':    { shortcut: null, description: 'Workers, vendors and clients' },
  '/dashboard':       { shortcut: null, description: 'Overview, risk flags and activity' },
  '/financials':      { shortcut: null, description: 'Reports, ledgers and statements' },
};

function NavLabel({ label, href, isActive }: { label: string; href: string; isActive: boolean }) {
  const shortcutLetter = SHORTCUT_LETTERS[href];
  if (!shortcutLetter || isActive) return <span style={{ flex: 1, lineHeight: 1 }}>{label}</span>;
  const letterIndex = label.toUpperCase().indexOf(shortcutLetter);
  if (letterIndex === -1) return <span style={{ flex: 1, lineHeight: 1 }}>{label}</span>;
  const before = label.slice(0, letterIndex);
  const letter = label.slice(letterIndex, letterIndex + 1);
  const after  = label.slice(letterIndex + 1);
  return (
    <span style={{ flex: 1, lineHeight: 1 }}>
      {before}
      <span style={{ textDecoration: 'underline', textUnderlineOffset: '2px', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(0,0,0,0.2)' }}>
        {letter}
      </span>
      {after}
    </span>
  );
}

function NavTooltip({ href, children }: { href: string; children: React.ReactNode }) {
  const tip = NAV_TOOLTIPS[href];
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!tip) return <>{children}</>;
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 500); }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setShow(false); }}
    >
      {children}
      {show && (
        <div style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 12, zIndex: 200, pointerEvents: 'none' }}>
          <div style={{ width: 0, height: 0, position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: '6px solid rgba(0,0,0,0.08)' }} />
          <div style={{ background: 'white', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: '10px 12px', width: 200 }}>
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', lineHeight: 1.5, margin: 0 }}>{tip.description}</p>
            {tip.shortcut && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 4, padding: '2px 6px', lineHeight: 1 }}>{tip.shortcut}</span>
                <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>press anywhere to open</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sidebar content ────────────────────────────────────────────────────────────

function SidebarContent({
  session,
  onNavigate,
  onCollapse,
}: {
  session: Session;
  onNavigate: () => void;
  onCollapse?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: profile } = useUserProfile(session.user.id);
  const role = profile?.role ?? '';

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [userRowHovered, setUserRowHovered] = useState(false);
  const quickAddRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (quickAddRef.current && !quickAddRef.current.contains(e.target as Node)) setShowQuickAdd(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: hasPrincipal } = useQuery({
    queryKey: ['has_principal'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id').eq('role', 'principal').limit(1);
      return (data?.length || 0) > 0;
    },
    staleTime: 5 * 60 * 1000,
    enabled: role === 'principal' || role === 'management',
  });

  const showFinancials = role === 'principal' || (role === 'management' && !hasPrincipal);

  const { data: woPendingCount = 0 } = useQuery({
    queryKey: ['nav_wo_pending'],
    queryFn: async () => {
      const { count } = await supabase.from('work_orders').select('*', { count: 'exact', head: true }).eq('status', 'Draft');
      return count ?? 0;
    },
    staleTime: 60_000,
    enabled: role === 'management' || role === 'principal',
  });

  const { data: poUntalliedCount = 0 } = useQuery({
    queryKey: ['nav_po_untallied'],
    queryFn: async () => {
      const { count } = await supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).not('status', 'in', '("Tallied","Cancelled","Draft")');
      return count ?? 0;
    },
    staleTime: 60_000,
    enabled: role !== 'supervisor' && role !== 'accountant',
  });

  const { data: billOverdueCount = 0 } = useQuery({
    queryKey: ['nav_bill_overdue'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { count } = await supabase.from('client_invoices').select('*', { count: 'exact', head: true }).lt('due_date', today).not('status', 'in', '("Paid","Void","Cancelled")');
      return count ?? 0;
    },
    staleTime: 60_000,
    enabled: role !== 'supervisor',
  });

  const { data: inboxBadgeCount = 0 } = useQuery({
    queryKey: ['inbox_badge'],
    queryFn: async () => {
      const { count } = await supabase.from('rough_entries').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  const { data: sidebarProjects = [] } = useQuery({
    queryKey: ['sidebar_projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name');
      return (data ?? []) as { project_id: string; name: string }[];
    },
    staleTime: 60_000,
  });

  type NavItem = { path: string; icon: React.ElementType; label: string; show: boolean; badge?: number; accent?: boolean };
  type NavGroup = { label: string; show: boolean; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      label: 'FIELD', show: true,
      items: [
        { path: '/ledger',  icon: IconArrowsExchange, label: 'Transactions', show: role !== 'supervisor', accent: true },
        { path: '/logbook', icon: IconNotebook,       label: 'Logbook',      show: true,                 badge: inboxBadgeCount },
      ],
    },
    {
      label: 'PEOPLE', show: true,
      items: [
        { path: '/stakeholders', icon: IconUsersGroup,    label: 'Parties',    show: role !== 'supervisor' && role !== 'accountant' },
        { path: '/attendance',   icon: IconCalendarCheck, label: 'Attendance', show: true },
      ],
    },
    {
      label: 'PROCUREMENT', show: true,
      items: [
        { path: '/work-orders',     icon: IconClipboardList, label: 'Work Orders',     show: true,                                           badge: woPendingCount },
        { path: '/purchase-orders', icon: IconShoppingBag,   label: 'Purchase Orders', show: role !== 'supervisor' && role !== 'accountant', badge: poUntalliedCount },
      ],
    },
    {
      label: 'BILLING', show: role !== 'supervisor',
      items: [
        { path: '/billing', icon: IconFileInvoice, label: 'Client Billing', show: role !== 'supervisor', badge: billOverdueCount },
      ],
    },
    {
      label: 'INTELLIGENCE', show: true,
      items: [
        { path: '/financials', icon: IconChartBar,        label: 'Financials', show: showFinancials },
        { path: '/dashboard',  icon: IconLayoutDashboard, label: 'Pulse',      show: true },
      ],
    },
    {
      label: 'ADMIN', show: role === 'principal' || role === 'management',
      items: [
        { path: '/cost-codes', icon: IconSitemap,                label: 'Cost Codes',    show: true },
        { path: '/team',       icon: IconShieldLock,             label: 'Team & Access', show: true },
        { path: '/settings',   icon: IconAdjustmentsHorizontal, label: 'Settings',      show: true },
      ],
    },
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');

  const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/'); };
  const go = (path: string) => { navigate(path); setShowQuickAdd(false); onNavigate(); };

  const quickCreateItems = [
    { label: 'New Transaction',    path: '/ledger/new',          icon: IconArrowsExchange },
    { label: 'New Work Order',     path: '/work-orders/new',     icon: IconClipboardList },
    { label: 'New Purchase Order', path: '/purchase-orders/new', icon: IconShoppingBag },
    { label: 'Raise Bill',         path: '/billing/new',         icon: IconFileInvoice },
    { label: 'New Project',        path: '/projects',            icon: IconBuildingEstate },
    { label: 'Add Stakeholder',    path: '/stakeholders',        icon: IconUsersGroup },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--nav-bg)' }}>

      {/* ── Company identity ─────────────────────────────────────────────── */}
      <div style={{ height: 56, padding: '0 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--nav-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{ width: 8, height: 8, background: 'var(--nav-accent)', transform: 'rotate(45deg)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--nav-text-active)' }}>
            Briklay
          </span>
        </div>
      </div>

      {/* ── + New button ─────────────────────────────────────────────────── */}
      <div style={{ margin: '12px 12px 4px', position: 'relative' }} ref={quickAddRef}>
        <button
          onClick={() => setShowQuickAdd(o => !o)}
          style={{
            width: '100%', height: 30, borderRadius: 6,
            background: showQuickAdd ? 'rgba(0,0,0,0.03)' : 'transparent',
            border: '1px solid var(--nav-border)',
            color: 'var(--nav-text-default)',
            fontSize: 12, fontWeight: 400,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 10px',
            transition: 'background 80ms, border-color 80ms',
          }}
          onMouseEnter={e => { if (!showQuickAdd) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.12)'; }}}
          onMouseLeave={e => { if (!showQuickAdd) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--nav-border)'; }}}
        >
          <span>
            <span style={{ color: 'var(--nav-accent)', fontWeight: 500 }}>+</span>
            {' '}New
          </span>
          <IconChevronDown size={12} strokeWidth={1.5} style={{ transition: 'transform 150ms', transform: showQuickAdd ? 'rotate(180deg)' : 'none' }} />
        </button>

        {showQuickAdd && (
          <div
            className="popover-animate"
            style={{
              position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
              background: '#ffffff', border: '1px solid var(--nav-border)',
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              overflow: 'hidden', zIndex: 50,
            }}
          >
            {quickCreateItems.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.path}
                  onClick={() => go(item.path)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', fontSize: 13,
                    color: 'var(--nav-text-default)', background: 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    transition: 'background 60ms',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.03)'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                >
                  <Icon size={14} strokeWidth={1.5} style={{ color: 'var(--nav-text-muted)', flexShrink: 0 }} />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Nav groups ───────────────────────────────────────────────────── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 0 4px' }} className="no-scrollbar">

        {/* ── Dashboard (standalone) ───────────────────────────────────── */}
        <div style={{ padding: '8px 0 4px' }}>
          <Link to="/dashboard" onClick={onNavigate} className="nav-item" data-active={location.pathname === '/dashboard'}>
            <IconLayoutDashboard size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, lineHeight: 1 }}>Dashboard</span>
          </Link>
        </div>
        <div style={{ height: 1, background: 'var(--nav-border)', margin: '0 12px 4px' }} />

        {/* ── PROJECTS section ─────────────────────────────────────────── */}
        <div className="nav-group-animate">
          <p style={{ padding: '16px 16px 4px', fontSize: 10, fontWeight: 500, color: 'var(--nav-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none' }}>
            Projects
          </p>
          {sidebarProjects.map(proj => {
            const path = `/projects/${proj.project_id}`;
            const active = isActive(path);
            return (
              <Link key={proj.project_id} to={path} onClick={onNavigate} className="nav-item" data-active={active}>
                <span style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: active ? 'var(--nav-accent)' : 'currentColor', opacity: active ? 1 : 0.4 }} />
                </span>
                <span style={{ flex: 1, lineHeight: 1 }}>{proj.name}</span>
              </Link>
            );
          })}
          <Link to="/projects" onClick={onNavigate} className="nav-item" data-active={location.pathname === '/projects'}>
            <IconBuildingEstate size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, lineHeight: 1 }}>+ Add Project</span>
          </Link>
        </div>

        {/* ── Other nav groups ─────────────────────────────────────────── */}
        {navGroups.filter(g => g.show).map((group, gi) => {
          const visible = group.items.filter(i => i.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.label} className="nav-group-animate" style={{ animationDelay: `${(gi + 1) * 40}ms` }}>
              <p style={{ padding: '16px 16px 4px', fontSize: 10, fontWeight: 500, color: 'var(--nav-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none' }}>
                {group.label}
              </p>
              {visible.map(item => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <NavTooltip key={item.path} href={item.path}>
                    <Link
                      to={item.path}
                      onClick={onNavigate}
                      className="nav-item"
                      data-active={active}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.5}
                        style={{ flexShrink: 0, ...(item.accent ? { color: 'var(--nav-accent)' } : {}) }}
                      />
                      <NavLabel label={item.label} href={item.path} isActive={active} />
                      {(item.badge ?? 0) > 0 && (
                        <span className="nav-badge-mono">
                          {(item.badge ?? 0) > 9 ? '9+' : item.badge}
                        </span>
                      )}
                    </Link>
                  </NavTooltip>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* ── Collapse trigger ─────────────────────────────────────────────── */}
      {onCollapse && (
        <button
          onClick={onCollapse}
          style={{
            height: 32, width: '100%',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 16px',
            fontSize: 11, color: 'var(--nav-text-muted)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            transition: 'color 100ms',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-text-default)'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = 'var(--nav-text-muted)'}
        >
          <IconLayoutSidebarLeftCollapse size={14} strokeWidth={1.5} />
          Collapse
        </button>
      )}

      {/* ── User identity ────────────────────────────────────────────────── */}
      <div
        style={{ borderTop: '1px solid var(--nav-border)', padding: '10px 12px', flexShrink: 0, position: 'relative' }}
        ref={userMenuRef}
      >
        <button
          onClick={() => setShowUserMenu(o => !o)}
          onMouseEnter={() => setUserRowHovered(true)}
          onMouseLeave={() => setUserRowHovered(false)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.08)', color: 'var(--nav-text-active)', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, userSelect: 'none' }}>
            {initials(profile?.name ?? 'User')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--nav-text-active)', lineHeight: '1.2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.name ?? 'User'}
            </p>
            <p style={{ fontSize: 11, fontWeight: 400, color: 'var(--nav-text-muted)', lineHeight: '1.2', textTransform: 'capitalize' }}>
              {role}
            </p>
          </div>
          <IconDots size={14} strokeWidth={1.5} style={{ color: 'var(--nav-text-muted)', marginLeft: 'auto', opacity: userRowHovered ? 1 : 0, transition: 'opacity 100ms', flexShrink: 0 }} />
        </button>

        {showUserMenu && (
          <div
            className="popover-animate"
            style={{
              position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 4,
              background: '#ffffff', border: '1px solid var(--nav-border)',
              borderRadius: 8, boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
              overflow: 'hidden', zIndex: 50,
            }}
          >
            <button
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 13, color: 'var(--nav-text-default)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 60ms' }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.03)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              <IconSettings size={14} strokeWidth={1.5} style={{ color: 'var(--nav-text-muted)' }} />
              Profile
            </button>
            <div style={{ borderTop: '1px solid var(--nav-border)' }} />
            <button
              onClick={handleLogout}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 13, color: '#c0392b', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 60ms' }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(192,57,43,0.06)'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
            >
              <IconLogout size={14} strokeWidth={1.5} />
              Sign Out
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Global keyboard shortcuts ──────────────────────────────────────────────────

function GlobalShortcuts() {
  const { open } = useCommandBar();
  useGlobalShortcuts(open);
  return null;
}

// ── Sidebar shell ──────────────────────────────────────────────────────────────

function Sidebar({
  session,
  mobileOpen: _mobileOpen,
  onMobileClose: _onMobileClose,
  isOpen,
  onToggle,
}: {
  session: Session;
  mobileOpen: boolean;
  onMobileClose: () => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      {/* Desktop — animated width (220px ↔ 0px) */}
      <aside
        style={{ width: isOpen ? 220 : 0, background: 'var(--nav-bg)' }}
        className="hidden md:block fixed left-0 top-0 h-full z-50 overflow-hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)]"
      >
        {/* Inner wrapper keeps content at full width so it doesn't squish during animation */}
        <div style={{ width: 220, height: '100%' }}>
          <SidebarContent session={session} onNavigate={() => {}} onCollapse={onToggle} />
        </div>
      </aside>

      {/* Mobile drawer — hidden on phones (bottom tab bar handles mobile nav) */}
      {/* Kept for tablet use if needed, but currently not triggered on mobile */}
    </>
  );
}

// ── Mobile helpers ────────────────────────────────────────────────────────────

function getMobileTitle(pathname: string): string {
  const routes: Record<string, string> = {
    '/':                    'Transactions',
    '/dashboard':           'Dashboard',
    '/logbook':             'Logbook',
    '/ledger':              'Transactions',
    '/ledger/new':          'New Transaction',
    '/projects':            'Projects',
    '/work-orders':         'Work Orders',
    '/work-orders/new':     'New Work Order',
    '/purchase-orders':     'Purchase Orders',
    '/purchase-orders/new': 'New Purchase Order',
    '/billing':             'Billing',
    '/billing/new':         'New Bill',
    '/stakeholders':        'Parties',
    '/settings':            'Settings',
    '/team':                'Team & Access',
    '/financials':          'Financials',
    '/financials/pl':       'P&L',
    '/financials/cashflow': 'Cashflow',
    '/invoices':            'Invoices',
    '/invoices/new':        'New Invoice',
    '/attendance':          'Attendance',
    '/cost-codes':          'Cost Codes',
  };
  if (routes[pathname]) return routes[pathname];
  const seg = pathname.split('/').filter(Boolean);
  const detailTitles: Record<string, string> = {
    'ledger': 'Transaction', 'projects': 'Project', 'work-orders': 'Work Order',
    'purchase-orders': 'Purchase Order', 'billing': 'Bill', 'stakeholders': 'Stakeholder', 'invoices': 'Invoice',
  };
  return detailTitles[seg[0]] ?? 'Briklay';
}

function MobileTopbar({ session }: { session: Session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: profile } = useUserProfile(session.user.id);

  const pathSegments = location.pathname.split('/').filter(Boolean);
  const isDetailPage = pathSegments.length >= 2;
  const title = getMobileTitle(location.pathname);

  const avatarColor: Record<string, string> = {
    principal: 'bg-[#C45B39] text-white', management: 'bg-blue-500 text-white',
    supervisor: 'bg-teal-500 text-white', accountant: 'bg-purple-500 text-white',
  };
  const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <div
      className="md:hidden sticky top-0 z-30 flex items-end gap-2 px-4 bg-white border-b border-black/[0.06]"
      style={{ minHeight: 'calc(52px + env(safe-area-inset-top))', paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}
    >
      {isDetailPage && (
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center w-9 h-9 -ml-2 rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          <IconChevronLeft size={24} strokeWidth={2} />
        </button>
      )}
      <span className="flex-1 text-[16px] font-[500] text-on-surface leading-none tracking-tight">{title}</span>
      {profile && (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor[profile.role] ?? 'bg-surface-container-high text-on-surface'}`}>
          {initials(profile.name ?? 'U')}
        </div>
      )}
    </div>
  );
}

const TERRACOTTA = '#C45B39';

function BottomTabBar({ session, onMoreTap }: { session: Session; onMoreTap: () => void }) {
  const location = useLocation();
  const { data: profile } = useUserProfile(session.user.id);
  const role = profile?.role ?? '';

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');

  const moreActive = [
    '/purchase-orders', '/billing', '/stakeholders', '/team', '/settings',
    '/financials', '/invoices', '/fund-register', '/cost-codes', '/attendance',
    '/work-orders',
  ].some(p => isActive(p));

  const { data: inboxBadge = 0 } = useQuery({
    queryKey: ['inbox_badge'],
    queryFn: async () => {
      const { count } = await supabase.from('rough_entries').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  type Tab = { path: string; icon: React.ElementType; label: string; show: boolean; badge?: number };
  const tabs: Tab[] = [
    { path: '/ledger', icon: IconArrowsExchange,  label: 'Txns',     show: role !== 'supervisor' },
    { path: '/logbook', icon: IconNotebook,        label: 'Logbook',  show: true, badge: inboxBadge },
    { path: '/ledger', icon: IconArrowsExchange,  label: 'Txns',     show: role !== 'supervisor' },
    { path: '/projects', icon: IconBuildingEstate, label: 'Projects', show: true },
  ].filter(t => t.show);

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white"
      style={{ borderTop: '1px solid var(--nav-border)' }}
    >
      <div className="flex items-stretch" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(tab => {
          const active = isActive(tab.path);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative"
              style={{ minHeight: 56, color: active ? TERRACOTTA : 'var(--nav-text-muted)' }}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2 : 1.5} />
                {(tab.badge ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold px-1 leading-none"
                    style={{ background: 'rgba(0,0,0,0.10)', color: 'var(--nav-text-default)' }}>
                    {(tab.badge ?? 0) > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={onMoreTap}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
          style={{ minHeight: 56, color: moreActive ? TERRACOTTA : 'var(--nav-text-muted)' }}
        >
          <IconDotsVertical size={22} strokeWidth={moreActive ? 2 : 1.5} />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </div>
    </nav>
  );
}

function MoreNavSheet({
  session, isOpen, onClose,
}: { session: Session; isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: profile } = useUserProfile(session.user.id);
  const role = profile?.role ?? '';

  const { data: hasPrincipal } = useQuery({
    queryKey: ['has_principal'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id').eq('role', 'principal').limit(1);
      return (data?.length || 0) > 0;
    },
    staleTime: 5 * 60 * 1000,
    enabled: role === 'principal' || role === 'management',
  });

  const showFinancials = role === 'principal' || (role === 'management' && !hasPrincipal);

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const go = (path: string) => { navigate(path); onClose(); };

  const items = [
    { path: '/work-orders',     icon: IconClipboardList,        label: 'Work Orders',     show: true },
    { path: '/purchase-orders', icon: IconShoppingBag,          label: 'Purchase Orders', show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/attendance',      icon: IconCalendarCheck,        label: 'Attendance',      show: true },
    { path: '/billing',         icon: IconFileInvoice,          label: 'Billing',         show: role !== 'supervisor' },
    { path: '/stakeholders',    icon: IconUsersGroup,           label: 'Parties',         show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/financials',      icon: IconChartBar,             label: 'Financials',      show: showFinancials },
    { path: '/cost-codes',      icon: IconSitemap,              label: 'Cost Codes',      show: role === 'principal' || role === 'management' },
    { path: '/team',            icon: IconShieldLock,           label: 'Team & Access',   show: role === 'principal' || role === 'management' },
    { path: '/settings',        icon: IconAdjustmentsHorizontal, label: 'Settings',        show: true },
  ].filter(i => i.show);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-[45] bg-black/40 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Sheet */}
      <div
        className={`md:hidden fixed bottom-0 left-0 right-0 z-[50] bg-white rounded-t-[20px] shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-8 h-1 rounded-full bg-black/15" />
        </div>
        <div className="px-4 pb-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant/40">More</p>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {items.map(item => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => go(item.path)}
                className="w-full flex items-center gap-3 px-5"
                style={{
                  minHeight: 52,
                  backgroundColor: active ? 'rgba(200,96,58,0.06)' : undefined,
                }}
              >
                <Icon size={18} strokeWidth={1.5} style={{ color: active ? TERRACOTTA : 'var(--nav-text-muted)', flexShrink: 0 }} />
                <span
                  className="flex-1 text-[14px] text-left"
                  style={{ fontWeight: active ? 600 : 400, color: active ? TERRACOTTA : 'var(--nav-text-default)' }}
                >
                  {item.label}
                </span>
                {active && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: TERRACOTTA, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Login() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: { data: { full_name: name } }
      });
      if (error) setError(error.message);
      else setSuccess('Account created! You can now sign in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-margin-mobile">
      <div className="w-full max-w-md bg-surface-container-lowest p-8 rounded-2xl shadow-card-md border border-outline-variant/30">
        <div className="text-center mb-8">
          <h1 className="text-headline-lg font-headline-lg font-black text-primary mb-2">Briklay</h1>
          <p className="text-body-sm text-on-surface-variant">{isSignUp ? 'Create your account' : 'Sign in to continue'}</p>
        </div>
        
        {error && <div className="mb-4 p-3 bg-error-container text-on-error-container rounded-lg text-body-sm">{error}</div>}
        {success && <div className="mb-4 p-3 bg-secondary-container text-on-secondary-container rounded-lg text-body-sm">{success}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant uppercase">Full Name</label>
              <input type="text" className="bk-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="space-y-stack-sm">
            <label className="text-label-caps font-label-caps text-on-surface-variant uppercase">Email</label>
            <input type="email" className="bk-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-stack-sm">
            <label className="text-label-caps font-label-caps text-on-surface-variant uppercase">Password</label>
            <input type="password" className="bk-input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="bk-btn w-full mt-4 py-4 rounded-xl text-body-lg" disabled={loading}>
            {loading ? (isSignUp ? 'Creating...' : 'Signing in...') : (isSignUp ? 'Create Account' : 'Sign In')}
          </button>
        </form>
        
        <div className="mt-6 text-center">
          <button type="button" className="text-secondary text-body-sm font-semibold hover:underline"
            onClick={() => { setIsSignUp(!isSignUp); setError(null); setSuccess(null); }}>
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useUserProfile(userId: string) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data as UserProfile;
    },
  });
}



function Projects({ session }: { session: Session }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const [showForm, setShowForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<Project>>({});

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });

  // Financial summary data for cards
  const { data: allocData, isLoading: allocLoading } = useQuery({
    queryKey: ['project_card_allocs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('project_id, allocated_amount, transactions(txn_id, status)');
      if (error) throw error;
      return data as unknown as { project_id: string; allocated_amount: number; transactions: { txn_id: string; status: string } | null }[];
    },
  });

  const { data: woData, isLoading: woLoading } = useQuery({
    queryKey: ['project_card_wos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('project_id, status');
      if (error) throw error;
      return data as { project_id: string; status: string }[];
    },
  });

  // Aggregate per project
  const projectStats = (() => {
    const stats: Record<string, { totalSpend: number; txnIds: Set<string> }> = {};
    for (const a of allocData || []) {
      if (a.transactions?.status !== 'Active') continue;
      if (!stats[a.project_id]) stats[a.project_id] = { totalSpend: 0, txnIds: new Set() };
      stats[a.project_id].totalSpend += Number(a.allocated_amount) || 0;
      if (a.transactions?.txn_id) stats[a.project_id].txnIds.add(a.transactions.txn_id);
    }
    return stats;
  })();

  const openWOCounts = (woData || []).reduce((acc, wo) => {
    if (['Draft', 'Issued', 'Active'].includes(wo.status)) {
      acc[wo.project_id] = (acc[wo.project_id] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const statsLoading = allocLoading || woLoading;

  const fmtSpend = (n: number) =>
    n >= 100000 ? `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L` : `₹${n.toLocaleString()}`;

  const { show: showSnackbar } = useSnackbar();

  const createProject = useMutation({
    mutationFn: async (newProject: Partial<Project>) => {
      const { data, error } = await supabase.from('projects').insert([newProject]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
      showSnackbar(`Project "${data.name}" created`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to create project', { type: 'error' }),
  });

  const updateProject = useMutation({
    mutationFn: async ({ id, updates }: { id: string, updates: Partial<Project> }) => {
      const { data, error } = await supabase.from('projects').update(updates).eq('project_id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditingProjectId(null);
      showSnackbar('Project updated');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update', { type: 'error' }),
  });

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('projects').delete().eq('project_id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      showSnackbar('Project deleted');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to delete — check for linked records', { type: 'error' }),
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createProject.mutate({
      project_id: formData.get('project_id') as string,
      name: formData.get('name') as string,
      site_location: formData.get('site_location') as string,
      start_date: formData.get('start_date') as string,
    });
  };



  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-stack-lg">
        <div>
          <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Projects</h2>
          <p className="text-[12px] text-on-surface-variant/50 mt-1">{projects?.length ?? 0} projects</p>
        </div>
        {(profile?.role === 'management' || profile?.role === 'principal') && (
          <button className="bk-btn hidden md:flex items-center gap-2 h-9 px-4 rounded-xl text-[13px]" onClick={() => setShowForm(!showForm)}>
            <span className="material-symbols-outlined text-[16px]">{showForm ? 'close' : 'add'}</span>
            {showForm ? 'Cancel' : 'New Project'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl shadow-card border border-outline-variant/30 mb-stack-lg">
          <h3 className="text-headline-md font-headline-md mb-4">Create New Project</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">PROJECT ID</label>
              <input name="project_id" className="bk-input" placeholder="e.g. BRK-PRJ-001" required />
            </div>
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">PROJECT NAME</label>
              <input name="name" className="bk-input" placeholder="e.g. Phase 1 Residential" required />
            </div>
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">SITE LOCATION</label>
              <input name="site_location" className="bk-input" placeholder="City / Address" required />
            </div>
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">START DATE</label>
              <input name="start_date" type="date" className="bk-input" required />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" className="bk-btn" disabled={createProject.isPending}>
                {createProject.isPending ? 'Saving...' : 'Save Project'}
              </button>
            </div>
          </form>
          {createProject.isError && <p className="text-error mt-4 text-body-sm">Error: {createProject.error.message}</p>}
        </div>
      )}

      <div className="grid gap-gutter grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <LinearProgress className="col-span-full mb-4" />}
        {error && <p className="text-error col-span-full">Failed to load projects: {(error as Error).message}</p>}
        {projects?.length === 0 && !isLoading && <p className="text-on-surface-variant col-span-full">No projects yet.</p>}
        {projects?.map((p) => (
          <div key={p.project_id} className="contents">
            <div className="bg-white p-4 rounded-xl shadow-elevation-1 border border-black/[0.06] hover:shadow-elevation-2 transition-shadow duration-200 relative group bk-row-ripple">
              {editingProjectId === p.project_id ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant">PROJECT NAME</label>
                    <input className="bk-input w-full py-1.5" value={editFormData.name || ''} onChange={e => setEditFormData({...editFormData, name: e.target.value})} placeholder="Project Name" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant">SITE LOCATION</label>
                    <input className="bk-input w-full py-1.5" value={editFormData.site_location || ''} onChange={e => setEditFormData({...editFormData, site_location: e.target.value})} placeholder="Site Location" />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-on-surface-variant">START DATE</label>
                      <input type="date" className="bk-input w-full py-1.5" value={editFormData.start_date ? new Date(editFormData.start_date).toISOString().split('T')[0] : ''} onChange={e => setEditFormData({...editFormData, start_date: e.target.value})} />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-on-surface-variant">STATUS</label>
                      <select className="bk-input w-full py-1.5" value={editFormData.status || 'Active'} onChange={e => setEditFormData({...editFormData, status: e.target.value as any})}>
                        <option value="Active">Active</option>
                        <option value="Completed">Completed</option>
                        <option value="On Hold">On Hold</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <button className="bk-btn-ghost text-body-sm py-1 px-3 border border-primary/20" onClick={() => setEditingProjectId(null)}>Cancel</button>
                    <button className="bk-btn text-body-sm py-1 px-4" onClick={() => updateProject.mutate({ id: p.project_id, updates: editFormData })} disabled={updateProject.isPending}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="cursor-pointer" onClick={() => navigate(`/projects/${p.project_id}`)}>
                    <div className="flex justify-between items-start mb-4 pr-6">
                      <div>
                        <h3 className="font-body-lg font-bold text-on-surface">{p.name}</h3>
                        <p className="text-body-sm text-on-surface-variant font-data-mono">{p.project_id}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.status === 'Active' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                        {p.status?.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-body-sm text-on-surface-variant space-y-1">
                      <p className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">location_on</span>{p.site_location}</p>
                      <p className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">calendar_today</span>{new Date(p.start_date).toLocaleDateString()}</p>
                    </div>

                    {/* Financial summary strip */}
                    <div className="mt-4 pt-3 border-t border-outline-variant/15">
                      {statsLoading ? (
                        <div className="grid grid-cols-3 gap-2">
                          {[0,1,2].map(i => (
                            <div key={i} className="text-center space-y-1">
                              <div className="h-4 w-12 mx-auto bg-surface-container-highest rounded animate-pulse" />
                              <div className="h-2.5 w-8 mx-auto bg-surface-container-highest rounded animate-pulse" />
                            </div>
                          ))}
                        </div>
                      ) : (() => {
                        const s = projectStats[p.project_id];
                        const spend = s?.totalSpend ?? 0;
                        const txnCount = s?.txnIds.size ?? 0;
                        const openWOs = openWOCounts[p.project_id] ?? 0;
                        return (
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className={`text-body-sm font-bold font-data-mono ${spend === 0 ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                                {fmtSpend(spend)}
                              </p>
                              <p className="text-[10px] text-on-surface-variant mt-0.5">spent</p>
                            </div>
                            <div className="border-x border-outline-variant/15">
                              <p className={`text-body-sm font-bold ${openWOs === 0 ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                                {openWOs === 0 ? 'No WOs' : openWOs}
                              </p>
                              <p className="text-[10px] text-on-surface-variant mt-0.5">open WOs</p>
                            </div>
                            <div>
                              <p className={`text-body-sm font-bold ${txnCount === 0 ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                                {txnCount}
                              </p>
                              <p className="text-[10px] text-on-surface-variant mt-0.5">transactions</p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  
                  {(profile?.role === 'management' || profile?.role === 'principal') && (
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/90 backdrop-blur rounded-lg p-1 shadow-sm border border-outline-variant/20">
                      <button className="p-1.5 hover:bg-surface-container rounded-md text-on-surface-variant hover:text-primary transition-colors" onClick={(e) => { e.stopPropagation(); setEditingProjectId(p.project_id); setEditFormData(p); }} title="Edit Project">
                        <Edit2 size={16} />
                      </button>
                      <button className="p-1.5 hover:bg-error-container rounded-md text-on-surface-variant hover:text-error transition-colors" onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this project? This will fail if there are linked work orders or transactions.')) {
                          deleteProject.mutate(p.project_id);
                        }
                      }} title="Delete Project">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* FAB — mobile only */}
      {(profile?.role === 'management' || profile?.role === 'principal') && (
        <button className="bk-fab" onClick={() => setShowForm(true)} title="New Project">
          <span className="material-symbols-outlined text-[24px]">add</span>
        </button>
      )}
    </div>
  );
}

function Team({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as UserProfile[];
    },
    enabled: profile?.role === 'management' || profile?.role === 'principal',
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name');
      if (error) throw error;
      return data as { project_id: string, name: string }[];
    },
    enabled: profile?.role === 'management' || profile?.role === 'principal',
  });

  const { show: showSnackbar } = useSnackbar();

  const updateUser = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string, updates: Partial<UserProfile> }) => {
      const { data, error } = await supabase.from('user_profiles').update(updates).eq('id', userId).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      setEditingUserId(null);
      showSnackbar('User updated');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update', { type: 'error' }),
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      if (!supabaseAdmin) throw new Error("Service Role Key is missing. Cannot delete users.");
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      showSnackbar('User removed');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to delete user', { type: 'error' }),
  });

  const createUser = useMutation({
    mutationFn: async (formData: FormData) => {
      if (!supabaseAdmin) throw new Error("Service Role Key is missing. Cannot add users.");
      const email = formData.get('email') as string;
      const password = formData.get('password') as string;
      const name = formData.get('name') as string;
      const role = formData.get('role') as string;
      if (role === 'principal' && team?.some(u => u.role === 'principal')) {
        throw new Error('Only one Principal is allowed per organisation. Update the existing Principal first.');
      }
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: name }
      });
      if (authError) throw authError;
      if (role !== 'supervisor') {
        const { error: updateError } = await supabase.from('user_profiles').update({ role: role as any }).eq('id', authData.user.id);
        if (updateError) throw updateError;
      }
      return authData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      setShowAddForm(false);
      showSnackbar('User created successfully');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to create user', { type: 'error' }),
  });

  if (profile?.role !== 'management' && profile?.role !== 'principal') {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl">
          <h3 className="text-headline-md font-headline-md">Access Denied</h3>
          <p className="text-body-sm mt-2">Only Management and Principal can access this page.</p>
        </div>
      </div>
    );
  }

  const toggleProjectAssignment = (userId: string, currentAssigned: string[], projectId: string) => {
    const isAssigned = currentAssigned.includes(projectId);
    const newAssigned = isAssigned ? currentAssigned.filter(id => id !== projectId) : [...currentAssigned, projectId];
    updateUser.mutate({ userId, updates: { assigned_projects: newAssigned } });
  };

  const startEditing = (user: UserProfile) => { setEditingUserId(user.id); setEditName(user.name); };

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-stack-lg">
        <h2 className="text-headline-lg font-headline-lg text-primary">Settings</h2>
        <button className="bk-btn flex items-center gap-2" onClick={() => setShowAddForm(!showAddForm)}>
          <span className="material-symbols-outlined text-[18px]">{showAddForm ? 'close' : 'person_add'}</span>
          {showAddForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {!supabaseAdmin && (
        <div className="mb-4 p-4 bg-tertiary-fixed text-on-tertiary-fixed rounded-xl border border-on-tertiary-container/20 text-body-sm">
          <strong>Missing Admin Key:</strong> Add <code className="font-data-mono">VITE_SUPABASE_SERVICE_ROLE_KEY</code> to <code className="font-data-mono">.env.local</code>.
        </div>
      )}

      {showAddForm && (
        <div className="bg-surface-container-lowest p-6 rounded-xl shadow-card border border-outline-variant/30 mb-stack-lg">
          <h3 className="text-headline-md font-headline-md mb-4">Create New User</h3>
          <form onSubmit={(e) => { e.preventDefault(); createUser.mutate(new FormData(e.currentTarget)); }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-stack-sm"><label className="text-label-caps font-label-caps text-on-surface-variant">NAME</label><input name="name" className="bk-input" required /></div>
            <div className="space-y-stack-sm"><label className="text-label-caps font-label-caps text-on-surface-variant">EMAIL</label><input name="email" type="email" className="bk-input" required /></div>
            <div className="space-y-stack-sm"><label className="text-label-caps font-label-caps text-on-surface-variant">PASSWORD</label><input name="password" type="password" className="bk-input" required minLength={6} /></div>
            <div className="space-y-stack-sm">
              <label className="text-label-caps font-label-caps text-on-surface-variant">ROLE</label>
              <select name="role" className="bk-input">
                <option value="supervisor">Supervisor</option>
                <option value="accountant">Accountant</option>
                <option value="management">Management</option>
                <option value="principal" disabled={team?.some(u => u.role === 'principal')}>
                  Principal{team?.some(u => u.role === 'principal') ? ' (already assigned)' : ''}
                </option>
              </select>
            </div>
            <div className="md:col-span-2 flex justify-end"><button type="submit" className="bk-btn" disabled={createUser.isPending || !supabaseAdmin}>{createUser.isPending ? 'Saving...' : 'Create User'}</button></div>
          </form>
          {createUser.isError && <p className="text-error mt-4 text-body-sm">Error: {createUser.error.message}</p>}
        </div>
      )}

      <div className="space-y-stack-md">
        {teamLoading && <LinearProgress className="mb-4" />}
        {team?.map((user) => (
          <div key={user.id} className="bg-white p-6 rounded-2xl shadow-elevation-1 border border-black/[0.06] hover:shadow-elevation-2 transition-shadow duration-200 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary"><span className="material-symbols-outlined">person</span></div>
                {editingUserId === user.id ? (
                  <div className="flex gap-2 items-center">
                    <input autoFocus className="bk-input w-48" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <button className="bk-btn px-3 py-2 text-body-sm" onClick={() => updateUser.mutate({ userId: user.id, updates: { name: editName } })}>Save</button>
                    <button className="p-2 hover:bg-surface-container rounded-lg" onClick={() => setEditingUserId(null)}><span className="material-symbols-outlined text-[18px]">close</span></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div><h3 className="font-body-lg font-bold text-on-surface">{user.name}</h3><p className="text-label-caps text-on-surface-variant">{user.id.slice(0, 8)}...</p></div>
                    <button className="p-1 hover:bg-surface-container rounded-lg opacity-60" onClick={() => startEditing(user)}><Edit2 size={14} /></button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <select
                  className="bk-input w-auto py-2"
                  value={user.role}
                  disabled={updateUser.isPending}
                  onChange={(e) => {
                    const newRole = e.target.value;
                    if (newRole === 'principal' && team?.some(u => u.id !== user.id && u.role === 'principal')) {
                      showSnackbar('Only one Principal is allowed per organisation.', { type: 'error' });
                      return;
                    }
                    updateUser.mutate({ userId: user.id, updates: { role: newRole as any } });
                  }}
                >
                  <option value="supervisor">Supervisor</option>
                  <option value="accountant">Accountant</option>
                  <option value="management">Management</option>
                  <option value="principal">Principal</option>
                </select>
                <button className="p-2 text-error hover:bg-error-container/20 rounded-lg" onClick={() => { if (confirm('Delete this user?')) deleteUser.mutate(user.id); }} disabled={deleteUser.isPending || !supabaseAdmin} title={!supabaseAdmin ? "Requires Service Role Key" : "Delete"}>
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            {user.role === 'supervisor' && projects && (
              <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/20">
                <h4 className="text-label-caps font-label-caps text-on-surface-variant mb-3">ASSIGNED PROJECTS</h4>
                <div className="flex flex-wrap gap-2">
                  {projects.length === 0 && <span className="text-body-sm text-on-surface-variant">No projects available.</span>}
                  {projects.map((proj) => {
                    const isAssigned = user.assigned_projects?.includes(proj.project_id) || false;
                    return (
                      <button key={proj.project_id}
                        className={`px-3 py-1 rounded-full text-label-caps font-label-caps flex items-center gap-1 transition-colors ${isAssigned ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
                        onClick={() => toggleProjectAssignment(user.id, user.assigned_projects || [], proj.project_id)} disabled={updateUser.isPending}>
                        <span className="material-symbols-outlined text-[14px]">{isAssigned ? 'close' : 'add'}</span>{proj.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PrincipalGuard({ session, children }: { session: Session; children: React.ReactNode }) {
  const { data: profile } = useUserProfile(session.user.id);
  const { data: hasPrincipal, isLoading } = useQuery({
    queryKey: ['has_principal'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id').eq('role', 'principal').limit(1);
      return (data?.length || 0) > 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !profile) return <LinearProgress />;

  const canAccess =
    profile.role === 'principal' ||
    (profile.role === 'management' && !hasPrincipal);

  if (!canAccess) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl">
          <h3 className="text-headline-md font-headline-md">Access Restricted</h3>
          <p className="text-body-sm mt-2">The Financials section is only accessible to the Principal user.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default App;
