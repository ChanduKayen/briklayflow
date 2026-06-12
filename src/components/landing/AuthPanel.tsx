/**
 * AuthPanel — slide-in right sheet (verbatim chrome from the reference).
 * Phase 2: visual stub. Submit is not yet wired; Phase 3 attaches the
 * Supabase calls (mirroring Login.tsx) plus the resend / check-email state.
 * Per ruling, the "Forgot password?" link is removed for launch (see the
 * followups doc: password-reset flow + restore the link).
 */
import type { Dispatch, SetStateAction } from 'react';
import { X, Mail, Lock, ArrowRight } from 'lucide-react';
import { V, font, serif, terraGrad } from './landingTokens';

type Mode = 'signin' | 'signup';

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
  if (!open) return null;
  const signin = mode === 'signin';
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

        <div className="mt-10">
          <h2 className="text-2xl" style={{ color: V.ink, ...serif }}>
            {signin ? 'Welcome back.' : 'Start building.'}
          </h2>
          <p className="text-sm mt-1.5" style={{ color: V.sys }}>
            {signin ? 'Your sites are where you left them.' : 'Free to start. Set up your first project in minutes.'}
          </p>
        </div>

        <div className="mt-8 space-y-3">
          {!signin && (
            <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
              <span className="text-xs" style={{ color: V.faint }}>Aa</span>
              <input placeholder="Your name" aria-label="Your name" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
            </div>
          )}
          <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
            <Mail size={15} style={{ color: V.faint }} />
            <input placeholder="Email address" type="email" aria-label="Email address" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
          </div>
          <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
            <Lock size={15} style={{ color: V.faint }} />
            <input placeholder="Password" type="password" aria-label="Password" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
          </div>
        </div>

        {/* Mirrors Login.tsx auth calls verbatim — see docs/new-po-redesign-followups.md ticket: unify into useAuth hook */}
        <button
          className="btnp mt-6 w-full py-3.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2"
          style={{ background: terraGrad, color: '#fff' }}
        >
          {signin ? 'Sign in' : 'Create account'} <ArrowRight size={15} className="arr" />
        </button>

        <p className="text-sm mt-6 text-center" style={{ color: V.sys }}>
          {signin ? 'New to Briklay? ' : 'Already have an account? '}
          <button onClick={() => setMode(signin ? 'signup' : 'signin')} className="font-medium underline" style={{ color: V.ink }}>
            {signin ? 'Create an account' : 'Sign in'}
          </button>
        </p>

        <p className="text-xs mt-auto pt-10 text-center" style={{ color: V.faint }}>
          Built by builders, for builders · your data stays yours
        </p>
      </div>
    </div>
  );
}
