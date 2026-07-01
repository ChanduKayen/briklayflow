// S1-2 Part B — single source of truth for the auth/login destination.
//
// Every path that sends a user to sign in MUST use this constant: the auth guards,
// the onAuthStateChange → SIGNED_OUT handler, the router's unauthenticated fallback,
// and any involuntary redirect (invite, welcome, create-workspace). Hardcoding '/login'
// in individual call sites is how an involuntary signout drifted onto the retired
// standalone login screen — one constant keeps every redirect pointed at the current
// login surface (the Landing screen, which renders for '/' and LOGIN_ROUTE).
export const LOGIN_ROUTE = '/login';
