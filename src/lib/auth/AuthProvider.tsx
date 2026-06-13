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
      console.error('[AuthProvider] resolver threw:', err)
      // If we have cached data, keep showing the app — network may be flaky
      if (!cached) setAuthState({ status: 'unauthenticated' })
    } finally {
      resolvingRef.current = false
    }
  }, [navigate])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        runResolver(session.user.id, session.user.email ?? '')
      } else {
        setAuthState({ status: 'unauthenticated' })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await runResolver(session.user.id, session.user.email ?? '')
        }
        if (event === 'SIGNED_OUT') {
          clearCtxCache()
          queryClient.clear()
          setAuthState({ status: 'unauthenticated' })
          navigate('/login', { replace: true })
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
          location.pathname === '/login' ||
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
