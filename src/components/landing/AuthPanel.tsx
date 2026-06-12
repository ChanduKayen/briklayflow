/**
 * AuthPanel — slide-in right sheet (verbatim chrome from the reference).
 * Submit mirrors Login.tsx's Supabase calls exactly (see the comment at the
 * call site). Per ruling, the "Forgot password?" link is removed for launch
 * (see docs/new-po-redesign-followups.md TICKET 3: password-reset flow +
 * restore the link, and unify both auth paths into a useAuth hook).
 */
import React, { useState, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, Mail, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { V, font, serif, terraGrad } from './landingTokens';

type Mode = 'signin' | 'signup';

// Official Google "G" mark (lucide has no brand icons).
const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
  </svg>
);

export default function AuthPanel({
  open,
  mode,
  setMode,
  onClose,
}: {
  open: boolean;
  mode: Mode;
  setMode: Dispatch<SetStateAction<Mode>>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get('redirect');

  const signin = mode === 'signin';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupComplete, setSignupComplete] = useState(false);

  // Clear transient state when the mode flips or the panel (re)opens.
  useEffect(() => { setError(null); setSignupComplete(false); }, [mode]);
  useEffect(() => { if (open) { setError(null); setSignupComplete(false); setLoading(false); } }, [open]);

  // Google OAuth. Redirects the whole page to Google, then back to the app
  // root, where supabase-js (detectSessionInUrl) exchanges the code and the
  // app's auth listener flips to logged-in. Requires the Google provider to be
  // ENABLED in the Supabase project (dashboard + Google Cloud OAuth client).
  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    // On success the browser navigates away to Google; nothing else runs here.
    if (error) { setError(error.message); setLoading(false); }
  };

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    // Mirrors Login.tsx handleResendConfirmation verbatim.
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Mirrors Login.tsx auth calls verbatim — see docs/new-po-redesign-followups.md ticket: unify into useAuth hook
    if (!signin) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) {
        setError(error.message);
      } else if (data?.user?.identities?.length === 0) {
        // Supabase returns an empty identities array for already-confirmed accounts
        setError('exists');
      } else {
        setSignupComplete(true);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else if (redirectTo) {
        navigate(redirectTo, { replace: true });
      }
      // On success the app's auth listener flips state and renders the app.
    }
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={font}>
      <div className="absolute inset-0" style={{ background: 'rgba(30,26,21,0.45)' }} onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md h-full overflow-y-auto p-7 sm:p-10 flex flex-col"
        style={{ background: V.page }}
        role="dialog" aria-modal="true" aria-label={signin ? 'Sign in' : 'Create account'}
      >
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold" style={{ color: V.ink }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </p>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full" style={{ color: V.faint }}>
            <X size={18} />
          </button>
        </div>

        {signupComplete ? (
          /* Check-your-email state (ruling 6). */
          <div className="mt-10">
            <h2 className="text-2xl" style={{ color: V.ink, ...serif }}>
              Check your email.
            </h2>
            <p className="text-sm mt-3 leading-relaxed" style={{ color: V.sys }}>
              We sent a confirmation link to {email}. Open it, then sign in here.
            </p>
            {error && (
              <p className="text-sm mt-4" style={{ color: V.terraDeep }}>{error}</p>
            )}
            <div className="mt-6">
              <button onClick={handleResend} disabled={loading} className="tlink text-sm font-medium" style={{ color: V.ink }}>
                {loading ? 'Sending…' : 'Resend'}
              </button>
            </div>
            <div className="mt-3">
              <button
                onClick={() => { setSignupComplete(false); setMode('signin'); }}
                className="tlink text-sm"
                style={{ color: V.sys }}
              >
                Back to sign in
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-10">
              <h2 className="text-2xl" style={{ color: V.ink, ...serif }}>
                {signin ? 'Welcome back.' : 'Start building.'}
              </h2>
              <p className="text-sm mt-1.5" style={{ color: V.sys }}>
                {signin ? 'Your sites are where you left them.' : 'Free to start. Set up your first project in minutes.'}
              </p>
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="btng mt-8 w-full py-3.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2.5"
              style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink }}
            >
              <GoogleG /> Continue with Google
            </button>

            <div className="flex items-center gap-3 my-5">
              <span className="flex-1" style={{ height: 1, background: V.line }} />
              <span className="text-xs whitespace-nowrap" style={{ color: V.faint }}>or with email</span>
              <span className="flex-1" style={{ height: 1, background: V.line }} />
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-3">
                {!signin && (
                  <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
                    <span className="text-xs" style={{ color: V.faint }}>Aa</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} required disabled={loading} placeholder="Your name" aria-label="Your name" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
                  </div>
                )}
                <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
                  <Mail size={15} style={{ color: V.faint }} />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} placeholder="Email address" type="email" aria-label="Email address" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
                </div>
                <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
                  <Lock size={15} style={{ color: V.faint }} />
                  <input value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading} minLength={signin ? undefined : 6} placeholder="Password" type="password" aria-label="Password" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
                </div>
              </div>

              {/* Real Supabase error text, plain, under the form. */}
              {error && error !== 'exists' && (
                <p className="text-sm mt-4" style={{ color: V.terraDeep }}>{error}</p>
              )}
              {error === 'exists' && (
                <p className="text-sm mt-4" style={{ color: V.terraDeep }}>
                  An account with this email already exists.{' '}
                  <button type="button" onClick={() => setMode('signin')} className="underline font-medium" style={{ color: V.ink }}>
                    Sign in instead
                  </button>
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btnp mt-6 w-full py-3.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2"
                style={{ background: terraGrad, color: '#fff', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? 'Please wait…' : (
                  <>
                    {signin ? 'Sign in' : 'Create account'} <ArrowRight size={15} className="arr" />
                  </>
                )}
              </button>
            </form>

            <p className="text-sm mt-6 text-center" style={{ color: V.sys }}>
              {signin ? 'New to Briklay? ' : 'Already have an account? '}
              <button onClick={() => setMode(signin ? 'signup' : 'signin')} className="font-medium underline" style={{ color: V.ink }}>
                {signin ? 'Create an account' : 'Sign in'}
              </button>
            </p>
          </>
        )}

        <p className="text-xs mt-auto pt-10 text-center" style={{ color: V.faint }}>
          Built by builders, for builders · your data stays yours
        </p>
      </div>
    </div>
  );
}
