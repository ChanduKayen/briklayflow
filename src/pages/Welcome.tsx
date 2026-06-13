/**
 * Welcome — the account-confirmed page, the success destination of the email
 * confirmation link (emailRedirectTo -> /welcome).
 *
 * The moment: the user just clicked the link, carrying a flicker of "did it work?".
 * The page does two jobs — RELIEF (you're in) then MOMENTUM (here's your first
 * step). Signature: the brand brick FALLS and LANDS, founding the line
 * "You're in, {name}." (reference: docs/reference/BriklayConfirmed.jsx).
 *
 * It assumes success ALREADY happened — supabase-js detectSessionInUrl has
 * exchanged the hash by the time we render, so we gate on the resolved auth state:
 *   session present  -> celebrate
 *   no session       -> the link was invalid/expired/used -> back to sign in,
 *                       where the existing resend flow lives (we do not rebuild it).
 *
 * A freshly confirmed signup has no workspace yet, so the first step is
 * /create-workspace (which flows into onboarding + the first project). The
 * day-book path is deferred until a workspace exists.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth/AuthProvider';
import { V, font, serif, terraGrad } from '../components/day-book/tokens';

const CSS = `
@keyframes cfBrickFall {
  0%   { opacity: 0; transform: translate(-50%, -120px) rotate(-8deg); animation-timing-function: cubic-bezier(.5,0,.9,.4); }
  8%   { opacity: 1; }
  46%  { transform: translate(-50%, 0) rotate(3deg); animation-timing-function: ease-out; }
  52%  { transform: translate(-50%, 0) rotate(3deg) scale(1.12,.82); }
  60%  { transform: translate(-50%, 0) scale(.97); }
  68%  { transform: translate(-50%, 0) scale(1); }
  100% { transform: translate(-50%, 0) scale(1); opacity: 1; }
}
@keyframes cfDust {
  0%, 44% { opacity: 0; transform: scaleX(.3); }
  54%     { opacity: .5; transform: scaleX(1); }
  100%    { opacity: 0; transform: scaleX(1.4); }
}
@keyframes cfRise { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: none; } }
@keyframes cfShudder { 0%,46%{transform:none;} 50%{transform:translateY(2px);} 54%{transform:translateY(-1px);} 58%,100%{transform:none;} }

.cf-brick   { animation: cfBrickFall 1.5s forwards; }
.cf-dust    { animation: cfDust 1.5s ease forwards; }
.cf-line    { animation: cfShudder 1.5s ease forwards; }
.cf-r1 { animation: cfRise .6s cubic-bezier(.25,.7,.2,1) 1.35s both; }
.cf-r2 { animation: cfRise .6s cubic-bezier(.25,.7,.2,1) 1.55s both; }

@media (prefers-reduced-motion: reduce) {
  .cf-brick { animation: none; opacity: 1; transform: translate(-50%, 0); }
  .cf-dust { display: none; }
  .cf-line, .cf-r1, .cf-r2 { animation: none; opacity: 1; transform: none; }
}
`;

function Brand() {
  return (
    <p className="text-lg font-semibold" style={{ color: V.ink }}>
      Briklay<span style={{ color: V.terra }}>.</span>
    </p>
  );
}

export default function Welcome() {
  const navigate = useNavigate();
  const { authState } = useAuth();
  const [ready, setReady] = useState(false);
  const [firstName, setFirstName] = useState<string | null>(null);

  // Read the confirmed user's first name from the session metadata (works even
  // before a workspace exists). getUser is local + fast; we hold the render until
  // it resolves so the brick lands once, with the right name (no mid-fall flicker).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const full = (data.user?.user_metadata?.full_name as string | undefined) ?? '';
      const first = full.trim().split(' ')[0];
      setFirstName(first || null);
      setReady(true);
    });
  }, []);

  const status = authState.status;

  // still settling — quiet page, never the login flash or a half-built celebration
  if (!ready || status === 'loading' || status === 'resolving') {
    return <div className="min-h-screen" style={{ background: V.page }} />;
  }

  // no session -> link was invalid, expired, or already used. Not a celebration.
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: V.page, ...font }}>
        <div className="w-full text-center" style={{ maxWidth: 440 }}>
          <Brand />
          <span className="inline-flex items-center justify-center mt-16 mb-4 w-11 h-11 rounded-full" style={{ background: V.terraWash }}>
            <AlertCircle size={20} style={{ color: V.terraDeep }} />
          </span>
          <h1 style={{ color: V.ink, ...serif, fontSize: 'clamp(1.6rem, 1.2rem + 2vw, 2.1rem)', lineHeight: 1.15 }}>
            This link has expired
          </h1>
          <p className="mt-3 leading-relaxed" style={{ color: V.sys, fontSize: 'clamp(0.9rem, 0.84rem + 0.4vw, 1rem)' }}>
            Confirmation links last a short while, and each one works once. Sign in to get a fresh link sent to your inbox.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="inline-flex items-center justify-center gap-2 mt-8 w-full py-3 rounded-xl font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#BC4B27]"
            style={{ background: terraGrad, color: '#fff', fontSize: 'clamp(0.9rem, 0.85rem + 0.3vw, 1rem)' }}
          >
            Back to sign in <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // session present -> confirmed. Celebrate, then point at the real first step.
  const headline = firstName ? `You're in, ${firstName}.` : "You're in.";

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: V.page, ...font }}>
      <style>{CSS}</style>

      <div className="w-full text-center" style={{ maxWidth: 440 }}>
        <Brand />

        {/* the signature: the brick lands, founding the line */}
        <div className="relative mt-16 mb-2" style={{ height: 64 }}>
          <span
            className="cf-brick absolute"
            aria-hidden="true"
            style={{ left: '50%', bottom: 14, width: 30, height: 19, borderRadius: 3, background: terraGrad, boxShadow: '0 6px 16px rgba(143,51,24,0.28)' }}
          />
          <span
            className="cf-dust absolute"
            aria-hidden="true"
            style={{ left: '50%', transform: 'translateX(-50%)', bottom: 12, width: 140, height: 1, background: V.terra, transformOrigin: 'center' }}
          />
        </div>

        <h1 className="cf-line" style={{ color: V.ink, ...serif, fontSize: 'clamp(2rem, 1.4rem + 3vw, 2.8rem)', lineHeight: 1.1 }}>
          {headline}
        </h1>

        <p className="cf-r1 mt-4 leading-relaxed" style={{ color: V.sys, fontSize: 'clamp(0.9rem, 0.84rem + 0.4vw, 1rem)' }}>
          Your account is set. Your books start the moment your site does.
        </p>

        <button
          onClick={() => navigate('/create-workspace')}
          className="cf-r2 inline-flex items-center justify-center gap-2 mt-8 w-full py-3 rounded-xl font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#BC4B27]"
          style={{ background: terraGrad, color: '#fff', fontSize: 'clamp(0.9rem, 0.85rem + 0.3vw, 1rem)' }}
        >
          Set up your workspace <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
