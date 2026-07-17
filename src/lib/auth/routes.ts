// S1-2 Part B — single source of truth for the auth/login destination.
//
// Every path that sends a user to sign in MUST use this constant: the auth guards,
// the onAuthStateChange → SIGNED_OUT handler, the router's unauthenticated fallback,
// and any involuntary redirect (invite, welcome, create-workspace). Hardcoding '/login'
// in individual call sites is how an involuntary signout drifted onto the retired
// standalone login screen — one constant keeps every redirect pointed at the current
// login surface (the Landing screen, which renders for '/' and LOGIN_ROUTE).
export const LOGIN_ROUTE = '/login';

/**
 * The login destination that REMEMBERS where he was going.
 *
 * ══ WHY ═══════════════════════════════════════════════════════════════════════════════════════
 * Every WhatsApp answer carries a "View ledger" button:
 *
 *     /ledger?stakeholder=STK-3819&project=The%20Pride
 *
 * WhatsApp opens it in its OWN in-app browser, which has its own cookie jar — so that tap very
 * often arrives with no session. The guard then did `<Navigate to={LOGIN_ROUTE} replace />`,
 * throwing away the pathname AND the query. After signing in he landed on the default route:
 * the COMPLETE ledger. Not his party, not his site — and the number he tapped from was about
 * one site, so the page and the message he'd just read disagreed.
 *
 * The receiving half already existed and had for months: AuthPanel reads `?redirect=` and
 * navigates to it on sign-in. Nothing ever SENT it. This is that missing sender.
 *
 * `search` must ride along or this fixes nothing — the whole payload of a ledger deep link
 * (which party, which site) is in the query string, not the path.
 */
export const loginRouteFor = (pathname: string, search = ''): string =>
  `${LOGIN_ROUTE}?redirect=${encodeURIComponent(pathname + search)}`;

/**
 * Validate a `?redirect=` before navigating to it. Returns null for anything that isn't a plain
 * same-site path.
 *
 * This value arrives in a URL, so it is attacker-supplied by definition: a link reading
 * `…/login?redirect=//evil.example` costs nothing to send and, unchecked, turns our login screen
 * into a redirector that wears our domain. `//host` is protocol-relative and `https://host` is
 * absolute — both must start with a single slash and neither does. A path is one slash, then not
 * another.
 *
 * Deliberately NOT a URL parse: `new URL(raw, origin)` resolves the hostile cases into something
 * that looks fine, which is how this check is usually got wrong.
 */
export const safeRedirect = (raw: string | null | undefined): string | null =>
  raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
