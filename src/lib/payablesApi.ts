// Payables data layer — "who do we owe, and how much", assembled from dues that
// already exist in the ledger. Three real sources, no new tables:
//   • Vendors  — approved-PO balances (the v_vendor_balance view: ordered − paid − advance)
//   • Contracts— work-order value minus what's been paid against it (txn_allocations, order_type='WO')
//   • Labour   — this week's unpaid wages + contract-earned from the attendance muster
import { supabase } from './supabase';
import { loadWeek, mondayOf, type Cell } from './attendanceApi';

export interface PartyDue {
  stakeholderId: string; name: string;
  poOwed: number; woOwed: number; total: number;
  projects: string[];        // project names this party is owed against
}
export interface LabourDue { projectId: string; projectName: string; wages: number; contract: number; total: number }
export interface Payables {
  parties: PartyDue[];
  labour: LabourDue[];
  totalParties: number;
  totalLabour: number;
}

const sumCells = (cells: Cell[]) => cells.reduce((s, c) => s + ((c && c !== 'off') ? c.v : 0), 0);
const latestPct = (st: { cells: Cell[]; before: number }) => st.cells.reduce((p, c) => (c && c !== 'off') ? c.v : p, st.before);

export async function loadPayables(): Promise<Payables> {
  const [vbR, woR, stkR, projR, week] = await Promise.all([
    supabase.from('v_vendor_balance').select('stakeholder_id, project_id, owed'),
    supabase.from('work_orders').select('wo_id, stakeholder_id, project_id, order_value, status').not('status', 'in', '("Draft","Cancelled")'),
    supabase.from('stakeholders').select('stakeholder_id, name'),
    supabase.from('projects').select('project_id, name'),
    loadWeek(mondayOf(new Date())),
  ]);
  for (const r of [vbR, woR, stkR, projR]) if (r.error) throw r.error;

  const nameOf: Record<string, string> = {};
  (stkR.data ?? []).forEach((s: any) => { nameOf[s.stakeholder_id] = s.name; });
  const projName: Record<string, string> = {};
  (projR.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });

  // Paid-against-WO, from allocations (non-voided).
  const woIds = (woR.data ?? []).map((w: any) => w.wo_id);
  const paidByWo: Record<string, number> = {};
  if (woIds.length) {
    const alR = await supabase.from('txn_allocations')
      .select('order_ref, allocated_amount, transactions(status)')
      .eq('order_type', 'WO').in('order_ref', woIds);
    if (alR.error) throw alR.error;
    (alR.data ?? []).forEach((a: any) => {
      if (a.transactions?.status === 'Voided') return;
      paidByWo[a.order_ref] = (paidByWo[a.order_ref] || 0) + Number(a.allocated_amount || 0);
    });
  }

  // Combine PO + WO dues per stakeholder.
  const byParty: Record<string, PartyDue> = {};
  const ensure = (id: string): PartyDue => (byParty[id] ||= { stakeholderId: id, name: nameOf[id] || 'Unknown party', poOwed: 0, woOwed: 0, total: 0, projects: [] });
  const addProject = (d: PartyDue, projectId: string | null) => { const n = projectId ? (projName[projectId] || projectId) : null; if (n && !d.projects.includes(n)) d.projects.push(n); };

  (vbR.data ?? []).forEach((v: any) => {
    const owed = Number(v.owed || 0);
    if (owed <= 0 || !v.stakeholder_id) return;
    const d = ensure(v.stakeholder_id); d.poOwed += owed; addProject(d, v.project_id);
  });
  (woR.data ?? []).forEach((w: any) => {
    if (!w.stakeholder_id) return;
    const owed = Number(w.order_value || 0) - (paidByWo[w.wo_id] || 0);
    if (owed <= 0.5) return;
    const d = ensure(w.stakeholder_id); d.woOwed += owed; addProject(d, w.project_id);
  });
  const parties = Object.values(byParty)
    .map(d => ({ ...d, total: d.poOwed + d.woOwed }))
    .filter(d => d.total > 0.5)
    .sort((a, b) => b.total - a.total);

  // Labour this week, per project, from the attendance muster.
  const labour: LabourDue[] = week.sites.map(site => {
    let wages = 0, contract = 0;
    site.crews.forEach(crew => {
      if (crew.basis === 'contract') {
        crew.stages.forEach(st => {
          const earned = st.type === 'lump' ? (st.amount || 0) * latestPct(st) / 100 : (st.before + sumCells(st.cells)) * (st.rate || 0);
          contract += earned - st.paid;
        });
      } else {
        crew.cats.forEach(cat => { wages += sumCells(cat.cells) * cat.rate; });
      }
    });
    site.direct.forEach(w => { wages += sumCells(w.cells) * w.rate; });
    return { projectId: site.site, projectName: site.label, wages: Math.max(0, wages), contract: Math.max(0, contract), total: Math.max(0, wages) + Math.max(0, contract) };
  }).filter(l => l.total > 0.5).sort((a, b) => b.total - a.total);

  return {
    parties, labour,
    totalParties: parties.reduce((s, d) => s + d.total, 0),
    totalLabour: labour.reduce((s, l) => s + l.total, 0),
  };
}
