import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './lib/auth/AuthProvider';
import { LOGIN_ROUTE, loginRouteFor } from './lib/auth/routes';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { SITE_DESK_ENABLED } from './lib/desk/flag';
import { useDeskPreload } from './lib/desk/live';
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
  IconShieldLock,
  IconLogout, IconChevronLeft, IconDots,
  IconRepeat, IconLayoutGrid, IconFiles, IconUsers, IconUser,
  IconCircleDot, IconClock, IconFileText, IconChecklist,
} from '@tabler/icons-react';

// Route pages are lazy-loaded so the dev server (and the prod bundle) only transform/ship
// the page you're on — not all ~40 at once. The big eager import graph was what OOM-killed
// esbuild on a low-RAM box. Components used OUTSIDE <Routes> (TeamAccess, Privacy, Terms,
// DataDeletion, the auth/entry screens) stay eager below.
const Stakeholders = lazy(() => import('./pages/Stakeholders'));
const StakeholderDetail = lazy(() => import('./pages/StakeholderDetail'));
const WorkOrders = lazy(() => import('./pages/WorkOrders'));
const WorkOrderDetail = lazy(() => import('./pages/WorkOrderDetail'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectTasks = lazy(() => import('./pages/ProjectTasks'));
const ProjectIssues = lazy(() => import('./pages/ProjectIssues'));
// Site Desk v30 — behind SITE_DESK_ENABLED. The old pages above stay routable until parity sign-off.
const SiteDeskV2 = lazy(() => import('./pages/SiteDeskV2'));
const ProjectDesk = lazy(() => import('./pages/ProjectDesk'));
const ProjectLedger = lazy(() => import('./pages/ProjectLedger'));
const ProjectHome = lazy(() => import('./pages/ProjectDesk').then((m) => ({ default: m.ProjectHome })));
const ProjectWorkOrders = lazy(() => import('./pages/ProjectWorkOrders'));
const ProjectPurchaseOrders = lazy(() => import('./pages/ProjectPurchaseOrders'));
const ProjectInventory = lazy(() => import('./pages/ProjectInventory'));
const ProjectBOQs = lazy(() => import('./pages/ProjectBOQs'));
const ProjectInward = lazy(() => import('./pages/ProjectInward'));
const InwardRegister = lazy(() => import('./pages/InwardRegister'));
const NewProjectWizard = lazy(() => import('./components/NewProjectWizard'));
const TransactionDetail = lazy(() => import('./pages/TransactionDetail'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const NewPurchaseOrder = lazy(() => import('./pages/NewPurchaseOrder'));
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail'));
const Ledger = lazy(() => import('./pages/Ledger'));
const NewTransaction = lazy(() => import('./pages/NewTransaction'));
const ImportTransactions = lazy(() => import('./pages/ImportTransactions'));
const Insights = lazy(() => import('./pages/Insights'));
const Profile = lazy(() => import('./pages/Profile'));
const FollowUpRules = lazy(() => import('./pages/FollowUpRules'));
const NewWorkOrder = lazy(() => import('./pages/NewWorkOrder'));
const Financials = lazy(() => import('./pages/Financials'));
const FinancialsPL = lazy(() => import('./pages/FinancialsPL'));
const FinancialsCashflow = lazy(() => import('./pages/FinancialsCashflow'));
const Invoices = lazy(() => import('./pages/Invoices'));
const NewInvoice = lazy(() => import('./pages/NewInvoice'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Billing = lazy(() => import('./pages/Billing'));
const NewBill = lazy(() => import('./pages/NewBill'));
const BillDetail = lazy(() => import('./pages/BillDetail'));
const Logbook = lazy(() => import('./pages/Logbook'));
import { BriklayDesktopNav } from './components/nav/BriklayRail';
import { isSecondaryNavRoute } from './components/nav/navTokens';
const Orders = lazy(() => import('./pages/Orders'));
import InviteAccept from './pages/InviteAccept';
import OnboardingWizard from './components/OnboardingWizard';
import Pending from './pages/Pending';
import Welcome from './pages/Welcome';
import CreateWorkspace from './pages/CreateWorkspace';
// S1-2 Part B: the standalone <Login> screen is retired — every unauthenticated path now
// resolves to the Landing screen (via LOGIN_ROUTE), so the old surface is unreachable.
import Landing from './pages/Landing';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import DataDeletion from './pages/DataDeletion';
const ProcurementRequests = lazy(() => import('./pages/ProcurementRequests'));
const ProcurementQuotes = lazy(() => import('./pages/ProcurementQuotes'));
const ProcurementOrders = lazy(() => import('./pages/ProcurementOrders'));
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
  // S1-2 Part B: sign out through the AuthProvider wrapper (not supabase.auth.signOut directly) so the
  // SIGNED_OUT handler sees explicitSignOutRef=true — a user sign-out is logged as explicit, not
  // misclassified as refresh_failed, and skips the spurious-logout getSession() round-trip.
  const { signOut } = useAuth();

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
        signOut().catch(() => {});
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

  /**
   * THE SITE DESK IS ALREADY THERE WHEN YOU GET THERE.
   *
   * Its route is a lazy chunk and its data is one large read (every project, problem, task, QC row,
   * narration and a signed URL per photo). Both used to start on the click, so opening the desk meant
   * watching a skeleton while the thing you came to do was still being fetched — and both are perfectly
   * well known in advance.
   *
   * So they are fetched on IDLE, once we know who you are: it never competes with the page in front of
   * you, and by the time you reach for the desk it is warm. (Prefetch is a no-op if it is already
   * cached, so this can never double-fetch.)
   */
  useDeskPreload(authState.status === 'authenticated' ? authState.context.orgId : null);
  const [session, setSession] = useState<Session | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [routerReady, setRouterReady] = useState(false);
  // Secondary-nav contexts (Site Management): the user toggles whether the main rail is
  // expanded (labels, 220px) or collapsed to its icon spine (56px) beside the panel. Persisted.
  const [railExpanded, setRailExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem('briklay_rail_expanded') === '1'; } catch { return false; }
  });
  const toggleRail = useCallback(() => setRailExpanded(v => {
    const next = !v;
    try { localStorage.setItem('briklay_rail_expanded', next ? '1' : '0'); } catch { /* private mode */ }
    return next;
  }), []);
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

  // Warm the Site Management chunks once the main page is up + the browser is idle — so opening
  // Task Manager / Snags & Issues / Follow-up Rules is instant, not gated on a lazy import at
  // click time. Vite dedupes: these import() calls just prime the same chunks lazy() will use.
  useEffect(() => {
    if (!session?.user?.id) return;
    const prefetch = () => {
      import('./pages/ProjectTasks');
      import('./pages/SiteDesk');
      import('./pages/FollowUpRules');
      import('./pages/ProjectIssues');
    };
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(prefetch, 1500);
    return () => clearTimeout(t);
  }, [session?.user?.id]);

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
    if (!session) return <Navigate to={LOGIN_ROUTE} replace />;
    return <Pending session={session} />;
  }

  if (location.pathname === '/create-workspace') {
    if (!routerReady) return null;
    if (!session) return <Navigate to={LOGIN_ROUTE} replace />;
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
    // /signup is a public entry too (the team-invite button lands here as /signup?method=phone → the
    // AuthPanel opens straight into phone signup). Render Landing directly so the query survives.
    if (p === '/' || p === LOGIN_ROUTE || p === '/signup') return <Landing />;
    // S1-2 Part B: consolidate EVERY other unauthenticated path onto the single login route so an
    // involuntary signout on a deep route (e.g. /ledger) can never surface the retired Login screen —
    // even a forgotten reference or a stale-bundle tab lands on the current login surface.
    //
    // …CARRYING WHERE HE WAS GOING. This used to be a bare `to={LOGIN_ROUTE}`, which discarded the
    // pathname and the query. Every WhatsApp answer's "View ledger" button is a deep link
    // (/ledger?stakeholder=…&project=…) opened in WhatsApp's own in-app browser — a separate cookie
    // jar, so it usually lands here with no session. He signed in and got the COMPLETE ledger: not
    // his party, not his site, contradicting the per-site number he had just tapped from.
    // AuthPanel has read `?redirect=` all along; nothing ever sent it. `location.search` is the
    // load-bearing half — which party and which site live entirely in the query string.
    return <Navigate to={loginRouteFor(p, location.search)} replace />;
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
      <BriklayDesktopNav session={session} railExpanded={railExpanded} onToggleRail={toggleRail} />
      <main
        // Shell margin reserves the rail. Inside a hub with a secondary navbar it's the panel
        // (224) plus the rail at whatever width the user toggled it to (spine 56 / full 220).
        style={{ ['--shell-ml' as string]: isSecondaryNavRoute(location.pathname) ? `${(railExpanded ? 220 : 56) + 224}px` : '220px' } as React.CSSProperties}
        className={`min-h-screen mobile-main-pb transition-[margin-left] duration-[220ms] ease-[cubic-bezier(0.4,0,0.6,1)] md:ml-[var(--shell-ml)]`}
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
        <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route path="/" element={<Navigate to="/ledger" replace />} />
          <Route path="/insights" element={<Insights />} />
          {/* Dashboard retired → Insights. Keep the old path as a redirect so post-login
              / onboarding / invite flows that still send users to /dashboard land here. */}
          <Route path="/dashboard" element={<Navigate to="/insights" replace />} />
          <Route path="/logbook" element={<Logbook session={session} />} />
          {/* ── THE SITE MANAGEMENT HUB IS DELETED ────────────────────────────────────────
              /site-desk (the old Issues & Snags rollup) and /tasks (the old global task manager)
              were two doors into the same building; the Site Desk is the building. Both redirect,
              so every WhatsApp deep link, notification and bookmark ever sent still lands somewhere
              true — at the same work, on the better surface. Follow-up Rules keeps its own address
              (it is a settings page, and the desk's gear points straight at it). */}
          <Route path="/site-desk" element={<Navigate to="/desk/all/problems" replace />} />

          {/* ── SITE DESK v30 (feature-flagged) ──────────────────────────────────────────
              Registered ONLY when the flag is on, so with it off the portal is byte-identical
              to what it was: no route, no nav entry, old pages untouched.
              The static /desk/settings/chasing must precede the :site param routes — it mounts
              the EXISTING Follow-up Rules page unchanged (restyle is out of scope). */}
          {SITE_DESK_ENABLED && (
            <>
              <Route path="/desk" element={<Navigate to="/desk/all/problems" replace />} />
              <Route path="/desk/settings/chasing" element={<FollowUpRules session={session} />} />
              <Route path="/desk/:site/problems" element={<SiteDeskV2 session={session} tab="problems" />} />
              <Route path="/desk/:site/problems/:ref" element={<SiteDeskV2 session={session} tab="problems" />} />
              <Route path="/desk/:site/plan" element={<SiteDeskV2 session={session} tab="plan" />} />
            </>
          )}
          <Route path="/tasks" element={<Navigate to="/desk/all/plan" replace />} />
          <Route path="/ledger" element={<Ledger session={session} />} />
          <Route path="/ledger/new" element={<NewTransaction session={session} />} />
          <Route path="/ledger/import" element={<ImportTransactions session={session} />} />
          <Route path="/ledger/:txnId" element={<TransactionDetail session={session} />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/new" element={<NewInvoice session={session} />} />
          <Route path="/invoices/:invoiceId" element={<InvoiceDetail session={session} />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/billing/new" element={<NewBill session={session} />} />
          <Route path="/billing/:billId" element={<BillDetail session={session} />} />
          <Route path="/projects" element={<Projects session={session} />} />
          <Route path="/projects/new" element={<NewProjectWizard session={session} />} />
          {/* A PROJECT OPENS ON ITS WORK, not on a lobby. ProjectHome sends you to the Site Desk;
              a project with no site code (which cannot have a desk) still gets the old overview. */}
          <Route path="/projects/:projectId" element={<ProjectHome session={session} />} />
          {/* The overview's one irreplaceable job — editing the project — lives on as its settings. */}
          <Route path="/projects/:projectId/settings" element={<ProjectDetail session={session} />} />
          {/* THE SAME LEDGER, locked to this project. The old ProjectTransactions table is retired —
              one book of account, so a figure reads the same wherever you open it. */}
          <Route path="/projects/:projectId/transactions" element={<ProjectLedger session={session} />} />
          <Route path="/projects/:projectId/tasks" element={<ProjectTasks session={session} />} />
          <Route path="/projects/:projectId/issues" element={<ProjectIssues session={session} />} />
          <Route path="/projects/:projectId/work-orders" element={<ProjectWorkOrders session={session} />} />
          <Route path="/projects/:projectId/purchase-orders" element={<ProjectPurchaseOrders session={session} />} />
          <Route path="/projects/:projectId/inventory" element={<ProjectInventory session={session} />} />
          <Route path="/projects/:projectId/boqs" element={<ProjectBOQs session={session} />} />
          <Route path="/projects/:projectId/inward" element={<ProjectInward session={session} />} />

          {/* ── THE SITE DESK, INSIDE THE PROJECT ─────────────────────────────────────────────
              The same page as /desk, locked to this project. The site is IMPLIED by the address, so
              it is not repeated in it: /projects/PRJ-X/desk/problems/CHAK-14, not …/desk/chak/… .
              The old /projects/:id/tasks and /issues routes are kept alive — WhatsApp confirmations
              and older notifications still link straight at them — but nothing in the UI points there
              any more. */}
          {SITE_DESK_ENABLED && (
            <>
              <Route path="/projects/:projectId/desk" element={<Navigate to="plan" replace />} />
              <Route path="/projects/:projectId/desk/plan" element={<ProjectDesk session={session} tab="plan" />} />
              <Route path="/projects/:projectId/desk/problems" element={<ProjectDesk session={session} tab="problems" />} />
              <Route path="/projects/:projectId/desk/problems/:ref" element={<ProjectDesk session={session} tab="problems" />} />
            </>
          )}
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
          <Route path="/team" element={<Team session={session} />} />
          <Route path="/profile" element={<Profile session={session} />} />
          {/* SKU directory + Settings retired → Settings' account/org config moved into /profile.
              Keep the old /settings path as a redirect so stale links/bookmarks still land somewhere true. */}
          <Route path="/settings" element={<Navigate to="/profile" replace />} />
          <Route path="/sku-directory" element={<Navigate to="/" replace />} />
          {/* Follow-up Rules — org-tunable timing per cause (how soon / how often we chase). */}
          <Route path="/follow-up-rules" element={<FollowUpRules session={session} />} />
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
        </Suspense>
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
    '/site-desk':           'Site Desk',
    '/ledger':              'Transactions',
    '/ledger/new':          'New Transaction',
    '/ledger/import':       'Import Transactions',
    '/projects':            'Projects',
    '/work-orders':         'Contracts',
    '/work-orders/new':     'New Contract',
    '/purchase-orders':     'Purchase Orders',
    '/purchase-orders/new': 'New Purchase Order',
    '/billing':             'Billing',
    '/billing/new':         'New Bill',
    '/stakeholders':        'Parties',
    '/profile':             'Profile',
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
            {/* Email-pending bubble — mirrors the desktop rail; points at the "add your email" item in Profile. */}
            {!session.user.email && (
              <span aria-label="Email update needed" className="absolute -top-0.5 -right-0.5 rounded-full" style={{ width: 9, height: 9, background: '#E0603A', boxShadow: '0 0 0 2px #fff' }} />
            )}
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
                  onClick={() => { setMenuOpen(false); navigate('/profile'); }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left text-[14px] text-on-surface touch-active"
                >
                  <IconUser size={17} strokeWidth={1.7} style={{ color: '#9A9186', flexShrink: 0 }} /> Profile
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

  // ── Mobile auto-hide: tuck the bar away on scroll-down, bring it back on scroll-up;
  //    and hide it entirely on full-screen "/…/new" forms (New Transaction, New PO/WO/
  //    Bill/Invoice) which own their own bottom action bar, so the two never stack. ──
  const [navHidden, setNavHidden] = useState(false);
  const hideForRoute = /\/new$/.test(location.pathname);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 10) return;
      setNavHidden(y > last && y > 72); // hide when scrolling down past 72px, show on up
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const navTucked = navHidden || hideForRoute;

  // Glass shell shared by both context tab bars
  const shellClass =
    "md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-xl supports-[backdrop-filter]:bg-white/75";
  const shellStyle: React.CSSProperties = {
    boxShadow: '0 -1px 3px rgba(0,0,0,0.04), 0 -8px 24px rgba(0,0,0,0.04)',
    height: 'calc(56px + env(safe-area-inset-bottom))',
    transform: navTucked ? 'translateY(115%)' : 'translateY(0)',
    transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
    willChange: 'transform',
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
  const moreActive = ['/billing', '/team', '/profile', '/stakeholders', '/invoices', '/insights', '/inward-register'].some(p => isActivePath(p));

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
    { path: `${base}/tasks`,           icon: IconClipboardList, label: 'Task Manager', show: true },
    { path: `${base}/issues?view=issues`, icon: IconCircleDot,  label: 'Issues',       show: true },
    { path: `${base}/issues?view=snags`,  icon: IconClipboardList, label: 'Snags',    show: true },
    { path: `${base}/inventory`, icon: IconFiles,           label: 'Inventory',       show: true },
    { path: `${base}/boqs`,      icon: IconClipboardList,   label: 'BOQs',            show: true },
    { path: `${base}/inward`,    icon: IconShoppingBag,     label: 'Inward Register', show: true },
    { path: '/insights',         icon: IconChartPie,        label: 'Insights',        show: true },
  ] : [];

  const globalItems = [
    { path: '/site-desk',     icon: IconClipboardList,         label: 'Site Desk',       show: true },
    { path: '/tasks',         icon: IconChecklist,             label: 'Task Manager',    show: true },
    { path: '/stakeholders',  icon: IconUsers,                 label: 'Parties',         show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/inward-register', icon: IconLayoutGrid,          label: 'Inward Register', show: role !== 'supervisor' && role !== 'accountant' },
    { path: '/billing',       icon: IconFileInvoice,           label: 'Client Billing', show: role !== 'supervisor' },
    { path: '/insights',      icon: IconChartPie,              label: 'Insights',       show: true },
    { path: '/team',          icon: IconShieldLock,            label: 'Team & Access',  show: role === 'principal' || role === 'management' },
    { path: '/follow-up-rules', icon: IconClock,               label: 'Follow-up Rules', show: role === 'principal' || role === 'management' },
    { path: '/profile',       icon: IconUser,                  label: 'Profile',        show: true },
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
