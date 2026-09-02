// Weekly Payments (Payables) data layer — the "who do we pay this week, how much, and why"
// run, labour-first. Rows are party × project, rolled up from the attendance week:
//   • daily-wage crews / direct workers → wages (days × rate), allocate to the project
//   • contract crews → this-week earned + carried balance, allocate to the work order + milestone
// Mark-paid records a REAL transaction via insert_transaction_with_allocations.
import { supabase } from './supabase';
import { loadWeek, mondayOf, weekDates, weekLabel, type Cell } from './attendanceApi';
import { createCredit, allocateToCredit, allocateToPool, settleFIFO } from './ledgerWrite';

export { mondayOf, weekLabel };

const sumCells = (cells: Cell[]) => cells.reduce((s, c) => s + ((c && c !== 'off') ? c.v : 0), 0);
const latestPct = (st: { cells: Cell[]; before: number }) => st.cells.reduce((p, c) => (c && c !== 'off') ? c.v : p, st.before);

export interface AttDetail {
  period: string;
  days: string[];                                  // Mon…Sat labels
  cats: { name: string; rate: number; cells: (number | null)[] }[];
  ledger: [string, number][];
  sum: number;
}
export interface StageDetail {
  readings: [string, string, number][];            // [stage name, "70% of ₹58,000", earned]
  ledger: [string, number][];
  sum: number;
}
export interface PayRow {
  key: string;
  projectId: string; projectName: string;
  stakeholderId: string | null;
  party: string; trade: string;
  kind: 'wages' | 'contract' | 'recurring' | 'vendor';
  recurringId?: string;
  basis: string;
  thisWeek: number;                                // computed figure (prefill)
  balanceBf: number;                               // carried from before (contract only)
  woId: string | null; milestoneId: string | null; // allocation target for a contract payment
  bills?: VendorBill[];                            // open POs for a vendor (oldest-first)
  advance?: number;                                // vendor: paid ahead of billing (shown SEPARATELY from dues)
  withoutBills?: number;                           // vendor: paid with no bill on file
  att?: AttDetail;
  stage?: StageDetail;
}
export interface VendorBill { poId: string; no: string; date: string; amount: number; balance: number; projectId: string | null; projectName: string | null }
export interface PaySection { projectId: string; projectName: string; rows: PayRow[] }
export interface WeeklyPayments { sections: PaySection[]; monday: Date }

const inrShort = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export async function loadWeeklyPayments(monday: Date): Promise<WeeklyPayments> {
  const { sites } = await loadWeek(monday);
  const dates = weekDates(monday);
  const dayLabels = dates.slice(0, 6).map(d => new Date(d).toLocaleString('en-US', { weekday: 'short' }));
  const period = `${new Date(dates[0]).toLocaleString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(dates[5]).toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;

  const sections: PaySection[] = sites.map(site => {
    const rows: PayRow[] = [];

    site.crews.forEach((crew, ci) => {
      if (crew.basis === 'contract') {
        // This-week earned vs prior earned, per stage; carried b/f = prior earned − paid.
        let thisWeekEarned = 0, priorEarned = 0, paid = 0;
        const readings: [string, string, number][] = [];
        crew.stages.forEach(st => {
          if (st.type === 'lump') {
            const pct = latestPct(st), amt = st.amount || 0;
            const earned = amt * pct / 100, before = amt * st.before / 100;
            thisWeekEarned += earned - before; priorEarned += before; paid += st.paid;
            readings.push([st.n, `${pct}% of ${inrShort(amt)}`, earned]);
          } else {
            const done = st.before + sumCells(st.cells), rate = st.rate || 0;
            const earned = done * rate, before = st.before * rate;
            thisWeekEarned += earned - before; priorEarned += before; paid += st.paid;
            readings.push([st.n, `${done} ${st.unit || ''} · ${inrShort(earned)}`, earned]);
          }
        });
        const balanceBf = Math.max(0, priorEarned - paid);
        const thisWeek = Math.max(0, thisWeekEarned);
        if (thisWeek <= 0 && balanceBf <= 0) return;
        // Allocate a contract payment to the WO + the first stage that still has a balance.
        const target = crew.stages.find(st => {
          const e = st.type === 'lump' ? (st.amount || 0) * latestPct(st) / 100 : (st.before + sumCells(st.cells)) * (st.rate || 0);
          return e - st.paid > 0.5;
        }) ?? crew.stages[0];
        rows.push({
          key: `c${site.site}-${ci}`, projectId: site.site, projectName: site.label,
          stakeholderId: crew.stakeholderId, party: crew.n, trade: crew.trade || crew.d || 'Contract',
          kind: 'contract', basis: `contract · ${crew.stages.length} phase${crew.stages.length !== 1 ? 's' : ''}`,
          thisWeek, balanceBf, woId: crew.woId, milestoneId: target?.milestoneId ?? null,
          stage: { readings, ledger: [['Certified so far', priorEarned + thisWeekEarned], ['Paid so far', -paid]], sum: (priorEarned + thisWeekEarned) - paid },
        });
      } else {
        const cats = crew.cats.map(cat => ({ name: cat.n, rate: cat.rate, cells: cat.cells.slice(0, 6).map(c => (c && c !== 'off') ? c.v : null) }));
        const wage = crew.cats.reduce((s, cat) => s + sumCells(cat.cells) * cat.rate, 0);
        if (wage <= 0) return;
        const ledger = crew.cats.map(cat => [`${sumCells(cat.cells)} × ${inrShort(cat.rate)}`, sumCells(cat.cells) * cat.rate] as [string, number]).filter(l => l[1] > 0);
        rows.push({
          key: `w${site.site}-${ci}`, projectId: site.site, projectName: site.label,
          stakeholderId: crew.stakeholderId, party: crew.n, trade: crew.trade || crew.d || 'Labour',
          kind: 'wages', basis: 'attendance', thisWeek: wage, balanceBf: 0, woId: null, milestoneId: null,
          att: { period, days: dayLabels, cats, ledger, sum: wage },
        });
      }
    });

    site.direct.forEach((w, wi) => {
      const wage = sumCells(w.cells) * w.rate;
      if (wage <= 0) return;
      const days = sumCells(w.cells);
      rows.push({
        key: `d${site.site}-${wi}`, projectId: site.site, projectName: site.label,
        stakeholderId: w.stakeholderId, party: w.n, trade: w.cat || 'Direct',
        kind: 'wages', basis: 'attendance', thisWeek: wage, balanceBf: 0, woId: null, milestoneId: null,
        att: { period, days: dayLabels, cats: [{ name: w.cat, rate: w.rate, cells: w.cells.slice(0, 6).map(c => (c && c !== 'off') ? c.v : null) }], ledger: [[`${days} × ${inrShort(w.rate)}`, wage]], sum: wage },
      });
    });

    return { projectId: site.site, projectName: site.label, rows };
  }); // keep every active project — an empty one still shows its "add a payment" row

  return { sections, monday };
}

// ── vendor payments — ONE net-payable row per vendor, from the party-ledger view ─────────────
// The headline due is the vendor's NET to-pay (billed − paid across ALL bills: POs, consolidated,
// opening, adjustments), read from v_party_balance so Payables and the party-ledger hero can't drift.
// Advance (paid ahead) rides along SEPARATELY, never netted into the due. The open PO bills come too,
// for the expand + the oldest-first payment allocation. If the view isn't present yet (migration not
// applied), it falls back to the sum of open PO dues so the page still works.
export async function loadVendorRows(): Promise<PayRow[]> {
  const [poR, stkR, projR, balR] = await Promise.all([
    supabase.from('purchase_orders').select('po_id, stakeholder_id, project_id, total_value, order_value, vendor_bill_amount, vendor_bill_number, date_issued, status').eq('approval_status', 'APPROVED'),
    supabase.from('stakeholders').select('stakeholder_id, name'),
    supabase.from('projects').select('project_id, name'),
    supabase.from('v_party_balance').select('stakeholder_id, to_pay, advance, without_bills'),
  ]);
  if (poR.error) throw poR.error;
  const pos = (poR.data ?? []).filter((p: any) => p.stakeholder_id && (p.status || '').toUpperCase() !== 'CANCELLED');
  const poIds = pos.map((p: any) => p.po_id);
  const stkName: Record<string, string> = {}; (stkR.data ?? []).forEach((s: any) => { stkName[s.stakeholder_id] = s.name; });
  const projName: Record<string, string> = {}; (projR.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });

  // Ledger net figures per vendor (view absent → {} → fall back to open PO dues below).
  const bal: Record<string, { toPay: number; advance: number; without: number }> = {};
  (balR.data ?? []).forEach((b: any) => { bal[b.stakeholder_id] = { toPay: Number(b.to_pay || 0), advance: Number(b.advance || 0), without: Number(b.without_bills || 0) }; });

  const paidByPo: Record<string, number> = {};
  if (poIds.length) {
    const alR = await supabase.from('txn_allocations').select('order_ref, allocated_amount, transactions(status)').eq('order_type', 'PO').in('order_ref', poIds);
    (alR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided') return; paidByPo[a.order_ref] = (paidByPo[a.order_ref] || 0) + Number(a.allocated_amount || 0); });
  }

  // Open PO bills grouped by VENDOR (across projects) — each bill keeps its own project.
  const byVendor: Record<string, VendorBill[]> = {};
  pos.forEach((p: any) => {
    const base = Number(p.vendor_bill_amount || p.total_value || p.order_value || 0);
    const due = base - (paidByPo[p.po_id] || 0);
    if (due <= 0.5) return;
    (byVendor[p.stakeholder_id] ||= []).push({
      poId: p.po_id, no: p.vendor_bill_number || p.po_id, date: p.date_issued || '', amount: base, balance: due,
      projectId: p.project_id ?? null, projectName: p.project_id ? (projName[p.project_id] || p.project_id) : null,
    });
  });

  const vendorIds = new Set<string>([...Object.keys(byVendor), ...Object.keys(bal)]);
  const rows: PayRow[] = [];
  for (const vid of vendorIds) {
    const bills = (byVendor[vid] ?? []).sort((a, b) => (a.date || '').localeCompare(b.date || '')); // oldest first
    const openDue = bills.reduce((s, b) => s + b.balance, 0);
    const b = bal[vid];
    // Net to-pay from the ledger view; fall back to open PO dues when the view is unavailable.
    const due = b ? b.toPay : openDue;
    if (due <= 0.5) continue; // a payment run lists only what's owed; advance-only vendors live on the party page
    const projects = Array.from(new Set(bills.map(x => x.projectId).filter(Boolean))) as string[];
    const primaryProject = bills[0]?.projectId ?? null;
    const projectLabel = projects.length > 1 ? 'Multiple sites' : (projects[0] ? (projName[projects[0]] || projects[0]) : '—');
    rows.push({
      key: `v-${vid}`, projectId: primaryProject ?? '', projectName: projectLabel,
      stakeholderId: vid, party: stkName[vid] || 'Vendor',
      trade: `${bills.length} bill${bills.length !== 1 ? 's' : ''} open${projects.length > 1 ? ` · ${projects.length} sites` : ''}`,
      kind: 'vendor' as const, basis: 'vendor bills · oldest first', thisWeek: due, balanceBf: 0, woId: null, milestoneId: null,
      bills, advance: b?.advance ?? 0, withoutBills: b?.without ?? 0,
    });
  }
  return rows.sort((a, b) => b.thisWeek - a.thisWeek);
}

// ── recurring / fixed payments ───────────────────────────────────────────────
export interface Recurring {
  id: string; projectId: string; projectName: string; stakeholderId: string | null;
  partyName: string; label: string; amount: number; cadence: 'weekly' | 'monthly'; category: string;
}
export async function loadRecurring(): Promise<Recurring[]> {
  const [recR, projR] = await Promise.all([
    supabase.from('recurring_payments').select('*').eq('active', true).order('created_at'),
    supabase.from('projects').select('project_id, name'),
  ]);
  if (recR.error) throw recR.error; if (projR.error) throw projR.error;
  const pn: Record<string, string> = {}; (projR.data ?? []).forEach((p: any) => { pn[p.project_id] = p.name; });
  return (recR.data ?? []).map((r: any) => ({
    id: r.id, projectId: r.project_id, projectName: pn[r.project_id] || r.project_id, stakeholderId: r.stakeholder_id ?? null,
    partyName: r.party_name, label: r.label || r.category, amount: Number(r.amount) || 0, cadence: r.cadence, category: r.category,
  }));
}
/** A recurring line as a payable row (same UI + payment path as any other row). */
export function recurringToRow(r: Recurring): PayRow {
  return {
    key: `rec-${r.id}`, recurringId: r.id, projectId: r.projectId, projectName: r.projectName,
    stakeholderId: r.stakeholderId, party: r.partyName, trade: r.label,
    kind: 'recurring', basis: `${r.cadence} · recurring`, thisWeek: r.amount, balanceBf: 0,
    woId: null, milestoneId: null,
  };
}
export async function addRecurring(orgId: string, r: { projectId: string; stakeholderId: string | null; partyName: string; label: string; amount: number; cadence: 'weekly' | 'monthly'; category: string }): Promise<void> {
  const { error } = await supabase.from('recurring_payments').insert({
    org_id: orgId, project_id: r.projectId, stakeholder_id: r.stakeholderId, party_name: r.partyName,
    label: r.label || null, amount: r.amount, cadence: r.cadence, category: r.category || 'Recurring',
  });
  if (error) throw error;
}
export async function removeRecurring(id: string): Promise<void> {
  const { error } = await supabase.from('recurring_payments').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// Record a real payment for a row. Wages/recurring → project allocation; contract → WO + milestone.
export async function recordWeeklyPayment(
  orgId: string, row: PayRow,
  amount: number, mode: string, reason: string,
): Promise<string> {
  const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const category = row.kind === 'contract' ? 'Running Bill' : row.kind === 'vendor' ? 'Purchase Payment' : row.kind === 'recurring' ? 'Recurring' : 'Wages';
  // Write the computed provenance into the ledger comment so the transaction carries WHY.
  const detail = row.att
    ? row.att.cats.map(c => { const days = c.cells.reduce((a: number, v) => a + (v || 0), 0); return days ? `${c.name} ${days}×₹${c.rate}` : ''; }).filter(Boolean).join(', ')
    : row.stage ? row.stage.readings.map(([n, m]) => `${n} · ${m}`).join('; ')
    : row.bills ? row.bills.map(b => `Bill ${b.no} ${inrShort(b.balance)}`).join(', ')
    : row.basis;
  const remarks = [row.party, detail, reason].filter(Boolean).join(' · ');
  // Contract → the work order + milestone. Vendor → spread across the open POs, oldest bill first
  // (anything beyond stays on account = a bare project allocation). Wages/recurring → project only.
  let allocations: Record<string, unknown>[];
  if (row.kind === 'contract' && row.woId) {
    allocations = [{ project_id: row.projectId, order_type: 'WO', order_ref: row.woId, milestone_id: row.milestoneId, allocated_amount: amount }];
  } else if (row.kind === 'vendor' && row.bills?.length) {
    // Oldest bill first — each PO allocation carries THAT bill's own project (a vendor row spans sites).
    allocations = []; let left = amount;
    for (const b of row.bills) { const a = Math.min(b.balance, left); if (a > 0.5) { allocations.push({ project_id: b.projectId ?? row.projectId, order_type: 'PO', order_ref: b.poId, allocated_amount: a }); left -= a; } if (left <= 0.5) break; }
    if (left > 0.5) allocations.push({ project_id: row.bills[0]?.projectId ?? row.projectId, allocated_amount: left }); // on account
  } else {
    allocations = [{ project_id: row.projectId, allocated_amount: amount }];
  }
  const { data, error } = await supabase.rpc('insert_transaction_with_allocations', {
    p_txn: {
      txn_id: txnId, org_id: orgId, stakeholder_id: row.stakeholderId,
      date: new Date().toISOString().split('T')[0], total_amount: amount,
      payment_mode: mode, category, remarks, ai_flag_status: 'Clean', ai_flag_data: {},
    },
    p_allocations: allocations,
  });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string } | null;
  if (!r?.success) throw new Error(r?.error || 'Could not record the payment');
  return txnId;
}

// ── Phase 2: mirror a weekly payment onto the allocation ledger (new-ledger orgs) ──
// The plan IS the accrual (§2.3): a wage/recurring payment mints a plan credit and settles it. A
// contract payment is an advance against measurement (§3.2 → the pool). A vendor payment settles the
// open bill credits, oldest first. Called only when the org has flipped to the new ledger.
export async function settleWeeklyPaymentOnLedger(txnId: string, row: PayRow, amount: number, monday: Date): Promise<void> {
  if (row.kind === 'contract' && row.woId) { await allocateToPool(txnId, row.woId, amount); return; }
  if (row.kind === 'vendor') { await settleFIFO(txnId); return; }         // settle open vendor bills oldest-first
  if (!row.stakeholderId) return;                                          // an ad-hoc payee with no party can't accrue
  // wages / recurring — a plan credit for what was paid, settled by this payment
  const creditId = await createCredit({
    stakeholderId: row.stakeholderId, kind: 'plan', amount, entryDate: mondayOf(monday).toISOString().slice(0, 10),
    projectId: row.projectId, note: `${row.trade} · weekly plan`, source: 'plan',
  });
  await allocateToCredit(txnId, creditId, amount);
}
