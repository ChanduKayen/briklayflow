import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, coalescedRefresh } from '../supabase'
import { resolveAuthDestination, type MembershipContext } from './resolver'
import { LOGIN_ROUTE } from './routes'
import { parseStoredSession, isExpired, needsRefresh, backoffDelay, type StoredSessionInfo } from './refreshPolicy'

// S3 — resume/refresh tuning. Freshness is computed on demand from expires_at (never from a timer
// that may have frozen while backgrounded); we refresh proactively once within REFRESH_MARGIN_SEC.
const REFRESH_MARGIN_SEC = 60
const REVALIDATE_DEBOUNCE_MS = 400
const REFRESH_BASE_MS = 1_000
const REFRESH_MAX_MS = 30_000
const MAX_REFRESH_ATTEMPTS = 5

// ── Membership cache (localStorage) ──────────────────────────────
const CACHE_KEY = 'briklay_membership_ctx'

function saveCtxCache(ctx: MembershipContext) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(ctx)) } catch {}
}
function loadCtxCache(): MembershipContext | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as MembershipContext) : null
  } catch { return null }
}
function clearCtxCache() {
  localStorage.removeItem(CACHE_KEY)
}

// S1-2/S3: read the persisted Supabase session SYNCHRONOUSLY from localStorage — no lock, no network,
// cannot hang. supabase.auth.getSession() acquires the gotrue auth lock and can stall behind an
// in-flight signOut()/refresh (that stall left the app on a blank splash after a rail sign-out).
// The logout redirect must be pure navigation, never gated on something that can hang, so both the
// spurious-SIGNED_OUT guard and the resume path re-sync straight from storage. Parsing is delegated
// to the pure, table-tested parseStoredSession so "expired access token" and "recoverable session
// (refresh token present)" are distinguished — the mobile trap the old check conflated.
function readStoredSession(): StoredSessionInfo | null {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        return parseStoredSession(localStorage.getItem(key))
      }
    }
  } catch { /* unreadable storage → treat as no session */ }
  return null
}

// ── Auth state machine ────────────────────────────────────────────

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'resolving' }
  | { status: 'authenticated'; context: MembershipContext }
  | { status: 'pending';       orgName: string }
  | { status: 'no-org' }

// ── Permissions ───────────────────────────────────────────────────

export type Permission =
  | 'view:transactions'
  | 'create:transactions'
  | 'view:work_orders'
  | 'create:work_orders'
  | 'view:purchase_orders'
  | 'create:purchase_orders'
  | 'view:reports'
  | 'manage:team'
  | 'manage:org'

const ROLE_PERMISSIONS: Record<MembershipContext['role'], Permission[]> = {
  principal: [
    'view:transactions', 'create:transactions',
    'view:work_orders',  'create:work_orders',
    'view:purchase_orders', 'create:purchase_orders',
    'view:reports', 'manage:team', 'manage:org',
  ],
  management: [
    'view:transactions', 'create:transactions',
    'view:work_orders',  'create:work_orders',
    'view:purchase_orders', 'create:purchase_orders',
    'view:reports', 'manage:team',
  ],
  supervisor: [
    'view:transactions',
    'view:work_orders', 'create:work_orders',
    'view:purchase_orders',
  ],
  accountant: [
    'view:transactions', 'create:transactions',
    'view:purchase_orders',
    'view:reports',
  ],
}

// ── Context types ─────────────────────────────────────────────────

type AuthContextValue = {
  authState: AuthState
  signOut:   () => Promise<void>
  can:       (permission: Permission) => boolean
  isRole:    (role: MembershipContext['role']) => boolean
  orgId:     string | null
  userId:    string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate     = useNavigate()
  const location     = useLocation()
  const queryClient  = useQueryClient()
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' })
  const resolvingRef = useRef(false)
  // S1-2: distinguish an EXPLICIT user sign-out from a gotrue-initiated SIGNED_OUT (refresh failure),
  // so a transient network hiccup can't be mistaken for a real logout.
  const explicitSignOutRef = useRef(false)
  // S1-2: the user id we've already resolved for. onAuthStateChange fires SIGNED_IN / TOKEN_REFRESHED
  // for the SAME user on token refresh, tab focus, and cross-tab storage echoes — gating the resolver
  // (and its query re-fetch) on the user id actually CHANGING is what kills the "loads continuously
  // on refresh" storm. Only a genuine user change re-loads the app.
  const resolvedUserIdRef = useRef<string | null>(null)

  const runResolver = useCallback(async (userId: string, email: string) => {
    if (resolvingRef.current) return
    resolvingRef.current = true

    // Serve cached context immediately so the app renders without waiting for the network
    const cached = loadCtxCache()
    if (cached) {
      setAuthState({ status: 'authenticated', context: cached })
    } else {
      setAuthState({ status: 'resolving' })
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('resolver timed out after 10s')), 10_000)
    )

    try {
      const result = await Promise.race([resolveAuthDestination(userId, email), timeout])

      switch (result.destination) {
        case 'dashboard':
          saveCtxCache(result.context)
          setAuthState({ status: 'authenticated', context: result.context })
          if (!cached) queryClient.clear()
          break
        case 'accept-invite':
          clearCtxCache()
          setAuthState({ status: 'unauthenticated' })
          navigate(`/invite/${result.token}`, { replace: true })
          break
        case 'create-workspace':
          clearCtxCache()
          setAuthState({ status: 'no-org' })
          break
        case 'pending':
          clearCtxCache()
          setAuthState({ status: 'pending', orgName: result.orgName })
          break
      }
    } catch (err) {
      console.error('[auth:resolver] failed — reason: resolver_timeout_or_error', err)
      // If we have cached data, keep showing the app — network may be flaky
      if (!cached) setAuthState({ status: 'unauthenticated' })
    } finally {
      resolvingRef.current = false
    }
  }, [navigate])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        resolvedUserIdRef.current = session.user.id
        runResolver(session.user.id, session.user.email ?? '')
      } else {
        setAuthState({ status: 'unauthenticated' })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const uid = session?.user?.id ?? null
        // sameUser distinguishes THIS tab's own token refresh / a cross-tab storage echo (same user,
        // new token) from a genuine user change. It's the signal that reveals the cross-tab race.
        const sameUser = uid !== null && uid === resolvedUserIdRef.current
        // S1-2 Step 1: make every session transition observable, incl. whether the user actually changed.
        console.log(`[auth:event] ${event}${uid ? ` user=${uid.slice(0, 8)} sameUser=${sameUser}` : ' (no session)'}`)

        // USER_UPDATED fires when the email gets confirmed (among other profile changes) — re-resolve
        // even for the same user so a freshly-confirmed user is picked up without a stale state lingering.
        if (event === 'USER_UPDATED' && session?.user) {
          resolvedUserIdRef.current = session.user.id
          await runResolver(session.user.id, session.user.email ?? '')
          return
        }
        // S1-2 Step 2: gate the resolver/re-fetch on the user id CHANGING. A SIGNED_IN re-emitted for the
        // same user (token refresh surfaced as SIGNED_IN, tab focus, or a cross-tab storage echo) must NOT
        // re-run the resolver — that re-load-on-every-auth-event is the "loads continuously" storm.
        if (event === 'SIGNED_IN' && session?.user) {
          if (sameUser) {
            console.log('[auth:event] SIGNED_IN ignored — same user already resolved (no re-fetch storm)')
            return
          }
          resolvedUserIdRef.current = session.user.id
          await runResolver(session.user.id, session.user.email ?? '')
          return
        }
        // TOKEN_REFRESHED (same user, new token) is intentionally NOT handled — it must never re-load the app.
        if (event === 'SIGNED_OUT') {
          const explicit = explicitSignOutRef.current
          explicitSignOutRef.current = false
          // A NON-explicit SIGNED_OUT is gotrue-initiated. GOVERNING INVARIANT (S3): sign out ONLY on a
          // positively-identified dead refresh token — every other failure keeps the session. Read storage
          // SYNCHRONOUSLY (never getSession(), which can hang on the auth lock).
          if (!explicit) {
            const online = typeof navigator === 'undefined' || navigator.onLine !== false
            const stored = readStoredSession()
            // S3: offline can NEVER prove a token is dead — a network-induced SIGNED_OUT (mobile background
            // → offline → gotrue gives up) must keep the session; the online listener revalidates on reconnect.
            if (!online) {
              console.warn('[auth:logout] IGNORED — net:offline (network-induced SIGNED_OUT, keeping session)')
              return
            }
            // S3: an EXPIRED access token with a refresh token still present is RECOVERABLE, not dead — do not
            // conflate "access token expired" (routine on mobile resume) with "session dead". If it truly is
            // dead, the next protected request 401s → 401-retry refresh → gotrue re-emits SIGNED_OUT with storage
            // cleared, and we tear down then, with proof.
            if (stored && (stored.hasRefreshToken || !isExpired(stored.expiresAt, Date.now()))) {
              console.warn('[auth:logout] IGNORED spurious SIGNED_OUT — session recoverable in storage (transient/cross-tab)')
              return // keep the app mounted; do NOT tear down a recoverable session
            }
            // Online AND nothing recoverable in storage → gotrue positively removed the session → dead token.
            console.warn('[auth:logout] forced — reason: refresh_failed_or_expired (non-explicit SIGNED_OUT)')
          } else {
            console.log('[auth:logout] explicit user sign-out')
          }
          // Genuine logout → clean, immediate redirect to login (pure navigation, no data fetch that could hang).
          resolvedUserIdRef.current = null // next sign-in is a genuine user change → re-resolves
          clearCtxCache()
          queryClient.clear()
          setAuthState({ status: 'unauthenticated' })
          navigate(LOGIN_ROUTE, { replace: true })
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [runResolver])

  // ── S3: resume + network revalidation ─────────────────────────────
  // Mobile browsers freeze JS (and auth-js's refresh ticker) while backgrounded, so a resumed tab
  // can hold an expired access token that no timer will renew. On every RESUME signal — foreground,
  // bfcache restore, and reconnect — recompute freshness ON DEMAND from expires_at and, if within
  // margin, drive a refresh through the single lock-coalesced entry (coalescedRefresh → auth-js
  // refreshSession → Web Lock). No parallel ticker; we only add trigger signals + bounded backoff.
  useEffect(() => {
    let disposed = false
    let debounceTimer: number | null = null
    let backoffTimer: number | null = null
    let attempt = 0
    // Opaque read so TS can't (wrongly) narrow navigator.onLine across the await below — its value
    // genuinely changes when the network drops mid-refresh.
    const offline = () => navigator.onLine === false

    const runRefresh = async (trigger: string) => {
      if (disposed || offline()) return // pause attempts while offline — they can only fail
      console.log(`[auth:refresh] resume_refresh trigger=${trigger}`)
      const fresh = await coalescedRefresh() // classifies + logs its own failure; never tears down here
      if (disposed) return
      if (fresh?.access_token) { attempt = 0; return }
      // Failure → bounded exponential backoff while online. If it was a genuinely dead token,
      // auth-js has already emitted SIGNED_OUT and the handler tears down; this backoff then no-ops.
      if (offline()) return
      if (attempt >= MAX_REFRESH_ATTEMPTS) {
        attempt = 0
        console.warn('[auth:refresh] backoff exhausted — waiting for next resume/online')
        return
      }
      const delay = backoffDelay(attempt++, REFRESH_BASE_MS, REFRESH_MAX_MS)
      if (backoffTimer) clearTimeout(backoffTimer)
      backoffTimer = window.setTimeout(() => runRefresh('backoff'), delay)
    }

    const revalidate = (trigger: string) => {
      if (disposed) return
      // Debounce: foreground + pageshow + online often fire together on a single resume.
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        const stored = readStoredSession()
        if (!stored) return // unauthenticated — nothing to revalidate
        if (needsRefresh(stored.expiresAt, Date.now(), REFRESH_MARGIN_SEC)) runRefresh(trigger)
      }, REVALIDATE_DEBOUNCE_MS)
    }

    const onVisible = () => { if (document.visibilityState === 'visible') revalidate('visible') }
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) revalidate('bfcache') } // iOS bfcache restore
    const onOnline = () => { console.log('[auth:net] net:online'); attempt = 0; revalidate('online') }
    const onOffline = () => { console.log('[auth:net] net:offline'); if (backoffTimer) clearTimeout(backoffTimer) }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      disposed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (backoffTimer) clearTimeout(backoffTimer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // ── Navigation effect ─────────────────────────────────────────────
  useEffect(() => {
    if (
      authState.status === 'loading' ||
      authState.status === 'resolving'
    ) return

    switch (authState.status) {
      case 'authenticated':
        if (
          location.pathname === '/' ||
          location.pathname === LOGIN_ROUTE ||
          location.pathname === '/create-workspace' ||
          location.pathname === '/pending' ||
          location.pathname.startsWith('/auth') ||
          location.pathname.startsWith('/invite')
        ) {
          navigate('/dashboard', { replace: true })
        }
        break

      // 'unauthenticated' removed — handled directly in SIGNED_OUT above

      case 'no-org':
        // /welcome owns the just-confirmed moment and links onward to
        // create-workspace itself — don't yank the celebration out from under it.
        if (location.pathname !== '/welcome') {
          navigate('/create-workspace', { replace: true })
        }
        break

      case 'pending':
        navigate('/pending', { replace: true })
        break
    }
  // Intentionally only depend on authState.status —
  // location and navigate are stable refs.
  // Adding location.pathname would cause redirect loops.
  }, [authState.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    explicitSignOutRef.current = true // S1-2: mark this SIGNED_OUT as genuine (user-initiated)
    console.log('[auth:logout] explicit signOut requested')
    await supabase.auth.signOut()
  }, [])

  const can = useCallback((permission: Permission): boolean => {
    if (authState.status !== 'authenticated') return false
    return ROLE_PERMISSIONS[authState.context.role]?.includes(permission) ?? false
  }, [authState])

  const isRole = useCallback((role: MembershipContext['role']): boolean => {
    if (authState.status !== 'authenticated') return false
    return authState.context.role === role
  }, [authState])

  const orgId  = authState.status === 'authenticated' ? authState.context.orgId  : null
  const userId = authState.status === 'authenticated' ? authState.context.membershipId : null

  return (
    <AuthContext.Provider value={{ authState, signOut, can, isRole, orgId, userId }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Hooks ─────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function useCan(permission: Permission): boolean {
  return useAuth().can(permission)
}

export function useOrgId(): string {
  const { orgId } = useAuth()
  if (!orgId) throw new Error('useOrgId called outside authenticated context')
  return orgId
}
