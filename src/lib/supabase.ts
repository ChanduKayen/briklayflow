import { createClient } from '@supabase/supabase-js';
import { classifyRefreshError } from './auth/refreshPolicy';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// ─────────────────────────────────────────────────────────────────────────
// S1-1 — no unbounded loaders (stabilization sprint).
//
// React Query's `retry` only fires when a fetch REJECTS. A request that HANGS
// forever (dead socket on flaky site 3G) never rejects, so the query stays
// `isLoading` and the screen spins forever — the exact "loader spins on a blank
// page" failure. We bound every DATA request with an AbortController timeout:
// a hung request aborts → the query rejects → retry/error handling takes over.
//
// Excluded from the timeout (must NOT be cut):
//   • /storage/  — photo uploads/downloads on slow networks (legitimately slow)
//   • /functions/ — edge functions (LLM calls can take 20–30s)
//   • /auth/     — token refresh (S1-2): aborting a slow refresh with an AbortError
//                  makes gotrue treat it as a non-retryable failure and DROP the
//                  session → a spurious logout mid-action. gotrue has its own
//                  network-retry for refresh; we must never cut it.
// So only PostgREST (/rest/) reads are time-bounded — exactly the paths behind the
// hung loaders. Normal queries finish in <2s; this only trips on a genuine hang.
// ─────────────────────────────────────────────────────────────────────────

const DATA_TIMEOUT_MS = 15_000;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url ?? '';
}

// S1-2 Step 5: keep the 15s threshold OBSERVABLE — short route label for the abort log.
function shortRoute(url: string): string {
  const i = url.indexOf('/rest/');
  return i >= 0 ? url.slice(i) : url.replace(/^https?:\/\/[^/]+/, '');
}

// Timeout-bounded fetch for a single /rest/ request (the S1-1 watchdog). Extracted so the
// S3 401-retry can reuse the exact same bounding for its one retry attempt.
function boundedFetch(input: RequestInfo | URL, init: RequestInit | undefined, url: string): Promise<Response> {
  const ctrl = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => {
    console.warn(`[fetch:timeout] aborted after ${Date.now() - started}ms — ${shortRoute(url)}`);
    try { ctrl.abort(new DOMException('Request timed out — the connection stalled.', 'TimeoutError')); }
    catch { ctrl.abort(); }
  }, DATA_TIMEOUT_MS);

  // Respect a caller-supplied signal (e.g. React Query cancellation) too.
  const ext = init?.signal;
  if (ext) {
    if (ext.aborted) { clearTimeout(timer); return Promise.reject(ext.reason ?? new DOMException('Aborted', 'AbortError')); }
    ext.addEventListener('abort', () => { try { ctrl.abort((ext as AbortSignal).reason); } catch { ctrl.abort(); } }, { once: true });
  }

  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ── header helpers for the S3 401-retry ──────────────────────────────────
function hasBearer(init: RequestInit | undefined): boolean {
  try { return new Headers(init?.headers as HeadersInit | undefined).has('authorization'); }
  catch { return false; }
}
function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

const timeoutFetch: typeof fetch = async (input, init) => {
  const url = urlOf(input);
  // Never time out uploads/downloads, edge functions, or AUTH TOKEN REFRESH (S1-2).
  if (url.includes('/storage/') || url.includes('/functions/') || url.includes('/auth/')) return fetch(input, init);

  const res = await boundedFetch(input, init, url);

  // ── S3 401-retry safety net ──────────────────────────────────────────
  // On mobile resume the access token can be expired before auth-js's (visibility-gated,
  // frozen-while-backgrounded) auto-refresh catches up → the protected request 401s. Do ONE
  // lock-coalesced refresh and retry the request once with the fresh token. A refresh FLAP here
  // must NOT log out — coalescedRefresh classifies the failure and never tears the session down
  // (sign-out, if the token is genuinely dead, remains auth-js's SIGNED_OUT → the AuthProvider
  // handler). Only fires for authenticated /rest/ calls while online, exactly once (the retry
  // calls boundedFetch directly, so it can't recurse into another 401-retry).
  if (res.status === 401 && hasBearer(init) && isOnline()) {
    const fresh = await coalescedRefresh();
    if (fresh?.access_token) {
      console.log('[auth:event] 401-retry — refreshed, retrying /rest request once');
      return boundedFetch(input, withBearer(init, fresh.access_token), url);
    }
  }
  return res;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timeoutFetch },
});

// ─────────────────────────────────────────────────────────────────────────
// S3 — the single app-level refresh entry point.
//
// HARD RULE: never create a second refresh path that races the existing one. This does NOT
// spin its own ticker — it calls auth-js's own refreshSession(), which coalesces across tabs via
// the navigator Web Lock. On top of that, `inFlightRefresh` collapses concurrent same-tab callers
// (a burst of 401s + a resume-revalidate) into ONE refresh so we never rotate the refresh token
// more than once. Both the 401-retry above and the AuthProvider resume path go through here.
// A failure is classified (fail-safe: only a positively-dead token is a sign-out) and logged, but
// teardown is left to auth-js's SIGNED_OUT so there is a single sign-out path.
// ─────────────────────────────────────────────────────────────────────────
let inFlightRefresh: Promise<{ access_token: string } | null> | null = null;

export function coalescedRefresh(): Promise<{ access_token: string } | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = supabase.auth
      .refreshSession()
      .then(({ data, error }) => {
        if (error) {
          const d = classifyRefreshError(error, isOnline());
          console.warn(`[auth:refresh] classify:${d.reason} action=${d.action}`);
          return null;
        }
        return data.session ? { access_token: data.session.access_token } : null;
      })
      .catch((err) => {
        const d = classifyRefreshError(err, isOnline());
        console.warn(`[auth:refresh] classify:${d.reason} action=${d.action}`);
        return null;
      })
      .finally(() => { inFlightRefresh = null; });
  }
  return inFlightRefresh;
}
