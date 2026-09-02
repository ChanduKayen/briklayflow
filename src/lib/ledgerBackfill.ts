// The Allocation Ledger — Phase-1 backfill (§1.5).
//
// Materialises the new tables from SOURCE data — NOT from loadPartyLedger — so the parity harness
// compares two independent computations and a bug in either surfaces as a diff. Idempotent per party:
// every row it writes carries source='backfill' and is deleted-then-reinserted on re-run.
//
// Credits it mints:   vendor bills · certified stages · work-owed opening · certified-side adjustments · consolidated bills
// Allocations (1.5):  WO-linked payments → contract pool · PO-linked payments → that PO's bill (FIFO) · consolidated coverage (FIFO, capped)
// Left unallocated on purpose where the link is ambiguous — that honesty is what FIFO-forward is for.
import { supabase } from './supabase';
import { billDateOf, BILL_DATE_COLUMNS } from './partyLedger';

const num = (v: any) => Number(v) || 0;
const today = () => new Date().toISOString().slice(0, 10);

interface NewCredit { org_id: string; stakeholder_id: string; project_id: string | null; kind: string; amount: number; entry_date: string; source: string; contract_ref?: string | null; milestone_id?: string | null; doc_flag?: string | null; note?: string | null; legacy?: boolean }
interface NewAlloc { org_id: string; payment_id: string; target_kind: 'credit' | 'pool'; credit_id?: string | null; contract_ref?: string | null; project_id?: string | null; amount: number; source: string }

export interface BackfillResult { stakeholderId: string; credits: number; allocations: number; skipped?: string }

export async function backfillParty(stakeholderId: string): Promise<BackfillResult> {
  const stkR = await supabase.from('stakeholders').select('stakeholder_id, org_id, type').eq('stakeholder_id', stakeholderId).single();
  if (stkR.error) throw stkR.error;
  const stk = stkR.data as any;
  const org_id = stk.org_id;
  const isVendor = stk.type === 'Vendor';

  // ── source reads ──
  const [txnR, poR, woR, obR, adjR, cbR] = await Promise.all([
    supabase.from('transactions').select('txn_id, date, total_amount, status, txn_allocations(project_id, order_type, order_ref, allocated_amount)').eq('stakeholder_id', stakeholderId).order('date'),
    supabase.from('purchase_orders').select(`po_id, project_id, vendor_bill_amount, vendor_bill_number, ${BILL_DATE_COLUMNS}`).eq('stakeholder_id', stakeholderId).not('vendor_bill_amount', 'is', null).gt('vendor_bill_amount', 0),
    supabase.from('work_orders').select('wo_id, project_id, wo_milestones(milestone_id, planned_amount, unit_type, rate)').eq('stakeholder_id', stakeholderId),
    supabase.from('stakeholder_opening_balances').select('*').eq('stakeholder_id', stakeholderId).maybeSingle(),
    supabase.from('party_adjustments').select('*').eq('stakeholder_id', stakeholderId),
    supabase.from('consolidated_bills').select('*').eq('stakeholder_id', stakeholderId).order('period_to'),
  ]);
  const payments = (txnR.data ?? []).filter((t: any) => t.status !== 'Voided');
  const paymentIds = payments.map((p: any) => p.txn_id);

  // ── idempotent wipe of prior backfill rows for this party ──
  if (paymentIds.length) await supabase.from('ledger_allocations').delete().eq('source', 'backfill').in('payment_id', paymentIds);
  await supabase.from('ledger_credits').delete().eq('source', 'backfill').eq('stakeholder_id', stakeholderId);

  // ── build credit rows ──
  const credits: NewCredit[] = [];
  // 2.1 vendor bills
  if (isVendor) for (const po of (poR.data ?? [])) {
    credits.push({ org_id, stakeholder_id: stakeholderId, project_id: po.project_id ?? null, kind: 'vendor_bill', amount: num(po.vendor_bill_amount), entry_date: billDateOf(po) || today(), source: 'backfill', contract_ref: po.po_id, note: po.vendor_bill_number || null });
  }
  // 2.4 certified — re-derived from attendance stage readings (independent of loadPartyLedger)
  const certCredits = await deriveCertified(stakeholderId, org_id, woR.data ?? []);
  credits.push(...certCredits);
  // 2.6 opening (work-owed side only; paid-ahead stays a correction debit)
  if (obR.data && (obR.data as any).direction === 'work_owed') {
    const o = obR.data as any;
    const bySite = o.by_site && Object.keys(o.by_site).length ? o.by_site : null;
    if (bySite) for (const [pid, amt] of Object.entries(bySite)) credits.push({ org_id, stakeholder_id: stakeholderId, project_id: pid, kind: 'opening', amount: num(amt), entry_date: o.as_of, source: 'backfill', confirmed: !!o.confirmed } as any);
    else credits.push({ org_id, stakeholder_id: stakeholderId, project_id: null, kind: 'opening', amount: num(o.total_amount), entry_date: o.as_of, source: 'backfill' });
  }
  // 3.3 adjustments (certified side)
  for (const a of (adjR.data ?? [])) if (a.side === 'certified') credits.push({ org_id, stakeholder_id: stakeholderId, project_id: a.project_id ?? null, kind: 'adjustment', amount: num(a.amount), entry_date: a.adj_date, source: 'backfill', note: a.note || null });
  // 2.2 consolidated bills
  for (const cb of (cbR.data ?? [])) credits.push({ org_id, stakeholder_id: stakeholderId, project_id: null, kind: 'consolidated', amount: num(cb.amount), entry_date: cb.period_to, source: 'backfill', doc_flag: cb.doc_type, note: cb.note || null });

  // ── insert credits, keep id maps for allocation ──
  const poCreditByPo: Record<string, string> = {};
  const cbCreditById: Record<string, { id: string; amount: number; from: string; to: string }> = {};
  if (credits.length) {
    const { data, error } = await supabase.from('ledger_credits').insert(credits).select('credit_id, kind, contract_ref, amount, entry_date');
    if (error) throw error;
    const cbs = (cbR.data ?? []) as any[];
    (data ?? []).forEach((row: any) => {
      if (row.kind === 'vendor_bill' && row.contract_ref) poCreditByPo[row.contract_ref] = row.credit_id;
      if (row.kind === 'consolidated') {
        // match back to the source cb by amount+date (backfill inserts one per cb)
        const cb = cbs.find(c => num(c.amount) === num(row.amount) && c.period_to === row.entry_date && !Object.values(cbCreditById).some(v => v.id === row.credit_id));
        if (cb) cbCreditById[cb.id] = { id: row.credit_id, amount: num(cb.amount), from: cb.period_from, to: cb.period_to };
      }
    });
  }

  // ── build allocation rows (§1.5) ──
  const allocs: NewAlloc[] = [];
  const remainingOnCredit: Record<string, number> = {};
  const remainingOnPayment: Record<string, number> = {};
  payments.forEach((p: any) => { remainingOnPayment[p.txn_id] = num(p.total_amount); });

  // a. order-linked payments
  for (const p of payments) {
    const oa = (p.txn_allocations ?? []).find((a: any) => a.order_type === 'WO' || a.order_type === 'PO');
    if (!oa || !oa.order_ref) continue;
    if (oa.order_type === 'WO') {
      // advance against a contract → pool
      const amt = Math.min(remainingOnPayment[p.txn_id], num(oa.allocated_amount) || num(p.total_amount));
      if (amt > 0) { allocs.push({ org_id, payment_id: p.txn_id, target_kind: 'pool', contract_ref: oa.order_ref, project_id: oa.project_id ?? null, amount: amt, source: 'backfill' }); remainingOnPayment[p.txn_id] -= amt; }
    } else {
      // PO-linked → settle that PO's bill credit, FIFO-capped
      const cid = poCreditByPo[oa.order_ref];
      if (!cid) continue;
      const poBill = (poR.data ?? []).find((x: any) => x.po_id === oa.order_ref);
      if (remainingOnCredit[cid] === undefined) remainingOnCredit[cid] = num(poBill?.vendor_bill_amount);
      const amt = Math.min(remainingOnPayment[p.txn_id], remainingOnCredit[cid]);
      if (amt > 0) { allocs.push({ org_id, payment_id: p.txn_id, target_kind: 'credit', credit_id: cid, project_id: oa.project_id ?? null, amount: amt, source: 'backfill' }); remainingOnPayment[p.txn_id] -= amt; remainingOnCredit[cid] -= amt; }
    }
  }

  // c. consolidated coverage — uncredited vendor payments inside the period, FIFO up to the bill amount
  if (isVendor) for (const cb of Object.values(cbCreditById)) {
    let left = cb.amount;
    for (const p of payments) {
      if (left <= 0) break;
      if (!(p.date >= cb.from && p.date <= cb.to)) continue;
      if (remainingOnPayment[p.txn_id] <= 0) continue;               // already settled/advanced
      const amt = Math.min(remainingOnPayment[p.txn_id], left);
      allocs.push({ org_id, payment_id: p.txn_id, target_kind: 'credit', credit_id: cb.id, project_id: null, amount: amt, source: 'backfill' });
      remainingOnPayment[p.txn_id] -= amt; left -= amt;
    }
  }

  if (allocs.length) { const { error } = await supabase.from('ledger_allocations').insert(allocs); if (error) throw error; }
  return { stakeholderId, credits: credits.length, allocations: allocs.length };
}

// Independent re-derivation of certified value from attendance stage readings (mirrors the intent of
// loadPartyLedger's inference, written separately so a bug in one shows up in the diff, not silently).
async function deriveCertified(stakeholderId: string, org_id: string, wos: any[]): Promise<NewCredit[]> {
  const out: NewCredit[] = [];
  try {
    const crewR = await supabase.from('labour_crews').select('wo_id, project_id').eq('stakeholder_id', stakeholderId).not('wo_id', 'is', null);
    const crews = crewR.data ?? [];
    const woIds = [...new Set(crews.map((c: any) => c.wo_id))];
    if (!woIds.length) return out;
    const msMeta: Record<string, any> = {}; const woOfMs: Record<string, string> = {}; const projOfWo: Record<string, string | null> = {};
    for (const w of wos) { if (!woIds.includes(w.wo_id)) continue; projOfWo[w.wo_id] = w.project_id ?? null; (w.wo_milestones ?? []).forEach((m: any) => { msMeta[m.milestone_id] = m; woOfMs[m.milestone_id] = w.wo_id; }); }
    const msIds = Object.keys(msMeta);
    if (!msIds.length) return out;
    const attR = await supabase.from('labour_attendance').select('milestone_id, value, work_date').eq('subject_type', 'stage').in('milestone_id', msIds).order('work_date');
    const byMs: Record<string, { work_date: string; value: number }[]> = {};
    (attR.data ?? []).forEach((a: any) => { (byMs[a.milestone_id] ||= []).push({ work_date: a.work_date, value: num(a.value) }); });
    for (const [mid, readings] of Object.entries(byMs)) {
      const m = msMeta[mid]; if (!m) continue;
      const lump = (m.unit_type ?? 'LS') === 'LS';
      let prev = 0;
      for (const r of readings) {
        const earned = lump ? num(m.planned_amount) * r.value / 100 : (num(m.rate) * r.value);
        const delta = lump ? (earned - prev) : earned;
        if (delta > 0.5) out.push({ org_id, stakeholder_id: stakeholderId, project_id: projOfWo[woOfMs[mid]] ?? null, kind: 'certified', amount: delta, entry_date: r.work_date, source: 'backfill', contract_ref: woOfMs[mid], milestone_id: mid });
        if (lump) prev = earned;
      }
    }
  } catch { /* labour tables absent — no certified feed */ }
  return out;
}

// Backfill every party the current user's org can see.
export async function backfillOrg(onProgress?: (done: number, total: number, party: string) => void): Promise<BackfillResult[]> {
  const { data, error } = await supabase.from('stakeholders').select('stakeholder_id').order('created_at');
  if (error) throw error;
  const ids = (data ?? []).map((s: any) => s.stakeholder_id);
  const results: BackfillResult[] = [];
  for (let i = 0; i < ids.length; i++) {
    try { results.push(await backfillParty(ids[i])); }
    catch (e: any) { results.push({ stakeholderId: ids[i], credits: 0, allocations: 0, skipped: e?.message || 'error' }); }
    onProgress?.(i + 1, ids.length, ids[i]);
  }
  return results;
}
