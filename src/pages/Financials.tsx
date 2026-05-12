import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LinearProgress } from '../components/LinearProgress';

const fmt = (n: number) =>
  n >= 100000
    ? `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L`
    : `₹${n.toLocaleString('en-IN')}`;

export default function Financials() {
  const { data: allocData, isLoading: allocLoading } = useQuery({
    queryKey: ['fin_allocs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('project_id, allocated_amount, transactions(status, total_amount, date)');
      if (error) throw error;
      return data as unknown as {
        project_id: string;
        allocated_amount: number;
        transactions: { status: string; total_amount: number; date: string } | null;
      }[];
    },
  });

  const { data: woData, isLoading: woLoading } = useQuery({
    queryKey: ['fin_wos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('project_id, order_value, status');
      if (error) throw error;
      return data as { project_id: string; order_value: number; status: string }[];
    },
  });

  const { data: poData, isLoading: poLoading } = useQuery({
    queryKey: ['fin_pos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_orders').select('project_id, order_value, status');
      if (error) throw error;
      return data as { project_id: string; order_value: number; status: string }[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name, status');
      if (error) throw error;
      return data as { project_id: string; name: string; status: string }[];
    },
  });

  const isLoading = allocLoading || woLoading || poLoading;

  // Active spend totals
  const activeAllocs = (allocData || []).filter(a => a.transactions?.status === 'Active');
  const totalSpend = activeAllocs.reduce((s, a) => s + Number(a.allocated_amount), 0);

  // Committed
  const activeWOValue = (woData || [])
    .filter(w => ['Issued', 'Active'].includes(w.status))
    .reduce((s, w) => s + Number(w.order_value), 0);
  const activePOValue = (poData || [])
    .filter(p => ['Issued', 'Received'].includes(p.status))
    .reduce((s, p) => s + Number(p.order_value), 0);

  // Spend by project
  const spendByProject: Record<string, number> = {};
  for (const a of activeAllocs) {
    spendByProject[a.project_id] = (spendByProject[a.project_id] || 0) + Number(a.allocated_amount);
  }

  const projectRows = (projects || [])
    .map(p => ({ ...p, spend: spendByProject[p.project_id] || 0 }))
    .filter(p => p.spend > 0)
    .sort((a, b) => b.spend - a.spend);

  const maxProjectSpend = Math.max(...projectRows.map(p => p.spend), 1);

  // Monthly spend (last 6 months from transactions)
  const monthlySpend: Record<string, number> = {};
  for (const a of activeAllocs) {
    if (!a.transactions?.date) continue;
    const month = a.transactions.date.slice(0, 7);
    monthlySpend[month] = (monthlySpend[month] || 0) + Number(a.allocated_amount);
  }
  const months = Object.keys(monthlySpend).sort().slice(-6);
  const maxMonthly = Math.max(...months.map(m => monthlySpend[m]), 1);

  const cards = [
    { label: 'Total Spend', value: fmt(totalSpend), icon: 'payments', color: 'text-primary' },
    { label: 'WO Committed', value: fmt(activeWOValue), icon: 'file_present', color: 'text-secondary' },
    { label: 'PO Committed', value: fmt(activePOValue), icon: 'shopping_cart', color: 'text-tertiary' },
    { label: 'Total Exposure', value: fmt(totalSpend + activeWOValue + activePOValue), icon: 'account_balance', color: 'text-error' },
  ];

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-16 max-w-5xl">
      <div className="mb-stack-lg">
        <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Financial Overview</h2>
        <p className="text-[12px] text-on-surface-variant/50 mt-1">Company-wide financial summary</p>
      </div>

      {isLoading && <LinearProgress className="mb-4" />}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-gutter mb-stack-xl">
        {cards.map(card => (
          <div key={card.label} className="bg-white rounded-xl p-4 shadow-elevation-1 border border-black/[0.06]">
            <div className="flex items-center gap-2 mb-2">
              <span className={`material-symbols-outlined text-[18px] ${card.color}`}>{card.icon}</span>
              <span className="text-[10px] font-bold text-on-surface-variant uppercase">{card.label}</span>
            </div>
            <p className={`text-[20px] font-bold font-data-mono ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Quick nav */}
      <div className="flex gap-3 mb-stack-xl flex-wrap">
        <Link to="/financials/pl" className="bk-btn flex items-center gap-2 text-body-sm h-9 px-4">
          <span className="material-symbols-outlined text-[16px]">table_chart</span>
          Cost Report
        </Link>
        <Link to="/financials/cashflow" className="bk-btn-ghost border border-primary/20 flex items-center gap-2 text-body-sm h-9 px-4 rounded-xl">
          <span className="material-symbols-outlined text-[16px]">show_chart</span>
          Cash Flow
        </Link>
      </div>

      {/* Spend by project */}
      {projectRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-elevation-1 border border-black/[0.06] p-6 mb-stack-xl">
          <h3 className="text-body-lg font-bold mb-4">Spend by Project</h3>
          <div className="space-y-3">
            {projectRows.map(p => (
              <div key={p.project_id}>
                <div className="flex justify-between items-center mb-1">
                  <Link to={`/projects/${p.project_id}`} className="text-body-sm text-primary hover:underline">{p.name}</Link>
                  <span className="text-body-sm font-data-mono font-bold">{fmt(p.spend)}</span>
                </div>
                <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(p.spend / maxProjectSpend) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly spend bar chart */}
      {months.length > 0 && (
        <div className="bg-white rounded-xl shadow-elevation-1 border border-black/[0.06] p-6">
          <h3 className="text-body-lg font-bold mb-4">Monthly Spend</h3>
          <div className="flex items-end gap-2" style={{ height: '120px' }}>
            {months.map(m => {
              const val = monthlySpend[m];
              const heightPct = Math.max((val / maxMonthly) * 100, 2);
              const [year, month] = m.split('-');
              const label = new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', { month: 'short' });
              return (
                <div key={m} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <span className="text-[9px] text-on-surface-variant font-data-mono">{fmt(val)}</span>
                  <div
                    className="w-full bg-primary rounded-t transition-all"
                    style={{ height: `${heightPct}%`, maxHeight: '80px' }}
                  />
                  <span className="text-[10px] text-on-surface-variant">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && projectRows.length === 0 && months.length === 0 && (
        <p className="text-on-surface-variant text-body-sm">No transaction data yet.</p>
      )}
    </div>
  );
}
