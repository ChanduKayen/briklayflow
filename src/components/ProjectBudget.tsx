import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getCostCode, MAT_DIVISIONS, WRK_DIVISIONS } from '../lib/costCodes';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BudgetLine {
  cost_code: string;
  planned_amount: number;
}

interface Props {
  projectId: string;
  canEdit: boolean;   // management / accountant only
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number) => Math.abs(n).toLocaleString('en-IN');

function MetricCard({
  label, value, sub, accent, negative,
}: {
  label: string; value: string; sub?: string;
  accent?: 'amber' | 'error' | 'secondary'; negative?: boolean;
}) {
  const valCls =
    accent === 'amber' ? 'text-amber-600'
    : accent === 'error' ? 'text-error'
    : accent === 'secondary' ? 'text-secondary'
    : negative ? 'text-error'
    : 'text-on-surface';
  return (
    <div className={`rounded-2xl border shadow-elevation-1 p-4 bg-white ${negative ? 'border-error/20' : 'border-outline-variant/20'}`}>
      <p className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-data-mono text-[18px] font-bold leading-tight ${valCls}`}>{value}</p>
      {sub && <p className="text-[10px] text-on-surface-variant/40 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProjectBudget({ projectId, canEdit }: Props) {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const inputRef  = useRef<HTMLInputElement>(null);

  const [editingCode, setEditingCode]     = useState<string | null>(null);
  const [editValue,   setEditValue]       = useState('');
  const [commitmentsOpen, setCommitmentsOpen] = useState(true);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: budgetLines = [] } = useQuery<BudgetLine[]>({
    queryKey: ['project_budgets', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_budgets')
        .select('cost_code, planned_amount')
        .eq('project_id', projectId);
      if (error) throw error;
      return data as BudgetLine[];
    },
  });

  const { data: allocations = [] } = useQuery<any[]>({
    queryKey: ['budget_allocs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('allocated_amount, transactions(txn_id, category, status)')
        .eq('project_id', projectId);
      if (error) throw error;
      return (data as any[]).filter(a => a.transactions?.status === 'Active');
    },
  });

  const { data: workOrders = [] } = useQuery<any[]>({
    queryKey: ['budget_wos', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('wo_id, order_value, status, scope_of_work, date_issued, stakeholders(name)')
        .eq('project_id', projectId);
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: purchaseOrders = [] } = useQuery<any[]>({
    queryKey: ['budget_pos', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('po_id, order_value, status, date_issued, stakeholders(name)')
        .eq('project_id', projectId);
      if (error) throw error;
      return data as any[];
    },
  });

  // ── Mutation: upsert budget line ────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async ({ code, amount }: { code: string; amount: number }) => {
      const { error } = await supabase
        .from('project_budgets')
        .upsert(
          { project_id: projectId, cost_code: code, planned_amount: amount, updated_at: new Date().toISOString() },
          { onConflict: 'project_id,cost_code' }
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project_budgets', projectId] }),
  });

  // ── Derived: spent by cost code ─────────────────────────────────────────────

  const spentByCode: Record<string, number>     = {};
  const txnsByCode:  Record<string, string[]>   = {};
  allocations.forEach((alloc: any) => {
    const code = alloc.transactions?.category;
    if (!code) return;
    spentByCode[code] = (spentByCode[code] || 0) + Number(alloc.allocated_amount);
    (txnsByCode[code] ??= []).push(alloc.transactions.txn_id);
  });

  // Planned by code
  const plannedByCode: Record<string, number> = {};
  budgetLines.forEach(b => { plannedByCode[b.cost_code] = Number(b.planned_amount); });

  // All cost codes with any data
  const allCodes = new Set([...Object.keys(spentByCode), ...Object.keys(plannedByCode)]);

  // Active commitments
  const activeWOs = workOrders.filter(wo => ['Issued', 'Active'].includes(wo.status));
  const activePOs = purchaseOrders.filter(po => ['Issued', 'Received'].includes(po.status));
  const totalCommitted = [...activeWOs, ...activePOs]
    .reduce((s, o) => s + Number(o.order_value || 0), 0);

  // Header totals
  const totalPlanned = Object.values(plannedByCode).reduce((s, v) => s + v, 0);
  const totalSpent   = Object.values(spentByCode).reduce((s, v) => s + v, 0);
  const remaining    = totalPlanned - totalCommitted - totalSpent;

  // Progress
  const progressPct = totalPlanned > 0
    ? Math.min(100, ((totalCommitted + totalSpent) / totalPlanned) * 100)
    : 0;

  // Over-budget lines (spent > planned, where planned > 0)
  const overBudgetCodes = Array.from(allCodes).filter(c =>
    (plannedByCode[c] || 0) > 0 && (spentByCode[c] || 0) > (plannedByCode[c] || 0)
  );
  const totalOverrun = overBudgetCodes.reduce(
    (s, c) => s + ((spentByCode[c] || 0) - (plannedByCode[c] || 0)), 0
  );

  // ── Group cost codes by division ────────────────────────────────────────────

  const allKnownDivisions = [...MAT_DIVISIONS, ...WRK_DIVISIONS];

  const groupedRows: {
    type: 'MAT' | 'WRK' | 'OTHER';
    divCode: string;
    divName: string;
    codes: string[];
  }[] = [];

  for (const div of allKnownDivisions) {
    const codesInDiv = div.items.filter(i => allCodes.has(i.code)).map(i => i.code);
    if (codesInDiv.length > 0) {
      groupedRows.push({ type: div.type, divCode: div.code, divName: div.name, codes: codesInDiv });
    }
  }

  // Legacy / unrecognised codes
  const knownCodes = new Set(allKnownDivisions.flatMap(d => d.items.map(i => i.code)));
  const legacyCodes = Array.from(allCodes).filter(c => !knownCodes.has(c));
  if (legacyCodes.length > 0) {
    groupedRows.push({ type: 'OTHER', divCode: 'LEGACY', divName: 'Other / Legacy', codes: legacyCodes });
  }

  // ── Inline edit handlers ────────────────────────────────────────────────────

  const startEdit = (code: string) => {
    if (!canEdit) return;
    setEditingCode(code);
    setEditValue(String(plannedByCode[code] || ''));
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
  };

  const commitEdit = (code: string) => {
    const amount = parseFloat(editValue.replace(/,/g, '')) || 0;
    if (amount !== (plannedByCode[code] || 0)) {
      saveMutation.mutate({ code, amount });
    }
    setEditingCode(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Over-budget banner ───────────────────────────────────────────── */}
      {overBudgetCodes.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-error/[0.07] border border-error/20 rounded-xl">
          <span className="material-symbols-outlined text-error text-[20px] shrink-0">warning</span>
          <p className="text-[13px] text-error font-medium flex-1">
            <strong>{overBudgetCodes.length} line{overBudgetCodes.length > 1 ? 's' : ''} over budget</strong>
            {' '}— ₹{fmt(totalOverrun)} total overrun
          </p>
          <div className="text-[10px] text-error/70 hidden sm:flex flex-col items-end">
            {overBudgetCodes.slice(0, 3).map(c => (
              <span key={c} className="font-data-mono">{c}</span>
            ))}
            {overBudgetCodes.length > 3 && <span>+{overBudgetCodes.length - 3} more</span>}
          </div>
        </div>
      )}

      {/* ── Header summary cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Total Planned"
          value={`₹${fmt(totalPlanned)}`}
          sub={`${budgetLines.length} lines`}
        />
        <MetricCard
          label="Committed"
          value={`₹${fmt(totalCommitted)}`}
          sub={`${activeWOs.length} WO · ${activePOs.length} PO`}
          accent="amber"
        />
        <MetricCard
          label="Spent"
          value={`₹${fmt(totalSpent)}`}
          sub={`${allocations.length} transaction${allocations.length !== 1 ? 's' : ''}`}
          accent="error"
        />
        <MetricCard
          label="Remaining"
          value={`${remaining < 0 ? '−' : ''}₹${fmt(remaining)}`}
          sub="Planned − Committed − Spent"
          negative={remaining < 0}
          accent={remaining >= 0 ? 'secondary' : undefined}
        />
      </div>

      {/* ── Master progress bar ──────────────────────────────────────────── */}
      {totalPlanned > 0 && (
        <div className="bg-white rounded-2xl border border-outline-variant/20 shadow-elevation-1 p-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-semibold text-on-surface-variant/60">Budget utilisation</span>
            <span className={`text-[13px] font-bold font-data-mono ${progressPct > 100 ? 'text-error' : 'text-on-surface'}`}>
              {progressPct.toFixed(1)}%
            </span>
          </div>
          {/* Stacked bar: committed (amber) + spent (red) */}
          <div className="h-2.5 bg-surface-container rounded-full overflow-hidden flex">
            {totalPlanned > 0 && totalCommitted > 0 && (
              <div
                className="h-full bg-amber-400 transition-all"
                style={{ width: `${Math.min(100, (totalCommitted / totalPlanned) * 100)}%` }}
              />
            )}
            {totalPlanned > 0 && totalSpent > 0 && (
              <div
                className="h-full bg-error transition-all"
                style={{ width: `${Math.min(100 - Math.min(100, (totalCommitted / totalPlanned) * 100), (totalSpent / totalPlanned) * 100)}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-5 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <span className="text-[10px] text-on-surface-variant/50">Committed ₹{fmt(totalCommitted)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-error shrink-0" />
              <span className="text-[10px] text-on-surface-variant/50">Spent ₹{fmt(totalSpent)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-surface-container-highest shrink-0" />
              <span className="text-[10px] text-on-surface-variant/50">Planned ₹{fmt(totalPlanned)}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Budget vs Actual table ───────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-outline-variant/20 shadow-elevation-1 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-outline-variant/[0.08] flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-on-surface">Budget vs Actual</h3>
          {canEdit && (
            <p className="text-[11px] text-on-surface-variant/40 flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">edit</span>
              Click Planned to set target
            </p>
          )}
        </div>

        {allCodes.size === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="material-symbols-outlined text-[44px] text-on-surface-variant/15 block mb-3">bar_chart</span>
            <p className="text-[13px] text-on-surface-variant/45 max-w-xs mx-auto">
              No data yet. Set budget targets by clicking the Planned column, or record transactions for this project.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className="border-b border-outline-variant/[0.08] bg-surface-container-lowest/50">
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-on-surface-variant/45 uppercase tracking-wide w-[100px]">Code</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-on-surface-variant/45 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-on-surface-variant/45 uppercase tracking-wide text-right w-[140px]">Planned ₹</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-on-surface-variant/45 uppercase tracking-wide text-right w-[120px]">Spent ₹</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-on-surface-variant/45 uppercase tracking-wide text-right w-[120px]">Variance ₹</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-on-surface-variant/45 uppercase tracking-wide text-right w-[110px]">% Used</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map(group => {
                  const divPlanned  = group.codes.reduce((s, c) => s + (plannedByCode[c] || 0), 0);
                  const divSpent    = group.codes.reduce((s, c) => s + (spentByCode[c]   || 0), 0);
                  const divVariance = divPlanned - divSpent;
                  const divPct      = divPlanned > 0 ? (divSpent / divPlanned) * 100 : null;

                  return [
                    /* Division header row */
                    <tr key={`div-${group.divCode}`}
                        className="bg-surface-container-low/40 border-y border-outline-variant/[0.08]">
                      <td colSpan={2} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {group.type !== 'OTHER' && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide ${
                              group.type === 'MAT' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                            }`}>{group.type}</span>
                          )}
                          <span className="text-[11px] font-semibold text-on-surface-variant/70">{group.divName}</span>
                          <span className="font-data-mono text-[9px] text-on-surface-variant/30">{group.divCode}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-data-mono text-[11px] font-semibold text-on-surface-variant/55">
                        {divPlanned > 0 ? `₹${fmt(divPlanned)}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-data-mono text-[11px] font-semibold text-on-surface-variant/55">
                        {divSpent > 0 ? `₹${fmt(divSpent)}` : '—'}
                      </td>
                      <td className={`px-4 py-2 text-right font-data-mono text-[11px] font-semibold ${divVariance < 0 ? 'text-error' : 'text-on-surface-variant/55'}`}>
                        {divPlanned > 0 ? `${divVariance < 0 ? '−' : '+'}₹${fmt(divVariance)}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-[11px] text-on-surface-variant/40">
                        {divPct !== null ? `${Math.round(divPct)}%` : '—'}
                      </td>
                    </tr>,

                    /* Item rows */
                    ...group.codes.map(code => {
                      const cc       = getCostCode(code);
                      const planned  = plannedByCode[code] || 0;
                      const spent    = spentByCode[code]   || 0;
                      const variance = planned - spent;
                      const pct      = planned > 0 ? (spent / planned) * 100 : null;
                      const isOver   = planned > 0 && spent > planned;
                      const noBudget = planned === 0 && spent > 0;
                      const isEditing = editingCode === code;

                      return (
                        <tr key={code}
                            className={`border-b border-outline-variant/[0.05] last:border-0 transition-colors ${
                              isOver ? 'bg-error/[0.025]' : 'hover:bg-surface-container-lowest/40'
                            }`}>
                          {/* Code */}
                          <td className="px-4 py-2.5">
                            <span className="font-data-mono text-[10px] text-on-surface-variant/45">{code}</span>
                          </td>
                          {/* Description */}
                          <td className="px-4 py-2.5">
                            <span className="text-[12px] text-on-surface leading-snug">
                              {cc?.item.name || code}
                            </span>
                          </td>
                          {/* Planned — editable */}
                          <td className="px-4 py-2.5 text-right">
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                type="number"
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(code)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter')  { commitEdit(code); }
                                  if (e.key === 'Escape') { setEditingCode(null); }
                                }}
                                className="w-28 text-right font-data-mono text-[12px] border border-primary rounded-lg px-2 py-1 outline-none bg-white shadow-sm"
                              />
                            ) : (
                              <button type="button" onClick={() => startEdit(code)}
                                className={`font-data-mono text-[12px] px-2 py-1 rounded-lg transition-all min-w-[80px] text-right ${
                                  noBudget
                                    ? 'text-amber-600 bg-amber-50 hover:bg-amber-100 text-[11px] font-medium'
                                    : canEdit
                                    ? 'text-on-surface hover:bg-surface-container cursor-text'
                                    : 'text-on-surface cursor-default'
                                }`}>
                                {noBudget ? 'No budget set' : `₹${fmt(planned)}`}
                              </button>
                            )}
                          </td>
                          {/* Spent */}
                          <td className="px-4 py-2.5 text-right">
                            <span className={`font-data-mono text-[12px] ${isOver ? 'text-error font-semibold' : 'text-on-surface-variant/65'}`}>
                              {spent > 0 ? `₹${fmt(spent)}` : '—'}
                            </span>
                            {txnsByCode[code]?.length > 0 && (
                              <p className="text-[9px] text-on-surface-variant/35 mt-0.5">
                                {txnsByCode[code].length} txn{txnsByCode[code].length > 1 ? 's' : ''}
                              </p>
                            )}
                          </td>
                          {/* Variance */}
                          <td className="px-4 py-2.5 text-right">
                            {planned > 0 ? (
                              <span className={`font-data-mono text-[12px] font-medium ${variance < 0 ? 'text-error' : 'text-secondary'}`}>
                                {variance < 0 ? '−' : '+'}₹{fmt(variance)}
                              </span>
                            ) : <span className="text-[12px] text-on-surface-variant/20">—</span>}
                          </td>
                          {/* % Used */}
                          <td className="px-4 py-2.5 text-right">
                            {pct !== null ? (
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-14 h-1.5 bg-surface-container rounded-full overflow-hidden shrink-0">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      pct > 100 ? 'bg-error' : pct > 80 ? 'bg-amber-400' : 'bg-primary'
                                    }`}
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                                <span className={`text-[11px] font-data-mono tabular-nums w-9 text-right ${
                                  pct > 100 ? 'text-error font-bold' : 'text-on-surface-variant/50'
                                }`}>
                                  {Math.round(pct)}%
                                </span>
                              </div>
                            ) : <span className="text-[12px] text-on-surface-variant/20">—</span>}
                          </td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Active Commitments ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-outline-variant/20 shadow-elevation-1 overflow-hidden">
        <button type="button"
          onClick={() => setCommitmentsOpen(o => !o)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-container-lowest/50 transition-colors">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant/50">handshake</span>
            <span className="text-[13px] font-semibold text-on-surface">Active Commitments</span>
            {totalCommitted > 0 && (
              <span className="font-data-mono text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                ₹{fmt(totalCommitted)}
              </span>
            )}
            <span className="text-[11px] text-on-surface-variant/35">
              {activeWOs.length + activePOs.length} active
            </span>
          </div>
          <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/35 transition-transform duration-200 ${commitmentsOpen ? 'rotate-180' : ''}`}>
            expand_more
          </span>
        </button>

        {commitmentsOpen && (
          <div className="border-t border-outline-variant/[0.08]">
            {activeWOs.length === 0 && activePOs.length === 0 ? (
              <p className="px-5 py-6 text-center text-[12px] text-on-surface-variant/35">
                No active WOs or POs for this project
              </p>
            ) : (
              <div className="divide-y divide-outline-variant/[0.05]">
                {activeWOs.map((wo: any) => (
                  <button key={wo.wo_id} type="button"
                    onClick={() => navigate(`/work-orders/${wo.wo_id}`)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-container-lowest/50 transition-colors group">
                    <span className="font-data-mono text-[9.5px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-bold shrink-0">WO</span>
                    <span className="font-data-mono text-[10.5px] text-on-surface-variant/50 shrink-0 w-28">{wo.wo_id}</span>
                    <span className="text-[12.5px] font-semibold text-on-surface flex-1 truncate">{wo.stakeholders?.name || '—'}</span>
                    <span className="text-[11px] text-on-surface-variant/45 flex-1 truncate hidden sm:block">
                      {wo.scope_of_work?.slice(0, 45) || '—'}
                    </span>
                    <span className="font-data-mono text-[13px] font-bold text-on-surface shrink-0">₹{fmt(Number(wo.order_value))}</span>
                    <span className={`text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                      wo.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>{wo.status}</span>
                    <span className="material-symbols-outlined text-[14px] text-on-surface-variant/25 group-hover:text-primary transition-colors shrink-0">arrow_forward</span>
                  </button>
                ))}
                {activePOs.map((po: any) => (
                  <button key={po.po_id} type="button"
                    onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-container-lowest/50 transition-colors group">
                    <span className="font-data-mono text-[9.5px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded font-bold shrink-0">PO</span>
                    <span className="font-data-mono text-[10.5px] text-on-surface-variant/50 shrink-0 w-28">{po.po_id}</span>
                    <span className="text-[12.5px] font-semibold text-on-surface flex-1 truncate">{po.stakeholders?.name || '—'}</span>
                    <span className="flex-1 hidden sm:block" />
                    <span className="font-data-mono text-[13px] font-bold text-on-surface shrink-0">₹{fmt(Number(po.order_value))}</span>
                    <span className={`text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                      po.status === 'Received' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>{po.status}</span>
                    <span className="material-symbols-outlined text-[14px] text-on-surface-variant/25 group-hover:text-primary transition-colors shrink-0">arrow_forward</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
