// The Allocation Ledger — read model for the party page.
//
// Returns the SAME PartyLedger shape the UI already renders (partyLedgerApi.PartyLedger), but built
// from the new engine: credits from ledger_credits, states from ledger_allocations, payments the debit
// side. Swapped in only for orgs whose operator has flipped new_ledger_enabled — every other org keeps
// the old netting untouched. Opening balance and paid-side adjustments (which have no first-class debit
// row yet) are folded in from their own tables, exactly as the derivation does.
import { supabase } from './supabase';
import type { LedgerEntry, PartyLedger, SiteBalance, ContractInfo, ConsolidatedBill, OpeningBalance, EntryKind } from './partyLedgerApi';

const num = (v: any) => Number(v) || 0;

// ── per-org cutover switch ──────────────────────────────────────────────────
export async function isNewLedgerOrg(orgId: string): Promise<boolean> {
  const { data } = await supabase.from('organizations').select('new_ledger_enabled').eq('org_id', orgId).maybeSingle();
  return !!(data as any)?.new_ledger_enabled;
}
export async function setNewLedgerEnabled(orgId: string, on: boolean, cutoverAt?: string): Promise<void> {
  const patch: any = { new_ledger_enabled: on };
  if (on && cutoverAt) patch.ledger_cutover_at = cutoverAt;
  const { error } = await supabase.from('organizations').update(patch).eq('org_id', orgId);
  if (error) throw error;
}

// ── projection reader (INV-12) — the cached per-party figures ────────────────
export interface PartyProjection { stakeholderId: string; toPay: number; advance: number; unclassifiedAhead: number; withoutBills: number; net: number }
export async function loadProjectionMap(orgId: string): Promise<Record<string, PartyProjection>> {
  const { data, error } = await supabase.from('ledger_projection').select('*').eq('org_id', orgId);
  if (error) throw error;
  const map: Record<string, PartyProjection> = {};
  (data ?? []).forEach((r: any) => { map[r.stakeholder_id] = { stakeholderId: r.stakeholder_id, toPay: num(r.to_pay), advance: num(r.advance), unclassifiedAhead: num(r.unclassified_ahead), withoutBills: num(r.without_bills), net: num(r.net) }; });
  return map;
}

// new-engine credit kind → the display kind the Row component understands
const displayKind = (k: string): EntryKind =>
  k === 'vendor_bill' ? 'bill' : k === 'consolidated' ? 'consolidated' : k === 'opening' ? 'opening'
    : k === 'adjustment' ? 'adjustment' : k === 'self_settle' ? 'bill' : 'certified'; // plan / certified → 'certified'
const creditLabel = (k: string): string =>
  k === 'vendor_bill' ? 'Bill' : k === 'consolidated' ? 'Consolidated bill' : k === 'plan' ? 'Weekly plan'
    : k === 'self_settle' ? 'Work done · no bill' : k === 'opening' ? 'Opening balance' : k === 'adjustment' ? 'Adjustment' : 'Certified';

export async function readParty(stakeholderId: string): Promise<PartyLedger> {
  const [stkR, txnR, credR, obR, adjR] = await Promise.all([
    supabase.from('stakeholders').select('stakeholder_id, name, type, category').eq('stakeholder_id', stakeholderId).single(),
    supabase.from('transactions').select('txn_id, date, total_amount, payment_mode, remarks, category, proof_document_url, bill_doc_url, status, txn_allocations(project_id, allocated_amount, projects(name))').eq('stakeholder_id', stakeholderId).order('date', { ascending: false }),
    supabase.from('ledger_credits').select('*').eq('stakeholder_id', stakeholderId),
    supabase.from('stakeholder_opening_balances').select('*').eq('stakeholder_id', stakeholderId).maybeSingle(),
    supabase.from('party_adjustments').select('*').eq('stakeholder_id', stakeholderId),
  ]);
  if (stkR.error) throw stkR.error;
  const stk = stkR.data as any;
  const isVendor = stk.type === 'Vendor';

  const payments = (txnR.data ?? []).filter((t: any) => t.status !== 'Voided');
  const credits = (credR.data ?? []) as any[];
  const paymentIds = payments.map((p: any) => p.txn_id);

  let allocs: any[] = [];
  if (paymentIds.length) {
    const { data, error } = await supabase.from('ledger_allocations').select('payment_id, target_kind, credit_id, contract_ref, project_id, amount').in('payment_id', paymentIds);
    if (error) throw error;
    allocs = data ?? [];
  }

  // project names
  const projName: Record<string, string> = {};
  (txnR.data ?? []).forEach((t: any) => (t.txn_allocations ?? []).forEach((a: any) => { if (a.project_id && a.projects?.name) projName[a.project_id] = a.projects.name; }));
  const needProj = [...new Set([...credits.map(c => c.project_id), ...allocs.map(a => a.project_id)].filter((x): x is string => !!x && !projName[x]))];
  if (needProj.length) { const { data } = await supabase.from('projects').select('project_id, name').in('project_id', needProj); (data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; }); }
  const pn = (id: string | null) => (id ? (projName[id] || id) : null);

  // allocation roll-ups
  const allocByPayment: Record<string, number> = {};
  const allocByCredit: Record<string, number> = {};
  const poolByPayment: Record<string, { contract: string; amount: number }> = {};
  const creditKindOfAlloc: Record<string, string> = {};      // credit_id → kind
  credits.forEach(c => { creditKindOfAlloc[c.credit_id] = c.kind; });
  const perContractAdvance: Record<string, number> = {};
  for (const a of allocs) {
    allocByPayment[a.payment_id] = (allocByPayment[a.payment_id] || 0) + num(a.amount);
    if (a.target_kind === 'credit' && a.credit_id) allocByCredit[a.credit_id] = (allocByCredit[a.credit_id] || 0) + num(a.amount);
    if (a.target_kind === 'pool' && a.contract_ref) { perContractAdvance[a.contract_ref] = (perContractAdvance[a.contract_ref] || 0) + num(a.amount); poolByPayment[a.payment_id] = { contract: a.contract_ref, amount: num(a.amount) }; }
  }
  const contractOfCredit: Record<string, string | null> = {};
  credits.forEach(c => { contractOfCredit[c.credit_id] = c.contract_ref ?? null; });
  // a payment's contract = its pool's contract, or a bill credit it settles
  const contractOfPayment: Record<string, string | null> = {};
  for (const a of allocs) {
    if (a.payment_id in contractOfPayment) continue;
    if (a.target_kind === 'pool' && a.contract_ref) contractOfPayment[a.payment_id] = a.contract_ref;
    else if (a.target_kind === 'credit' && a.credit_id && contractOfCredit[a.credit_id]) contractOfPayment[a.payment_id] = contractOfCredit[a.credit_id];
  }
  const coveredByConsolidated = (pid: string) => allocs.some(a => a.payment_id === pid && a.target_kind === 'credit' && a.credit_id && creditKindOfAlloc[a.credit_id] === 'consolidated');

  // ── entries ──
  const entries: Omit<LedgerEntry, 'running'>[] = [];

  for (const t of payments) {
    const pas = (t.txn_allocations ?? []) as any[];
    const byProject: Record<string, number> = {};
    pas.forEach(a => { if (a.project_id) byProject[a.project_id] = (byProject[a.project_id] || 0) + num(a.allocated_amount); });
    const pid = Object.keys(byProject)[0] ?? null;
    const allocated = allocByPayment[t.txn_id] || 0;
    const remainder = Math.max(0, num(t.total_amount) - allocated);
    const pool = poolByPayment[t.txn_id];
    const covered = coveredByConsolidated(t.txn_id);
    const unbilled = isVendor && allocated < 0.005;
    const state = pool ? 'Advance against measurement'
      : covered ? 'Covered by a consolidated bill'
      : contractOfPayment[t.txn_id] ? 'Billed on a contract'
      : unbilled ? 'No bill yet'
      : allocated > 0.005 ? 'Settled' : undefined;
    entries.push({
      id: `t-${t.txn_id}`, date: t.date, kind: 'payment',
      particulars: t.category || 'Payment', mode: t.payment_mode || '', narr: t.remarks || undefined,
      clip: !!(t.proof_document_url || t.bill_doc_url),
      projectId: pid, projectName: pn(pid), byProject,
      contractId: contractOfPayment[t.txn_id] ?? null,
      paid: num(t.total_amount), cert: 0,
      unbilled: unbilled || undefined, covered: covered || undefined, state,
      unclassified: remainder > 0.005, remainder,
    });
  }

  for (const c of credits) {
    const open = Math.max(0, num(c.amount) - (allocByCredit[c.credit_id] || 0));
    entries.push({
      id: `c-${c.credit_id}`, date: c.entry_date, kind: displayKind(c.kind),
      particulars: creditLabel(c.kind), detail: c.note || (open > 0.005 && num(c.amount) > 0 ? `₹${Math.round(open).toLocaleString('en-IN')} open` : undefined),
      projectId: c.project_id ?? null, projectName: pn(c.project_id ?? null),
      contractId: c.contract_ref ?? null, paid: 0, cert: num(c.amount),
      state: c.kind === 'consolidated' ? (c.confirmed ? 'confirmed' : 'awaiting confirmation') : undefined,
    });
  }

  // opening (paid-ahead debit side only; work-owed is a ledger_credit already)
  let opening: OpeningBalance | null = null;
  if (obR.data) {
    const o = obR.data as any;
    opening = { asOf: o.as_of, direction: o.direction, total: num(o.total_amount), bySite: o.by_site || {}, note: o.note || '', confirmed: !!o.confirmed };
    if (o.direction === 'paid_ahead') entries.push({ id: 'opening', date: o.as_of, kind: 'opening', particulars: 'Opening balance', detail: o.note || undefined, projectId: null, projectName: null, contractId: null, paid: num(o.total_amount), cert: 0 });
  }
  // paid-side adjustments (certified-side are ledger_credits)
  for (const a of (adjR.data ?? [])) if (a.side === 'paid') entries.push({ id: `adj-${a.id}`, date: a.adj_date, kind: 'adjustment', particulars: 'Adjustment', detail: a.note, projectId: a.project_id ?? null, projectName: pn(a.project_id ?? null), contractId: null, paid: num(a.amount), cert: 0 });

  // ── running "ahead" (paid − cert) oldest→newest, then newest-first ──
  const asc = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kind === 'opening' ? -1 : 0));
  let run = 0;
  const withRun: LedgerEntry[] = asc.map(e => { run += e.paid - e.cert; return { ...e, running: run }; });
  withRun.reverse();

  // ── figures ──
  const pays = withRun.filter(e => e.kind === 'payment');
  const totalPaid = pays.reduce((s, e) => s + e.paid, 0);
  const creditsTotal = credits.reduce((s, c) => s + num(c.amount), 0);
  const correctionDebits = (opening?.direction === 'paid_ahead' ? opening.total : 0) + (adjR.data ?? []).filter((a: any) => a.side === 'paid').reduce((s: number, a: any) => s + num(a.amount), 0);
  const openCredits = credits.reduce((s, c) => s + Math.max(0, num(c.amount) - (allocByCredit[c.credit_id] || 0)), 0) + (opening?.direction === 'work_owed' && !credits.some(c => c.kind === 'opening') ? opening.total : 0);
  const unallocatedCash = pays.reduce((s, e) => s + Math.max(0, e.paid - (allocByPayment[e.id.replace(/^t-/, '')] || 0)), 0) + correctionDebits;
  const advance = Object.values(perContractAdvance).reduce((s, v) => s + v, 0);
  const toPay = Math.max(0, openCredits - unallocatedCash);
  const unbilledPays = pays.filter(e => !(allocByPayment[e.id.replace(/^t-/, '')] > 0));
  const unbilledTotal = unbilledPays.reduce((s, e) => s + e.paid, 0);
  const lastPaidE = pays[0];
  const lastPaid = lastPaidE ? { date: lastPaidE.date!, amount: lastPaidE.paid, mode: lastPaidE.mode || '' } : null;

  // ── per-site ──
  const siteMap: Record<string, SiteBalance> = {};
  const ensure = (pid: string) => (siteMap[pid] ||= { projectId: pid, projectName: pn(pid) || pid, paid: 0, cert: 0, unbilled: 0, ahead: 0, hasContract: false });
  const unbilledBySite: Record<string, number> = {};
  unbilledPays.forEach(e => { if (e.byProject) Object.entries(e.byProject).forEach(([pid, amt]) => { unbilledBySite[pid] = (unbilledBySite[pid] || 0) + amt; }); });
  withRun.forEach(e => {
    if (e.kind === 'payment' && e.byProject) Object.entries(e.byProject).forEach(([pid, amt]) => { ensure(pid).paid += amt; });
    else if (e.projectId && (e.cert || e.paid)) { const s = ensure(e.projectId); s.paid += e.paid; s.cert += e.cert; if (e.contractId) s.hasContract = true; }
  });
  Object.values(siteMap).forEach(s => { s.unbilled = unbilledBySite[s.projectId] || 0; s.ahead = s.paid - s.cert; });
  const sites = Object.values(siteMap).sort((a, b) => b.paid - a.paid);

  // ── contracts (by pool + certified/bill credits sharing a contract_ref) ──
  const contractIds = [...new Set([...Object.keys(perContractAdvance), ...credits.filter(c => c.contract_ref).map(c => c.contract_ref)])];
  const contracts: ContractInfo[] = contractIds.map(cr => {
    const cCredits = credits.filter(c => c.contract_ref === cr);
    const value = cCredits.reduce((s, c) => s + num(c.amount), 0);
    const linkedPays = pays.filter(e => e.contractId === cr);
    return { woId: cr, title: cCredits[0] ? creditLabel(cCredits[0].kind) + ' ' + cr : cr, value, cert: value, paidLinked: (perContractAdvance[cr] || 0) + linkedPays.reduce((s, e) => s + Math.min(e.paid, allocByPayment[e.id.replace(/^t-/, '')] || 0), 0), paidCount: linkedPays.length, projectId: cCredits[0]?.project_id ?? null, projectName: pn(cCredits[0]?.project_id ?? null) };
  });

  // ── consolidated bills ──
  const consolidated: ConsolidatedBill[] = credits.filter(c => c.kind === 'consolidated').map(c => {
    const covered = allocs.filter(a => a.credit_id === c.credit_id);
    return { id: c.credit_id, from: c.entry_date, to: c.entry_date, amount: num(c.amount), docType: (c.doc_flag || 'none'), note: c.note || '', confirmed: !!c.confirmed, coversCount: covered.length, coversTotal: covered.reduce((s, a) => s + num(a.amount), 0) };
  });

  const unlinked = pays.filter(e => !e.contractId);

  return {
    kind: isVendor ? 'vendor' : 'worker',
    stakeholder: { id: stk.stakeholder_id, name: stk.name, type: stk.type, category: stk.category },
    entries: withRun, totalPaid, paidCount: pays.length, totalCert: creditsTotal, contractCount: contracts.length, lastPaid,
    sites, contracts, unlinkedCount: unlinked.length, unlinkedTotal: unlinked.reduce((s, e) => s + e.paid, 0),
    opening, aheadNow: run,
    unbilledTotal, unbilledCount: unbilledPays.length, consolidated,
    toPay, advance,
  };
}
