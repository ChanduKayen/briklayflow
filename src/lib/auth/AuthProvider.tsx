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
import { supabase } from '../supabase'
import { resolveAuthDestination, type MembershipContext } from './resolver'
import { LOGIN_ROUTE } from './routes'

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

// S1-2: read the persisted Supabase session SYNCHRONOUSLY from localStorage — no lock, no network,
// cannot hang. supabase.auth.getSession() acquires the gotrue auth lock and can stall behind an
// in-flight signOut()/refresh (that stall left the app on a blank splash after a rail sign-out).
// The logout redirect must be pure navigation, never gated on something that can hang (ticket Step 3),
// so the spurious-SIGNED_OUT guard re-syncs straight from storage instead of calling getSession().
function storedSessionStillValid(): boolean {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key)
        if (!raw) return false
        const parsed = JSON.parse(raw)
        const expiresAt = parsed?.expires_at ?? parsed?.currentSession?.expires_at ?? parsed?.session?.expires_at
        // No parseable expiry but a token blob is present → treat as still-valid (don't tear down).
        return typeof expiresAt === 'number' ? expiresAt * 1000 > Date.now() : true
      }
    }
  } catch { /* unreadable storage → fall through to "no valid session" */ }
  return false
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
          // S1-2 Step 2/3: a NON-explicit SIGNED_OUT is gotrue-initiated (refresh failure). A transient
          // network failure must never end a valid session — confirm the session is truly gone first,
          // reading storage SYNCHRONOUSLY (never getSession(), which can hang on the auth lock).
          if (!explicit) {
            if (storedSessionStillValid()) {
              console.warn('[auth:logout] IGNORED spurious SIGNED_OUT — valid session still in storage (transient/cross-tab)')
              return // keep the app mounted; do NOT tear down a valid session
            }
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
