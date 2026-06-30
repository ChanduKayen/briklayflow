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
// Excluded from the timeout (legitimately slow, must not be cut):
//   • /storage/  — photo uploads/downloads on slow networks
//   • /functions/ — edge functions (LLM calls can take 20–30s)
// So only PostgREST (/rest/) + auth (/auth/) requests are time-bounded — exactly
// the read paths behind the hung loaders. Normal queries finish in <2s; this
// only ever trips on a genuine hang, so working paths are untouched.
// ─────────────────────────────────────────────────────────────────────────

const DATA_TIMEOUT_MS = 15_000;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url ?? '';
}

const timeoutFetch: typeof fetch = (input, init) => {
  const url = urlOf(input);
  // Don't time out uploads/downloads or edge functions — they're legitimately slow.
  if (url.includes('/storage/') || url.includes('/functions/')) return fetch(input, init);

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
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
