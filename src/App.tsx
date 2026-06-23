import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './lib/auth/AuthProvider';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { Routes, Route, Navigate, useNavigate, Link, useLocation } from 'react-router-dom';
import TeamAccess from './components/team/TeamAccess';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from './types';
import { SnackbarProvider } from './components/Snackbar';
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
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import DataDeletion from './pages/DataDeletion';
import SKUDirectory from './pages/SKUDirectory';
import ProcurementRequests from './pages/ProcurementRequests';
import ProcurementQuotes from './pages/ProcurementQuotes';
import ProcurementOrders from './pages/ProcurementOrders';
import { FloatingActionButton } from './components/FloatingActionButton';
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

  // Public legal pages — no auth required (Meta/WhatsApp verification, footer
  // links). Render before any gate so they load regardless of session.
  if (location.pathname === '/privacy') {
    return <Privacy />;
  }
  if (location.pathname === '/terms') {
    return <Terms />;
  }
  if (location.pathname === '/data-deletion') {
    return <DataDeletion />;
  }

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
          {/* Purchase requests now live inside the PO draft queue. */}
          <Route path="/purchase-requests" element={<Navigate to="/purchase-orders?status=draft" replace />} />
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
    '/work-orders':         'Contracts',
    '/work-orders/new':     'New Contract',
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
    'ledger': 'Transaction', 'projects': 'Project', 'work-orders': 'Contract',
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

  // Account menu (mirrors the desktop avatar dropdown: Settings + Sign out).
  const { triggerSignOut } = useSignOut();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: Event) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menuOpen]);

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
          <div className="relative shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Account"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold touch-active transition-transform active:scale-95 ${avatarColor[profile.role] ?? 'bg-surface-container-high text-on-surface'}`}
            >
              {initials(profile.name ?? 'U')}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
                style={{ top: 'calc(100% + 8px)', minWidth: 208, background: '#FFFFFF', border: '1px solid #EAE6E0', borderRadius: 14, boxShadow: '0 14px 36px rgba(20,16,12,0.20)', zIndex: 50, transformOrigin: 'top right' }}
              >
                <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ borderBottom: '1px solid #F0ECE6' }}>
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${avatarColor[profile.role] ?? 'bg-surface-container-high text-on-surface'}`}>
                    {initials(profile.name ?? 'U')}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-on-surface truncate leading-tight">{profile.name ?? 'User'}</p>
                    <p className="text-[11px] text-on-surface-variant capitalize truncate">{profile.role}</p>
                  </div>
                </div>
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-[14px] text-on-surface touch-active"
                >
                  <IconAdjustmentsHorizontal size={17} strokeWidth={1.7} style={{ color: '#9A9186', flexShrink: 0 }} /> Settings
                </button>
                <div style={{ borderTop: '1px solid #F0ECE6' }} />
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); triggerSignOut(); }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-[14px] font-medium touch-active"
                  style={{ color: '#B2402A' }}
                >
                  <IconLogout size={17} strokeWidth={1.7} style={{ flexShrink: 0 }} /> Sign out
                </button>
              </div>
            )}
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
          <TabItem to={`${base}/work-orders`}      Icon={IconClipboardList}   label="Contracts" active={isWOs} />
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
  const moreActive = ['/billing', '/team', '/settings', '/stakeholders', '/invoices', '/insights', '/inward-register'].some(p => isActivePath(p));

  type Tab = { path: string; icon: React.ElementType; label: string; show: boolean; badge?: number };
  const tabs: Tab[] = [
    { path: '/ledger',   icon: IconRepeat,     label: 'Txns',     show: role !== 'supervisor' },
    { path: '/projects', icon: IconLayoutGrid, label: 'Projects', show: true },
    { path: '/orders',   icon: IconFiles,      label: 'Orders',   show: true, badge: ordersBadge },
    { path: '/logbook',  icon: IconNotebook,   label: 'Day book', show: true },
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
    { path: '/stakeholders',  icon: IconUsers,                 label: 'Parties',         show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/inward-register', icon: IconLayoutGrid,          label: 'Inward Register', show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/billing',       icon: IconFileInvoice,           label: 'Client Billing', show: role !== 'supervisor' },
    { path: '/insights',      icon: IconChartPie,              label: 'Insights',       show: true },
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
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-medium touch-active"
              style={{ background: 'rgba(178,64,42,0.08)', color: '#B2402A' }}
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




function Team({ session }: { session: Session }) {
  return <TeamAccess session={session} />;
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
