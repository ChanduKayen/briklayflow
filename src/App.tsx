import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './lib/auth/AuthProvider';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
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
  IconChartPie, IconArrowsExchange,
  IconNotebook, IconClipboardList, IconShoppingBag,
  IconFileInvoice,
  IconShieldLock, IconAdjustmentsHorizontal,
  IconLogout, IconChevronLeft, IconDots,
  IconRepeat, IconLayoutGrid, IconFiles, IconUsers,
  IconMail, IconMailForward, IconCheck, IconBarcode,
  IconCircleDot, IconClock, IconFileText,
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
import InwardRegister from './pages/InwardRegister';
import NewProjectWizard from './components/NewProjectWizard';
import TransactionDetail from './pages/TransactionDetail';
import PurchaseOrders from './pages/PurchaseOrders';
import NewPurchaseOrder from './pages/NewPurchaseOrder';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import Ledger from './pages/Ledger';
import NewTransaction from './pages/NewTransaction';
import Insights from './pages/Insights';
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
import { BriklayDesktopNav } from './components/nav/BriklayRail';
import Orders from './pages/Orders';
import InviteAccept from './pages/InviteAccept';
import OnboardingWizard from './components/OnboardingWizard';
import Pending from './pages/Pending';
import Welcome from './pages/Welcome';
import CreateWorkspace from './pages/CreateWorkspace';
import Login from './pages/Login';
import Landing from './pages/Landing';
import SKUDirectory from './pages/SKUDirectory';
import ProcurementRequests from './pages/ProcurementRequests';
import ProcurementQuotes from './pages/ProcurementQuotes';
import ProcurementOrders from './pages/ProcurementOrders';
import { FloatingActionButton } from './components/FloatingActionButton';
import { QuickActionsOverlay } from './components/QuickActionsOverlay';
import { useLongPress } from './hooks/useLongPress';
import BottomSheet from './components/BottomSheet';
import GlobalRefetchIndicator from './components/GlobalRefetchIndicator';
import { clearPersistedCache } from './lib/queryClient';
import { useBadgeRealtime } from './hooks/useBadgeRealtime';

// ── Sign-out overlay: portal-based, self-contained, network-resilient ────────
//
// Design principle: the overlay owns its full visual lifecycle and calls
// supabase.auth.signOut() itself at the right moment, completely decoupled
// from React's render tree. A portal renders it into document.body so it
// persists across auth state changes (authenticated → unauthenticated) without
// being unmounted mid-animation.
//
// Timeline (total ~1 350 ms):
//  0 ms  — mount; overlay invisible, app content begins receding
//  40 ms — overlay fades in (500 ms ease)
// 420 ms — center logo + "Signing out" fades in
// 700 ms — supabase.auth.signOut() fires (network; non-blocking visually)
// 900 ms — center content fades out, overlay starts fading out (380 ms ease)
// 1 280 ms — onDismiss() called — signingOut=false, overlay unmounts (invisible)

// Calls the admin-users edge function (privileged auth.admin ops run server-side
// with the service-role key in function secrets — never in the browser). Surfaces
// the function's error message whether it arrives as a 2xx body or an HTTP error.
async function invokeAdminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as any).context;
      const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
      if (parsed?.error) message = parsed.error;
    } catch { /* fall back to error.message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

type SignOutCtx = { triggerSignOut: () => void };
const SignOutContext = createContext<SignOutCtx>({ triggerSignOut: () => {} });
export function useSignOut() { return useContext(SignOutContext); }

function SignOutOverlay({ onDismiss }: { onDismiss: () => void }) {
  const [fade, setFade]       = useState<'in' | 'visible' | 'out'>('in');
  const [showMark, setShowMark] = useState(false);

  useEffect(() => {
    const ts = [
      // Start fade-in on next paint
      setTimeout(() => setFade('visible'),   40),
      // Reveal center mark once overlay is mostly opaque
      setTimeout(() => setShowMark(true),   420),
      // Fire the actual sign-out (non-blocking; Login page mounts behind overlay).
      // Clear persisted query cache so a different user on the same device
      // doesn't hydrate the previous user's data.
      setTimeout(() => {
        clearPersistedCache();
        supabase.auth.signOut().catch(() => {});
      }, 700),
      // Begin dissolve
      setTimeout(() => { setShowMark(false); setFade('out'); }, 900),
      // Unmount after dissolve completes
      setTimeout(() => onDismiss(), 1280),
    ];
    return () => ts.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opacity = fade === 'visible' ? 1 : 0;
  const transition =
    fade === 'in'  ? 'opacity 500ms cubic-bezier(0.4,0,0.2,1)'
  : fade === 'out' ? 'opacity 380ms cubic-bezier(0.4,0,0.2,1)'
  : 'none';

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#fdfdfc',
        opacity, transition,
        pointerEvents: 'all',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Soft ambient warmth — mirrors Login page
        backgroundImage: [
          'radial-gradient(ellipse 60% 50% at 25% 20%, rgba(255,238,217,0.55) 0%, transparent 70%)',
          'radial-gradient(ellipse 55% 55% at 75% 80%, rgba(224,242,254,0.45) 0%, transparent 70%)',
        ].join(', '),
      }}
    >
      {/* Center mark */}
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
          opacity: showMark ? 1 : 0,
          transform: showMark ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity 380ms cubic-bezier(0.4,0,0.2,1), transform 380ms cubic-bezier(0.4,0,0.2,1)',
          userSelect: 'none', pointerEvents: 'none',
        }}
      >
        {/* Briklay diamond — breathing pulse */}
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none"
          style={{ animation: 'bk-so-pulse 1.8s ease-in-out infinite', opacity: 0.18 }}
        >
          <path d="M12 2L2 7L12 12L22 7L12 2Z"  stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 17L12 22L22 17"            stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M2 12L12 17L22 12"            stroke="#0b1c30" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
        {/* Minimal progress bar */}
        <div style={{ width: 32, height: 1.5, background: 'rgba(11,28,48,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: 'rgba(11,28,48,0.25)', borderRadius: 2,
            animation: showMark ? 'bk-so-bar 900ms cubic-bezier(0.4,0,0.2,1) forwards' : 'none',
          }} />
        </div>
      </div>

      <style>{`
        @keyframes bk-so-pulse {
          0%, 100% { opacity: 0.12; transform: scale(1);    }
          50%       { opacity: 0.22; transform: scale(1.08); }
        }
        @keyframes bk-so-bar {
          0%   { width: 0%   }
          100% { width: 100% }
        }
      `}</style>
    </div>,
    document.body
  );
}

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
  const [signingOut, setSigningOut] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const longPress = useLongPress(() => setQuickActionsOpen(true));
  const [routerReady, setRouterReady] = useState(false);
  // Must be at top level — hooks cannot be called after conditional returns
  const triggerSignOut = useCallback(() => setSigningOut(true), []);
  // Real-time badge invalidation (cheap; one channel for the session)
  useBadgeRealtime(!!session?.user?.id);

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
    // Unauthenticated — no session is coming, nothing to wait for
    if (authState.status === 'unauthenticated') {
      setRouterReady(true);
      // Always clear any lingering sign-out overlay so it doesn't
      // survive a re-login and blank the screen.
      setSigningOut(false);
      return;
    }
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

  // Account-confirmed celebration — the success destination of the email link.
  // Welcome owns its own loading/success/expired states off the resolved auth
  // state, so it renders before the auth-status gates below. We also catch the
  // failure landing: a dead/expired link drops the user at the Site URL root with
  // an `#error=access_denied&error_code=otp_expired` hash, so route that to
  // Welcome's "link expired" state instead of a blank root.
  if (location.pathname === '/welcome' || /error=access_denied|otp_expired/.test(location.hash)) {
    return <Welcome />;
  }

  // Never render the full app while auth is still resolving — orgId/userId are
  // null during these states and page components calling useOrgId() will throw.
  if (authState.status === 'loading' || authState.status === 'resolving') return <SplashLoader />;

  if (authState.status === 'unauthenticated') {
    const p = location.pathname;
    if (p === '/' || p === '/login') return <Landing />;
    return <Login />;
  }
  
  // Guard against rendering the main app layout when we are supposed to redirect
  // to create-workspace or pending, but the router hasn't updated the pathname yet.
  if (authState.status === 'no-org') return <SplashLoader />;
  if (authState.status === 'pending') return <SplashLoader />;

  // Session not yet arrived from getSession() — show splash instead of blank
  if (!session) return <SplashLoader />;

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
    <SignOutContext.Provider value={{ triggerSignOut }}>
    {/* Portal overlay — rendered outside the React tree so it persists
         across auth state changes without interrupting its animation */}
    {signingOut && <SignOutOverlay onDismiss={() => setSigningOut(false)} />}
    <SnackbarProvider>
    <PeekProvider>
    <CommandBarProvider>
    {/* Subtle recede while signing out: app breathes back as the veil descends */}
    <div
      className="bg-background text-on-surface min-h-screen"
      style={signingOut ? {
        filter: 'blur(6px) saturate(0.4)',
        transform: 'scale(0.985)',
        transition: 'filter 480ms cubic-bezier(0.4,0,0.2,1), transform 480ms cubic-bezier(0.4,0,0.2,1)',
        willChange: 'filter, transform',
      } : { transition: 'filter 200ms, transform 200ms' }}
    >
      <BriklayDesktopNav session={session} />
      <main
        className={`min-h-screen mobile-main-pb transition-[margin-left] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)] md:ml-[220px]`}
        {...longPress}
      >
        {/* Mobile topbar (phones only â€" replaces sidebar hamburger) */}
        <MobileTopbar session={session} />
        {/* WhatsApp entry deep-links bake their base URL at send time; a base without
            /logbook (e.g. a misconfigured WA_APP_LINK) lands on "/" -> /ledger and drops
            the param. Honor ?entry= here, BEFORE the "/" rule fires, so the link always
            reaches the Day Book entry — including already-sent messages. */}
        {(() => {
          const entryId = new URLSearchParams(location.search).get('entry');
          if (entryId && location.pathname !== '/logbook') {
            return <Navigate to={`/logbook?entry=${encodeURIComponent(entryId)}`} replace />;
          }
          return (
        <Routes>
          <Route path="/" element={<Navigate to="/ledger" replace />} />
          <Route path="/insights" element={<Insights />} />
          {/* Dashboard retired → Insights. Keep the old path as a redirect so post-login
              / onboarding / invite flows that still send users to /dashboard land here. */}
          <Route path="/dashboard" element={<Navigate to="/insights" replace />} />
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
          <Route path="/inward-register" element={<InwardRegister session={session} />} />
          <Route path="/sku-directory" element={<SKUDirectory session={session} />} />
          <Route path="/team" element={<Team session={session} />} />
          <Route path="/settings" element={<Settings session={session} />} />
          <Route path="/financials" element={<PrincipalGuard session={session}><Financials /></PrincipalGuard>} />
          <Route path="/financials/pl" element={<PrincipalGuard session={session}><FinancialsPL /></PrincipalGuard>} />
          <Route path="/financials/cashflow" element={<PrincipalGuard session={session}><FinancialsCashflow /></PrincipalGuard>} />
          {/* Procurement */}
          <Route path="/procurement" element={<Navigate to="/procurement/requests" replace />} />
          <Route path="/procurement/requests" element={<ProcurementRequests session={session} />} />
          <Route path="/procurement/quotes" element={<ProcurementQuotes session={session} />} />
          <Route path="/procurement/orders" element={<ProcurementOrders session={session} />} />
          <Route path="/procurement/*" element={<Navigate to="/procurement/requests" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
          );
        })()}
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

    {/* Background-refetch progress bar (cache-first signal) */}
    <GlobalRefetchIndicator />

    {/* Command bar â€" rendered outside the scroll container, above everything */}
    <CommandBar />
    <GlobalShortcuts />

    </CommandBarProvider>
    </PeekProvider>
    </SnackbarProvider>
    </SignOutContext.Provider>
  );
}

// â"€â"€ Nav shortcut helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function GlobalShortcuts() {
  const { open } = useCommandBar();
  useGlobalShortcuts(open);
  return null;
}

// â"€â"€ Sidebar shell â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function getMobileTitle(pathname: string): string {
  const routes: Record<string, string> = {
    '/':                    'Transactions',
    '/insights':            'Insights',
    '/logbook':             'Day book',
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
    '/attendance':               'Attendance',
    '/cost-codes':               'Cost Codes',
    '/procurement/requests':     'Requests',
    '/procurement/quotes':       'Quotes',
    '/procurement/orders':       'Orders',
  };
  if (routes[pathname]) return routes[pathname];
  const seg = pathname.split('/').filter(Boolean);
  const detailTitles: Record<string, string> = {
    'ledger': 'Transaction', 'projects': 'Project', 'work-orders': 'Work Order',
    'purchase-orders': 'Purchase Order', 'billing': 'Bill', 'stakeholders': 'Stakeholder',
    'invoices': 'Invoice', 'procurement': 'Procurement',
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
    <header
      className="md:hidden sticky top-0 z-30 bg-white/90 backdrop-blur-xl supports-[backdrop-filter]:bg-white/75"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02)',
      }}
    >
      <div className="flex items-center gap-2 px-4 h-12">
        {isDetailPage && (
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex items-center justify-center w-10 h-10 -ml-2 rounded-full text-on-surface-variant touch-active"
          >
            <IconChevronLeft size={24} strokeWidth={2} />
          </button>
        )}
        <h1
          className="flex-1 min-w-0 text-[17px] font-semibold text-on-surface leading-none truncate tracking-tight"
        >
          {title}
        </h1>
        {profile && (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor[profile.role] ?? 'bg-surface-container-high text-on-surface'}`}
          >
            {initials(profile.name ?? 'U')}
          </div>
        )}
      </div>
    </header>
  );
}

const TERRACOTTA = '#C45B39';

// ── Tab item ───────────────────────────────────────────────────────────────
function TabItem({
  Icon, label, active, badge, accentActive = true, onClick, to,
}: {
  Icon: React.ElementType;
  label: string;
  active: boolean;
  badge?: number;
  accentActive?: boolean;
  onClick?: () => void;
  to?: string;
}) {
  const activeColor = accentActive ? TERRACOTTA : '#0b1c30';
  const content = (
    <>
      {/* Top indicator pill */}
      <span
        className="absolute top-0 h-[2px] rounded-full transition-all duration-200"
        style={{
          width: active ? 20 : 0,
          opacity: active ? 1 : 0,
          background: activeColor,
        }}
        aria-hidden
      />
      <div className="relative flex items-center justify-center">
        <Icon size={22} strokeWidth={active ? 2 : 1.5} />
        {(badge ?? 0) > 0 && (
          <span
            className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-error text-on-error text-[9px] font-bold leading-none flex items-center justify-center"
            style={{ boxShadow: '0 0 0 1.5px rgba(255,255,255,0.95)' }}
          >
            {(badge ?? 0) > 9 ? '9+' : badge}
          </span>
        )}
      </div>
      <span
        className="text-[10px] leading-none mt-0.5"
        style={{ fontWeight: active ? 600 : 500, letterSpacing: '-0.005em' }}
      >
        {label}
      </span>
    </>
  );
  const cls = `flex-1 flex flex-col items-center justify-center gap-0.5 relative touch-active select-none transition-colors duration-150`;
  const style = { color: active ? activeColor : 'var(--nav-text-muted)' };
  return to ? (
    <Link to={to} className={cls} style={style}>{content}</Link>
  ) : (
    <button onClick={onClick} className={cls} style={style} type="button">{content}</button>
  );
}

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

  // ── Pending counts for badges (mirror sidebar queries; React Query dedupes) ──
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

  const { data: poDraftCount = 0 } = useQuery({
    queryKey: ['nav_po_draft'],
    queryFn: async () => (await supabase.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('approval_status', 'PENDING')).count ?? 0,
    staleTime: 60_000,
    enabled: role === 'management' || role === 'principal',
  });

  const ordersBadge = (woPendingCount ?? 0) + (poUntalliedCount ?? 0);

  // Glass shell shared by both context tab bars
  const shellClass =
    "md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-xl supports-[backdrop-filter]:bg-white/75";
  const shellStyle: React.CSSProperties = {
    boxShadow: '0 -1px 3px rgba(0,0,0,0.04), 0 -8px 24px rgba(0,0,0,0.04)',
    height: 'calc(56px + env(safe-area-inset-bottom))',
  };
  const innerStyle: React.CSSProperties = { paddingBottom: 'env(safe-area-inset-bottom)' };

  // ── Project context bottom bar ─────────────────────────────────────────
  if (isInProject) {
    const base = `/projects/${activeProjectId}`;
    const isOverview = location.pathname === base;
    const isTxns     = location.pathname.startsWith(`${base}/transactions`);
    const isWOs      = location.pathname.startsWith(`${base}/work-orders`);
    const isPOs      = location.pathname.startsWith(`${base}/purchase-orders`);
    const isOther    = !isOverview && !isTxns && !isWOs && !isPOs; // inventory, boqs, inward

    return (
      <nav className={shellClass} style={shellStyle}>
        <div className="flex items-stretch h-[56px]" style={innerStyle}>
          {/* ← Back to all projects (narrow, label-led) */}
          <Link
            to="/projects"
            className="flex flex-col items-center justify-center gap-0.5 touch-active select-none"
            style={{ minWidth: 48, paddingLeft: 4, paddingRight: 4, color: 'var(--nav-text-muted)' }}
          >
            <IconChevronLeft size={18} strokeWidth={2} />
            <span className="text-[9px] font-medium leading-none" style={{ letterSpacing: '0.02em' }}>Projects</span>
          </Link>
          <div style={{ width: 1, background: 'var(--nav-border)', margin: '12px 0', flexShrink: 0 }} />

          <TabItem to={base}                       Icon={IconLayoutGrid}      label="Overview" active={isOverview} />
          <TabItem to={`${base}/transactions`}     Icon={IconArrowsExchange}  label="Txns"     active={isTxns} />
          <TabItem to={`${base}/work-orders`}      Icon={IconClipboardList}   label="W.Orders" active={isWOs} />
          <TabItem to={`${base}/purchase-orders`}  Icon={IconShoppingBag}     label="POs"      active={isPOs} />
          <TabItem onClick={onMoreTap}             Icon={IconDots}            label="More"     active={isOther} />
        </div>
      </nav>
    );
  }

  // ── Purchase-orders context bottom bar (the mobile mirror of the desktop
  //    secondary panel: Draft → Sent for quotes → Live) ────────────────────────
  const inPO = (location.pathname.startsWith('/purchase-orders') && location.pathname !== '/purchase-orders/new')
            || location.pathname.startsWith('/procurement/quotes');
  if (inPO) {
    const onList = location.pathname === '/purchase-orders';
    const onQuotes = location.pathname.startsWith('/procurement/quotes');
    const status = new URLSearchParams(location.search).get('status') ?? 'all';
    const isApprover = role === 'management' || role === 'principal';
    return (
      <nav className={shellClass} style={shellStyle}>
        <div className="flex items-stretch h-[56px]" style={innerStyle}>
          {isApprover && <TabItem to="/purchase-orders?status=draft" Icon={IconFileText} label="Approvals" active={onList && status === 'draft'} badge={poDraftCount} />}
          <TabItem to="/procurement/quotes" Icon={IconClock}      label="Quotes" active={onQuotes} />
          <TabItem to="/purchase-orders"    Icon={IconCircleDot}  label="Live"   active={onList && status !== 'draft'} />
          <TabItem onClick={onMoreTap}      Icon={IconDots}       label="More"   active={false} />
        </div>
      </nav>
    );
  }

  // ── Global context bottom bar ──────────────────────────────────────────
  const isOrdersActive = isActivePath('/orders') || isActivePath('/purchase-orders') || isActivePath('/work-orders');
  const moreActive = ['/billing', '/team', '/settings', '/logbook', '/invoices', '/insights', '/sku-directory'].some(p => isActivePath(p));

  type Tab = { path: string; icon: React.ElementType; label: string; show: boolean; badge?: number };
  const tabs: Tab[] = [
    { path: '/ledger',       icon: IconRepeat,     label: 'Txns',     show: role !== 'supervisor' },
    { path: '/projects',     icon: IconLayoutGrid, label: 'Projects', show: true },
    { path: '/orders',       icon: IconFiles,      label: 'Orders',   show: true, badge: ordersBadge },
    { path: '/stakeholders', icon: IconUsers,      label: 'Parties',  show: role !== 'supervisor' && role !== 'accountant' },
  ].filter(t => t.show);

  return (
    <nav className={shellClass} style={shellStyle}>
      <div className="flex items-stretch h-[56px]" style={innerStyle}>
        {tabs.map(tab => {
          const active = tab.path === '/orders' ? isOrdersActive : isActivePath(tab.path);
          return (
            <TabItem
              key={tab.path}
              to={tab.path}
              Icon={tab.icon}
              label={tab.label}
              active={active}
              badge={tab.badge}
            />
          );
        })}
        <TabItem onClick={onMoreTap} Icon={IconDots} label="More" active={moreActive} />
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

  const base = activeProjectId ? `/projects/${activeProjectId}` : '';
  const projectMoreItems = isInProject ? [
    { path: base,                icon: IconLayoutGrid,      label: 'Overview',        show: true },
    { path: `${base}/inventory`, icon: IconFiles,           label: 'Inventory',       show: true },
    { path: `${base}/boqs`,      icon: IconClipboardList,   label: 'BOQs',            show: true },
    { path: `${base}/inward`,    icon: IconShoppingBag,     label: 'Inward Register', show: true },
    { path: '/insights',         icon: IconChartPie,        label: 'Insights',        show: true },
  ] : [];

  const globalItems = [
    { path: '/logbook',       icon: IconNotebook,              label: 'Day book',       show: true },
    { path: '/inward-register', icon: IconLayoutGrid,          label: 'Inward Register', show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/billing',       icon: IconFileInvoice,           label: 'Client Billing', show: role !== 'supervisor' },
    { path: '/insights',      icon: IconChartPie,              label: 'Insights',       show: true },
    { path: '/sku-directory', icon: IconBarcode,               label: 'SKU Directory',  show: role === 'principal' || role === 'management' },
    { path: '/team',          icon: IconShieldLock,            label: 'Team & Access',  show: role === 'principal' || role === 'management' },
    { path: '/settings',      icon: IconAdjustmentsHorizontal, label: 'Settings',       show: true },
  ].filter(i => i.show);

  const items = isInProject ? projectMoreItems.filter(i => i.show) : globalItems;
  const sheetTitle = isInProject ? 'Project' : 'More';

  const { triggerSignOut } = useSignOut();

  return (
    <BottomSheet open={isOpen} onClose={onClose} title={sheetTitle}>
      <div className="pb-2">
        {items.map(item => {
          const Icon = item.icon;
          const active = isActivePath(item.path);
          return (
            <button
              key={item.path}
              onClick={() => go(item.path)}
              className="w-full flex items-center gap-3 px-5 touch-active"
              style={{
                minHeight: 52,
                backgroundColor: active ? 'rgba(200,96,58,0.06)' : undefined,
              }}
            >
              <Icon size={20} strokeWidth={1.5} style={{ color: active ? TERRACOTTA : 'var(--nav-text-muted)', flexShrink: 0 }} />
              <span
                className="flex-1 text-[15px] text-left"
                style={{ fontWeight: active ? 600 : 400, color: active ? TERRACOTTA : 'var(--nav-text-default)' }}
              >
                {item.label}
              </span>
              {active && <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: TERRACOTTA, flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>

      {/* User block + sign out (global context only) */}
      {!isInProject && profile && (
        <>
          <div className="mx-5 my-2 border-t border-black/[0.06]" />
          <div className="px-5 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-surface-container-high flex items-center justify-center text-[12px] font-bold text-on-surface flex-shrink-0">
              {(profile.name ?? 'U').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-on-surface truncate">{profile.name ?? 'User'}</p>
              <p className="text-[11px] text-on-surface-variant capitalize">{role}</p>
            </div>
            <button
              onClick={() => { onClose(); triggerSignOut(); }}
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-medium text-on-surface-variant touch-active"
              style={{ background: 'rgba(0,0,0,0.04)' }}
            >
              <IconLogout size={14} strokeWidth={1.8} />
              Sign out
            </button>
          </div>
        </>
      )}
    </BottomSheet>
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
      // Two steps on purpose: embedding user_profiles joins two tables that both
      // carry org_id, so `.eq('org_id', …)` compiles to an ambiguous
      // `where org_id = …`. Fetch memberships, then their profiles by id.
      const { data: rows, error } = await supabase
        .from('org_memberships')
        .select('role, status, joined_at, user_id')
        .eq('org_id', profile!.org_id!)
        .eq('status', 'active')
        .order('joined_at', { ascending: false });
      if (error) throw error;
      const ids = (rows ?? []).map(r => (r as any).user_id as string).filter(Boolean);
      if (ids.length === 0) return [] as UserProfile[];
      const { data: profiles, error: pErr } = await supabase
        .from('user_profiles')
        .select('id, name, assigned_projects, created_at')
        .in('id', ids);
      if (pErr) throw pErr;
      const byId = new Map((profiles ?? []).map(p => [(p as any).id as string, p as any]));
      return (rows ?? [])
        .filter(r => byId.has((r as any).user_id))
        .map(r => {
          const p = byId.get((r as any).user_id);
          return {
            id:                p.id as string,
            name:              p.name as string,
            role:              r.role as UserProfile['role'],
            assigned_projects: (p.assigned_projects ?? []) as string[],
            created_at:        p.created_at as string,
          } satisfies UserProfile;
        });
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
      await invokeAdminUsers({ action: 'delete', userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      showSnackbar('User removed');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to delete user', { type: 'error' }),
  });

  const createUser = useMutation({
    mutationFn: async (formData: FormData) => {
      const email = formData.get('email') as string;
      const password = formData.get('password') as string;
      const name = formData.get('name') as string;
      const role = formData.get('role') as string;
      if (role === 'principal' && team?.some(u => u.role === 'principal')) {
        throw new Error('Only one Principal is allowed per organisation. Update the existing Principal first.');
      }
      // Auth user creation + membership setup run server-side in the admin-users
      // edge function (service-role key stays in function secrets, never the client).
      return await invokeAdminUsers({ action: 'create', email, password, name, role });
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
            <div className="md:col-span-2 flex justify-end"><button type="submit" className="bk-btn" disabled={createUser.isPending}>{createUser.isPending ? 'Saving...' : 'Create User'}</button></div>
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
                <button className="p-2 text-error hover:bg-error-container/20 rounded-lg" onClick={() => { if (confirm('Delete this user?')) deleteUser.mutate(user.id); }} disabled={deleteUser.isPending} title="Delete">
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
