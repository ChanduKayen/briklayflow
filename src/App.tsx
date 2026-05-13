import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { supabaseAdmin } from './lib/supabase-admin';
import type { Session } from '@supabase/supabase-js';
import { Edit2, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, UserProfile } from './types';
import { SnackbarProvider, useSnackbar } from './components/Snackbar';
import { LinearProgress } from './components/LinearProgress';
import {
  IconLayoutDashboard, IconArrowsExchange, IconFileText, IconShoppingCart,
  IconCalendarStats, IconBuilding, IconReceipt, IconUsers, IconWallet,
  IconChartLine, IconListTree, IconShield, IconSettings, IconPlus,
  IconChevronDown, IconLogout, IconDotsVertical, IconMenu2, IconChevronLeft,
  IconInbox,
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
import Inbox from './pages/Inbox';

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
          className="hidden md:flex fixed top-4 left-4 z-40 p-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/20 text-on-surface-variant hover:bg-surface-container shadow-sm transition-colors items-center justify-center"
          title="Open sidebar"
        >
          <IconMenu2 size={18} strokeWidth={1.5} />
        </button>
      )}
      <main
        className={`min-h-screen mobile-main-pb transition-[margin-left] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)] ${sidebarOpen ? 'md:ml-[220px]' : 'md:ml-0'}`}
      >
        {/* Mobile topbar (phones only — replaces sidebar hamburger) */}
        <MobileTopbar session={session} />
        <Routes>
          <Route path="/" element={<Dashboard session={session} />} />
          <Route path="/inbox" element={<Inbox session={session} />} />
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
    </SnackbarProvider>
  );
}

// ── Sidebar content (shared between desktop + mobile drawer) ──────────────────

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

  // ── Badge queries ────────────────────────────────────────────────────────
  const { data: woPendingCount = 0 } = useQuery({
    queryKey: ['nav_wo_pending'],
    queryFn: async () => {
      const { count } = await supabase.from('work_orders')
        .select('*', { count: 'exact', head: true }).eq('status', 'Pending Approval');
      return count ?? 0;
    },
    staleTime: 60_000,
    enabled: role !== 'supervisor',
  });

  const { data: poUntalliedCount = 0 } = useQuery({
    queryKey: ['nav_po_untallied'],
    queryFn: async () => {
      const { count } = await supabase.from('purchase_orders')
        .select('*', { count: 'exact', head: true })
        .not('status', 'in', '("Tallied","Cancelled","Draft")');
      return count ?? 0;
    },
    staleTime: 60_000,
    enabled: role !== 'supervisor' && role !== 'accountant',
  });

  const { data: billOverdueCount = 0 } = useQuery({
    queryKey: ['nav_bill_overdue'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { count } = await supabase.from('client_invoices')
        .select('*', { count: 'exact', head: true })
        .lt('due_date', today)
        .not('status', 'in', '("Paid","Void","Cancelled")');
      return count ?? 0;
    },
    staleTime: 60_000,
    enabled: role !== 'supervisor',
  });

  const { data: inboxBadgeCount = 0 } = useQuery({
    queryKey: ['inbox_badge'],
    queryFn: async () => {
      const { count } = await supabase
        .from('rough_entries')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING');
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  // ── Nav groups ───────────────────────────────────────────────────────────
  type NavItem = {
    path: string;
    icon: React.ElementType;
    label: string;
    show: boolean;
    color: string;
    badge?: number;
  };
  type NavGroup = { label: string; show: boolean; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      label: 'WORK', show: true,
      items: [
        { path: '/inbox',           icon: IconInbox,           label: 'Inbox',           show: true,                                           color: '#F59E0B', badge: inboxBadgeCount },
        { path: '/',                icon: IconLayoutDashboard, label: 'Dashboard',       show: true,                                           color: '#5B6AF5' },
        { path: '/ledger',          icon: IconArrowsExchange,  label: 'Transactions',    show: role !== 'supervisor',                          color: '#10B981' },
        { path: '/work-orders',     icon: IconFileText,        label: 'Work Orders',     show: true,                                           color: '#F59E0B', badge: woPendingCount },
        { path: '/purchase-orders', icon: IconShoppingCart,    label: 'Purchase Orders', show: role !== 'supervisor' && role !== 'accountant', color: '#3B82F6', badge: poUntalliedCount },
        { path: '/attendance',      icon: IconCalendarStats,   label: 'Attendance',      show: true,                                           color: '#14B8A6' },
      ],
    },
    {
      label: 'BUILD', show: true,
      items: [
        { path: '/projects',     icon: IconBuilding, label: 'Projects',     show: true,                                           color: '#8B5CF6' },
        { path: '/billing',      icon: IconReceipt,  label: 'Billing',      show: role !== 'supervisor',                         color: '#EF4444', badge: billOverdueCount },
        { path: '/stakeholders', icon: IconUsers,    label: 'Stakeholders', show: role !== 'supervisor' && role !== 'accountant', color: '#06B6D4' },
      ],
    },
    {
      label: 'FINANCE', show: role !== 'supervisor',
      items: [
        { path: '/fund-register', icon: IconWallet,    label: 'Fund Register', show: true,          color: '#059669' },
        { path: '/financials',    icon: IconChartLine, label: 'Financials',    show: showFinancials, color: '#6366F1' },
      ],
    },
    {
      label: 'ADMIN', show: role === 'principal' || role === 'management',
      items: [
        { path: '/cost-codes', icon: IconListTree, label: 'Cost Codes',    show: true, color: '#64748B' },
        { path: '/team',       icon: IconShield,   label: 'Team & Access', show: true, color: '#C45B39' },
        { path: '/settings',   icon: IconSettings, label: 'Settings',      show: true, color: '#6B7280' },
      ],
    },
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');

  // ── Avatar ───────────────────────────────────────────────────────────────
  const avatarColor: Record<string, string> = {
    principal:  'bg-[#C45B39] text-white',
    management: 'bg-blue-500 text-white',
    supervisor: 'bg-teal-500 text-white',
    accountant: 'bg-purple-500 text-white',
  };
  const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const go = (path: string) => { navigate(path); setShowQuickAdd(false); onNavigate(); };

  const quickCreateItems = [
    { label: 'New Transaction',    path: '/ledger/new',          icon: IconArrowsExchange, color: '#10B981' },
    { label: 'New Work Order',     path: '/work-orders/new',     icon: IconFileText,       color: '#F59E0B' },
    { label: 'New Purchase Order', path: '/purchase-orders/new', icon: IconShoppingCart,   color: '#3B82F6' },
    { label: 'Raise Bill',         path: '/billing/new',         icon: IconReceipt,        color: '#EF4444' },
    { label: 'New Project',        path: '/projects',            icon: IconBuilding,       color: '#8B5CF6' },
    { label: 'Add Stakeholder',    path: '/stakeholders',        icon: IconUsers,          color: '#06B6D4' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Company identity ─────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 border-b border-outline-variant/15 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-sm bg-[#C45B39] shrink-0" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface leading-none">BRIKLAY</p>
              <p className="text-[11px] text-on-surface-variant/50 leading-tight mt-0.5">Engineering</p>
            </div>
          </div>
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1 rounded-md text-on-surface-variant/40 hover:text-on-surface-variant/70 hover:bg-surface-container transition-colors"
              title="Collapse sidebar"
            >
              <IconMenu2 size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      {/* ── Quick Create ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-1 shrink-0 relative" ref={quickAddRef}>
        <button
          onClick={() => setShowQuickAdd(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 text-[13px] text-on-surface-variant bg-surface-container-lowest border border-outline-variant/40 rounded-lg hover:bg-surface-container transition-colors duration-[120ms]"
        >
          <span className="flex items-center gap-1.5">
            <IconPlus size={14} strokeWidth={2} />
            Quick Create
          </span>
          <IconChevronDown size={14} strokeWidth={2} className={`transition-transform duration-150 ${showQuickAdd ? 'rotate-180' : ''}`} />
        </button>

        {showQuickAdd && (
          <div className="absolute left-4 right-4 top-[calc(100%-4px)] bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-elevation-8 overflow-hidden z-50 popover-animate">
            {quickCreateItems.map(item => (
              <button key={item.path}
                onClick={() => go(item.path)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-on-surface hover:bg-surface-container transition-colors text-left"
              >
                <div style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <item.icon size={12} strokeWidth={2} color="white" />
                </div>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Nav groups ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-1">
        {navGroups.filter(g => g.show).map((group, gi) => {
          const visible = group.items.filter(i => i.show);
          if (visible.length === 0) return null;
          return (
            <div key={group.label} className="nav-group-animate" style={{ animationDelay: `${gi * 40}ms` }}>
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant/40 select-none">
                {group.label}
              </p>
              {visible.map(item => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    className="sidebar-link-v2"
                    style={active ? {
                      backgroundColor: `${item.color}14`,
                      color: item.color,
                      fontWeight: 500,
                    } : undefined}
                  >
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      backgroundColor: item.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon size={15} strokeWidth={1.75} color="white" />
                    </div>
                    <span className="flex-1 leading-none">{item.label}</span>
                    {(item.badge ?? 0) > 0 && (
                      <span
                        className="inline-flex items-center justify-center rounded-full shrink-0"
                        style={{
                          minWidth: 18,
                          height: 18,
                          padding: '0 4px',
                          fontSize: 11,
                          fontWeight: 500,
                          lineHeight: 1,
                          backgroundColor: `${item.color}26`,
                          color: item.color,
                        }}
                      >
                        {(item.badge ?? 0) > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* ── User identity ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-outline-variant/15 px-4 py-3 relative" ref={userMenuRef}>
        <button
          onClick={() => setShowUserMenu(o => !o)}
          className="w-full flex items-center gap-2.5 group rounded-lg p-1 -mx-1 hover:bg-surface-container transition-colors"
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor[role] ?? 'bg-surface-container-high text-on-surface'}`}>
            {initials(profile?.name ?? 'User')}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[13px] font-semibold text-on-surface leading-tight truncate">{profile?.name ?? 'User'}</p>
            <p className="text-[11px] text-on-surface-variant/50 capitalize leading-tight">{role}</p>
          </div>
          <IconDotsVertical size={15} strokeWidth={2} className="text-on-surface-variant/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </button>

        {showUserMenu && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-elevation-8 overflow-hidden z-50 popover-animate">
            <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-on-surface hover:bg-surface-container transition-colors">
              <IconSettings size={15} strokeWidth={1.5} className="text-on-surface-variant/60" />
              My Profile
            </button>
            <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-on-surface hover:bg-surface-container transition-colors">
              <IconShield size={15} strokeWidth={1.5} className="text-on-surface-variant/60" />
              Change Password
            </button>
            <div className="border-t border-outline-variant/20" />
            <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-error hover:bg-error-container/20 transition-colors">
              <IconLogout size={15} strokeWidth={1.5} />
              Sign Out
            </button>
          </div>
        )}
      </div>

    </div>
  );
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
        style={{ width: isOpen ? 220 : 0 }}
        className="hidden md:block fixed left-0 top-0 h-full bg-surface-container-low border-r border-outline-variant/12 z-50 overflow-hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)]"
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
    '/':                    'Dashboard',
    '/inbox':               'Inbox',
    '/ledger':              'Transactions',
    '/ledger/new':          'New Transaction',
    '/projects':            'Projects',
    '/work-orders':         'Work Orders',
    '/work-orders/new':     'New Work Order',
    '/purchase-orders':     'Purchase Orders',
    '/purchase-orders/new': 'New Purchase Order',
    '/billing':             'Billing',
    '/billing/new':         'New Bill',
    '/stakeholders':        'Stakeholders',
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
    { path: '/',       icon: IconLayoutDashboard, label: 'Home',     show: true },
    { path: '/inbox',  icon: IconInbox,           label: 'Inbox',    show: true, badge: inboxBadge },
    { path: '/ledger', icon: IconArrowsExchange,  label: 'Txns',     show: role !== 'supervisor' },
    { path: '/projects', icon: IconBuilding,      label: 'Projects', show: true },
  ].filter(t => t.show);

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-black/[0.08]"
    >
      <div className="flex items-stretch" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(tab => {
          const active = isActive(tab.path);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors relative"
              style={{ minHeight: 56, color: active ? TERRACOTTA : '#9ca3af' }}
            >
              <div className="relative">
                <Icon size={22} strokeWidth={active ? 2 : 1.5} />
                {(tab.badge ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold px-1 leading-none">
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
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
          style={{ minHeight: 56, color: moreActive ? TERRACOTTA : '#9ca3af' }}
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
    { path: '/work-orders',     icon: IconFileText,      label: 'Work Orders',     show: true,                                             color: '#F59E0B' },
    { path: '/purchase-orders', icon: IconShoppingCart,  label: 'Purchase Orders', show: role !== 'supervisor' && role !== 'accountant',   color: '#3B82F6' },
    { path: '/attendance',      icon: IconCalendarStats, label: 'Attendance',      show: true,                                             color: '#14B8A6' },
    { path: '/billing',         icon: IconReceipt,       label: 'Billing',         show: role !== 'supervisor',                            color: '#EF4444' },
    { path: '/stakeholders',    icon: IconUsers,         label: 'Stakeholders',    show: role !== 'supervisor' && role !== 'accountant',   color: '#06B6D4' },
    { path: '/invoices',        icon: IconReceipt,       label: 'Invoices',        show: true,                                             color: '#8B5CF6' },
    { path: '/financials',      icon: IconChartLine,     label: 'Financials',      show: showFinancials,                                   color: '#6366F1' },
    { path: '/cost-codes',      icon: IconListTree,      label: 'Cost Codes',      show: role === 'principal' || role === 'management',    color: '#64748B' },
    { path: '/team',            icon: IconShield,        label: 'Team & Access',   show: role === 'principal' || role === 'management',    color: '#C45B39' },
    { path: '/settings',        icon: IconSettings,      label: 'Settings',        show: true,                                             color: '#6B7280' },
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
                className="w-full flex items-center gap-3 px-4 transition-colors"
                style={{
                  minHeight: 56,
                  backgroundColor: active ? `${TERRACOTTA}08` : undefined,
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} strokeWidth={1.75} color="white" />
                </div>
                <span
                  className="flex-1 text-[15px] text-left"
                  style={{ fontWeight: active ? 600 : 500, color: active ? TERRACOTTA : '#1a1a1a' }}
                >
                  {item.label}
                </span>
                {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: TERRACOTTA }} />}
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
