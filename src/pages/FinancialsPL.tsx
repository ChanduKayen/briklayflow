import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getCostCode, MAT_DIVISIONS, WRK_DIVISIONS } from '../lib/costCodes';
import { PageSkeleton } from '../components/SkeletonLoader';

const fmt = (n: number) =>
  n === 0 ? '—' : `₹${n >= 100000 ? (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L' : n.toLocaleString('en-IN')}`;

export default function FinancialsPL() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: txns, isLoading } = useQuery({
    queryKey: ['pl_txns', dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('transactions')
        .select('txn_id, total_amount, date, category, status, stakeholders(type)')
        .eq('status', 'Active')
        .order('date', { ascending: false });
      if (dateFrom) q = q.gte('date', dateFrom);
      if (dateTo) q = q.lte('date', dateTo);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as {
        txn_id: string;
        total_amount: number;
        date: string;
        category: string | null;
        status: string;
        stakeholders: { type: string } | null;
      }[];
    },
  });

  // Aggregate spend per cost code
  const spendByCode: Record<string, number> = {};
  for (const t of txns || []) {
    const amt = Number(t.total_amount);
    if (!t.category) continue; // uncategorised entries don't belong to a cost code
    spendByCode[t.category] = (spendByCode[t.category] || 0) + amt;
  }

  // Group by division
  interface DivRow {
    divisionCode: string;
    divisionName: string;
    type: 'MAT' | 'WRK';
    total: number;
    items: { code: string; name: string; amount: number }[];
  }

  const buildDivRows = (divs: typeof MAT_DIVISIONS): DivRow[] =>
    divs
      .map(div => {
        const items = div.items
          .map(item => ({ code: item.code, name: item.name, amount: spendByCode[item.code] || 0 }))
          .filter(i => i.amount > 0);
        const total = items.reduce((s, i) => s + i.amount, 0);
        return { divisionCode: div.code, divisionName: div.name, type: div.type as 'MAT' | 'WRK', total, items };
      })
      .filter(d => d.total > 0);

  // Legacy text categories
  const legacySpend: Record<string, number> = {};
  for (const [code, amt] of Object.entries(spendByCode)) {
    if (!getCostCode(code)) legacySpend[code] = amt;
  }

  const matRows = buildDivRows(MAT_DIVISIONS);
  const wrkRows = buildDivRows(WRK_DIVISIONS);

  const matTotal = matRows.reduce((s, d) => s + d.total, 0);
  const wrkTotal = wrkRows.reduce((s, d) => s + d.total, 0);
  const legacyTotal = Object.values(legacySpend).reduce((s, v) => s + v, 0);
  const grandTotal = matTotal + wrkTotal + legacyTotal;

  const txnCount = txns?.length || 0;

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-16 max-w-4xl">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/financials" className="text-on-surface-variant hover:text-primary">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </Link>
        <div>
          <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Cost Report</h2>
          <p className="text-[12px] text-on-surface-variant/50 mt-0.5">
            {txnCount} active transaction{txnCount !== 1 ? 's' : ''} · Total {fmt(grandTotal)}
          </p>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex gap-3 mt-4 mb-stack-lg flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-label-caps font-label-caps text-on-surface-variant">FROM</label>
          <input type="date" className="bk-input py-1.5 text-body-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-label-caps font-label-caps text-on-surface-variant">TO</label>
          <input type="date" className="bk-input py-1.5 text-body-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        {(dateFrom || dateTo) && (
          <button className="text-body-sm text-primary hover:underline" onClick={() => { setDateFrom(''); setDateTo(''); }}>
            Clear filter
          </button>
        )}
      </div>

      {isLoading && <div className="mb-4"><PageSkeleton /></div>}

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-gutter mb-stack-xl">
        {[
          { label: 'Materials (MAT)', value: fmt(matTotal), color: 'text-primary' },
          { label: 'Works & Labour (WRK)', value: fmt(wrkTotal), color: 'text-secondary' },
          { label: 'Grand Total', value: fmt(grandTotal), color: 'text-on-surface' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-4 shadow-elevation-1 border border-black/[0.06]">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase mb-1">{c.label}</p>
            <p className={`text-[18px] font-bold font-data-mono ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* MAT section */}
      {matRows.length > 0 && (
        <Section title="Materials" typeTag="MAT" rows={matRows} total={matTotal} grandTotal={grandTotal} />
      )}

      {/* WRK section */}
      {wrkRows.length > 0 && (
        <Section title="Works & Labour" typeTag="WRK" rows={wrkRows} total={wrkTotal} grandTotal={grandTotal} />
      )}

      {/* Legacy */}
      {legacyTotal > 0 && (
        <div className="bg-white rounded-xl shadow-elevation-1 border border-black/[0.06] mb-stack-lg overflow-hidden">
          <div className="px-5 py-3 bg-surface-container-low border-b border-outline-variant/20 flex justify-between items-center">
            <span className="text-body-sm font-bold text-on-surface">Other / Uncategorised</span>
            <span className="font-data-mono text-body-sm font-bold">{fmt(legacyTotal)}</span>
          </div>
          <div className="tscroll"><table className="w-full">
            <tbody>
              {Object.entries(legacySpend).map(([code, amt]) => (
                <tr key={code} className="border-b border-outline-variant/10 last:border-0">
                  <td className="px-5 py-2.5 text-body-sm text-on-surface-variant">{code}</td>
                  <td className="px-5 py-2.5 text-body-sm font-data-mono text-right">{fmt(amt)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      {!isLoading && grandTotal === 0 && (
        <p className="text-on-surface-variant text-body-sm">No transactions in this period.</p>
      )}
    </div>
  );
}

function Section({
  title,
  typeTag,
  rows,
  total,
  grandTotal,
}: {
  title: string;
  typeTag: string;
  rows: { divisionCode: string; divisionName: string; total: number; items: { code: string; name: string; amount: number }[] }[];
  total: number;
  grandTotal: number;
}) {
  const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
  const fmt = (n: number) =>
    n === 0 ? '—' : `₹${n >= 100000 ? (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L' : n.toLocaleString('en-IN')}`;

  return (
    <div className="bg-white rounded-xl shadow-elevation-1 border border-black/[0.06] mb-stack-lg overflow-hidden">
      <div className="px-5 py-3 bg-surface-container-low border-b border-outline-variant/20 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeTag === 'MAT' ? 'bg-primary-container text-on-primary-container' : 'bg-secondary-container text-on-secondary-container'}`}>
            {typeTag}
          </span>
          <span className="text-body-sm font-bold text-on-surface">{title}</span>
          <span className="text-[11px] text-on-surface-variant">({pct}% of total)</span>
        </div>
        <span className="font-data-mono text-body-sm font-bold">{fmt(total)}</span>
      </div>
      {rows.map(div => (
        <details key={div.divisionCode} className="border-b border-outline-variant/10 last:border-0">
          <summary className="px-5 py-2.5 flex justify-between items-center cursor-pointer hover:bg-surface-container-lowest list-none">
            <span className="text-body-sm text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">chevron_right</span>
              <span className="text-[11px] font-data-mono text-on-surface-variant/60">{div.divisionCode}</span>
              {div.divisionName}
            </span>
            <span className="font-data-mono text-body-sm font-bold">{fmt(div.total)}</span>
          </summary>
          <div className="bg-surface-container-lowest">
            {div.items.map(item => (
              <div key={item.code} className="px-10 py-2 flex justify-between items-center border-t border-outline-variant/10">
                <span className="text-body-sm text-on-surface-variant">{item.name}</span>
                <span className="font-data-mono text-body-sm">{fmt(item.amount)}</span>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
