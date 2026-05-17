import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageSkeleton } from '../components/SkeletonLoader';

const MONTHS_BACK = 12;

const fmt = (n: number) =>
  `₹${n >= 100000 ? (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L' : n.toLocaleString('en-IN')}`;

const monthLabel = (ym: string) => {
  const [year, month] = ym.split('-');
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
};

// Last N months as YYYY-MM strings
function lastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export default function FinancialsCashflow() {
  const [selectedYear, setSelectedYear] = useState<string>('');
  const currentYear = new Date().getFullYear();

  const { data: txns, isLoading } = useQuery({
    queryKey: ['cf_txns', selectedYear],
    queryFn: async () => {
      let q = supabase
        .from('transactions')
        .select('txn_id, total_amount, date, payment_mode, status, stakeholders(type, name)')
        .eq('status', 'Active')
        .order('date', { ascending: false });
      if (selectedYear) {
        q = q.gte('date', `${selectedYear}-01-01`).lte('date', `${selectedYear}-12-31`);
      } else {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - MONTHS_BACK);
        q = q.gte('date', cutoff.toISOString().slice(0, 10));
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as {
        txn_id: string;
        total_amount: number;
        date: string;
        payment_mode: string;
        status: string;
        stakeholders: { type: string; name: string } | null;
      }[];
    },
  });

  // Monthly aggregates
  const monthlyData: Record<string, { total: number; cash: number; neft: number; upi: number; cheque: number; count: number }> = {};
  for (const t of txns || []) {
    const m = t.date?.slice(0, 7);
    if (!m) continue;
    if (!monthlyData[m]) monthlyData[m] = { total: 0, cash: 0, neft: 0, upi: 0, cheque: 0, count: 0 };
    const amt = Number(t.total_amount);
    monthlyData[m].total += amt;
    monthlyData[m].count += 1;
    const mode = (t.payment_mode || '').toLowerCase();
    if (mode === 'cash') monthlyData[m].cash += amt;
    else if (mode === 'neft') monthlyData[m].neft += amt;
    else if (mode === 'upi') monthlyData[m].upi += amt;
    else if (mode === 'cheque') monthlyData[m].cheque += amt;
  }

  const displayMonths = selectedYear
    ? Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`)
    : lastNMonths(MONTHS_BACK);

  const monthsWithData = displayMonths.filter(m => monthlyData[m]);

  const grandTotal = (txns || []).reduce((s, t) => s + Number(t.total_amount), 0);
  const maxMonthlyTotal = Math.max(...displayMonths.map(m => monthlyData[m]?.total || 0), 1);

  // Payment mode totals
  const modeTotal = { Cash: 0, NEFT: 0, UPI: 0, Cheque: 0 };
  for (const t of txns || []) {
    const mode = t.payment_mode as keyof typeof modeTotal;
    if (modeTotal[mode] !== undefined) modeTotal[mode] += Number(t.total_amount);
  }

  const years = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-16 max-w-4xl">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/financials" className="text-on-surface-variant hover:text-primary">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </Link>
        <div>
          <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Cash Flow</h2>
          <p className="text-[12px] text-on-surface-variant/50 mt-0.5">
            {selectedYear ? `FY ${selectedYear}` : `Last ${MONTHS_BACK} months`} · {(txns || []).length} payments · Total outflow {fmt(grandTotal)}
          </p>
        </div>
      </div>

      {/* Year filter */}
      <div className="flex items-center gap-3 mt-4 mb-stack-lg flex-wrap">
        <button
          className={`px-3 py-1.5 rounded-full text-label-caps font-label-caps transition-colors ${!selectedYear ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
          onClick={() => setSelectedYear('')}
        >
          Last 12 months
        </button>
        {years.map(y => (
          <button
            key={y}
            className={`px-3 py-1.5 rounded-full text-label-caps font-label-caps transition-colors ${selectedYear === y ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
            onClick={() => setSelectedYear(y)}
          >
            {y}
          </button>
        ))}
      </div>

      {isLoading && <div className="mb-4"><PageSkeleton /></div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-gutter mb-stack-xl">
        {(Object.entries(modeTotal) as [string, number][]).map(([mode, total]) => (
          <div key={mode} className="bg-white rounded-xl p-4 shadow-elevation-1 border border-black/[0.06]">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase mb-1">{mode}</p>
            <p className="text-[16px] font-bold font-data-mono text-on-surface">{total === 0 ? '—' : fmt(total)}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {monthsWithData.length > 0 && (
        <div className="bg-white rounded-xl shadow-elevation-1 border border-black/[0.06] p-6 mb-stack-xl">
          <h3 className="text-body-sm font-bold mb-4 text-on-surface">Monthly Outflows</h3>
          <div className="flex items-end gap-1" style={{ height: '100px' }}>
            {displayMonths.map(m => {
              const d = monthlyData[m];
              const total = d?.total || 0;
              const heightPct = Math.max((total / maxMonthlyTotal) * 100, total > 0 ? 2 : 0);
              return (
                <div key={m} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end" title={total > 0 ? `${monthLabel(m)}: ${fmt(total)}` : undefined}>
                  {total > 0 && <span className="text-[8px] text-on-surface-variant font-data-mono">{fmt(total)}</span>}
                  <div
                    className={`w-full rounded-t ${total > 0 ? 'bg-primary' : 'bg-transparent'}`}
                    style={{ height: `${heightPct}%`, maxHeight: '70px' }}
                  />
                  <span className="text-[9px] text-on-surface-variant">{monthLabel(m)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly table */}
      {monthsWithData.length > 0 && (
        <div className="bg-white rounded-xl shadow-elevation-1 border border-black/[0.06] overflow-hidden">
          <div className="px-5 py-3 bg-surface-container-low border-b border-outline-variant/20">
            <h3 className="text-body-sm font-bold text-on-surface">Monthly Breakdown</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-outline-variant/20">
                <th className="px-5 py-2 text-left text-label-caps font-label-caps text-on-surface-variant">Month</th>
                <th className="px-5 py-2 text-right text-label-caps font-label-caps text-on-surface-variant">Txns</th>
                <th className="px-5 py-2 text-right text-label-caps font-label-caps text-on-surface-variant">Cash</th>
                <th className="px-5 py-2 text-right text-label-caps font-label-caps text-on-surface-variant">NEFT</th>
                <th className="px-5 py-2 text-right text-label-caps font-label-caps text-on-surface-variant">UPI</th>
                <th className="px-5 py-2 text-right text-label-caps font-label-caps text-on-surface-variant">Cheque</th>
                <th className="px-5 py-2 text-right text-label-caps font-label-caps text-on-surface-variant font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...monthsWithData].reverse().map(m => {
                const d = monthlyData[m];
                return (
                  <tr key={m} className="border-b border-outline-variant/10 last:border-0 hover:bg-surface-container-lowest">
                    <td className="px-5 py-2.5 text-body-sm font-medium">{monthLabel(m)}</td>
                    <td className="px-5 py-2.5 text-body-sm text-right text-on-surface-variant">{d.count}</td>
                    <td className="px-5 py-2.5 text-body-sm font-data-mono text-right">{d.cash ? fmt(d.cash) : '—'}</td>
                    <td className="px-5 py-2.5 text-body-sm font-data-mono text-right">{d.neft ? fmt(d.neft) : '—'}</td>
                    <td className="px-5 py-2.5 text-body-sm font-data-mono text-right">{d.upi ? fmt(d.upi) : '—'}</td>
                    <td className="px-5 py-2.5 text-body-sm font-data-mono text-right">{d.cheque ? fmt(d.cheque) : '—'}</td>
                    <td className="px-5 py-2.5 text-body-sm font-data-mono font-bold text-right">{fmt(d.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && monthsWithData.length === 0 && (
        <p className="text-on-surface-variant text-body-sm">No transactions in this period.</p>
      )}
    </div>
  );
}
