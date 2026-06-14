import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContext';
import { formatTxn } from '../lib/formatTxn';
import { DashboardSkeleton } from '../components/SkeletonLoader';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateStr() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function SkeletonLine({ w = '100%' }: { w?: string }) {
  return (
    <span
      className="animate-pulse block rounded"
      style={{ height: 12, borderRadius: 4, background: 'rgba(0,0,0,0.07)', width: w }}
    />
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, amber,
}: {
  label: string; value: string; sub: string; amber?: boolean;
}) {
  return (
    <div style={{
      background: 'white',
      border: '1px solid rgba(0,0,0,0.06)',
      borderRadius: 10,
      padding: '16px',
    }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(0,0,0,0.45)', marginBottom: 10, margin: 0 }}>
        {label}
      </p>
      <p style={{
        fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, margin: '10px 0 4px',
        color: amber ? '#b45309' : '#0b1c30',
      }}>
        {value}
      </p>
      <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: 0 }}>{sub}</p>
    </div>
  );
}

// ── Action Item Row ────────────────────────────────────────────────────────────

function ActionRow({
  dot, text, btn, onClick, last,
}: {
  dot: 'amber' | 'red' | 'blue';
  text: string;
  btn: string;
  onClick: () => void;
  last?: boolean;
}) {
  const dotColor = { amber: '#f59e0b', red: '#ef4444', blue: '#60a5fa' }[dot];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px',
      height: 48, borderBottom: last ? 'none' : '1px solid rgba(0,0,0,0.05)',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: dotColor }} />
      <span style={{ flex: 1, fontSize: 14, color: '#0b1c30' }}>{text}</span>
      <button
        onClick={onClick}
        style={{ fontSize: 11, color: '#C8603A', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', flexShrink: 0 }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
      >
        {btn}
      </button>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Dashboard({ session }: { session: Session }) {
  const { data: profile } = useUserProfile(session.user.id);
  const navigate = useNavigate();
  const { openPeek } = usePeek();

  const greeting = getGreeting();
  const dateStr = getDateStr();
  const userName = profile?.name?.split(' ')[0] || session.user.email?.split('@')[0] || 'there';

  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingTime, setBriefingTime] = useState('');

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: spentData, isLoading: isSpentLoading } = useQuery({
    queryKey: ['dash_spent'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('total_amount, txn_allocations(project_id)')
        .eq('status', 'Active');
      const total = (data || []).reduce((s, t: any) => s + Number(t.total_amount), 0);
      const pids = new Set<string>();
      (data || []).forEach((t: any) =>
        (t.txn_allocations || []).forEach((a: any) => { if (a.project_id) pids.add(a.project_id); })
      );
      return { total, projectCount: pids.size };
    },
  });

  const { data: woData, isLoading: isWoLoading } = useQuery({
    queryKey: ['dash_wos'],
    queryFn: async () => {
      const { data } = await supabase
        .from('work_orders')
        .select('order_value')
        .in('status', ['Draft', 'Issued', 'Active']);
      return {
        count: data?.length || 0,
        value: (data || []).reduce((s, wo: any) => s + Number(wo.order_value), 0),
      };
    },
  });

  const { data: pendingCount, isLoading: isPendingLoading } = useQuery({
    queryKey: ['dash_pending'],
    queryFn: async () => {
      const { count } = await supabase
        .from('rough_entries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING');
      return count || 0;
    },
  });

  const { data: needsActionCount } = useQuery({
    queryKey: ['dash_needs_action'],
    queryFn: async () => {
      const [wvRes, unlinkedRes] = await Promise.all([
        supabase.from('transactions').select('txn_id, stakeholders(type)').eq('status', 'Active'),
        supabase.from('txn_allocations').select('txn_id').is('order_type', null),
      ]);
      const wvIds = new Set(
        (wvRes.data || [])
          .filter((t: any) => ['Worker', 'Vendor'].includes(t.stakeholders?.type))
          .map((t: any) => t.txn_id)
      );
      const unlinkedIds = new Set((unlinkedRes.data || []).map((a: any) => a.txn_id));
      return [...wvIds].filter(id => unlinkedIds.has(id)).length;
    },
  });

  const { data: flaggedCount } = useQuery({
    queryKey: ['dash_flagged'],
    queryFn: async () => {
      const { count } = await supabase
        .from('transactions')
        .select('txn_id', { count: 'exact', head: true })
        .eq('ai_flag_status', 'Flagged')
        .eq('status', 'Active');
      return count || 0;
    },
  });

  const { data: untalliedPOCount } = useQuery({
    queryKey: ['dash_untallied_pos'],
    queryFn: async () => {
      const { count } = await supabase
        .from('purchase_orders')
        .select('po_id', { count: 'exact', head: true })
        .eq('status', 'Delivered');
      return count || 0;
    },
  });

  const { data: overdueData } = useQuery({
    queryKey: ['dash_overdue_invoices'],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_invoices')
        .select('total_amount, paid_amount')
        .eq('status', 'Overdue');
      return {
        count: data?.length || 0,
        total: (data || []).reduce((s, inv: any) => s + Number(inv.total_amount) - Number(inv.paid_amount || 0), 0),
      };
    },
  });

  const { data: stuckDraftCount } = useQuery({
    queryKey: ['dash_stuck_drafts'],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count } = await supabase
        .from('work_orders')
        .select('wo_id', { count: 'exact', head: true })
        .eq('status', 'Draft')
        .lt('created_at', sevenDaysAgo);
      return count || 0;
    },
  });

  const { data: recentTxns, isLoading: isRecentLoading } = useQuery({
    queryKey: ['dash_recent_txns'],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('*, stakeholders(name, category)')
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
  });

  // ── AI Briefing ────────────────────────────────────────────────────────────

  const fetchBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const [txnsRes, wosRes, pendingRes, milestonesRes] = await Promise.all([
        supabase.from('transactions').select('total_amount, status, created_at').order('created_at', { ascending: false }).limit(20),
        supabase.from('work_orders').select('wo_number, status, order_value').in('status', ['Active', 'Issued']),
        supabase.from('rough_entries').select('id').eq('status', 'PENDING'),
        supabase.from('wo_milestones').select('name, planned_amount, status').eq('status', 'Pending').limit(5),
      ]);

      const context = {
        pendingLogbook: pendingRes.data?.length || 0,
        activeWOs: wosRes.data?.length || 0,
        dueMilestones: milestonesRes.data || [],
        recentSpend: (txnsRes.data || []).reduce((s: number, t: any) => s + (t.total_amount || 0), 0),
      };

      // The Anthropic key lives in function secrets — the briefing is generated
      // server-side by the ai-briefing edge function, never in the browser.
      const { data, error } = await supabase.functions.invoke('ai-briefing', { body: { context } });
      if (error) throw error;
      setBriefing(data?.briefing || 'Everything looks on track today.');
      setBriefingTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setBriefing('Open items need your attention. Check the action items below.');
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => { fetchBriefing(); }, [fetchBriefing]);

  // ── Action items ────────────────────────────────────────────────────────────

  type ActionItem = { dot: 'amber' | 'red' | 'blue'; text: string; btn: string; onClick: () => void };

  const actionItems: ActionItem[] = [
    (pendingCount || 0) > 0 && {
      dot: 'amber' as const,
      text: `${pendingCount} logbook entr${pendingCount === 1 ? 'y' : 'ies'} need review`,
      btn: 'Review →',
      onClick: () => navigate('/logbook'),
    },
    (needsActionCount || 0) > 0 && {
      dot: 'amber' as const,
      text: `${needsActionCount} transaction${needsActionCount === 1 ? '' : 's'} need work order or project link`,
      btn: 'Resolve →',
      onClick: () => navigate('/ledger?needs_action=true'),
    },
    (flaggedCount || 0) > 0 && {
      dot: 'amber' as const,
      text: `${flaggedCount} transaction${flaggedCount === 1 ? '' : 's'} flagged for review`,
      btn: 'View →',
      onClick: () => navigate('/ledger?flagged=true'),
    },
    (untalliedPOCount || 0) > 0 && {
      dot: 'amber' as const,
      text: `${untalliedPOCount} purchase order${untalliedPOCount === 1 ? '' : 's'} delivered but not tallied`,
      btn: 'Tally →',
      onClick: () => navigate('/purchase-orders'),
    },
    overdueData && overdueData.count > 0 && {
      dot: 'red' as const,
      text: `${overdueData.count} client bill${overdueData.count === 1 ? '' : 's'} overdue — ${fmt(overdueData.total)} total`,
      btn: 'View →',
      onClick: () => navigate('/billing'),
    },
    (stuckDraftCount || 0) > 0 && {
      dot: 'amber' as const,
      text: `${stuckDraftCount} work order${stuckDraftCount === 1 ? '' : 's'} still in draft`,
      btn: 'Review →',
      onClick: () => navigate('/work-orders'),
    },
  ].filter(Boolean) as ActionItem[];

  // ── Render ─────────────────────────────────────────────────────────────────

  const isInitialLoading = isSpentLoading || isWoLoading || isPendingLoading || isRecentLoading;

  if (isInitialLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="mobile-main-pb" style={{ padding: '24px 24px 0', maxWidth: 900 }}>

      {/* A) PAGE HEADER */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em',
          color: '#0b1c30', margin: 0, fontFamily: 'Manrope, sans-serif',
        }}>
          {greeting}, {userName}
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', margin: '3px 0 0' }}>{dateStr}</p>
      </div>

      {/* B) KPI STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginBottom: 24 }}>
        <KPICard
          label="TOTAL SPENT"
          value={spentData ? fmt(spentData.total) : '—'}
          sub={spentData ? `across ${spentData.projectCount} project${spentData.projectCount === 1 ? '' : 's'}` : 'loading…'}
        />
        <KPICard
          label="OPEN WORK ORDERS"
          value={woData !== undefined ? String(woData.count) : '—'}
          sub={woData ? `${fmt(woData.value)} total value` : 'loading…'}
        />
        <KPICard
          label="PENDING LOGBOOK"
          value={pendingCount !== undefined ? String(pendingCount) : '—'}
          sub="needs review"
          amber={(pendingCount || 0) > 0}
        />
        <KPICard
          label="NEEDS ACTION"
          value={needsActionCount !== undefined ? String(needsActionCount) : '—'}
          sub="transactions unlinked"
          amber={(needsActionCount || 0) > 0}
        />
      </div>

      {/* C) AI BRIEFING */}
      <div style={{
        background: 'rgba(200,96,58,0.04)',
        border: '1px solid rgba(200,96,58,0.15)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#0b1c30' }}>🤖 AI Briefing</span>
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
            {briefingTime
              ? `${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${briefingTime}`
              : new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        </div>
        <div style={{ height: 1, background: 'rgba(200,96,58,0.12)', marginBottom: 10 }} />
        {briefingLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <SkeletonLine />
            <SkeletonLine w="80%" />
            <SkeletonLine w="60%" />
          </div>
        ) : (
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#0b1c30', margin: 0 }}>{briefing}</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={fetchBriefing}
            disabled={briefingLoading}
            style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Refresh ↻
          </button>
        </div>
      </div>

      {/* D) ACTION ITEMS */}
      <section style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(0,0,0,0.45)', margin: '0 0 12px' }}>
          ACTION ITEMS
        </p>
        {actionItems.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px',
            background: 'white', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', flexShrink: 0, marginTop: 5 }} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#0b1c30', margin: 0 }}>All caught up</p>
              <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', margin: '2px 0 0' }}>No action items right now.</p>
            </div>
          </div>
        ) : (
          <div style={{ background: 'white', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 10, overflow: 'hidden' }}>
            {actionItems.map((item, idx) => (
              <ActionRow
                key={idx}
                dot={item.dot}
                text={item.text}
                btn={item.btn}
                onClick={item.onClick}
                last={idx === actionItems.length - 1}
              />
            ))}
          </div>
        )}
      </section>

      {/* E) RECENT ACTIVITY */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(0,0,0,0.45)', margin: 0 }}>
            RECENT ACTIVITY
          </p>
          <Link to="/ledger" style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', textDecoration: 'none' }}>View all →</Link>
        </div>
        <div>
          {(recentTxns || []).map((txn: any, idx: number) => (
            <button
              key={txn.txn_id}
              onClick={() => openPeek('TRANSACTION', txn.txn_id)}
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 0',
                borderBottom: idx < (recentTxns?.length || 0) - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              {(() => { const f = formatTxn(txn, 'global'); return (<><div style={{ flex: 1, minWidth: 0, marginRight: 12 }}><p style={{ fontSize: 13, fontWeight: 500, color: '#0b1c30', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.primary}</p>{f.secondary && <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', margin: '1px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.secondary}</p>}{f.tertiary && <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.28)', margin: '1px 0 0' }}>{f.tertiary}</p>}</div><p style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: '#0b1c30', margin: 0, flexShrink: 0 }}>₹{Number(txn.total_amount).toLocaleString('en-IN')}</p></>); })()}
            </button>
          ))}
          {(!recentTxns || recentTxns.length === 0) && (
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', textAlign: 'center', padding: '24px 0', margin: 0 }}>
              No transactions yet.
            </p>
          )}
        </div>
      </section>

      <CommandBarFirstTimeHint />
    </div>
  );
}

// ── First-time command bar hint ────────────────────────────────────────────────

const HINT_KEY = 'bk_cmdbar_hint_seen';

function CommandBarFirstTimeHint() {
  const [phase, setPhase] = useState<'hidden' | 'entering' | 'visible' | 'leaving'>('hidden');

  useEffect(() => {
    if (localStorage.getItem(HINT_KEY)) return;

    const showTimer = setTimeout(() => {
      setPhase('entering');
      setTimeout(() => setPhase('visible'), 300);
    }, 2000);

    const hideTimer = setTimeout(() => {
      setPhase('leaving');
      setTimeout(() => {
        setPhase('hidden');
        localStorage.setItem(HINT_KEY, '1');
      }, 300);
    }, 6000);

    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <div
      className={`cmdbar-hint ${phase === 'entering' || phase === 'visible' ? 'entering' : 'leaving'}`}
    >
      Press <strong style={{ color: 'rgba(255,255,255,0.88)', margin: '0 3px' }}>Space</strong> to search and act quickly
    </div>
  );
}
