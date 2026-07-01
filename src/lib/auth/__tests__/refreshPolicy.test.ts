// S3 — exhaustive table tests for the pure refresh-policy core. No browser.
import { suite, test, expect } from './harness';
import {
  classifyRefreshError,
  extractErrorCode,
  isExpired,
  needsRefresh,
  backoffDelay,
  parseStoredSession,
  DEAD_TOKEN_CODES,
} from '../refreshPolicy';

const NOW = 1_700_000_000_000; // fixed "now" in ms
const nowSec = Math.floor(NOW / 1000);

suite('classifyRefreshError — GOVERNING INVARIANT (signout only on dead token)', () => {
  // Every dead-token code, in every shape gotrue might surface it, while ONLINE → signout.
  const deadShapes: Array<[string, unknown]> = [
    ['error_code field', { error_code: 'refresh_token_not_found', status: 400 }],
    ['code field', { code: 'refresh_token_not_found' }],
    ['message field', { message: 'Invalid Refresh Token: refresh_token_not_found' }],
    ['invalid_grant error field', { error: 'invalid_grant', error_description: 'Already used' }],
    ['invalid_grant in message', { message: 'AuthApiError: invalid_grant' }],
    ['already_used code', { code: 'refresh_token_already_used' }],
    ['already_used in error_description', { error_description: 'refresh_token_already_used' }],
    ['bare string', 'invalid_grant'],
  ];
  for (const [label, err] of deadShapes) {
    test(`ONLINE + ${label} → signout`, () => {
      const d = classifyRefreshError(err, true);
      expect(d.action).toBe('signout');
    });
    // The SAME dead error OFFLINE must NOT sign out — offline can't prove token death.
    test(`OFFLINE + ${label} → retry/offline (never signout)`, () => {
      expect(classifyRefreshError(err, false)).toEqual({ action: 'retry', reason: 'offline' });
    });
  }

  // Everything that is NOT a positively-dead token → retry (keep session), while online.
  const transientShapes: Array<[string, unknown]> = [
    ['fetch throw (TypeError)', new TypeError('Failed to fetch')],
    ['500 server error', { status: 500, message: 'Internal Server Error' }],
    ['429 rate limit', { status: 429, message: 'Too Many Requests' }],
    ['ambiguous bare 401', { status: 401, message: 'Unauthorized' }],
    ['ambiguous bare 400', { status: 400, message: 'Bad Request' }],
    ['timeout', { name: 'TimeoutError', message: 'Request timed out' }],
    ['abort', { name: 'AbortError', message: 'aborted' }],
    ['captive-portal html', { status: 400, message: '<html>Sign in to WiFi</html>' }],
    ['empty object', {}],
    ['null', null],
    ['undefined', undefined],
    ['unrelated string', 'something exploded'],
  ];
  for (const [label, err] of transientShapes) {
    test(`ONLINE + ${label} → retry/transient`, () => {
      expect(classifyRefreshError(err, true)).toEqual({ action: 'retry', reason: 'transient' });
    });
    test(`OFFLINE + ${label} → retry/offline`, () => {
      expect(classifyRefreshError(err, false)).toEqual({ action: 'retry', reason: 'offline' });
    });
  }

  test('reason carries the matched dead code', () => {
    expect(classifyRefreshError({ code: 'invalid_grant' }, true).reason).toBe('invalid_grant');
    expect(classifyRefreshError({ code: 'refresh_token_already_used' }, true).reason).toBe('refresh_token_already_used');
  });

  test('exactly three dead codes are recognised', () => {
    expect(DEAD_TOKEN_CODES.length).toBe(3);
  });
});

suite('extractErrorCode — normalisation', () => {
  test('null/undefined → empty', () => { expect(extractErrorCode(null)).toBe(''); expect(extractErrorCode(undefined)).toBe(''); });
  test('string lowercased', () => { expect(extractErrorCode('Invalid_Grant')).toBe('invalid_grant'); });
  test('joins multiple string fields', () => {
    expect(extractErrorCode({ code: 'X', message: 'Y', status: 400 })).toBe('x y');
  });
  test('non-string fields ignored', () => {
    expect(extractErrorCode({ status: 401, ok: false })).toBe('');
  });
});

suite('isExpired — on-demand truth from expires_at vs now', () => {
  test('past → expired', () => { expect(isExpired(nowSec - 10, NOW)).toBe(true); });
  test('future → not expired', () => { expect(isExpired(nowSec + 10, NOW)).toBe(false); });
  test('exactly now → expired (>=)', () => { expect(isExpired(nowSec, NOW)).toBe(true); });
  test('null → expired (unknown)', () => { expect(isExpired(null, NOW)).toBe(true); });
  test('undefined → expired', () => { expect(isExpired(undefined, NOW)).toBe(true); });
  test('NaN → expired', () => { expect(isExpired(NaN, NOW)).toBe(true); });
});

suite('needsRefresh — margin window', () => {
  const MARGIN = 60; // seconds
  test('well before margin → false', () => { expect(needsRefresh(nowSec + 3600, NOW, MARGIN)).toBe(false); });
  test('just outside margin → false', () => { expect(needsRefresh(nowSec + 61, NOW, MARGIN)).toBe(false); });
  test('exactly at margin edge → true', () => { expect(needsRefresh(nowSec + 60, NOW, MARGIN)).toBe(true); });
  test('inside margin → true', () => { expect(needsRefresh(nowSec + 30, NOW, MARGIN)).toBe(true); });
  test('already expired → true', () => { expect(needsRefresh(nowSec - 5, NOW, MARGIN)).toBe(true); });
  test('null → true', () => { expect(needsRefresh(null, NOW, MARGIN)).toBe(true); });
  test('margin 0 equals isExpired', () => {
    expect(needsRefresh(nowSec + 1, NOW, 0)).toBe(false);
    expect(needsRefresh(nowSec, NOW, 0)).toBe(true);
  });
});

suite('backoffDelay — bounded exponential', () => {
  test('attempt 0 → base', () => { expect(backoffDelay(0, 1000, 30000)).toBe(1000); });
  test('attempt 1 → 2·base', () => { expect(backoffDelay(1, 1000, 30000)).toBe(2000); });
  test('attempt 3 → 8·base', () => { expect(backoffDelay(3, 1000, 30000)).toBe(8000); });
  test('clamped to max', () => { expect(backoffDelay(10, 1000, 30000)).toBe(30000); });
  test('negative attempt clamps to base', () => { expect(backoffDelay(-5, 1000, 30000)).toBe(1000); });
  test('huge attempt → max (no Infinity)', () => { expect(backoffDelay(1000, 1000, 30000)).toBe(30000); });
});

suite('parseStoredSession — recoverable vs dead (expired access ≠ dead session)', () => {
  test('direct shape with refresh token', () => {
    const raw = JSON.stringify({ expires_at: nowSec + 100, refresh_token: 'r1', access_token: 'a1' });
    expect(parseStoredSession(raw)).toEqual({ expiresAt: nowSec + 100, hasRefreshToken: true });
  });
  test('EXPIRED access token but refresh token present → still recoverable', () => {
    const raw = JSON.stringify({ expires_at: nowSec - 9999, refresh_token: 'r1' });
    const info = parseStoredSession(raw)!;
    expect(info.hasRefreshToken).toBe(true);
    expect(isExpired(info.expiresAt, NOW)).toBe(true); // access expired…
    // …but recoverable, because a refresh token is present. The guard must NOT log out on this.
  });
  test('wrapped currentSession shape', () => {
    const raw = JSON.stringify({ currentSession: { expires_at: nowSec + 5, refresh_token: 'r2' } });
    expect(parseStoredSession(raw)).toEqual({ expiresAt: nowSec + 5, hasRefreshToken: true });
  });
  test('missing refresh token → not recoverable', () => {
    const raw = JSON.stringify({ expires_at: nowSec + 5, access_token: 'a1' });
    expect(parseStoredSession(raw)).toEqual({ expiresAt: nowSec + 5, hasRefreshToken: false });
  });
  test('empty refresh token → not recoverable', () => {
    const raw = JSON.stringify({ expires_at: nowSec + 5, refresh_token: '' });
    expect(parseStoredSession(raw)!.hasRefreshToken).toBe(false);
  });
  test('no expires_at → expiresAt null', () => {
    const raw = JSON.stringify({ refresh_token: 'r1' });
    expect(parseStoredSession(raw)).toEqual({ expiresAt: null, hasRefreshToken: true });
  });
  test('null raw → null', () => { expect(parseStoredSession(null)).toBe(null); });
  test('empty string → null', () => { expect(parseStoredSession('')).toBe(null); });
  test('invalid JSON → null', () => { expect(parseStoredSession('{not json')).toBe(null); });
  test('non-object JSON → null', () => { expect(parseStoredSession('123')).toBe(null); });
});
