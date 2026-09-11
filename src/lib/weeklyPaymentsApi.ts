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
export interface WeeklyPayments { sections: PaySection[]; monday: Date; isCurrentWeek: boolean }

const inrShort = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export async function loadWeeklyPayments(monday: Date): Promise<WeeklyPayments> {
  const { sites } = await loadWeek(monday);
  const dates = weekDates(monday);
  const dayLabels = dates.slice(0, 6).map(d => new Date(d).toLocaleString('en-US', { weekday: 'short' }));
  const period = `${new Date(dates[0]).toLocaleString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(dates[5]).toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;

  const sections: PaySection[] = sites.map(site => {
    const rows: PayRow[] = [];

    site.crews.forEach((crew, ci) => {
      // A wages-mode crew (on a contract, but paid by daily attendance) is a WAGES row here — its
      // this-week figure is days × rate, not stage certifications. Only a %-of-work contract uses the
      // stage-cert path below.
      if (crew.basis === 'contract' && crew.accrualBasis !== 'day') {
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
        // A wages-mode crew is paid by attendance but SITS ON a contract — carry its WO (+ first phase)
        // so the payment links to the contract (subtracts from it) instead of landing unlinked.
        const onWo = crew.basis === 'contract' && crew.accrualBasis === 'day';
        rows.push({
          key: `w${site.site}-${ci}`, projectId: site.site, projectName: site.label,
          stakeholderId: crew.stakeholderId, party: crew.n, trade: crew.trade || crew.d || 'Labour',
          kind: 'wages', basis: onWo ? 'attendance · on a contract' : 'attendance', thisWeek: wage, balanceBf: 0,
          woId: onWo ? crew.woId : null, milestoneId: onWo ? (crew.stages[0]?.milestoneId ?? null) : null,
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

  // ── One row per worker: fold the ledger's prior balance INTO this week's row ───────────────────────
  //    v_party_balance (the single source) says what each worker is owed in total; this week's rows
  //    already represent part of it. The remainder ("owed from earlier") is FOLDED INTO the worker's own
  //    row as its Balance B/F — so the ledger and the run show one row, not a duplicate "this week" row
  //    plus a separate "carried from the ledger" row. A worker owed from before with NO work this week
  //    gets a single row (B/F only). The live balance is only meaningful for the CURRENT week, so past
  //    weeks stay a plain record of that week's attendance (no carry). Falls back silently if the view
  //    isn't applied yet. ──
  const isCurrentWeek = mondayOf(new Date()).getTime() === monday.getTime();
  if (isCurrentWeek) try {
    // Per-SITE carry-forward. v_party_site_balance says what each worker is owed ON each project — the
    // opening's by_site split, certified work and wages there, minus payments allocated there. This
    // week's rows already represent part of each site's figure; the earlier remainder is folded into the
    // worker's row ON THAT SITE, or (no work there this week) a standalone row tagged to that site — so a
    // carried balance lands on the site it belongs to, not lumped on the last-seen project. Falls back
    // to the party-level lump when the per-site view isn't applied yet (siteOwed empty → siteless path).
    const [siteR, partyR] = await Promise.all([
      supabase.from('v_party_site_balance').select('stakeholder_id, project_id, to_pay').gt('to_pay', 0),
      supabase.from('v_party_balance').select('stakeholder_id, to_pay').gt('to_pay', 0),
    ]);
    const siteOwed: Record<string, Record<string, number>> = {};
    (siteR.data ?? []).forEach((b: any) => { if (b.project_id) (siteOwed[b.stakeholder_id] ||= {})[b.project_id] = Number(b.to_pay || 0); });
    const partyOwed: Record<string, number> = {};
    (partyR.data ?? []).forEach((b: any) => { partyOwed[b.stakeholder_id] = Number(b.to_pay || 0); });

    const owedIds = [...new Set([...Object.keys(siteOwed), ...Object.keys(partyOwed)])];
    if (owedIds.length) {
      // What this week's rows already represent (b/f + this week), per (worker, site) and per worker, plus
      // the first row for each (worker, site) — the row a site's earlier balance folds into.
      const repBySite: Record<string, Record<string, number>> = {};
      const repByWorker: Record<string, number> = {};
      const rowBySite: Record<string, Record<string, PayRow>> = {};
      sections.forEach(s => s.rows.forEach(r => {
        if (!r.stakeholderId) return;
        const amt = r.balanceBf + r.thisWeek;
        (repBySite[r.stakeholderId] ||= {})[r.projectId] = ((repBySite[r.stakeholderId] ||= {})[r.projectId] || 0) + amt;
        repByWorker[r.stakeholderId] = (repByWorker[r.stakeholderId] || 0) + amt;
        (rowBySite[r.stakeholderId] ||= {});
        if (!rowBySite[r.stakeholderId][r.projectId]) rowBySite[r.stakeholderId][r.projectId] = r;
      }));

      // Restrict to WORKERS (vendors are handled by loadVendorRows).
      const wkrR = await supabase.from('stakeholders').select('stakeholder_id, name, category, type').in('stakeholder_id', owedIds).eq('type', 'Worker');
      const workers = (wkrR.data ?? []) as any[];

      // The last-seen project for a site-less remainder (an opening left "not site-specific"), and names
      // for every project we might tag a carried row with.
      const workerIds = workers.map(w => w.stakeholder_id);
      const lastProj: Record<string, string> = {};
      if (workerIds.length) {
        const lineR = await supabase.from('v_party_ledger_line').select('stakeholder_id, project_id, line_date').in('stakeholder_id', workerIds).not('project_id', 'is', null).order('line_date', { ascending: false });
        (lineR.data ?? []).forEach((l: any) => { if (!lastProj[l.stakeholder_id] && l.project_id) lastProj[l.stakeholder_id] = l.project_id; });
      }
      const needProj = new Set<string>();
      workers.forEach(w => Object.keys(siteOwed[w.stakeholder_id] || {}).forEach(p => needProj.add(p)));
      Object.values(lastProj).forEach(p => needProj.add(p));
      const projName: Record<string, string> = {};
      if (needProj.size) { const pr = await supabase.from('projects').select('project_id, name').in('project_id', [...needProj]); (pr.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; }); }

      const standalone: PayRow[] = [];
      for (const w of workers) {
        const sid = w.stakeholder_id;
        const sites = siteOwed[sid] || {};
        let totalCarried = 0;
        // Each site's earlier balance → fold into that site's row, else a standalone row tagged to it.
        for (const proj of Object.keys(sites)) {
          const carried = Math.round(sites[proj] - ((repBySite[sid]?.[proj]) || 0));
          if (carried <= 0.5) continue;
          totalCarried += carried;
          const foldRow = rowBySite[sid]?.[proj];
          if (foldRow) foldRow.balanceBf += carried;
          else standalone.push({
            key: `carry-${sid}-${proj}`, projectId: proj, projectName: projName[proj] || proj,
            stakeholderId: sid, party: w.name || 'Worker', trade: w.category || 'Worker',
            kind: 'wages', basis: 'owed from earlier · no work logged this week', thisWeek: 0, balanceBf: carried,
            woId: null, milestoneId: null,
          });
        }
        // Site-less remainder: the party owes MORE than this week's rows + the per-site carries account
        // for (an opening amount left "not site-specific"). Never negative, so an advance on one site is
        // never clawed back from another here. Fold into the last-seen project's row, else a standalone.
        const siteless = Math.round((partyOwed[sid] || 0) - (repByWorker[sid] || 0) - totalCarried);
        if (siteless > 0.5) {
          const proj = lastProj[sid];
          const foldRow = proj ? rowBySite[sid]?.[proj] : undefined;
          if (foldRow) foldRow.balanceBf += siteless;
          else standalone.push({
            key: `carry-${sid}-none`, projectId: proj || '', projectName: proj ? (projName[proj] || proj) : '—',
            stakeholderId: sid, party: w.name || 'Worker', trade: w.category || 'Worker',
            kind: 'wages', basis: 'owed from earlier · no work logged this week', thisWeek: 0, balanceBf: siteless,
            woId: null, milestoneId: null,
          });
        }
      }
      if (standalone.length) sections.push({ projectId: '__carry__', projectName: 'Owed from earlier', rows: standalone });
    }
  } catch { /* v_party_site_balance / v_party_balance not applied yet — no carry-forward */ }

  return { sections, monday, isCurrentWeek };
}

/** What this week's run has already settled, by row key. Read back from the stamp
 *  recordWeeklyPayment writes, so a paid row stays paid across a reload — on every surface.
 *  Payments made before that stamp existed carry no key and cannot be matched. */
export async function loadWeeklyPaid(monday: Date): Promise<Record<string, number>> {
  const key = mondayOf(monday).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('transactions')
    .select('total_amount, status, ai_flag_data')
    .eq('ai_flag_data->>weekly_run', key);
  if (error) return {};
  const out: Record<string, number> = {};
  for (const t of (data ?? []) as { total_amount: number; status: string | null; ai_flag_data: { row_key?: string } | null }[]) {
    if (t.status === 'Voided') continue;                   // a voided payment leaves the row owing again
    const rk = t.ai_flag_data?.row_key;
    if (rk) out[rk] = (out[rk] || 0) + Number(t.total_amount || 0);
  }
  return out;
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
    supabase.from('stakeholders').select('stakeholder_id, name, type'),
    supabase.from('projects').select('project_id, name'),
    supabase.from('v_party_balance').select('stakeholder_id, to_pay, advance, without_bills'),
  ]);
  if (poR.error) throw poR.error;
  const pos = (poR.data ?? []).filter((p: any) => p.stakeholder_id && (p.status || '').toUpperCase() !== 'CANCELLED');
  const poIds = pos.map((p: any) => p.po_id);
  const stkName: Record<string, string> = {}; (stkR.data ?? []).forEach((s: any) => { stkName[s.stakeholder_id] = s.name; });
  // Only actual VENDORS belong in this section. v_party_balance covers vendors AND workers, so without
  // this filter a worker with a balance but no PO leaked in as a "0 bills open" vendor row.
  const isVendorId = new Set((stkR.data ?? []).filter((s: any) => s.type === 'Vendor').map((s: any) => s.stakeholder_id));
  const projName: Record<string, string> = {}; (projR.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });

  // Ledger net figures per vendor (view absent → {} → fall back to open PO dues below).
  const bal: Record<string, { toPay: number; advance: number; without: number }> = {};
  (balR.data ?? []).forEach((b: any) => { bal[b.stakeholder_id] = { toPay: Number(b.to_pay || 0), advance: Number(b.advance || 0), without: Number(b.without_bills || 0) }; });

  const paidByPo: Record<string, number> = {};
  if (poIds.length) {
    const alR = await supabase.from('txn_allocations').select('order_ref, allocated_amount, transactions(status)').eq('order_type', 'PO').in('order_ref', poIds);
    (alR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided') return; paidByPo[a.order_ref] = (paidByPo[a.order_ref] || 0) + Number(a.allocated_amount || 0); });
  }

  // Bill lines grouped by VENDOR, from v_party_ledger_line — the SAME bills-union-fallback the balance
  // sums, so the expand lists exactly what the net is derived from (a standalone bill shows here too).
  // Falls back to the PO read only if the view isn't applied yet. Per-bill paid isn't split yet
  // (payments settle bills is pending), so balance = full amount and the vendor NET (to_pay) is the truth.
  const vendorIdList = [...isVendorId];
  const byVendorView: Record<string, VendorBill[]> = {};
  let viewOk = false;
  if (vendorIdList.length) {
    const blvR = await supabase.from('v_party_ledger_line').select('stakeholder_id, ref_id, project_id, line_date, label, billed').eq('kind', 'po_bill').in('stakeholder_id', vendorIdList);
    if (!blvR.error) {
      viewOk = true;
      (blvR.data ?? []).forEach((l: any) => {
        (byVendorView[l.stakeholder_id] ||= []).push({
          poId: l.ref_id, no: (l.label || 'Bill').replace(/^Bill\s+/, ''), date: l.line_date || '', amount: Number(l.billed || 0), balance: Number(l.billed || 0),
          projectId: l.project_id ?? null, projectName: l.project_id ? (projName[l.project_id] || l.project_id) : null,
        });
      });
    }
  }
  // PO fallback (view not applied): open PO bills grouped by vendor, each netted per PO.
  const byVendorPo: Record<string, VendorBill[]> = {};
  pos.forEach((p: any) => {
    const base = Number(p.vendor_bill_amount || p.total_value || p.order_value || 0);
    const due = base - (paidByPo[p.po_id] || 0);
    if (due <= 0.5) return;
    (byVendorPo[p.stakeholder_id] ||= []).push({
      poId: p.po_id, no: p.vendor_bill_number || p.po_id, date: p.date_issued || '', amount: base, balance: due,
      projectId: p.project_id ?? null, projectName: p.project_id ? (projName[p.project_id] || p.project_id) : null,
    });
  });
  const byVendor = viewOk ? byVendorView : byVendorPo;

  const vendorIds = new Set<string>([...Object.keys(byVendor), ...Object.keys(bal)].filter(id => isVendorId.has(id)));
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
  monday: Date, note = '',
): Promise<string> {
  const txnId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const category = row.kind === 'contract' ? 'Running Bill' : row.kind === 'vendor' ? 'Purchase Payment' : row.kind === 'recurring' ? 'Recurring' : 'Wages';
  // Write the computed provenance into the ledger comment so the transaction carries WHY.
  const detail = row.att
    ? row.att.cats.map(c => { const days = c.cells.reduce((a: number, v) => a + (v || 0), 0); return days ? `${c.name} ${days}×₹${c.rate}` : ''; }).filter(Boolean).join(', ')
    : row.stage ? row.stage.readings.map(([n, m]) => `${n} · ${m}`).join('; ')
    : row.bills ? row.bills.map(b => `Bill ${b.no} ${inrShort(b.balance)}`).join(', ')
    : row.basis;
  const remarks = [row.party, detail, reason, note.trim()].filter(Boolean).join(' · ');
  // Contract → the work order + milestone. Vendor → spread across the open POs, oldest bill first
  // (anything beyond stays on account = a bare project allocation). Wages/recurring → project only.
  let allocations: Record<string, unknown>[];
  // Any row that carries a WO links to it — a %-contract row, and a wages-mode crew's attendance row
  // (so paying its wages subtracts from the contract and shows linked, not on-account).
  if (row.woId) {
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
      payment_mode: mode, category, remarks, ai_flag_status: 'Clean',
      // Stamp the run and the row this settles. A wage figure comes from the attendance
      // register, which knows nothing about payments, so without this the row comes back at
      // its full amount on the next load and asks to be paid again.
      ai_flag_data: { weekly_run: mondayOf(monday).toISOString().slice(0, 10), row_key: row.key },
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
  if (row.woId) { await allocateToPool(txnId, row.woId, amount); return; }
  if (row.kind === 'vendor') { await settleFIFO(txnId); return; }         // settle open vendor bills oldest-first
  if (!row.stakeholderId) return;                                          // an ad-hoc payee with no party can't accrue
  // wages / recurring — a plan credit for what was paid, settled by this payment
  const creditId = await createCredit({
    stakeholderId: row.stakeholderId, kind: 'plan', amount, entryDate: mondayOf(monday).toISOString().slice(0, 10),
    projectId: row.projectId, note: `${row.trade} · weekly plan`, source: 'plan',
  });
  await allocateToCredit(txnId, creditId, amount);
}
