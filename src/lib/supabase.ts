import { createClient } from '@supabase/supabase-js';

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

const timeoutFetch: typeof fetch = (input, init) => {
  const url = urlOf(input);
  // Never time out uploads/downloads, edge functions, or AUTH TOKEN REFRESH (S1-2).
  if (url.includes('/storage/') || url.includes('/functions/') || url.includes('/auth/')) return fetch(input, init);

  const ctrl = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => {
    // S1-2 Step 5: log which route was cut and how long it ran, so a legitimately-slow query being
    // aborted becomes visible in logs (data-driven threshold) instead of via a frustrated user.
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
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: timeoutFetch },
});
