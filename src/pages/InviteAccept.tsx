import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { IconAlertTriangle, IconCircleCheck, IconLoader2 } from '@tabler/icons-react';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

type InviteDetails = {
  inviteId:  string;
  orgId:     string;
  orgName:   string;
  orgSlug:   string;
  email:     string;
  role:      string;
  expiresAt: string;
};

type PageState =
  | { phase: 'validating' }
  | { phase: 'valid';     invite: InviteDetails }
  | { phase: 'invalid';   reason: string }
  | { phase: 'accepting'; invite: InviteDetails }
  | { phase: 'success';   orgName: string; role: string }
  | { phase: 'error';     invite: InviteDetails; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeExpiry(iso: string): string {
  const diff  = new Date(iso).getTime() - Date.now();
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(hours / 24);
  if (days  > 0) return `in ${days} day${days   === 1 ? '' : 's'}`;
  if (hours > 0) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  return 'very soon';
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

function Validating() {
  return (
    <div className="flex flex-col items-center py-10 gap-3">
      <IconLoader2 size={24} className="text-on-surface-variant animate-spin" strokeWidth={1.5} />
      <p className="text-[13px] text-on-surface-variant">Checking your invite…</p>
    </div>
  );
}

function ValidCard({
  invite, session, onAccept, onSignOut, onDecline, accepting,
}: {
  invite:     InviteDetails;
  session:    Session | null;
  onAccept:   () => void;
  onSignOut:  () => void;
  onDecline:  () => void;
  accepting?: boolean;
}) {
  return (
    <div>
      <div className="text-center mb-6">
        <p className="text-[13px] text-on-surface-variant mb-1">You've been invited to join</p>
        <h2 className="text-[18px] font-semibold text-on-surface">{invite.orgName}</h2>
        <p className="text-[13px] text-on-surface-variant mt-1 mb-3">as</p>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-[12px] font-medium bg-primary/10 text-primary uppercase tracking-wide">
          {capitalize(invite.role)}
        </span>
      </div>

      <div className="text-center space-y-1 mb-8">
        <p className="text-[12px] text-on-surface-variant">
          Invite sent to:{' '}
          <span className="font-medium text-on-surface">{invite.email}</span>
        </p>
        <p className="text-[12px] text-on-surface-variant">
          Expires {relativeExpiry(invite.expiresAt)}
        </p>
      </div>

      <button
        className="bk-btn w-full flex items-center justify-center gap-2"
        onClick={onAccept}
        disabled={accepting}
      >
        {accepting ? (
          <>
            <IconLoader2 size={15} className="animate-spin" strokeWidth={2} />
            Joining…
          </>
        ) : (
          `Join ${invite.orgName}`
        )}
      </button>

      <div className="text-center mt-3 flex flex-col items-center gap-2">
        <button
          onClick={onDecline}
          style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--color-text-tertiary, rgba(0,0,0,0.4))', cursor: 'pointer' }}
        >
          Decline invite
        </button>
        {session && (
          <button
            className="text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
            onClick={onSignOut}
          >
            Wrong account? Sign out
          </button>
        )}
      </div>
    </div>
  );
}

function InvalidCard({ reason }: { reason: string }) {
  return (
    <div className="text-center py-4">
      <div className="flex justify-center mb-3">
        <IconAlertTriangle size={28} className="text-on-error-container" strokeWidth={1.5} />
      </div>
      <h2 className="text-[15px] font-semibold text-on-surface mb-2">
        This invite is no longer valid
      </h2>
      <p className="text-[13px] text-on-surface-variant mb-6">{reason}</p>
      <Link to="/" className="text-secondary text-[13px] font-semibold hover:underline">
        Back to login →
      </Link>
    </div>
  );
}

function SuccessCard({ orgName, role }: { orgName: string; role: string }) {
  return (
    <div className="text-center py-4">
      <div className="flex justify-center mb-3">
        <IconCircleCheck size={32} className="text-primary" strokeWidth={1.5} />
      </div>
      <h2 className="text-[16px] font-semibold text-on-surface mb-1">You're in.</h2>
      <p className="text-[13px] text-on-surface-variant">
        Welcome to {orgName} as {capitalize(role)}
      </p>
      <p className="text-[12px] text-on-surface-variant/50 mt-1">
        Welcome to {orgName}. Your role is {capitalize(role)}.
      </p>
      <p className="text-[12px] text-on-surface-variant mt-2">Redirecting to dashboard…</p>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-4">
      <div className="mb-4 p-3 bg-error-container text-on-error-container rounded-lg text-[13px] text-left">
        {message}
      </div>
      <button className="bk-btn w-full mb-4" onClick={onRetry}>
        Try again
      </button>
      <p className="text-[11px] text-on-surface-variant">
        Still not working? Contact your admin.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { session: Session | null; token: string }

type InviteValidationResult = {
  is_valid: boolean
  fail_reason: string | null
  invite_id: string
  org_id: string
  org_name: string
  org_slug: string
  email: string
  role: string
  expires_at: string
}

type AcceptInviteResult = {
  success: boolean
  error: string | null
}

export default function InviteAccept({ session, token }: Props) {
  const navigate   = useNavigate();
  const validated  = useRef(false);
  const [state, setState] = useState<PageState>({ phase: 'validating' });

  // Validate token on mount. useRef guard prevents double-fire in StrictMode.
  useEffect(() => {
    if (validated.current) return;
    validated.current = true;

    if (!token) {
      setState({ phase: 'invalid', reason: 'Invalid invite link.' });
      return;
    }

    supabase
      .rpc('validate_invite_token', { p_token: token })
      .single<InviteValidationResult>()
      .then(({ data, error }) => {
        if (error || !data) {
          setState({ phase: 'invalid', reason: 'Invite not found.' });
          return;
        }
        if (!data.is_valid) {
          setState({ phase: 'invalid', reason: data.fail_reason ?? 'This invite is no longer valid.' });
          return;
        }
        setState({
          phase:  'valid',
          invite: {
            inviteId:  data.invite_id,
            orgId:     data.org_id,
            orgName:   data.org_name,
            orgSlug:   data.org_slug,
            email:     data.email,
            role:      data.role,
            expiresAt: data.expires_at,
          },
        });
      });
  }, [token]);

  const handleAccept = async (invite: InviteDetails) => {
    if (!session?.user) {
      // Not logged in — redirect to login with return URL.
      // After sign-in, the redirect param brings them back here.
      navigate(`/login?redirect=/invite/${token}`);
      return;
    }

    setState({ phase: 'accepting', invite });

    const { data, error } = await supabase
      .rpc('accept_invite', { p_token: token!, p_user_id: session.user.id })
      .single<AcceptInviteResult>();

    if (error || !data) {
      setState({ phase: 'error', invite, message: error?.message ?? 'Unexpected error — please try again.' });
      return;
    }
    if (!data.success) {
      setState({ phase: 'error', invite, message: data.error ?? 'Failed to accept invite.' });
      return;
    }

    setState({ phase: 'success', orgName: invite.orgName, role: invite.role });
    setTimeout(() => navigate('/dashboard', { replace: true }), 2000);
  };

  const handleDecline = async () => {
    await supabase
      .from('org_invites')
      .update({ status: 'revoked' })
      .eq('token', token);

    if (!session) {
      navigate('/login');
      return;
    }

    const { count } = await supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true });

    if (!count || count === 0) {
      navigate('/create-workspace', { replace: true });
    } else {
      navigate('/pending', { replace: true });
    }
  };

  const handleSignOut = () => supabase.auth.signOut();

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-margin-mobile">
      <div className="w-full max-w-md bg-surface-container-lowest p-8 rounded-2xl shadow-card-md border border-outline-variant/30">

        <div className="text-center mb-8">
          <h1 className="text-headline-lg font-headline-lg font-black text-primary mb-2">Briklay</h1>
        </div>

        {state.phase === 'validating' && <Validating />}

        {(state.phase === 'valid' || state.phase === 'accepting') && (
          <ValidCard
            invite={state.invite}
            session={session}
            onAccept={() => { if (state.phase === 'valid') handleAccept(state.invite); }}
            onSignOut={handleSignOut}
            onDecline={handleDecline}
            accepting={state.phase === 'accepting'}
          />
        )}

        {state.phase === 'invalid' && <InvalidCard reason={state.reason} />}

        {state.phase === 'success' && (
          <SuccessCard orgName={state.orgName} role={state.role} />
        )}

        {state.phase === 'error' && (
          <ErrorCard
            message={state.message}
            onRetry={() => handleAccept(state.invite)}
          />
        )}

      </div>
    </div>
  );
}
