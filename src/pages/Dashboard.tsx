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
        return { totalPayments: myTotalPayments, activeWOValue: myWOValue, flaggedCount: 0, isScoped: true };
      } else {
        const [txnRes, woRes, flaggedRes] = await Promise.all([txnQuery, woQuery, flaggedQuery]);
        return {
          totalPayments: txnRes.data?.reduce((sum, t) => sum + Number(t.total_amount), 0) || 0,
          activeWOValue: woRes.data?.reduce((sum, wo) => sum + Number(wo.order_value), 0) || 0,
          flaggedCount: flaggedRes.count || 0,
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
                className={`p-4 rounded-xl shadow-card border cursor-pointer transition-opacity hover:opacity-80 ${metrics?.flaggedCount ? 'bg-error-container border-error/10' : 'bg-surface-container-low border-outline-variant/10'}`}
                onClick={() => navigate('/ledger?flagged=true')}
              >
                <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">FLAGGED</p>
                <div className="flex items-end justify-between">
                  <span className={`text-headline-lg-mobile font-headline-lg-mobile ${metrics?.flaggedCount ? 'text-on-error-container' : 'text-on-surface'}`}>{metrics?.flaggedCount || 0}</span>
                  <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>flag</span>
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
            <div className="flex flex-col gap-stack-md">
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
              <span className="text-label-caps font-label-caps text-secondary cursor-pointer">HISTORY</span>
            </div>
            <div className="bg-white rounded-xl shadow-card border border-outline-variant/10 overflow-hidden">
              {recentTxns && recentTxns.length > 0 ? recentTxns.map((txn: any, idx: number) => (
                <div key={txn.txn_id} className={`p-4 flex items-center justify-between ${idx < recentTxns.length - 1 ? 'border-b border-outline-variant/10' : ''}`}>
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
                </div>
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
