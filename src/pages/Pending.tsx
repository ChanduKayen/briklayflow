import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { IconClockHour4 } from '@tabler/icons-react';
import { supabase } from '../lib/supabase';

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days  > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (mins  > 0) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  return 'just now';
}

export default function Pending({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [orgName,    setOrgName]    = useState<string>('your organization');
  const [createdAt,  setCreatedAt]  = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [suspended,  setSuspended]  = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkStatus = async () => {
    if (document.hidden) return;
    const { data: pendingRow } = await supabase
      .from('org_memberships')
      .select('status')
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (!pendingRow) {
      const { data: anyRow } = await supabase
        .from('org_memberships')
        .select('status')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (anyRow?.status === 'active') {
        navigate('/dashboard', { replace: true });
      } else if (anyRow?.status === 'suspended') {
        setSuspended(true);
      }
    }
  };

  useEffect(() => {
    (async () => {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('status', 'active')
        .maybeSingle();
      if (org?.name) setOrgName(org.name);

      const { data: membership } = await supabase
        .from('org_memberships')
        .select('status, created_at')
        .eq('user_id', session.user.id)
        .eq('status', 'pending')
        .maybeSingle();
      if (membership?.created_at) setCreatedAt(membership.created_at);
    })();

    intervalRef.current = setInterval(checkStatus, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshMsg(null);
    const { data: anyRow } = await supabase
      .from('org_memberships')
      .select('status')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (anyRow?.status === 'active') {
      navigate('/dashboard', { replace: true });
    } else if (anyRow?.status === 'suspended') {
      setSuspended(true);
    } else {
      setRefreshMsg('Still pending. Check back later.');
    }
  };

  const handleSignOut = () => supabase.auth.signOut();

  if (suspended) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background px-margin-mobile">
        <div className="w-full max-w-[320px] bg-surface-container-lowest p-8 rounded-2xl shadow-card-md border border-outline-variant/30">
          <div className="text-center mb-8">
            <h1 className="text-headline-lg font-headline-lg font-black text-primary mb-2">Briklay</h1>
          </div>
          <div className="text-center py-4">
            <p className="text-[15px] font-medium text-on-surface mb-2">Access denied</p>
            <p className="text-[13px] text-on-surface-variant">
              Your account has been suspended. Contact your admin for help.
            </p>
          </div>
          <p className="text-[11px] text-on-surface-variant text-center mt-6">
            <span onClick={handleSignOut} style={{ cursor: 'pointer' }}>Sign out</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-margin-mobile">
      <div className="w-full max-w-[320px] bg-surface-container-lowest p-8 rounded-2xl shadow-card-md border border-outline-variant/30">

        <div className="text-center mb-8">
          <h1 className="text-headline-lg font-headline-lg font-black text-primary mb-2">Briklay</h1>
        </div>

        <div className="flex flex-col items-center gap-3 mb-6">
          <IconClockHour4 size={28} className="text-on-surface-variant" strokeWidth={1.5} />
          <div className="text-center">
            <p className="text-[16px] font-medium text-on-surface mb-2">Awaiting approval</p>
            <p className="text-[13px] text-on-surface-variant text-center leading-[1.5]">
              Your request to join {orgName} has been sent to the admin.
              You'll get access once approved.
            </p>
          </div>
        </div>

        <div style={{ borderTop: '0.5px solid var(--color-outline-variant)', margin: '20px 0' }} />

        <div className="flex flex-col gap-3">
          {createdAt && (
            <div className="flex justify-between items-center">
              <span className="text-[12px] text-on-surface-variant">Request sent</span>
              <span className="text-[12px] text-on-surface-variant">{timeAgo(createdAt)}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-on-surface-variant">Status</span>
            <span className="text-[12px] text-amber-500">Pending review</span>
          </div>
        </div>

        <div style={{ borderTop: '0.5px solid var(--color-outline-variant)', margin: '20px 0' }} />

        <button
          onClick={handleRefresh}
          style={{
            width:        '100%',
            height:       '44px',
            border:       '0.5px solid var(--color-outline)',
            background:   'transparent',
            borderRadius: '8px',
            fontSize:     '14px',
            cursor:       'pointer',
            color:        'var(--color-on-surface)',
          }}
        >
          Refresh status
        </button>

        {refreshMsg && (
          <p className="text-[12px] text-on-surface-variant text-center mt-3">{refreshMsg}</p>
        )}

        <p className="text-[11px] text-on-surface-variant text-center mt-6">
          Wrong account?{' '}
          <span onClick={handleSignOut} style={{ cursor: 'pointer' }}>Sign out</span>
        </p>

      </div>
    </div>
  );
}
