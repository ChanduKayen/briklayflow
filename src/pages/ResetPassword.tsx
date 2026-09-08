/**
 * ResetPassword — the destination of the "reset your password" email link.
 *
 * Supabase drops the user here in a short-lived RECOVERY session (from the link's token), so
 * updateUser({ password }) works without the old password. If there's no session (the link was opened
 * cold, or expired), we say so and send them back to sign in. On success we route into the app — the
 * recovery session is a real session, so they're signed in with the new password already set.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { V, serif, terraGrad } from '../components/landing/landingTokens';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);       // did we land in a recovery/real session?
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A recovery link establishes a session (PASSWORD_RECOVERY). Wait for it before deciding "expired".
  useEffect(() => {
    let settled = false;
    supabase.auth.getSession().then(({ data }) => { if (!settled) { setReady(!!data.session); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { settled = true; setReady(!!session); });
    // If nothing arrives shortly, getSession's result stands (no session → expired copy).
    const t = setTimeout(() => { settled = true; }, 4000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { setError('Use at least 6 characters.'); return; }
    if (pw !== pw2) { setError('The two passwords don’t match.'); return; }
    setLoading(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(() => navigate('/', { replace: true }), 1400);
  };

  const field = { background: V.surface, border: `1px solid ${V.line}`, height: 50 } as const;

  return (
    <div style={{ minHeight: '100dvh', background: V.page, display: 'grid', placeItems: 'center', padding: 20, fontFamily: "'DM Sans',system-ui,sans-serif" }}>
      <div style={{ width: 'min(420px,100%)' }}>
        <h1 className="text-2xl" style={{ color: V.ink, ...serif, margin: 0 }}>Set a new password.</h1>

        {done ? (
          <div className="mt-6 flex items-center gap-2.5" style={{ color: V.terra }}>
            <CheckCircle2 size={18} /> <span className="text-sm" style={{ color: V.ink }}>Password updated — taking you in…</span>
          </div>
        ) : !ready ? (
          <>
            <p className="text-sm mt-3 leading-relaxed" style={{ color: V.sys }}>
              This reset link isn’t active — it may have expired or already been used. Request a fresh one from the sign-in screen.
            </p>
            <button onClick={() => navigate('/', { replace: true })} className="mt-6 w-full py-3.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2" style={{ background: terraGrad, color: '#fff' }}>
              Back to sign in <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="text-sm mt-3" style={{ color: V.sys }}>Choose a new password for your account.</p>
            <div className="flex items-center gap-2.5 px-4 rounded-xl mt-6" style={field}>
              <Lock size={15} style={{ color: V.faint }} />
              <input value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoFocus placeholder="New password" type="password" aria-label="New password" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
            </div>
            <div className="flex items-center gap-2.5 px-4 rounded-xl mt-3" style={field}>
              <Lock size={15} style={{ color: V.faint }} />
              <input value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} placeholder="Confirm new password" type="password" aria-label="Confirm new password" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
            </div>
            {error && <p className="text-sm mt-4" style={{ color: V.terraDeep }}>{error}</p>}
            <button type="submit" disabled={loading} className="mt-6 w-full py-3.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2" style={{ background: terraGrad, color: '#fff', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Updating…' : <>Update password <ArrowRight size={15} /></>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
