import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';

export default function Dashboard({ session }: { session: Session }) {
  const { data: profile } = useUserProfile(session.user.id);
  const navigate = useNavigate();

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['dashboard_metrics', profile?.role],
    queryFn: async () => {
      if (!profile) return null;
      let txnQuery = supabase.from('transactions').select('total_amount').eq('status', 'Active');
      let woQuery = supabase.from('work_orders').select('order_value').eq('status', 'Active');
      let flaggedQuery = supabase.from('transactions').select('txn_id', { count: 'exact', head: true }).eq('ai_flag_status', 'Flagged').eq('status', 'Active');

      if (profile.role === 'supervisor') {
        const myProjects = profile.assigned_projects || [];
        const { data: allocs } = await supabase.from('txn_allocations').select('allocated_amount, transactions!inner(status)').eq('transactions.status', 'Active').in('project_id', myProjects);
        const myTotalPayments = allocs?.reduce((sum, a) => sum + Number(a.allocated_amount), 0) || 0;
        const { data: myWOs } = await supabase.from('work_orders').select('order_value').eq('status', 'Active').in('project_id', myProjects);
        const myWOValue = myWOs?.reduce((sum, wo) => sum + Number(wo.order_value), 0) || 0;
        return { totalPayments: myTotalPayments, activeWOValue: myWOValue, flaggedCount: 0, needsActionCount: 0, isScoped: true };
      } else {
        const [txnRes, woRes, flaggedRes] = await Promise.all([txnQuery, woQuery, flaggedQuery]);
        // Needs action: active Worker/Vendor transactions with at least one unlinked allocation
        const [activeWVRes, unlinkedAllocsRes] = await Promise.all([
          supabase.from('transactions').select('txn_id, stakeholders(type)').eq('status', 'Active'),
          supabase.from('txn_allocations').select('txn_id').is('order_type', null),
        ]);
        const wvIds = new Set(
          (activeWVRes.data || [])
            .filter((t: any) => ['Worker', 'Vendor'].includes(t.stakeholders?.type))
            .map((t: any) => t.txn_id)
        );
        const unlinkedIds = new Set((unlinkedAllocsRes.data || []).map((a: any) => a.txn_id));
        const needsActionCount = [...wvIds].filter(id => unlinkedIds.has(id)).length;
        return {
          totalPayments: txnRes.data?.reduce((sum, t) => sum + Number(t.total_amount), 0) || 0,
          activeWOValue: woRes.data?.reduce((sum, wo) => sum + Number(wo.order_value), 0) || 0,
          flaggedCount: flaggedRes.count || 0,
          needsActionCount,
          isScoped: false
        };
      }
    },
    enabled: !!profile,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('*').eq('status', 'Active').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: recentTxns } = useQuery({
    queryKey: ['recent_txns'],
    queryFn: async () => {
      const { data } = await supabase.from('transactions').select('*, stakeholders(name)').order('created_at', { ascending: false }).limit(5);
      return data || [];
    },
  });

  const fmt = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${n.toLocaleString()}`;
  };

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      {/* Page Header */}
      <div className="flex justify-between items-end mb-stack-lg">
        <div>
          <h2 className="text-headline-lg-mobile md:text-headline-lg font-headline-lg text-on-background">Dashboard</h2>
          {metrics?.isScoped && (
            <p className="text-body-sm text-on-surface-variant mt-1">Scoped to your {profile?.assigned_projects?.length || 0} assigned projects</p>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-secondary" size={32} /></div>
      ) : (
        <>
          {/* Summary Bento Grid */}
          <div className="grid grid-cols-2 gap-stack-md mb-stack-lg">
            <div className="bg-surface-container-low p-4 rounded-xl shadow-card border border-outline-variant/10">
              <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">TRANSACTIONS</p>
              <div className="flex items-end justify-between">
                <span className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">{fmt(metrics?.totalPayments || 0)}</span>
                <span className="material-symbols-outlined text-secondary">trending_up</span>
              </div>
            </div>
            <div className="bg-surface-container-low p-4 rounded-xl shadow-card border border-outline-variant/10">
              <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">WORK ORDERS</p>
              <div className="flex items-end justify-between">
                <span className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">{fmt(metrics?.activeWOValue || 0)}</span>
                <span className="material-symbols-outlined text-on-surface-variant">engineering</span>
              </div>
            </div>
            <div className="bg-surface-container-low p-4 rounded-xl shadow-card border border-outline-variant/10">
              <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">OPEN BALANCE</p>
              <div className="flex items-end justify-between">
                <span className="text-data-mono font-data-mono text-on-surface">{fmt(Math.max(0, (metrics?.activeWOValue || 0) - (metrics?.totalPayments || 0)))}</span>
                <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
              </div>
            </div>
            {!metrics?.isScoped && (
              <div
                className={`p-4 rounded-xl shadow-card border cursor-pointer transition-opacity hover:opacity-80 ${metrics?.needsActionCount ? 'bg-amber-50 border-amber-200/40' : 'bg-surface-container-low border-outline-variant/10'}`}
                onClick={() => navigate('/ledger?needs_action=true')}
              >
                <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">NEEDS ACTION</p>
                <div className="flex items-end justify-between">
                  <span className={`text-headline-lg-mobile font-headline-lg-mobile ${metrics?.needsActionCount ? 'text-amber-700' : 'text-on-surface'}`}>{metrics?.needsActionCount || 0}</span>
                  <span className={`material-symbols-outlined ${metrics?.needsActionCount ? 'text-amber-500' : 'text-on-surface-variant/40'}`}>link_off</span>
                </div>
              </div>
            )}
            {!metrics?.isScoped && (
              <div
                className={`p-4 rounded-xl shadow-card border cursor-pointer transition-opacity hover:opacity-80 ${metrics?.flaggedCount ? 'bg-error-container border-error/10' : 'bg-surface-container-low border-outline-variant/10 opacity-60'}`}
                onClick={() => navigate('/ledger?flagged=true')}
              >
                <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">FLAGGED</p>
                <div className="flex items-end justify-between">
                  <span className={`text-headline-lg-mobile font-headline-lg-mobile ${metrics?.flaggedCount ? 'text-on-error-container' : 'text-on-surface'}`}>{metrics?.flaggedCount || 0}</span>
                  <span className={`material-symbols-outlined ${metrics?.flaggedCount ? 'text-error' : 'text-on-surface-variant/30'}`} style={{ fontVariationSettings: "'FILL' 1" }}>flag</span>
                </div>
              </div>
            )}
          </div>

          {/* Active Projects */}
          <section className="mb-stack-lg">
            <div className="flex justify-between items-center mb-stack-md">
              <h2 className="text-headline-md font-headline-md text-on-surface">Active Projects</h2>
              <Link to="/projects" className="text-label-caps font-label-caps text-secondary cursor-pointer hover:underline">VIEW ALL</Link>
            </div>

            {/* Mobile: horizontal scroll snap cards */}
            <div className="md:hidden -mx-4 px-4">
              <div
                className="flex gap-3 overflow-x-auto no-scrollbar pb-1"
                style={{ scrollSnapType: 'x mandatory' }}
              >
                {projects && projects.length > 0 ? projects.slice(0, 6).map((p: any) => (
                  <Link
                    to={`/projects/${p.project_id}`}
                    key={p.project_id}
                    className="bg-white rounded-xl shadow-card border border-outline-variant/10 p-4 flex-shrink-0 block"
                    style={{ width: 200, scrollSnapAlign: 'start' }}
                  >
                    <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded text-[10px] font-semibold inline-block mb-2">{p.status?.toUpperCase()}</span>
                    <h3 className="font-bold text-[14px] text-on-surface leading-tight mb-1 line-clamp-2">{p.name}</h3>
                    <p className="text-[12px] text-on-surface-variant truncate">{p.site_location}</p>
                  </Link>
                )) : (
                  <p className="text-body-sm text-on-surface-variant py-2">No active projects.</p>
                )}
              </div>
            </div>

            {/* Desktop: vertical list */}
            <div className="hidden md:flex flex-col gap-stack-md">
              {projects?.slice(0, 3).map((p: any) => (
                <Link to={`/projects/${p.project_id}`} key={p.project_id} className="bg-white p-4 rounded-xl shadow-card border border-outline-variant/10 cursor-pointer hover:shadow-card-md transition-shadow block">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-body-lg font-bold text-on-surface">{p.name}</h3>
                      <p className="text-body-sm text-on-surface-variant">{p.site_location}</p>
                    </div>
                    <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded text-label-caps font-label-caps">{p.status?.toUpperCase()}</span>
                  </div>
                </Link>
              ))}
              {(!projects || projects.length === 0) && (
                <p className="text-body-sm text-on-surface-variant">No active projects.</p>
              )}
            </div>
          </section>

          {/* Recent Transactions */}
          <section>
            <div className="flex justify-between items-center mb-stack-md">
              <h2 className="text-headline-md font-headline-md text-on-surface">Recent Transactions</h2>
              <Link to="/ledger" className="text-label-caps font-label-caps text-secondary cursor-pointer hover:underline">VIEW ALL</Link>
            </div>

            {/* Mobile: card stack */}
            <div className="md:hidden space-y-2">
              {recentTxns && recentTxns.length > 0 ? recentTxns.map((txn: any) => (
                <Link
                  key={txn.txn_id}
                  to={`/ledger/${txn.txn_id}`}
                  className="bg-white rounded-xl border border-black/[0.06] p-3 block"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[15px] font-[500] text-on-surface truncate mr-3">{txn.stakeholders?.name || txn.txn_id}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {txn.ai_flag_status === 'Flagged' && <span className="material-symbols-outlined text-error text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>flag</span>}
                      <span className="text-[15px] font-bold font-data-mono text-on-surface">₹{Number(txn.total_amount).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-on-surface-variant uppercase">{txn.category}</span>
                    <span className={`text-[11px] font-semibold ${txn.status === 'Active' ? 'text-emerald-600' : 'text-on-surface-variant/50'}`}>{txn.status}</span>
                  </div>
                </Link>
              )) : (
                <div className="py-8 text-center text-on-surface-variant text-body-sm">No transactions yet.</div>
              )}
              <Link to="/ledger" className="block w-full py-3 text-center text-[14px] font-semibold text-secondary border border-secondary/20 rounded-xl">
                View All Transactions →
              </Link>
            </div>

            {/* Desktop: table-style card */}
            <div className="hidden md:block bg-white rounded-xl shadow-card border border-outline-variant/10 overflow-hidden">
              {recentTxns && recentTxns.length > 0 ? recentTxns.map((txn: any, idx: number) => (
                <Link key={txn.txn_id} to={`/ledger/${txn.txn_id}`} className={`p-4 flex items-center justify-between hover:bg-surface-container-low/40 transition-colors block ${idx < recentTxns.length - 1 ? 'border-b border-outline-variant/10' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-[18px]">receipt_long</span>
                    </div>
                    <div>
                      <p className="font-body-lg font-bold text-on-surface">{txn.stakeholders?.name || txn.txn_id}</p>
                      <p className="text-label-caps font-label-caps text-on-surface-variant uppercase">{txn.category}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {txn.ai_flag_status === 'Flagged' && <span className="material-symbols-outlined text-error text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>flag</span>}
                      <p className="text-data-mono font-data-mono text-on-surface">₹{Number(txn.total_amount).toLocaleString()}</p>
                    </div>
                    <p className={`text-body-sm font-semibold ${txn.status === 'Active' ? 'text-secondary' : 'text-on-surface-variant'}`}>{txn.status?.toUpperCase()}</p>
                  </div>
                </Link>
              )) : (
                <div className="p-8 text-center text-on-surface-variant text-body-sm">No transactions yet.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
