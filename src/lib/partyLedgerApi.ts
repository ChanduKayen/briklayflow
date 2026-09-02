// Party ledger data layer — assembles one party's account into the redesigned ledger:
//   • Paid       = transactions to the party (linked to a contract when the allocation has a WO)
//   • Certified  = inferred from the attendance page's contract-stage readings (labour_attendance)
//   • Billed     = a vendor's recorded PO bills (vendors have no "certified" work)
//   • Opening    = stakeholder_opening_balances (seed row)
//   • Adjustment = party_adjustments (manual credit/debit notes)
// Running "ahead" = cumulative(paid − certified) from the opening onward (paid ahead of certified).
import { supabase } from './supabase';
import { billDateOf, BILL_DATE_COLUMNS } from './partyLedger';

export type EntryKind = 'payment' | 'certified' | 'wage' | 'bill' | 'adjustment' | 'opening' | 'start' | 'consolidated';
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
  unclassified?: boolean;                      // new-engine payment with an unallocated remainder (set only by readParty)
  remainder?: number;                          // the unallocated amount, for the classify flow
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
  const [stkR, txnR, woR, poR, obR, adjR, cbR, wcR, balR] = await Promise.all([
    supabase.from('stakeholders').select('stakeholder_id, name, type, category').eq('stakeholder_id', stakeholderId).single(),
    supabase.from('transactions').select('*, txn_allocations(project_id, order_type, order_ref, milestone_id, allocated_amount, projects(name))').eq('stakeholder_id', stakeholderId).order('date', { ascending: false }),
    supabase.from('work_orders').select('wo_id, project_id, title, scope_of_work, order_value, projects(name), wo_milestones(milestone_id, name, planned_amount, unit_type, quantity, rate, seq_no)').eq('stakeholder_id', stakeholderId),
    supabase.from('purchase_orders').select(`po_id, project_id, vendor_bill_amount, vendor_bill_number, ${BILL_DATE_COLUMNS}`).eq('stakeholder_id', stakeholderId).not('vendor_bill_amount', 'is', null).gt('vendor_bill_amount', 0),
    supabase.from('stakeholder_opening_balances').select('*').eq('stakeholder_id', stakeholderId).maybeSingle(),
    supabase.from('party_adjustments').select('*').eq('stakeholder_id', stakeholderId),
    supabase.from('consolidated_bills').select('*').eq('stakeholder_id', stakeholderId).order('period_to'),
    // Approved work certifications = the governed certified obligation (replaces raw stage readings).
    supabase.from('work_certifications').select('id, wo_id, milestone_id, reading_kind, computed_amount, reading_date, project_id, status').eq('stakeholder_id', stakeholderId).eq('status', 'approved'),
    // The single-source balance (cutover-applied) — authoritative for the hero's to_pay / advance.
    supabase.from('v_party_balance').select('billed, paid, without_bills, to_pay, advance').eq('stakeholder_id', stakeholderId).maybeSingle(),
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

  // ── Certified: APPROVED work certifications (the governed obligation source; a pending one is not
  //    owed, exactly like a pending PO). measured/piece each count; lump = latest per milestone. ──
  const contractCert: Record<string, number> = {}; // wo_id → total certified
  {
    const certs = (wcR.data ?? []) as any[];
    const latestLump: Record<string, any> = {};
    const certLines: any[] = [];
    for (const wc of certs) {
      if (wc.reading_kind === 'lump' && wc.milestone_id) {
        const cur = latestLump[wc.milestone_id];
        if (!cur || (wc.reading_date || '') > (cur.reading_date || '')) latestLump[wc.milestone_id] = wc;
      } else {
        certLines.push(wc);
      }
    }
    Object.values(latestLump).forEach(wc => certLines.push(wc));
    for (const wc of certLines) {
      const amt = num(wc.computed_amount);
      if (amt <= 0.5) continue;
      const pid = wc.project_id ?? null;
      entries.push({
        id: `cert-${wc.id}`, date: wc.reading_date, kind: 'certified',
        particulars: 'Work certified', projectId: pid, projectName: pid ? (projName[pid] || pid) : null,
        contractId: wc.wo_id ?? null, paid: 0, cert: amt,
      });
      if (wc.wo_id) contractCert[wc.wo_id] = (contractCert[wc.wo_id] || 0) + amt;
    }
  }

  // ── Wage accrual (workers only) — the NMR / day-work obligation ────────────────────────────────
  // The locked model (see the worker-payable-accrual spec): a NO-CONTRACT worker's attendance IS the
  // measured value, so each day present accrues a wage credit (units × rate). A CONTRACT crew records
  // PRESENCE ONLY and accrues nothing here — its obligation is the certified stage readings above; a
  // payment before certification simply reads as an advance. This closes the gap where a daily-wage
  // worker's "to pay" was always ₹0 because attendance never became an obligation. Same figure the
  // weekly payment run computes (attendance × rate), so the ledger and the run agree.
  if (!isVendor) {
    try {
      // The worker's crews (a gang keyed to this party) + their per-skill rate rows, and any direct
      // workers keyed to this party. Only DAY-basis engagements accrue a wage per attendance; work /
      // measurement / piece engagements accrue via approved certifications instead (skipped here).
      const [crewAllR, directAllR] = await Promise.all([
        supabase.from('labour_crews').select('crew_id, project_id, accrual_basis').eq('stakeholder_id', stakeholderId),
        supabase.from('labour_direct_workers').select('id, project_id, rate, accrual_basis').eq('stakeholder_id', stakeholderId),
      ]);
      // Day-basis engagements accrue a wage per attendance; work/measurement/piece accrue via certifications.
      const nmrCrews = (crewAllR.data ?? []).filter((c: any) => c.accrual_basis === 'day');
      const crewProj: Record<string, string | null> = {};
      nmrCrews.forEach((c: any) => { crewProj[c.crew_id] = c.project_id ?? null; });
      const directs = (directAllR.data ?? []).filter((w: any) => w.accrual_basis === 'day');
      const directMeta: Record<string, { projectId: string | null; rate: number }> = {};
      directs.forEach((w: any) => { directMeta[w.id] = { projectId: w.project_id ?? null, rate: num(w.rate) }; });

      // Resolve names for any project not already known from the payment/contract joins.
      const wageProjIds = [...new Set([...nmrCrews.map((c: any) => c.project_id), ...directs.map((w: any) => w.project_id)].filter((p): p is string => !!p && !projName[p]))];
      if (wageProjIds.length) {
        const pr = await supabase.from('projects').select('project_id, name').in('project_id', wageProjIds);
        (pr.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });
      }

      // Rate per NMR crew skill row (category_id → rate + crew).
      const catRate: Record<string, { rate: number; crewId: string }> = {};
      if (nmrCrews.length) {
        const catR = await supabase.from('labour_crew_categories').select('id, crew_id, rate').in('crew_id', nmrCrews.map((c: any) => c.crew_id));
        (catR.data ?? []).forEach((k: any) => { catRate[k.id] = { rate: num(k.rate), crewId: k.crew_id }; });
      }

      // Attendance for those skill rows + direct workers, folded to wage = value × rate per (subject, day).
      // Grouped to ONE credit per crew (or direct worker) per work_date so the ledger reads cleanly.
      const catIds = Object.keys(catRate);
      const directIds = directs.map((w: any) => w.id);
      const wageByKey: Record<string, { date: string; projectId: string | null; amount: number; label: string }> = {};
      const addWage = (key: string, date: string, projectId: string | null, amount: number, label: string) => {
        if (amount <= 0) return;
        const k = `${key}|${date}`;
        (wageByKey[k] ||= { date, projectId, amount: 0, label }).amount += amount;
      };
      if (catIds.length) {
        const aR = await supabase.from('labour_attendance').select('category_id, value, work_date').eq('subject_type', 'crew_category').in('category_id', catIds);
        (aR.data ?? []).forEach((a: any) => { const c = catRate[a.category_id]; if (!c) return; addWage(`crew-${c.crewId}`, a.work_date, crewProj[c.crewId] ?? null, num(a.value) * c.rate, 'Wages'); });
      }
      if (directIds.length) {
        const aR = await supabase.from('labour_attendance').select('direct_worker_id, value, work_date').eq('subject_type', 'direct').in('direct_worker_id', directIds);
        (aR.data ?? []).forEach((a: any) => { const m = directMeta[a.direct_worker_id]; if (!m) return; addWage(`direct-${a.direct_worker_id}`, a.work_date, m.projectId, num(a.value) * m.rate, 'Wages'); });
      }
      for (const [k, w] of Object.entries(wageByKey)) {
        entries.push({
          id: `wage-${k}`, date: w.date, kind: 'wage', particulars: w.label,
          projectId: w.projectId, projectName: w.projectId ? (projName[w.projectId] || w.projectId) : null,
          contractId: null, paid: 0, cert: Math.round(w.amount),
        });
      }
    } catch { /* labour tables not present — no wage feed */ }
  }

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
  // A consolidated bill IS billing — its amount is a real certified figure. The running Balance
  // column already accumulates its cert (see the withRun reduce above), so it MUST also enter the
  // billed total here; otherwise the hero's to-pay/advance diverge from the ledger's own balance
  // (payments counted as paid, but the bill that accounts for them dropped from billed → a phantom
  // "advance" that hides a real amount owed).
  // A worker's wage accrual is a real obligation (a credit) — it counts as "certified" alongside stage
  // certifications and vendor bills, so to_pay/advance are computed on the true obligation base.
  const totalCert = withRun.filter(e => e.kind === 'certified' || e.kind === 'wage' || e.kind === 'bill' || e.kind === 'consolidated').reduce((s, e) => s + e.cert, 0);
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

  // The single source of record for the hero's dues is v_party_balance (it applies the ledger cutover
  // and the exact same formulas). Prefer it so the party page and Payables can never disagree; fall
  // back to the locally-derived figures only when the view isn't available yet (migration pending).
  const bal = balR?.data as { billed?: number; paid?: number; to_pay?: number; advance?: number } | null | undefined;
  const toPay   = bal ? num(bal.to_pay)  : Math.max(0, totalCert - totalPaid);
  const advance = bal ? num(bal.advance) : Math.max(0, totalPaid - totalCert - unbilledTotal);
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
