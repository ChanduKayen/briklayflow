/**
 * LoginRegister — the register-book login / sign-up screen.
 *
 * The reference (src/pages/loginV1.html) is rendered VERBATIM inside a
 * full-viewport iframe, exactly like the marketing landing (Landing.tsx), so its
 * bespoke stylesheet, page-turn animation, OTP blanks and self-writing "Your
 * Briklay" cover run as authored with zero global-CSS leakage into the app.
 *
 * Its simulated auth is rewired to the REAL Supabase calls here: every button in
 * the sheet postMessages a `brik-auth-req` up to this component, which runs the
 * same supabase-js calls AuthPanel does and answers with `brik-auth-res`. On a
 * successful phone/password login we navigate to `?redirect=` (WhatsApp deep
 * links); otherwise the app's auth listener flips to the dashboard on its own.
 *
 * Rendered at `/login` and `/signup` for logged-out users only (see App.tsx).
 */
import { useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { safeRedirect } from '../lib/auth/routes';
import loginHtml from './loginV1.html?raw';

type Reply = { id: number; ok: boolean; error?: string; kind?: 'exists' | 'unconfirmed' | 'nouser' };
type Req = {
  type?: string;
  id?: number;
  action?: string;
  payload?: { phone?: string; token?: string; email?: string; password?: string; name?: string; firm?: string; mode?: string; resend?: boolean };
};

// Normalize to E.164 (mirrors AuthPanel.toE164). India default: bare 10 digits → +91XXXXXXXXXX.
const toE164 = (raw: string): string => {
  const d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return '+' + d;
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  return '+' + d;
};

export default function LoginRegister() {
  const navigate = useNavigate();
  const location = useLocation();

  // Where the guard was sending him (a WhatsApp "View ledger" deep link, usually). safeRedirect()
  // because this rides in on a URL anyone can compose — `?redirect=//evil.example` must not turn our
  // own login screen into an open redirector.
  const redirectTo = safeRedirect(new URLSearchParams(location.search).get('redirect'));

  // Which face the book opens on: `/signup` and the team-invite deep link (`?method=phone`) start on
  // sign-up; everything else on log-in. Injected into the iframe as `__BRIK_INIT__`.
  const initMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (location.pathname === '/signup' || params.get('method') === 'phone') ? 'signup' : 'login';
  }, [location.pathname, location.search]);

  const srcDoc = useMemo(
    () => loginHtml.replace('__BRIK_INIT__', JSON.stringify({ mode: initMode })),
    [initMode],
  );

  useEffect(() => {
    const prevTitle = document.title;
    document.title = (initMode === 'signup' ? 'Sign up' : 'Log in') + ' · Briklay';
    return () => { document.title = prevTitle; };
  }, [initMode]);

  useEffect(() => {
    const origin = window.location.origin;

    const onMsg = async (e: MessageEvent) => {
      const d = e.data as Req | null;
      if (!d || d.type !== 'brik-auth-req') return;
      const source = e.source as Window | null;
      const reply = (r: Omit<Reply, 'id'>) => source?.postMessage({ type: 'brik-auth-res', id: d.id, ...r }, '*');
      // Fire the "dot becomes a door" celebration (SignInCelebration, mounted above the auth
      // tree) the instant a sign-in succeeds — dispatched before the session flip unmounts us.
      const celebrate = (mode: 'login' | 'signup', name?: string) =>
        window.dispatchEvent(new CustomEvent('brik-celebrate', { detail: { mode, name } }));
      const p = d.payload ?? {};

      try {
        switch (d.action) {
          case 'send-otp': {
            const phone = toE164(p.phone ?? '');
            // A resend (the user already exists at this point) — just re-send, no existence gate.
            if (p.resend) {
              const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
              reply({ ok: !error, error: error?.message });
              break;
            }
            if (p.mode === 'signup') {
              // SIGN-UP is for NEW numbers only. Probe with shouldCreateUser:false: no error means the
              // number already has an account → block (send them to log in). An error means it does not
              // exist → create it and send the code.
              const probe = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
              if (!probe.error) { reply({ ok: false, kind: 'exists' }); break; }
              const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
              reply({ ok: !error, error: error?.message });
              break;
            }
            // LOG-IN is for EXISTING numbers only — never silently create one.
            const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
            if (error) {
              if (/not found|no user|signups?\s*not\s*allowed|otp.?disabled|user.*not.*exist/i.test(error.message)) reply({ ok: false, kind: 'nouser' });
              else reply({ ok: false, error: error.message });
              break;
            }
            reply({ ok: true });
            break;
          }
          case 'verify-otp': {
            // LOGIN: verify creates the session → the app's auth listener opens it.
            const { error } = await supabase.auth.verifyOtp({ phone: toE164(p.phone ?? ''), token: p.token ?? '', type: 'sms' });
            if (error) { reply({ ok: false, error: error.message }); break; }
            celebrate('login');
            reply({ ok: true });
            if (redirectTo) navigate(redirectTo, { replace: true });
            break;
          }
          case 'verify-signup': {
            // SIGNUP: verify the code AND set the name together, so the account is born named
            // (a phone user has no email fallback — without this the profile name is the raw digits).
            const { error } = await supabase.auth.verifyOtp({ phone: toE164(p.phone ?? ''), token: p.token ?? '', type: 'sms' });
            if (error) { reply({ ok: false, error: error.message }); break; }
            if (p.name) await supabase.auth.updateUser({ data: { full_name: p.name } });
            celebrate('signup', p.name);
            reply({ ok: true });
            if (redirectTo) navigate(redirectTo, { replace: true });
            break;
          }
          case 'email-login': {
            const { error } = await supabase.auth.signInWithPassword({ email: p.email ?? '', password: p.password ?? '' });
            if (error) {
              // Unconfirmed email is recoverable, not a dead end — surface the "check your email" state.
              if (/email not confirmed|not confirmed|confirm/i.test(error.message)) reply({ ok: false, kind: 'unconfirmed' });
              else reply({ ok: false, error: error.message });
              break;
            }
            celebrate('login');
            reply({ ok: true });
            if (redirectTo) navigate(redirectTo, { replace: true });
            break;
          }
          case 'email-signup': {
            const { data, error } = await supabase.auth.signUp({
              email: p.email ?? '',
              password: p.password ?? '',
              options: { data: { full_name: p.name }, emailRedirectTo: `${origin}/welcome` },
            });
            if (error) reply({ ok: false, error: error.message });
            // Supabase returns an empty identities array for an already-confirmed account.
            else if (data?.user?.identities?.length === 0) reply({ ok: false, kind: 'exists' });
            else reply({ ok: true });
            break;
          }
          case 'forgot': {
            // Always answer ok, even on error, so an address can't be probed.
            await supabase.auth.resetPasswordForEmail(p.email ?? '', { redirectTo: `${origin}/reset-password` });
            reply({ ok: true });
            break;
          }
          case 'google': {
            const { error } = await supabase.auth.signInWithOAuth({
              provider: 'google',
              // Google leaves the app entirely; the deep link can only survive by riding in this url.
              options: { redirectTo: origin + (redirectTo ?? '') },
            });
            // On success the browser navigates away to Google; only an error comes back here.
            if (error) reply({ ok: false, error: error.message });
            break;
          }
        }
      } catch (err) {
        reply({ ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' });
      }
    };

    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate, redirectTo]);

  return (
    <iframe
      title="Log in to Briklay"
      srcDoc={srcDoc}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 0, display: 'block' }}
    />
  );
}
