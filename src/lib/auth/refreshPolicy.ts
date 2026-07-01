// ─────────────────────────────────────────────────────────────────────────
// S3 — Mobile auth hardening: the pure, deterministic refresh-policy core.
//
// GOVERNING INVARIANT: sign out ONLY on a positively-identified dead refresh
// token. Every other failure — offline, timeout, 5xx, 429, ambiguous 400/401,
// fetch throw — must RETRY and KEEP the session. Fail safe toward staying in.
//
// This module has NO browser dependencies (no window/localStorage/Date global
// state) so it can be exhaustively table-tested under Node. `now` and `online`
// are always passed in. It decides; the wiring acts.
// ─────────────────────────────────────────────────────────────────────────

export type RefreshAction = 'signout' | 'retry';

export interface RefreshDecision {
  action: RefreshAction;
  /** Bare reason, e.g. 'invalid_grant' | 'offline' | 'transient'. Callers log `classify:${reason}`. */
  reason: string;
}

// The ONLY error signatures that positively identify a dead/unusable refresh
// token. gotrue surfaces these as `error_code`/`error`/`message`. Anything not
// matching one of these — including bare 401/403, 5xx, 429, and network throws —
// is treated as transient and retried.
export const DEAD_TOKEN_CODES = [
  'refresh_token_not_found',
  'invalid_grant',
  'refresh_token_already_used',
] as const;

/**
 * Normalise an arbitrary thrown value / Supabase AuthError into a single
 * lowercase haystack string we can substring-match dead-token codes against.
 * Handles strings, Error instances, and AuthApiError-shaped objects
 * ({ code, error_code, error, name, message, error_description, status }).
 */
export function extractErrorCode(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err.toLowerCase();
  if (typeof err !== 'object') return String(err).toLowerCase();
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ['code', 'error_code', 'error', 'name', 'message', 'error_description', 'msg']) {
    const v = e[k];
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Classify a refresh failure. The whole point of S3: invert the old branch that
 * collapsed "network failure" and "token death" into one sign-out path.
 *
 * - offline           → retry (offline can NEVER prove a token is dead)
 * - dead-token code    → signout (the only positive identification)
 * - anything else      → retry (transient; keep the session)
 */
export function classifyRefreshError(err: unknown, online: boolean): RefreshDecision {
  if (!online) return { action: 'retry', reason: 'offline' };
  const hay = extractErrorCode(err);
  for (const code of DEAD_TOKEN_CODES) {
    if (hay.includes(code)) return { action: 'signout', reason: code };
  }
  return { action: 'retry', reason: 'transient' };
}

/**
 * On-demand expiry truth. Freshness is ALWAYS computed from expires_at vs now —
 * never inferred from whether a scheduled timer fired (mobile freezes timers).
 * A missing/non-finite expiry is treated as expired (unknown → refresh).
 */
export function isExpired(expiresAtSec: number | null | undefined, nowMs: number): boolean {
  if (typeof expiresAtSec !== 'number' || !Number.isFinite(expiresAtSec)) return true;
  return nowMs >= expiresAtSec * 1000;
}

/**
 * Should we refresh proactively? True once we are within `marginSec` of expiry
 * (or already past it). isExpired is the marginSec=0 case.
 */
export function needsRefresh(
  expiresAtSec: number | null | undefined,
  nowMs: number,
  marginSec: number,
): boolean {
  if (typeof expiresAtSec !== 'number' || !Number.isFinite(expiresAtSec)) return true;
  return nowMs >= (expiresAtSec - marginSec) * 1000;
}

/** Bounded exponential backoff: base·2^attempt, clamped to maxMs. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const a = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const raw = baseMs * 2 ** a;
  if (!Number.isFinite(raw)) return maxMs;
  return Math.min(maxMs, raw);
}

export interface StoredSessionInfo {
  /** unix seconds, or null when the blob has no parseable expiry */
  expiresAt: number | null;
  /** whether a non-empty refresh_token is present → session is RECOVERABLE */
  hasRefreshToken: boolean;
}

/**
 * Parse the raw `sb-*-auth-token` localStorage blob into the two facts the guard
 * needs — synchronously and lock-free. Pure (string in → info out) so it is
 * table-testable; the browser side only supplies the raw string.
 *
 * Supabase stores the session object directly; older/SSR shapes wrap it in
 * `currentSession` or `session`. hasRefreshToken is what distinguishes an expired
 * access token (recoverable) from a genuinely dead session (not recoverable).
 */
export function parseStoredSession(raw: string | null | undefined): StoredSessionInfo | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const outer = parsed as Record<string, unknown>;
  const inner = (outer.currentSession ?? outer.session ?? outer) as Record<string, unknown>;
  if (!inner || typeof inner !== 'object') return null;
  const expiresAtRaw = inner.expires_at;
  const expiresAt = typeof expiresAtRaw === 'number' && Number.isFinite(expiresAtRaw) ? expiresAtRaw : null;
  const rt = inner.refresh_token;
  const hasRefreshToken = typeof rt === 'string' && rt.length > 0;
  return { expiresAt, hasRefreshToken };
}
