import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './lib/auth/AuthProvider';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { supabaseAdmin } from './lib/supabase-admin';
import type { Session } from '@supabase/supabase-js';
import { Edit2, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from './types';
import { SnackbarProvider, useSnackbar } from './components/Snackbar';
import { PeekProvider } from './context/PeekContext';
import { CommandBarProvider, useCommandBar } from './context/CommandBarContext';
import { CommandBar } from './components/CommandBar';
import { PageSkeleton } from './components/SkeletonLoader';
import {
  IconLayoutDashboard, IconArrowsExchange,
  IconNotebook, IconClipboardList, IconShoppingBag,
  IconBuildingEstate, IconFileInvoice, IconUsersGroup,
  IconShieldLock, IconAdjustmentsHorizontal,
  IconLayoutSidebarLeftCollapse, IconLayoutSidebar,
  IconSettings, IconLogout, IconChevronDown, IconChevronLeft, IconDots,
  // IconDotsVertical,
  IconRepeat, IconLayoutGrid, IconFiles, IconUsers,
  IconMail, IconMailForward, IconCheck,
} from '@tabler/icons-react';

import Stakeholders from './pages/Stakeholders';
import StakeholderDetail from './pages/StakeholderDetail';
import WorkOrders from './pages/WorkOrders';
import WorkOrderDetail from './pages/WorkOrderDetail';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import ProjectTransactions from './pages/ProjectTransactions';
import ProjectWorkOrders from './pages/ProjectWorkOrders';
import ProjectPurchaseOrders from './pages/ProjectPurchaseOrders';
import ProjectInventory from './pages/ProjectInventory';
import ProjectBOQs from './pages/ProjectBOQs';
import ProjectInward from './pages/ProjectInward';
import NewProjectWizard from './components/NewProjectWizard';
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
import Orders from './pages/Orders';
import InviteAccept from './pages/InviteAccept';
import OnboardingWizard from './components/OnboardingWizard';
import Pending from './pages/Pending';
import CreateWorkspace from './pages/CreateWorkspace';
import { FloatingActionButton } from './components/FloatingActionButton';
import { QuickActionsOverlay } from './components/QuickActionsOverlay';
import { useLongPress } from './hooks/useLongPress';

function SplashLoader() {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9ff' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
        <div style={{ width: '16px', height: '1.5px', background: 'rgba(0,0,0,0.10)', borderRadius: '1px', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#0b1c30', borderRadius: '1px', animation: 'bk-slide 1s ease-in-out infinite' }}/>
        </div>
      </div>
      <style>{`
        @keyframes bk-slide {
          0%   { width: 0%;   margin-left: 0    }
          50%  { width: 100%; margin-left: 0    }
          100% { width: 0%;   margin-left: 100% }
        }
      `}</style>
    </div>
  );
}

function App() {
  const { authState } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const longPress = useLongPress(() => setQuickActionsOpen(true));
  const [routerReady, setRouterReady] = useState(false);

  // Profile query — used for onboarding wizard guard (enabled only when session exists)
  const { data: appProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', session?.user?.id ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', session!.user.id)
        .single();
      if (error) throw error;
      return data as UserProfile;
    },
    enabled: !!session?.user?.id,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Gate: hold rendering until auth is settled and session is available.
  // Critically: distinguish "unauthenticated" (no session ever) from
  // "authenticated but session hasn't arrived from getSession() yet".
  // We do NOT wait for profileFetched â€" the onboarding check uses
  // `if (appProfile && ...)` which is false-safe while loading, avoiding
  // a network round-trip on every refresh just to show the app.
  useEffect(() => {
    if (authState.status === 'loading' || authState.status === 'resolving') return;
    // Unauthenticated â€" no session is coming, nothing to wait for
    if (authState.status === 'unauthenticated') { setRouterReady(true); return; }
    // All other settled states (authenticated, pending, no-org) have a session.
    // Wait for it to arrive from getSession() before unlocking the router.
    if (!session) return;
    setRouterReady(true);
  }, [authState.status, session]);

  // Read local flag to instantly bypass the onboarding check for returning users
  const hasLocalOnboardingFlag = session?.user?.id 
    ? localStorage.getItem(`briklay_onboarding_${session.user.id}`) === 'true'
    : false;

  // Sync profile state to localStorage
  useEffect(() => {
    if (appProfile?.onboarding_done && session?.user?.id) {
      localStorage.setItem(`briklay_onboarding_${session.user.id}`, 'true');
    }
  }, [appProfile?.onboarding_done, session?.user?.id]);

  if (!routerReady) {
    return <SplashLoader />;
  }

  if (location.pathname.startsWith('/invite/')) {
    const token = location.pathname.replace('/invite/', '');
    return <InviteAccept session={session} token={token} />;
  }

  if (location.pathname === '/pending') {
    if (!routerReady) return null;
    if (!session) return <Navigate to="/login" replace />;
    return <Pending session={session} />;
  }

  if (location.pathname === '/create-workspace') {
    if (!routerReady) return null;
    if (!session) return <Navigate to="/login" replace />;
    return <CreateWorkspace session={session} />;
  }

  if (authState.status === 'unauthenticated') return <Login />;
  
  // Guard against rendering the main app layout when we are supposed to redirect
  // to create-workspace or pending, but the router hasn't updated the pathname yet.
  if (authState.status === 'no-org') return null;
  if (authState.status === 'pending') return null;

  if (!session) return null;

  // First-run onboarding for principals
  const isPrincipal = authState.status === 'authenticated' && authState.context.role === 'principal';
  
  // Only show SplashLoader if we MUST know their onboarding state and don't have it locally
  if (isPrincipal && !hasLocalOnboardingFlag && profileLoading) {
    return <SplashLoader />;
  }

  if (isPrincipal && !hasLocalOnboardingFlag && appProfile && !appProfile.onboarding_done) {
    const orgName = authState.status === 'authenticated' ? authState.context.orgName : undefined;
    const orgId   = authState.status === 'authenticated' ? authState.context.orgId   : undefined;
    return (
      <OnboardingWizard
        session={session}
        profile={appProfile}
        orgName={orgName}
        orgId={orgId}
        onComplete={() => {
          localStorage.setItem(`briklay_onboarding_${session.user.id}`, 'true');
          queryClient.setQueryData(
            ['profile', session.user.id],
            (old: UserProfile | undefined) => old ? { ...old, onboarding_done: true } : old
          );
          queryClient.invalidateQueries({ queryKey: ['profile', session.user.id] });
        }}
      />
    );
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
      {/* Desktop reopen button â€" only when sidebar is collapsed */}
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
        {...longPress}
      >
        {/* Mobile topbar (phones only â€" replaces sidebar hamburger) */}
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
          <Route path="/projects/new" element={<NewProjectWizard session={session} />} />
          <Route path="/projects/:projectId" element={<ProjectDetail session={session} />} />
          <Route path="/projects/:projectId/transactions" element={<ProjectTransactions session={session} />} />
          <Route path="/projects/:projectId/work-orders" element={<ProjectWorkOrders session={session} />} />
          <Route path="/projects/:projectId/purchase-orders" element={<ProjectPurchaseOrders session={session} />} />
          <Route path="/projects/:projectId/inventory" element={<ProjectInventory session={session} />} />
          <Route path="/projects/:projectId/boqs" element={<ProjectBOQs session={session} />} />
          <Route path="/projects/:projectId/inward" element={<ProjectInward session={session} />} />
          <Route path="/stakeholders" element={<Stakeholders session={session} />} />
          <Route path="/stakeholders/:stakeholderId" element={<StakeholderDetail session={session} />} />
          <Route path="/orders" element={<Orders session={session} />} />
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

      {/* Bottom tab bar â€" mobile only */}
      <BottomTabBar session={session} onMoreTap={() => setShowMoreSheet(true)} />

      {/* More nav sheet â€" mobile only */}
      <MoreNavSheet
        session={session}
        isOpen={showMoreSheet}
        onClose={() => setShowMoreSheet(false)}
      />

      {/* FAB â€" mobile only */}
      <FloatingActionButton />

      {/* Long-press quick actions overlay â€" mobile only */}
      <QuickActionsOverlay isOpen={quickActionsOpen} onClose={() => setQuickActionsOpen(false)} />
    </div>

    {/* Command bar â€" rendered outside the scroll container, above everything */}
    <CommandBar />
    <GlobalShortcuts />

    </CommandBarProvider>
    </PeekProvider>
    </SnackbarProvider>
  );
}

// â"€â"€ Nav shortcut helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const SHORTCUT_LETTERS: Record<string, string> = {
  '/ledger':          'T',
  '/work-orders':     'W',
  '/purchase-orders': 'P',
  '/logbook':         'L',
};

const NAV_TOOLTIPS: Record<string, { shortcut: string | null; description: string }> = {
  '/ledger':          { shortcut: 'T', description: 'All payments made â€" workers, vendors, expenses' },
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

// â"€â"€ Sidebar content â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [orgName, setOrgName] = useState<string>('');
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

  useEffect(() => {
    if (!profile?.org_id) return;
    supabase
      .from('organizations')
      .select('name')
      .eq('org_id', profile.org_id)
      .single()
      .then(({ data }) => { if (data?.name) setOrgName(data.name); });
  }, [profile?.org_id]);



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
      label: '',
      show: true,
      items: [
        { path: '/ledger',          icon: IconArrowsExchange, label: 'Transactions',    show: role !== 'supervisor',                          accent: true },
        { path: '/work-orders',     icon: IconClipboardList,  label: 'Work Orders',     show: true,                                           badge: woPendingCount },
        { path: '/purchase-orders', icon: IconShoppingBag,    label: 'Purchase Orders', show: role !== 'supervisor' && role !== 'accountant', badge: poUntalliedCount },
        { path: '/logbook',         icon: IconNotebook,       label: 'Logbook',         show: true,                                           badge: inboxBadgeCount },
        { path: '/stakeholders',    icon: IconUsersGroup,     label: 'Parties',         show: role !== 'supervisor' && role !== 'accountant' },
      ],
    },
    {
      label: '',
      show: role !== 'supervisor',
      items: [
        { path: '/billing',    icon: IconFileInvoice,     label: 'Client Billing', show: role !== 'supervisor', badge: billOverdueCount },
        { path: '/dashboard',  icon: IconLayoutDashboard, label: 'Dashboard',      show: true },
      ],
    },
    {
      label: 'WORKSPACE',
      show: role === 'principal' || role === 'management',
      items: [
        { path: '/team',     icon: IconShieldLock,             label: 'Team & Access', show: true },
        { path: '/settings', icon: IconAdjustmentsHorizontal,  label: 'Settings',      show: true },
      ],
    },
  ];

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');

  const initials = (name: string) =>
    name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const handleLogout = async () => { await supabase.auth.signOut(); };
  const go = (path: string) => { navigate(path); setShowQuickAdd(false); onNavigate(); };

  const quickCreateItems = [
    { label: 'New Transaction',    path: '/ledger/new',          icon: IconArrowsExchange },
    { label: 'New Work Order',     path: '/work-orders/new',     icon: IconClipboardList },
    { label: 'New Purchase Order', path: '/purchase-orders/new', icon: IconShoppingBag },
    { label: 'Raise Bill',         path: '/billing/new',         icon: IconFileInvoice },
    { label: 'New Project',        path: '/projects/new',        icon: IconBuildingEstate },
    { label: 'Add Stakeholder',    path: '/stakeholders',        icon: IconUsersGroup },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--nav-bg)' }}>

      {/* â"€â"€ Company identity â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div style={{ height: 56, padding: '0 16px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--nav-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{ width: 8, height: 8, background: 'var(--nav-accent)', transform: 'rotate(45deg)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--nav-text-active)' }}>
            {orgName || 'Briklay'}
          </span>
        </div>
      </div>

      {/* â"€â"€ + New button â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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

      {/* â"€â"€ Nav groups â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 0 4px' }} className="no-scrollbar">

        {/* â"€â"€ Context detection: project sub-nav vs global nav â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
        {(() => {
          const projMatch = location.pathname.match(/^\/projects\/([^/]+)/);
          const activeProjectId = projMatch?.[1];
          const isNewProject = activeProjectId === 'new';

          if (activeProjectId && !isNewProject) {
            // â"€â"€ Project context nav â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
            const activeProj = sidebarProjects.find(p => p.project_id === activeProjectId);
            const projName = activeProj?.name ?? 'â€¦';
            const base = `/projects/${activeProjectId}`;

            const projectNavItems = [
              { path: base,                       icon: 'grid_view',             label: 'Overview' },
              { path: `${base}/transactions`,     icon: 'swap_horiz',            label: 'Transactions' },
              { path: `${base}/work-orders`,      icon: 'assignment',            label: 'Work Orders' },
              { path: `${base}/purchase-orders`,  icon: 'shopping_bag',          label: 'Purchase Orders' },
              { path: `${base}/inventory`,        icon: 'inventory_2',           label: 'Inventory' },
              { path: `${base}/boqs`,             icon: 'format_list_numbered',  label: 'BOQs' },
              { path: `${base}/inward`,           icon: 'local_shipping',        label: 'Inward Register' },
            ];

            return (
              <>
                {/* Back link */}
                <div style={{ padding: '10px 12px 4px' }}>
                  <Link to="/projects" onClick={onNavigate}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, fontSize: 12, color: 'var(--nav-text-muted)', textDecoration: 'none', transition: 'color 100ms' }}
                    onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-active)'}
                    onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-muted)'}>
                    <IconChevronLeft size={13} strokeWidth={1.5} />
                    All Projects
                  </Link>
                </div>

                {/* Project title */}
                <div style={{ padding: '6px 20px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--nav-accent)', flexShrink: 0 }} />
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--nav-text-active)', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {projName}
                    </p>
                  </div>
                </div>

                <div style={{ height: 1, background: 'var(--nav-border)', margin: '0 12px 6px' }} />

                {/* Project nav items */}
                {projectNavItems.map(item => {
                  const exact = item.path === base;
                  const active = exact
                    ? location.pathname === base
                    : location.pathname.startsWith(item.path);
                  return (
                    <Link key={item.path} to={item.path} onClick={onNavigate} className="nav-item" data-active={active}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, color: active ? 'var(--nav-accent)' : 'inherit' }}>{item.icon}</span>
                      <span style={{ flex: 1, lineHeight: 1 }}>{item.label}</span>
                    </Link>
                  );
                })}
              </>
            );
          }

          // ── Global nav ────────────────────────────────────────────────────

          // Deterministic project avatar color from name
          const PROJ_PALETTE = ['#B5601A','#2A7A6E','#4A6FA8','#7B4EA0','#8C7327','#B03060'];
          const projColor = (name: string) => PROJ_PALETTE[name.charCodeAt(0) % PROJ_PALETTE.length];
          const projInitials = (name: string) =>
            name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

          const renderNavItem = (item: NavItem) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <NavTooltip key={item.path} href={item.path}>
                <Link to={item.path} onClick={onNavigate} className="nav-item" data-active={active}>
                  <Icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                  <NavLabel label={item.label} href={item.path} isActive={active} />
                  {(item.badge ?? 0) > 0 && (
                    <span className="nav-badge-mono">{(item.badge ?? 0) > 9 ? '9+' : item.badge}</span>
                  )}
                </Link>
              </NavTooltip>
            );
          };

          const SHOW_LIMIT = 7;
          const visibleProjects = sidebarProjects.slice(0, SHOW_LIMIT);
          const hiddenCount = sidebarProjects.length - SHOW_LIMIT;

          return (
            <>
              {/* ── PROJECTS section ────────────────────────────────── */}
              <div style={{ padding: '10px 0 2px' }}>

                {/* Section header row — click to collapse */}
                <button
                  onClick={() => setProjectsExpanded(o => !o)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 5,
                    padding: '0 12px 0 10px', height: 26,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                  }}
                >
                  <IconChevronDown
                    size={11} strokeWidth={2.5}
                    style={{
                      color: 'var(--nav-text-muted)', flexShrink: 0,
                      transition: 'transform 180ms cubic-bezier(0.4,0,0.6,1)',
                      transform: projectsExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}
                  />
                  <span style={{
                    flex: 1, textAlign: 'left', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.09em', textTransform: 'uppercase',
                    color: 'var(--nav-text-muted)', userSelect: 'none',
                  }}>
                    Projects
                  </span>
                  {sidebarProjects.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, lineHeight: '15px',
                      color: 'var(--nav-text-muted)',
                      background: 'rgba(0,0,0,0.06)',
                      borderRadius: 10, padding: '0 5px',
                    }}>
                      {sidebarProjects.length}
                    </span>
                  )}
                  {/* + Add new project */}
                  <Link
                    to="/projects/new"
                    onClick={e => { e.stopPropagation(); onNavigate(); }}
                    style={{
                      width: 20, height: 20,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 5, color: 'var(--nav-text-muted)',
                      fontSize: 17, fontWeight: 300, lineHeight: 1,
                      textDecoration: 'none', transition: 'background 80ms, color 80ms',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(0,0,0,0.07)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-accent)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-muted)'; }}
                  >
                    +
                  </Link>
                </button>

                {/* Collapsible project list */}
                <div style={{
                  overflow: 'hidden',
                  maxHeight: projectsExpanded ? 600 : 0,
                  transition: 'max-height 220ms cubic-bezier(0.4,0,0.6,1)',
                }}>
                  {sidebarProjects.length === 0 ? (
                    <Link
                      to="/projects/new"
                      onClick={onNavigate}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '5px 12px 5px 28px',
                        fontSize: 12, color: 'var(--nav-text-muted)',
                        textDecoration: 'none', fontStyle: 'italic',
                        transition: 'color 80ms',
                      }}
                    >
                      + Create first project
                    </Link>
                  ) : (
                    <>
                      {visibleProjects.map(proj => {
                        const path = `/projects/${proj.project_id}`;
                        const active = isActive(path);
                        const color = projColor(proj.name);
                        const mono = projInitials(proj.name);
                        return (
                          <Link
                            key={proj.project_id}
                            to={path}
                            onClick={onNavigate}
                            className="nav-item"
                            data-active={active}
                          >
                            {/* Monogram avatar */}
                            <div style={{
                              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                              background: active ? color : `${color}22`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 8, fontWeight: 800, letterSpacing: '-0.02em',
                              color: active ? '#fff' : color,
                              transition: 'background 100ms',
                              userSelect: 'none',
                            }}>
                              {mono}
                            </div>
                            <span style={{ flex: 1, lineHeight: 1 }}>{proj.name}</span>
                          </Link>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <Link
                          to="/projects"
                          onClick={onNavigate}
                          style={{
                            display: 'block', padding: '4px 12px 4px 36px',
                            fontSize: 11, color: 'var(--nav-text-muted)',
                            textDecoration: 'none', transition: 'color 80ms',
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-default)'}
                          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-muted)'}
                        >
                          +{hiddenCount} more
                        </Link>
                      )}
                    </>
                  )}

                  {/* All Projects footer link */}
                  <Link
                    to="/projects"
                    onClick={onNavigate}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '4px 12px 8px 28px',
                      fontSize: 11, color: 'var(--nav-text-muted)',
                      textDecoration: 'none', transition: 'color 80ms',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-default)'}
                    onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nav-text-muted)'}
                  >
                    All Projects →
                  </Link>
                </div>
              </div>

              {/* ── Divider ── */}
              <div style={{ height: 1, background: 'var(--nav-border)', margin: '2px 12px 4px' }} />

              {/* ── Primary nav (Txns, WOs, POs, Parties, Logbook) ── */}
              {navGroups[0].items.filter(i => i.show).map(renderNavItem)}

              {/* ── Divider ── */}
              {navGroups[1].show && navGroups[1].items.some(i => i.show) && (
                <div style={{ height: 1, background: 'var(--nav-border)', margin: '4px 12px' }} />
              )}

              {/* ── Secondary nav (Billing, Dashboard) ── */}
              {navGroups[1].show && navGroups[1].items.filter(i => i.show).map(renderNavItem)}

              {/* ── WORKSPACE section ── */}
              {(role === 'principal' || role === 'management') && (
                <>
                  <div style={{ height: 1, background: 'var(--nav-border)', margin: '4px 12px 2px' }} />
                  <p style={{
                    padding: '8px 16px 4px',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
                    textTransform: 'uppercase', color: 'var(--nav-text-muted)',
                    userSelect: 'none',
                  }}>
                    Workspace
                  </p>
                  {navGroups[2].items.filter(i => i.show).map(item => {
                    const Icon = item.icon;
                    const active = isActive(item.path);
                    return (
                      <Link key={item.path} to={item.path} onClick={onNavigate} className="nav-item" data-active={active}>
                        <Icon size={16} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, lineHeight: 1 }}>{item.label}</span>
                      </Link>
                    );
                  })}
                </>
              )}
            </>
          );
        })()}
      </nav>

      {/* â"€â"€ Collapse trigger â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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

      {/* â"€â"€ User identity â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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

// â"€â"€ Global keyboard shortcuts â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function GlobalShortcuts() {
  const { open } = useCommandBar();
  useGlobalShortcuts(open);
  return null;
}

// â"€â"€ Sidebar shell â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
      {/* Desktop â€" animated width (220px â†" 0px) */}
      <aside
        style={{ width: isOpen ? 220 : 0, background: 'var(--nav-bg)' }}
        className="hidden md:block fixed left-0 top-0 h-full z-50 overflow-hidden transition-[width] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)]"
      >
        {/* Inner wrapper keeps content at full width so it doesn't squish during animation */}
        <div style={{ width: 220, height: '100%' }}>
          <SidebarContent session={session} onNavigate={() => {}} onCollapse={onToggle} />
        </div>
      </aside>

      {/* Mobile drawer â€" hidden on phones (bottom tab bar handles mobile nav) */}
      {/* Kept for tablet use if needed, but currently not triggered on mobile */}
    </>
  );
}

// â"€â"€ Mobile helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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

  const isActivePath = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(path + '/');

  // Detect project context
  const projMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId = projMatch?.[1];
  const isInProject = !!(activeProjectId && activeProjectId !== 'new');

  // ── Project context bottom bar ─────────────────────────────────────────
  if (isInProject) {
    const base = `/projects/${activeProjectId}`;
    const isOverview  = location.pathname === base;
    const isTxns      = location.pathname.startsWith(`${base}/transactions`);
    const isWOs       = location.pathname.startsWith(`${base}/work-orders`);
    const isPOs       = location.pathname.startsWith(`${base}/purchase-orders`);
    const isOther     = !isOverview && !isTxns && !isWOs && !isPOs; // inventory, boqs, inward

    return (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white"
        style={{ borderTop: '0.5px solid var(--nav-border)', height: 60 }}
      >
        <div className="flex items-stretch h-full" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>

          {/* ← Back to all projects */}
          <Link
            to="/projects"
            className="flex flex-col items-center justify-center gap-0.5"
            style={{ color: 'var(--nav-text-muted)', minWidth: 52, paddingLeft: 4, paddingRight: 4 }}
          >
            <div className="flex items-center gap-0.5">
              <IconChevronLeft size={16} strokeWidth={2} />
            </div>
            <span className="text-[9px] font-medium leading-none" style={{ letterSpacing: '0.02em' }}>Projects</span>
          </Link>

          {/* Thin separator */}
          <div style={{ width: 1, background: 'var(--nav-border)', margin: '12px 0', flexShrink: 0 }} />

          {/* Overview */}
          <Link to={base} className="flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{ color: isOverview ? TERRACOTTA : 'var(--nav-text-muted)' }}>
            <IconLayoutGrid size={20} strokeWidth={isOverview ? 2 : 1.5} />
            <span className="text-[10px] font-medium leading-none">Overview</span>
          </Link>

          {/* Transactions */}
          <Link to={`${base}/transactions`} className="flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{ color: isTxns ? TERRACOTTA : 'var(--nav-text-muted)' }}>
            <IconArrowsExchange size={20} strokeWidth={isTxns ? 2 : 1.5} />
            <span className="text-[10px] font-medium leading-none">Txns</span>
          </Link>

          {/* Work Orders */}
          <Link to={`${base}/work-orders`} className="flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{ color: isWOs ? TERRACOTTA : 'var(--nav-text-muted)' }}>
            <IconClipboardList size={20} strokeWidth={isWOs ? 2 : 1.5} />
            <span className="text-[10px] font-medium leading-none">W.Orders</span>
          </Link>

          {/* Purchase Orders */}
          <Link to={`${base}/purchase-orders`} className="flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{ color: isPOs ? TERRACOTTA : 'var(--nav-text-muted)' }}>
            <IconShoppingBag size={20} strokeWidth={isPOs ? 2 : 1.5} />
            <span className="text-[10px] font-medium leading-none">POs</span>
          </Link>

          {/* More — active when on Inventory / BOQs / Inward */}
          <button
            onClick={onMoreTap}
            className="flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{ color: isOther ? TERRACOTTA : 'var(--nav-text-muted)' }}
          >
            <IconDots size={20} strokeWidth={isOther ? 2 : 1.5} />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>

        </div>
      </nav>
    );
  }

  // ── Global context bottom bar ──────────────────────────────────────────
  const isOrdersActive = isActivePath('/orders') || isActivePath('/purchase-orders') || isActivePath('/work-orders');
  const moreActive = ['/billing', '/team', '/settings', '/logbook', '/invoices'].some(p => isActivePath(p));

  type Tab = { path: string; icon: React.ElementType; label: string; show: boolean };
  const tabs: Tab[] = [
    { path: '/ledger',       icon: IconRepeat,     label: 'Txns',     show: role !== 'supervisor' },
    { path: '/projects',     icon: IconLayoutGrid, label: 'Projects', show: true },
    { path: '/orders',       icon: IconFiles,      label: 'Orders',   show: true },
    { path: '/stakeholders', icon: IconUsers,      label: 'Parties',  show: role !== 'supervisor' && role !== 'accountant' },
  ].filter(t => t.show);

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white"
      style={{ borderTop: '0.5px solid var(--nav-border)', height: 60 }}
    >
      <div className="flex items-stretch h-full" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {tabs.map(tab => {
          const active = tab.path === '/orders' ? isOrdersActive : isActivePath(tab.path);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className="flex-1 flex flex-col items-center justify-center gap-0.5"
              style={{ color: active ? '#000' : 'var(--nav-text-muted)' }}
            >
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={onMoreTap}
          className="flex-1 flex flex-col items-center justify-center gap-0.5"
          style={{ color: moreActive ? '#000' : 'var(--nav-text-muted)' }}
        >
          <IconDots size={20} strokeWidth={moreActive ? 2 : 1.5} />
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

  const isActivePath = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const go = (path: string) => { navigate(path); onClose(); };

  // Detect if we're in a project context — show project sub-pages in More sheet
  const projMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId = projMatch?.[1];
  const isInProject = !!(activeProjectId && activeProjectId !== 'new');

  // Project More items: the less-frequent project sub-pages
  const base = activeProjectId ? `/projects/${activeProjectId}` : '';
  const projectMoreItems = isInProject ? [
    { path: base,                    icon: IconLayoutGrid,            label: 'Overview',        show: true },
    { path: `${base}/inventory`,     icon: IconFiles,                 label: 'Inventory',       show: true },
    { path: `${base}/boqs`,          icon: IconClipboardList,         label: 'BOQs',            show: true },
    { path: `${base}/inward`,        icon: IconShoppingBag,           label: 'Inward Register', show: true },
    { path: '/dashboard',            icon: IconLayoutDashboard,       label: 'Dashboard',       show: true },
  ] : [];

  // Global More items (used outside project context)
  const globalItems = [
    { path: '/logbook',  icon: IconNotebook,              label: 'Logbook',       show: true },
    { path: '/billing',  icon: IconFileInvoice,           label: 'Client Billing', show: role !== 'supervisor' },
    { path: '/dashboard',icon: IconLayoutDashboard,       label: 'Dashboard',     show: true },
    { path: '/team',     icon: IconShieldLock,            label: 'Team & Access', show: role === 'principal' || role === 'management' },
    { path: '/settings', icon: IconAdjustmentsHorizontal, label: 'Settings',      show: true },
  ].filter(i => i.show);

  const items = isInProject ? projectMoreItems.filter(i => i.show) : globalItems;
  const sheetTitle = isInProject ? 'Project' : 'More';

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
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant/40">{sheetTitle}</p>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {items.map(item => {
            const Icon = item.icon;
            const active = isActivePath(item.path);
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
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get('redirect');

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
      if (error) {
        setError(error.message);
      } else if (redirectTo) {
        // Return user to the page that required auth (e.g. /invite/[token])
        navigate(redirectTo, { replace: true });
      }
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



type PendingInvite = {
  invite_id: string; email: string; role: string;
  token: string; created_at: string; expires_at: string;
};

function timeLeft(expiresAt: string): { label: string; urgent: boolean } {
  const hours = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 3_600_000);
  if (hours < 1)  return { label: 'Expires soon', urgent: true };
  if (hours < 24) return { label: `${hours}h left`,              urgent: true };
  return           { label: `${Math.floor(hours / 24)}d left`,   urgent: false };
}

function Team({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { orgId } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // â"€â"€ Invite form state â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState('supervisor');
  const [inviteLink, setInviteLink]   = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiedId, setCopiedId]       = useState<string | null>(null);
  
  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ['team', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_memberships')
        .select(`
          role,
          status,
          joined_at,
          user_profiles (id, name, assigned_projects, created_at)
        `)
        .eq('org_id', profile!.org_id!)
        .eq('status', 'active')
        .order('joined_at', { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .filter(r => r.user_profiles !== null)
        .map(r => ({
          id:                (r.user_profiles as any).id as string,
          name:              (r.user_profiles as any).name as string,
          role:              r.role as UserProfile['role'],
          assigned_projects: ((r.user_profiles as any).assigned_projects ?? []) as string[],
          created_at:        (r.user_profiles as any).created_at as string,
        } satisfies UserProfile));
    },
    enabled: (profile?.role === 'management' || profile?.role === 'principal') && !!profile?.org_id,
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

  const isAdmin = profile?.role === 'management' || profile?.role === 'principal';

  const { data: pendingInvites = [], refetch: refetchInvites } = useQuery({
    queryKey: ['pending_invites', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_invites')
        .select('invite_id, email, role, token, created_at, expires_at')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingInvite[];
    },
    enabled: isAdmin && !!orgId,
    staleTime: 30_000,
  });

  const { show: showSnackbar } = useSnackbar();

  const copyLink = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sendInvite = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('Organisation not loaded â€" refresh and try again');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail))
        throw new Error('Enter a valid email address');
      const { data, error } = await supabase
        .rpc('create_invite', {
          p_org_id:     orgId,
          p_email:      inviteEmail.trim().toLowerCase(),
          p_role:       inviteRole,
          p_invited_by: session.user.id,
        })
        .single();
      if (error) throw error;
      const row = data as { invite_id: string; token: string; success: boolean; error: string | null };
      if (!row.success) throw new Error(row.error ?? 'Failed to create invite');
      return row;
    },
    onSuccess: (data) => {
      setInviteLink(`${window.location.origin}/invite/${data.token}`);
      setInviteError(null);
      refetchInvites();
    },
    onError: (err: any) => { setInviteError(err.message ?? 'Failed'); setInviteLink(null); },
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.from('org_invites').update({ status: 'revoked' }).eq('invite_id', inviteId);
      if (error) throw error;
    },
    onSuccess: () => { refetchInvites(); showSnackbar('Invite revoked'); },
    onError: (err: any) => showSnackbar(err.message ?? 'Failed to revoke', { type: 'error' }),
  });

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

      const orgId = profile?.org_id;
      if (!orgId) throw new Error('Cannot determine organisation — refresh the page and try again.');

      // Atomically: sync user_profiles.role + upsert org_memberships in one transaction.
      const { data: finalizeData, error: finalizeError } = await supabase.rpc('finalize_new_member', {
        p_user_id: authData.user.id,
        p_org_id:  orgId,
        p_role:    role,
      });
      if (finalizeError) throw finalizeError;
      if (!finalizeData?.success) throw new Error(finalizeData?.error ?? 'Failed to set up user account');

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

      {/* â"€â"€ A. Invite form â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {isAdmin && (
        <div className="mb-5 rounded-2xl overflow-hidden border border-black/[0.06]" style={{ background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#C8603A 0%,#E8956D 100%)' }} />
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(200,96,58,0.1)' }}>
                <IconMailForward size={17} style={{ color: '#C8603A' }} strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-on-surface leading-tight">Invite a team member</p>
                <p className="text-[12px] text-on-surface-variant/55 mt-0.5">Send a secure join link â€" no password needed</p>
              </div>
            </div>

            {inviteLink ? (
              <div className="rounded-xl p-4 transition-all" style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.18)' }}>
                    <IconCheck size={11} style={{ color: '#16a34a' }} strokeWidth={3} />
                  </div>
                  <span className="text-[13px] font-semibold" style={{ color: '#15803d' }}>Invite ready</span>
                </div>
                <p className="text-[12px] mb-2.5" style={{ color: 'rgba(0,0,0,0.5)' }}>
                  Copy and share with <span className="font-medium text-on-surface">{inviteEmail}</span>
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 rounded-lg text-[11px] font-mono truncate" style={{ background: 'white', border: '1px solid rgba(0,0,0,0.09)', color: 'rgba(0,0,0,0.6)' }}>
                    {inviteLink}
                  </div>
                  <button
                    onClick={() => copyLink(inviteLink, 'new')}
                    className="px-4 py-2 rounded-lg text-[12px] font-semibold transition-all"
                    style={{ background: copiedId === 'new' ? '#16a34a' : '#C8603A', color: 'white', whiteSpace: 'nowrap', minWidth: 72 }}
                  >
                    {copiedId === 'new' ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
                <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                  <span className="text-[11px]" style={{ color: 'rgba(0,0,0,0.35)' }}>Expires in 7 days</span>
                  <button
                    onClick={() => { setInviteLink(null); setInviteEmail(''); setInviteError(null); }}
                    className="text-[12px] font-semibold transition-colors hover:opacity-80"
                    style={{ color: '#C8603A' }}
                  >
                    Invite another â†'
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col md:flex-row gap-2.5">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteError(null); }}
                    placeholder="colleague@company.com"
                    className="flex-1 px-4 rounded-xl text-[14px] outline-none transition-all"
                    style={{ height: 44, border: `1.5px solid ${inviteError ? '#ef4444' : 'rgba(0,0,0,0.11)'}`, background: 'rgba(0,0,0,0.02)' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#C8603A'; e.currentTarget.style.background = 'white'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(200,96,58,0.1)'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = inviteError ? '#ef4444' : 'rgba(0,0,0,0.11)'; e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; e.currentTarget.style.boxShadow = 'none'; }}
                    onKeyDown={e => { if (e.key === 'Enter') sendInvite.mutate(); }}
                  />
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value)}
                    className="px-3 rounded-xl text-[14px] outline-none cursor-pointer"
                    style={{ height: 44, minWidth: 148, border: '1.5px solid rgba(0,0,0,0.11)', background: 'rgba(0,0,0,0.02)' }}
                  >
                    <option value="supervisor">Supervisor</option>
                    <option value="accountant">Accountant</option>
                    <option value="management">Management</option>
                  </select>
                </div>
                {inviteError && <p className="text-[12px] mt-1.5" style={{ color: '#ef4444' }}>{inviteError}</p>}
                <button
                  onClick={() => sendInvite.mutate()}
                  disabled={sendInvite.isPending || !inviteEmail.trim()}
                  className="mt-3 flex items-center gap-2 px-5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40 hover:opacity-90 active:scale-[0.98]"
                  style={{ height: 44, background: '#C8603A', color: 'white' }}
                >
                  {sendInvite.isPending
                    ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Sendingâ€¦</>
                    : <><IconMailForward size={15} strokeWidth={2} />Send invite</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* â"€â"€ B. Pending invites â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {isAdmin && pendingInvites.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'rgba(0,0,0,0.38)' }}>Pending invites</p>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: '#C8603A' }}>{pendingInvites.length}</span>
          </div>
          <div className="space-y-2">
            {pendingInvites.map(inv => {
              const tl   = timeLeft(inv.expires_at);
              const link = `${window.location.origin}/invite/${inv.token}`;
              return (
                <div
                  key={inv.invite_id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                  style={{ background: 'white', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(200,96,58,0.08)' }}>
                    <IconMail size={14} style={{ color: '#C8603A' }} strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-on-surface truncate">{inv.email}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="px-2 py-px rounded-full text-[10px] font-semibold capitalize" style={{ background: 'rgba(59,130,246,0.1)', color: '#1d4ed8' }}>
                        {inv.role}
                      </span>
                      <span className="text-[11px]" style={{ color: tl.urgent ? '#f59e0b' : 'rgba(0,0,0,0.35)' }}>{tl.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => copyLink(link, inv.invite_id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                      style={{ background: copiedId === inv.invite_id ? 'rgba(34,197,94,0.1)' : 'rgba(0,0,0,0.04)', color: copiedId === inv.invite_id ? '#16a34a' : 'rgba(0,0,0,0.5)' }}
                    >
                      {copiedId === inv.invite_id ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={() => { if (confirm(`Revoke invite for ${inv.email}?`)) revokeInvite.mutate(inv.invite_id); }}
                      disabled={revokeInvite.isPending}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all hover:bg-red-50 disabled:opacity-40"
                      style={{ color: '#ef4444' }}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
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
        {teamLoading && <div className="mb-4"><PageSkeleton /></div>}
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

  if (isLoading || !profile) return <div className="p-4 md:p-8"><PageSkeleton /></div>;

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
