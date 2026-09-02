// Party ledger data layer — assembles one party's account into the redesigned ledger:
//   • Paid       = transactions to the party (linked to a contract when the allocation has a WO)
//   • Certified  = inferred from the attendance page's contract-stage readings (labour_attendance)
//   • Billed     = a vendor's recorded PO bills (vendors have no "certified" work)
//   • Opening    = stakeholder_opening_balances (seed row)
//   • Adjustment = party_adjustments (manual credit/debit notes)
// Running "ahead" = cumulative(paid − certified) from the opening onward (paid ahead of certified).
import { supabase } from './supabase';
import { billDateOf, BILL_DATE_COLUMNS } from './partyLedger';

export type EntryKind = 'payment' | 'certified' | 'bill' | 'adjustment' | 'opening' | 'start' | 'consolidated';
export interface LedgerEntry {
  id: string; date: string | null;           // ISO date, null for the permanent "start" row
  kind: EntryKind;
  particulars: string; detail?: string; mode?: string; narr?: string; clip?: boolean;
  projectId: string | null; projectName: string | null;
  byProject?: Record<string, number>;         // split payments per site
  contractId: string | null;                  // wo_id when linked to a contract
  paid: number; cert: number;                  // one side per row
  running: number;                             // "ahead" after this entry
  unbilled?: boolean;                          // vendor payment with no bill on file
  covered?: boolean;                           // covered by a consolidated bill
  state?: string;                              // a short status note for the sub-line
}
export interface SiteBalance { projectId: string; projectName: string; paid: number; cert: number; unbilled: number; ahead: number; hasContract: boolean }
export interface ConsolidatedBill { id: string; from: string; to: string; amount: number; docType: 'vendor' | 'kacha' | 'none'; note: string; confirmed: boolean; coversCount: number; coversTotal: number }
export interface ContractInfo { woId: string; title: string; value: number; cert: number; paidLinked: number; paidCount: number; projectId: string | null; projectName: string | null }
export interface OpeningBalance { asOf: string; direction: 'paid_ahead' | 'work_owed'; total: number; bySite: Record<string, number>; note: string; confirmed: boolean }
export interface PartyLedger {
  kind: 'worker' | 'vendor';
  stakeholder: { id: string; name: string; type: string; category: string | null };
  entries: LedgerEntry[];                      // newest first, with running "ahead"
  totalPaid: number; paidCount: number;
  totalCert: number; contractCount: number;
  lastPaid: { date: string; amount: number; mode: string } | null;
  sites: SiteBalance[];
  contracts: ContractInfo[];
  unlinkedCount: number; unlinkedTotal: number;
  opening: OpeningBalance | null;
  aheadNow: number;
  // vendor "paid without bills" + consolidated bills
  unbilledTotal: number; unbilledCount: number;
  consolidated: ConsolidatedBill[];
  toPay: number; advance: number;              // vendor: billed beyond paid / paid beyond billed
}

const num = (v: any) => Number(v) || 0;

export async function loadPartyLedger(stakeholderId: string): Promise<PartyLedger> {
  const [stkR, txnR, woR, poR, obR, adjR, cbR] = await Promise.all([
    supabase.from('stakeholders').select('stakeholder_id, name, type, category').eq('stakeholder_id', stakeholderId).single(),
    supabase.from('transactions').select('*, txn_allocations(project_id, order_type, order_ref, milestone_id, allocated_amount, projects(name))').eq('stakeholder_id', stakeholderId).order('date', { ascending: false }),
    supabase.from('work_orders').select('wo_id, project_id, title, scope_of_work, order_value, projects(name), wo_milestones(milestone_id, name, planned_amount, unit_type, quantity, rate, seq_no)').eq('stakeholder_id', stakeholderId),
    supabase.from('purchase_orders').select(`po_id, project_id, vendor_bill_amount, vendor_bill_number, ${BILL_DATE_COLUMNS}`).eq('stakeholder_id', stakeholderId).not('vendor_bill_amount', 'is', null).gt('vendor_bill_amount', 0),
    supabase.from('stakeholder_opening_balances').select('*').eq('stakeholder_id', stakeholderId).maybeSingle(),
    supabase.from('party_adjustments').select('*').eq('stakeholder_id', stakeholderId),
    supabase.from('consolidated_bills').select('*').eq('stakeholder_id', stakeholderId).order('period_to'),
  ]);
  if (stkR.error) throw stkR.error;
  const stk = stkR.data as any;

  // Project name lookup (from the joins + a fallback fetch).
  const projName: Record<string, string> = {};
  const noteProj = (id: string | null, name?: string | null) => { if (id && name) projName[id] = name; };
  (woR.data ?? []).forEach((w: any) => noteProj(w.project_id, w.projects?.name));
  (txnR.data ?? []).forEach((t: any) => (t.txn_allocations ?? []).forEach((a: any) => noteProj(a.project_id, a.projects?.name)));

  const entries: Omit<LedgerEntry, 'running'>[] = [];

  // ── Paid: one row per transaction (a split payment carries byProject) ──
  // Voided transactions are excluded here so this — the single source of truth for a party's
  // balance — agrees with the side drawer, the Parties list, and everywhere else. A voided
  // payment never happened; folding it in would overstate what's been paid.
  const isVendor = stk.type === 'Vendor';
  const activeTxns = (txnR.data ?? []).filter((t: any) => t.status !== 'Voided');
  for (const t of activeTxns) {
    const allocs = (t.txn_allocations ?? []) as any[];
    const linked = allocs.find(a => a.order_type === 'WO' || a.order_type === 'PO');
    const byProject: Record<string, number> = {};
    allocs.forEach(a => { if (a.project_id) byProject[a.project_id] = (byProject[a.project_id] || 0) + num(a.allocated_amount); });
    const pid = Object.keys(byProject)[0] ?? null;
    entries.push({
      id: `t-${t.txn_id}`, date: t.date, kind: 'payment',
      particulars: t.category || 'Payment', mode: t.payment_mode || '', narr: t.remarks || undefined,
      clip: !!(t.proof_document_url || t.bill_doc_url),
      projectId: pid, projectName: pid ? (projName[pid] || pid) : null, byProject,
      contractId: linked?.order_ref ?? null,   // WO for workers, PO for vendors
      paid: num(t.total_amount), cert: 0,
    });
  }

  // ── Certified: inferred from attendance contract-stage readings (defensive: labour_* may be absent) ──
  const contractCert: Record<string, number> = {}; // wo_id → total certified
  try {
    const crewR = await supabase.from('labour_crews').select('crew_id, wo_id, project_id').eq('stakeholder_id', stakeholderId).not('wo_id', 'is', null);
    const crews = crewR.data ?? [];
    const woIds = [...new Set(crews.map((c: any) => c.wo_id))];
    if (woIds.length) {
      const msByWo: Record<string, any[]> = {};
      (woR.data ?? []).forEach((w: any) => { if (woIds.includes(w.wo_id)) msByWo[w.wo_id] = (w.wo_milestones ?? []); });
      const msIds = Object.values(msByWo).flat().map((m: any) => m.milestone_id);
      const msMeta: Record<string, any> = {}; Object.values(msByWo).flat().forEach((m: any) => { msMeta[m.milestone_id] = m; });
      const woOfMs: Record<string, string> = {}; for (const [wo, ms] of Object.entries(msByWo)) (ms as any[]).forEach(m => { woOfMs[m.milestone_id] = wo; });
      if (msIds.length) {
        const attR = await supabase.from('labour_attendance').select('milestone_id, value, work_date').eq('subject_type', 'stage').in('milestone_id', msIds).order('work_date');
        const byMs: Record<string, { work_date: string; value: number }[]> = {};
        (attR.data ?? []).forEach((a: any) => { (byMs[a.milestone_id] ||= []).push({ work_date: a.work_date, value: num(a.value) }); });
        for (const [mid, readings] of Object.entries(byMs)) {
          const m = msMeta[mid]; if (!m) continue;
          const lump = (m.unit_type ?? 'LS') === 'LS';
          let prevEarned = 0;
          for (const r of readings) {
            const earned = lump ? num(m.planned_amount) * r.value / 100 : (num(m.rate) * r.value);
            const delta = lump ? (earned - prevEarned) : earned; // lump = cumulative %, measured = per-day qty
            if (delta > 0.5) {
              const wo = woOfMs[mid];
              const w = (woR.data ?? []).find((x: any) => x.wo_id === wo);
              entries.push({
                id: `cert-${mid}-${r.work_date}`, date: r.work_date, kind: 'certified',
                particulars: `${m.name} certified`, projectId: w?.project_id ?? null, projectName: w?.project_id ? (projName[w.project_id] || w.project_id) : null,
                contractId: wo, paid: 0, cert: delta,
              });
              contractCert[wo] = (contractCert[wo] || 0) + delta;
            }
            if (lump) prevEarned = earned;
          }
        }
      }
    }
  } catch { /* labour tables not present — no certified feed */ }

  // ── Billed: a vendor's recorded PO bills (as the certified/credit side) ──
  if (isVendor) {
    for (const p of (poR.data ?? [])) {
      const d = billDateOf(p);
      entries.push({
        id: `bill-${p.po_id}`, date: d, kind: 'bill', particulars: `Bill ${p.vendor_bill_number || p.po_id}`,
        projectId: p.project_id ?? null, projectName: p.project_id ? (projName[p.project_id] || p.project_id) : null,
        contractId: null, paid: 0, cert: num(p.vendor_bill_amount),
      });
    }
  }

  // ── Adjustments ──
  for (const a of (adjR.data ?? [])) {
    entries.push({
      id: `adj-${a.id}`, date: a.adj_date, kind: 'adjustment', particulars: 'Adjustment', detail: a.note,
      projectId: a.project_id ?? null, projectName: a.project_id ? (projName[a.project_id] || a.project_id) : null,
      contractId: null, paid: a.side === 'paid' ? num(a.amount) : 0, cert: a.side === 'certified' ? num(a.amount) : 0,
    });
  }

  // ── Opening balance (a seed row at its as-of date) ──
  let opening: OpeningBalance | null = null;
  if (obR.data) {
    const o = obR.data as any;
    opening = { asOf: o.as_of, direction: o.direction, total: num(o.total_amount), bySite: o.by_site || {}, note: o.note || '', confirmed: !!o.confirmed };
    entries.push({
      id: `opening`, date: o.as_of, kind: 'opening', particulars: 'Opening balance', detail: o.note || undefined,
      projectId: null, projectName: null, contractId: null,
      paid: o.direction === 'paid_ahead' ? num(o.total_amount) : 0, cert: o.direction === 'work_owed' ? num(o.total_amount) : 0,
    });
  }

  // ── Vendor consolidated bills: mark each payment billed(PO) / covered / still unbilled,
  //    and add a "consolidated bill" billed row per booked bill ──
  const cbs = (cbR.data ?? []) as any[];
  let unbilledTotal = 0, unbilledCount = 0;
  const unbilledBySite: Record<string, number> = {};
  const consolidated: ConsolidatedBill[] = [];
  if (isVendor) {
    const covers = (date: string | null) => date ? cbs.find((cb: any) => date >= cb.period_from && date <= cb.period_to) : null;
    const cbStats: Record<string, { count: number; total: number }> = {};
    for (const e of entries) {
      if (e.kind !== 'payment') continue;
      if (e.contractId) { e.state = 'Billed on a PO'; continue; }
      const cb = covers(e.date);
      if (cb) { e.covered = true; e.state = 'Covered by a consolidated bill'; (cbStats[cb.id] ||= { count: 0, total: 0 }); cbStats[cb.id].count++; cbStats[cb.id].total += e.paid; }
      else { e.unbilled = true; e.state = 'No bill yet'; unbilledTotal += e.paid; unbilledCount++; if (e.byProject) Object.entries(e.byProject).forEach(([pid, amt]) => { unbilledBySite[pid] = (unbilledBySite[pid] || 0) + amt; }); }
    }
    for (const cb of cbs) {
      const st = cbStats[cb.id] || { count: 0, total: 0 };
      const rangeLabel = `${new Date(cb.period_from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(cb.period_to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
      consolidated.push({ id: cb.id, from: cb.period_from, to: cb.period_to, amount: num(cb.amount), docType: cb.doc_type, note: cb.note || '', confirmed: !!cb.confirmed, coversCount: st.count, coversTotal: st.total });
      entries.push({
        id: `cb-${cb.id}`, date: cb.period_to, kind: 'consolidated',
        particulars: `Consolidated bill, ${rangeLabel}`, detail: `Covers ${st.count} payment${st.count !== 1 ? 's' : ''}`,
        projectId: null, projectName: null, contractId: null, paid: 0, cert: num(cb.amount),
        state: cb.confirmed ? 'confirmed' : 'awaiting confirmation',
      });
    }
  }

  // ── Sort oldest→newest, accumulate running "ahead" (paid − cert), then flip to newest-first ──
  const asc = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kind === 'opening' ? -1 : 0));
  let run = 0;
  const withRun: LedgerEntry[] = asc.map(e => { run += e.paid - e.cert; return { ...e, running: run }; });
  withRun.reverse(); // newest first

  // ── Facts / rollups ──
  const payments = withRun.filter(e => e.kind === 'payment');
  const totalPaid = payments.reduce((s, e) => s + e.paid, 0);
  const totalCert = withRun.filter(e => e.kind === 'certified' || e.kind === 'bill').reduce((s, e) => s + e.cert, 0);
  const lastPaidEntry = payments[0];
  const lastPaid = lastPaidEntry ? { date: lastPaidEntry.date!, amount: lastPaidEntry.paid, mode: lastPaidEntry.mode || '' } : null;

  // by-site
  const siteMap: Record<string, SiteBalance> = {};
  const ensureSite = (pid: string) => (siteMap[pid] ||= { projectId: pid, projectName: projName[pid] || pid, paid: 0, cert: 0, unbilled: 0, ahead: 0, hasContract: false });
  withRun.forEach(e => {
    if (e.kind === 'payment' && e.byProject) Object.entries(e.byProject).forEach(([pid, amt]) => { ensureSite(pid).paid += amt; });
    else if (e.projectId && (e.cert || e.paid)) { const s = ensureSite(e.projectId); s.paid += e.paid; s.cert += e.cert; if (e.contractId) s.hasContract = true; }
  });
  Object.values(siteMap).forEach(s => { s.unbilled = unbilledBySite[s.projectId] || 0; s.ahead = s.paid - s.cert; });
  const sites = Object.values(siteMap).sort((a, b) => b.paid - a.paid);

  // contracts (by-contract view) — work orders for workers, POs for vendors
  const contracts: ContractInfo[] = isVendor
    ? (poR.data ?? []).map((p: any) => {
        const linkedPays = payments.filter(e => e.contractId === p.po_id);
        return {
          woId: p.po_id, title: `Bill ${p.vendor_bill_number || p.po_id}`, value: num(p.vendor_bill_amount), cert: num(p.vendor_bill_amount),
          paidLinked: linkedPays.reduce((s, e) => s + e.paid, 0), paidCount: linkedPays.length,
          projectId: p.project_id ?? null, projectName: p.project_id ? (projName[p.project_id] || p.project_id) : null,
        };
      })
    : (woR.data ?? []).map((w: any) => {
        const value = num(w.order_value) || (w.wo_milestones ?? []).reduce((s: number, m: any) => s + num(m.planned_amount), 0);
        const paidLinkedEntries = payments.filter(e => e.contractId === w.wo_id);
        return {
          woId: w.wo_id, title: w.title || w.scope_of_work || w.wo_id, value, cert: contractCert[w.wo_id] || 0,
          paidLinked: paidLinkedEntries.reduce((s, e) => s + e.paid, 0), paidCount: paidLinkedEntries.length,
          projectId: w.project_id ?? null, projectName: w.project_id ? (projName[w.project_id] || w.project_id) : null,
        };
      });
  const contractCount = contracts.length;
  const unlinked = payments.filter(e => !e.contractId);
  const unlinkedCount = unlinked.length;
  const unlinkedTotal = unlinked.reduce((s, e) => s + e.paid, 0);

  const toPay = Math.max(0, totalCert - totalPaid);
  const advance = Math.max(0, totalPaid - totalCert - unbilledTotal);
  return {
    kind: isVendor ? 'vendor' : 'worker',
    stakeholder: { id: stk.stakeholder_id, name: stk.name, type: stk.type, category: stk.category },
    entries: withRun, totalPaid, paidCount: payments.length, totalCert, contractCount, lastPaid,
    sites, contracts, unlinkedCount, unlinkedTotal, opening, aheadNow: run,
    unbilledTotal, unbilledCount, consolidated, toPay, advance,
  };
}

// ── writes ───────────────────────────────────────────────────────────────────
export async function saveOpeningBalance(orgId: string, stakeholderId: string, o: { asOf: string; direction: 'paid_ahead' | 'work_owed'; total: number; bySite: Record<string, number>; note: string }): Promise<void> {
  const { error } = await supabase.from('stakeholder_opening_balances').upsert({
    org_id: orgId, stakeholder_id: stakeholderId, as_of: o.asOf, direction: o.direction,
    total_amount: o.total, by_site: o.bySite, note: o.note || null,
  }, { onConflict: 'org_id,stakeholder_id' });
  if (error) throw error;
}
export async function bookConsolidatedBill(orgId: string, stakeholderId: string, cb: { from: string; to: string; amount: number; docType: 'vendor' | 'kacha' | 'none'; note: string }): Promise<void> {
  const { error } = await supabase.from('consolidated_bills').insert({
    org_id: orgId, stakeholder_id: stakeholderId, period_from: cb.from, period_to: cb.to, amount: cb.amount, doc_type: cb.docType, note: cb.note || null,
  });
  if (error) throw error;
}
export async function addAdjustment(orgId: string, stakeholderId: string, a: { projectId: string | null; adjDate: string; side: 'paid' | 'certified'; amount: number; note: string }): Promise<void> {
  const { error } = await supabase.from('party_adjustments').insert({
    org_id: orgId, stakeholder_id: stakeholderId, project_id: a.projectId, adj_date: a.adjDate, side: a.side, amount: a.amount, note: a.note,
  });
  if (error) throw error;
}
// Link a payment to a work-order contract (re-allocate). Mirrors trackingApi.attachToContract.
export async function linkPaymentToContract(txnId: string, woId: string): Promise<void> {
  const { error } = await supabase.from('txn_allocations').update({ order_type: 'WO', order_ref: woId }).eq('txn_id', txnId).is('order_type', null);
  if (error) throw error;
}
