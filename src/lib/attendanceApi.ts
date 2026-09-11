// Attendance data layer — the single seam between the Attendance page and Supabase.
// It loads a week into the exact in-memory shape the reference mockup renders
// (sites → crews → {head, cats, stages} + direct workers, plus the rate CARD),
// and persists every edit back to the labour_* tables (see migration 20260901000000).
import { supabase } from './supabase';
import { submitWorkCertification } from './workCertification';

// ── the reference's cell shape ───────────────────────────────────────────────
// A grid cell is either a value object, null (a gap on a working day), or 'off'
// (a non-working day — Sundays). src distinguishes a WhatsApp report from an
// office correction; by/at/photo are provenance shown on hover.
export type Cell = { v: number; src: 'wa' | 'office'; by?: string; at?: string; photo?: boolean } | null | 'off';

export const SUPERVISOR_KEY = '__supervisor__';

export interface CardTrade { skilled: number | null; hm: number | null; hf: number | null }
export interface RateCard {
  trades: Record<string, CardTrade>;
  unskilled: { hm: number | null; hf: number | null };
  supervisor: number | null;
  since: Record<string, string>;
}

export interface CatRow { id: string; n: string; rate: number; own?: boolean; cells: Cell[] }
export interface StageRow {
  milestoneId: string; n: string; type: 'lump' | 'measured';
  amount?: number; unit?: string; rate?: number; total?: number;
  before: number; paid: number; cells: Cell[];
}
export interface CrewRow {
  crewId: string; n: string; d: string; trade: string | null; stakeholderId: string | null;
  contract: boolean; basis: 'contract' | 'labour'; basisConfirmed: boolean;
  accrualBasis: 'day' | 'work' | 'measurement' | 'piece' | null;   // the declared obligation channel
  woId: string | null; paidThrough?: number;
  head: Cell[]; cats: CatRow[]; stages: StageRow[];
}
export interface DirectRow { id: string; n: string; d: string; cat: string; rate: number; own?: boolean; stakeholderId: string | null; cells: Cell[] }
export interface SiteRow { site: string; label: string; hint: string; crews: CrewRow[]; direct: DirectRow[] }

export interface WeekData { sites: SiteRow[]; card: RateCard }

// ── date helpers ─────────────────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Monday (00:00) of the week containing `d`. */
export function mondayOf(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}
export function weekDates(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return iso(d); });
}
export function weekLabel(monday: Date): string {
  const end = new Date(monday); end.setDate(end.getDate() + 6);
  const m = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
  const same = monday.getMonth() === end.getMonth();
  return same ? `${monday.getDate()} – ${end.getDate()} ${m(end)}` : `${monday.getDate()} ${m(monday)} – ${end.getDate()} ${m(end)}`;
}
const timeLabel = (ts: string) => new Date(ts).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

// A fresh 7-day cell array: Sunday (index 6) is a day off, the rest are gaps.
const emptyCells = (): Cell[] => [null, null, null, null, null, null, 'off'];

function cellFrom(row: any): Cell {
  return { v: Number(row.value), src: row.source === 'wa' ? 'wa' : 'office', by: row.recorded_by_name || undefined, at: row.recorded_at ? timeLabel(row.recorded_at) : undefined, photo: !!row.photo_url };
}
// Build a 7-slot cell array for one subject from its attendance rows (keyed by date).
function cellsFor(rows: any[], dates: string[]): Cell[] {
  const byDate: Record<string, any> = {};
  rows.forEach(r => { byDate[r.work_date] = r; });
  return dates.map((d, i) => byDate[d] ? cellFrom(byDate[d]) : emptyCells()[i]);
}

// ── load one week for every active project ──────────────────────────────────
export async function loadWeek(monday: Date): Promise<WeekData> {
  const dates = weekDates(monday);
  const weekStart = dates[0], weekEnd = dates[6];

  const [projectsR, crewsR, catsR, directR, cardR] = await Promise.all([
    supabase.from('projects').select('project_id, name, site_location').eq('status', 'Active').order('name'),
    supabase.from('labour_crews').select('*').order('sort_order'),
    supabase.from('labour_crew_categories').select('*').order('sort_order'),
    supabase.from('labour_direct_workers').select('*').order('sort_order'),
    supabase.from('labour_rate_card').select('*'),
  ]);
  for (const r of [projectsR, crewsR, catsR, directR, cardR]) if (r.error) throw r.error;

  const crews = crewsR.data ?? [], cats = catsR.data ?? [], direct = directR.data ?? [];
  const woIds = [...new Set(crews.map((c: any) => c.wo_id).filter(Boolean))];

  // Milestones (stages) + their paid totals, only for crews on a contract.
  let milestones: any[] = [], allocs: any[] = [];
  if (woIds.length) {
    const msR = await supabase.from('wo_milestones').select('*').in('wo_id', woIds).order('seq_no');
    if (msR.error) throw msR.error;
    milestones = msR.data ?? [];
    const alR = await supabase.from('txn_allocations')
      .select('milestone_id, allocated_amount, transactions(status)')
      .eq('order_type', 'WO').in('order_ref', woIds);
    if (alR.error) throw alR.error;
    allocs = alR.data ?? [];
  }
  const paidByMs: Record<string, number> = {};
  allocs.forEach((a: any) => {
    if (!a.milestone_id || a.transactions?.status === 'Voided') return;
    paidByMs[a.milestone_id] = (paidByMs[a.milestone_id] || 0) + Number(a.allocated_amount || 0);
  });

  // All attendance rows: this week (for the grid) + prior stage readings (for "before").
  const subjectMsIds = milestones.map((m: any) => m.milestone_id);
  const attThisWeek = (await supabase.from('labour_attendance').select('*').gte('work_date', weekStart).lte('work_date', weekEnd)).data ?? [];
  let priorStage: any[] = [];
  if (subjectMsIds.length) {
    const pr = await supabase.from('labour_attendance').select('milestone_id, value, work_date, subject_type')
      .eq('subject_type', 'stage').in('milestone_id', subjectMsIds).lt('work_date', weekStart);
    priorStage = pr.data ?? [];
  }

  // Index this-week attendance by subject.
  const byHead: Record<string, any[]> = {}, byCat: Record<string, any[]> = {}, byDirect: Record<string, any[]> = {}, byStage: Record<string, any[]> = {};
  for (const a of attThisWeek) {
    if (a.subject_type === 'crew_head' && a.crew_id) (byHead[a.crew_id] ||= []).push(a);
    else if (a.subject_type === 'crew_category' && a.category_id) (byCat[a.category_id] ||= []).push(a);
    else if (a.subject_type === 'direct' && a.direct_worker_id) (byDirect[a.direct_worker_id] ||= []).push(a);
    else if (a.subject_type === 'stage' && a.milestone_id) (byStage[a.milestone_id] ||= []).push(a);
  }
  // "before" baselines for stages.
  const lumpBefore: Record<string, number> = {}, measuredBefore: Record<string, number> = {};
  for (const p of priorStage) {
    measuredBefore[p.milestone_id] = (measuredBefore[p.milestone_id] || 0) + Number(p.value || 0);
    lumpBefore[p.milestone_id] = Number(p.value || 0); // latest wins (rows come ordered by nothing; refined below)
  }
  // latest-wins for lump: recompute from max work_date
  const lumpLatest: Record<string, { d: string; v: number }> = {};
  for (const p of priorStage) {
    const cur = lumpLatest[p.milestone_id];
    if (!cur || p.work_date > cur.d) lumpLatest[p.milestone_id] = { d: p.work_date, v: Number(p.value || 0) };
  }

  const paidThroughIdx = (paidThrough: string | null): number | undefined => {
    if (!paidThrough) return undefined;
    if (paidThrough < weekStart) return undefined;
    if (paidThrough >= weekEnd) return 6;
    return dates.indexOf(paidThrough);
  };

  const sites: SiteRow[] = (projectsR.data ?? []).map((p: any) => {
    const projectCrews = crews.filter((c: any) => c.project_id === p.project_id).map((c: any): CrewRow => {
      const crewCats = cats.filter((k: any) => k.crew_id === c.crew_id).map((k: any): CatRow => ({
        id: k.id, n: k.category, rate: Number(k.rate) || 0, own: k.own_rate, cells: cellsFor(byCat[k.id] ?? [], dates),
      }));
      // Show the phases the crew was set to work (labour_crews.stage_ids); null/empty = all phases.
      const pickedStages: string[] | null = Array.isArray(c.stage_ids) && c.stage_ids.length ? c.stage_ids : null;
      const crewStages = milestones
        .filter((m: any) => m.wo_id === c.wo_id && (!pickedStages || pickedStages.includes(m.milestone_id)))
        .map((m: any): StageRow => {
        const isLump = (m.unit_type ?? 'LS') === 'LS';
        return {
          milestoneId: m.milestone_id, n: m.name, type: isLump ? 'lump' : 'measured',
          amount: isLump ? Number(m.planned_amount) || 0 : undefined,
          unit: isLump ? undefined : (m.unit_type || 'unit'),
          rate: isLump ? undefined : Number(m.rate) || 0,
          total: isLump ? undefined : Number(m.quantity) || 0,
          before: isLump ? (lumpLatest[m.milestone_id]?.v ?? 0) : (measuredBefore[m.milestone_id] ?? 0),
          paid: paidByMs[m.milestone_id] || 0,
          cells: cellsFor(byStage[m.milestone_id] ?? [], dates),
        };
      });
      return {
        crewId: c.crew_id, n: c.name, d: c.description || (c.trade ?? ''), trade: c.trade ?? null, stakeholderId: c.stakeholder_id ?? null,
        // "On contract" only when there's a real work order behind it (that's where stages come
        // from). A plain gang added by search has none — it's daily wages, no toggle.
        contract: c.is_contract || !!c.wo_id, basis: c.wo_id || c.is_contract ? c.basis : 'labour',
        basisConfirmed: !!c.basis_confirmed, accrualBasis: c.accrual_basis ?? null,
        woId: c.wo_id ?? null, paidThrough: paidThroughIdx(c.paid_through),
        head: cellsFor(byHead[c.crew_id] ?? [], dates), cats: crewCats, stages: crewStages,
      };
    });
    const projectDirect = direct.filter((w: any) => w.project_id === p.project_id).map((w: any): DirectRow => ({
      id: w.id, n: w.name, d: w.category, cat: w.category, rate: Number(w.rate) || 0, own: w.own_rate, stakeholderId: w.stakeholder_id ?? null, cells: cellsFor(byDirect[w.id] ?? [], dates),
    }));
    return { site: p.project_id, label: p.name, hint: p.site_location || '', crews: projectCrews, direct: projectDirect };
  });

  // Rate card
  const card: RateCard = { trades: {}, unskilled: { hm: null, hf: null }, supervisor: null, since: {} };
  const todayISO = iso(new Date());
  for (const r of (cardR.data ?? [])) {
    const label = r.effective_from === todayISO ? 'today' : '';
    if (r.trade === SUPERVISOR_KEY) { card.supervisor = Number(r.rate); if (label) card.since['supervisor.skilled'] = label; }
    else if (!r.trade) { card.unskilled[r.kind as 'hm' | 'hf'] = Number(r.rate); if (label) card.since['unskilled.' + r.kind] = label; }
    else { (card.trades[r.trade] ||= { skilled: null, hm: null, hf: null })[r.kind as keyof CardTrade] = Number(r.rate); if (label) card.since[r.trade + '.' + r.kind] = label; }
  }
  return { sites, card };
}

// ── writes ───────────────────────────────────────────────────────────────────
// Upsert one attendance cell (office correction). subject identifies which row.
export async function saveCell(
  orgId: string, projectId: string, workDate: string,
  subject: { type: 'crew_head'; crew_id: string } | { type: 'crew_category'; category_id: string }
         | { type: 'direct'; direct_worker_id: string } | { type: 'stage'; milestone_id: string },
  value: number, byName: string,
): Promise<void> {
  const row: any = {
    org_id: orgId, project_id: projectId, work_date: workDate, subject_type: subject.type,
    value, source: 'office', recorded_by_name: byName, recorded_at: new Date().toISOString(),
    crew_id: null, category_id: null, direct_worker_id: null, milestone_id: null,
  };
  if (subject.type === 'crew_head') row.crew_id = subject.crew_id;
  else if (subject.type === 'crew_category') row.category_id = subject.category_id;
  else if (subject.type === 'direct') row.direct_worker_id = subject.direct_worker_id;
  else row.milestone_id = subject.milestone_id;
  const { error } = await supabase.from('labour_attendance').upsert(row, { onConflict: 'org_id,subject_key,work_date' });
  if (error) throw error;
}

const cardKeyToCols = (key: string): { trade: string | null } =>
  key === 'unskilled' ? { trade: null } : key === 'supervisor' ? { trade: SUPERVISOR_KEY } : { trade: key };

// Set a rate-card value (stamps effective_from = today).
export async function saveRate(orgId: string, key: string, kind: 'skilled' | 'hm' | 'hf', rate: number): Promise<void> {
  const { trade } = cardKeyToCols(key);
  // trade is NOT NULL DEFAULT '' in the DB ('' = unskilled), so the plain unique
  // (org_id, trade, kind) is a valid upsert conflict target.
  const { error } = await supabase.from('labour_rate_card')
    .upsert({ org_id: orgId, trade: trade ?? '', kind, rate, effective_from: iso(new Date()) }, { onConflict: 'org_id,trade,kind' });
  if (error) throw error;
}

export async function setCategoryRate(id: string, rate: number): Promise<void> {
  const { error } = await supabase.from('labour_crew_categories').update({ rate, own_rate: true }).eq('id', id);
  if (error) throw error;
}
export async function setDirectRate(id: string, rate: number): Promise<void> {
  const { error } = await supabase.from('labour_direct_workers').update({ rate, own_rate: true }).eq('id', id);
  if (error) throw error;
}
export async function setCrewBasis(crewId: string, basis: 'contract' | 'labour'): Promise<void> {
  // The toggle IS the basis declaration: Contract → work (certified), Labour → day (attendance wage).
  // Setting it confirms the engagement's accrual basis (clears the "assumed" chip). Switching to Labour
  // FULLY UNLINKS the crew from its work order (wo_id / is_contract / stage_ids cleared) — it becomes a
  // clean wage crew; past payments made while on the contract stay as history. Re-linking runs the
  // put-on-contract wizard again. (The Contract direction is handled by that wizard, not here.)
  const patch = basis === 'labour'
    ? { basis, accrual_basis: 'day', basis_confirmed: true, wo_id: null, is_contract: false, stage_ids: null }
    : { basis, accrual_basis: 'work', basis_confirmed: true };
  const { error } = await supabase.from('labour_crews').update(patch).eq('crew_id', crewId);
  if (error) throw error;
}
export async function addCategory(orgId: string, crewId: string, category: string, rate: number): Promise<void> {
  const { error } = await supabase.from('labour_crew_categories').insert({ org_id: orgId, crew_id: crewId, category, rate });
  if (error) throw error;
}
export async function addDirectWorker(orgId: string, projectId: string, name: string, category: string, rate: number, stakeholderId?: string): Promise<void> {
  // A single worker added here is a day-wage engagement (confirmed basis).
  const { error } = await supabase.from('labour_direct_workers').insert({ org_id: orgId, project_id: projectId, name, category, rate, stakeholder_id: stakeholderId ?? null, accrual_basis: 'day', basis_confirmed: true });
  if (error) throw error;
}
export async function addCrew(
  orgId: string, projectId: string, name: string, trade: string | null,
  cats: { category: string; rate: number }[], stakeholderId?: string,
): Promise<void> {
  const { data, error } = await supabase.from('labour_crews')
    .insert({ org_id: orgId, project_id: projectId, name, trade, description: trade || 'Labour', stakeholder_id: stakeholderId ?? null, accrual_basis: 'day', basis_confirmed: true })
    .select('crew_id').single();
  if (error) throw error;
  if (cats.length) {
    const { error: e2 } = await supabase.from('labour_crew_categories').insert(cats.map(c => ({ org_id: orgId, crew_id: data!.crew_id, category: c.category, rate: c.rate })));
    if (e2) throw e2;
  }
}

// Starter rate card — sensible regional defaults for a fresh org (from the reference).
// Seeded with an old effective_from so nothing shows a spurious "changed today" badge.
const STARTER_RATES: { trade: string; kind: 'skilled' | 'hm' | 'hf'; rate: number }[] = [
  { trade: 'Mason', kind: 'skilled', rate: 1100 }, { trade: 'Mason', kind: 'hm', rate: 700 }, { trade: 'Mason', kind: 'hf', rate: 550 },
  { trade: 'Carpenter', kind: 'skilled', rate: 1000 }, { trade: 'Carpenter', kind: 'hm', rate: 700 }, { trade: 'Carpenter', kind: 'hf', rate: 550 },
  { trade: 'Bar bender', kind: 'skilled', rate: 950 }, { trade: 'Bar bender', kind: 'hm', rate: 650 }, { trade: 'Bar bender', kind: 'hf', rate: 500 },
  { trade: 'Plumber', kind: 'skilled', rate: 900 }, { trade: 'Plumber', kind: 'hm', rate: 600 },
  { trade: 'Electrician', kind: 'skilled', rate: 950 }, { trade: 'Electrician', kind: 'hm', rate: 600 },
  { trade: 'Painter', kind: 'skilled', rate: 850 }, { trade: 'Painter', kind: 'hm', rate: 600 }, { trade: 'Painter', kind: 'hf', rate: 500 },
  { trade: 'Tiler', kind: 'skilled', rate: 950 }, { trade: 'Tiler', kind: 'hm', rate: 650 }, { trade: 'Tiler', kind: 'hf', rate: 500 },
  { trade: '', kind: 'hm', rate: 650 }, { trade: '', kind: 'hf', rate: 500 },           // unskilled
  { trade: SUPERVISOR_KEY, kind: 'skilled', rate: 900 },                                  // supervisor
];

/** True when the org has no rate-card rows at all — the cue to offer/seed starters. */
export function cardIsEmpty(card: RateCard): boolean {
  return Object.keys(card.trades).length === 0 && card.unskilled.hm == null && card.unskilled.hf == null && card.supervisor == null;
}

/** Seed the starter rate card for an org. Idempotent: ignore-duplicates on the unique key. */
export async function seedRateCard(orgId: string): Promise<void> {
  const rows = STARTER_RATES.map(r => ({ org_id: orgId, trade: r.trade, kind: r.kind, rate: r.rate, effective_from: '2020-01-01' }));
  const { error } = await supabase.from('labour_rate_card').upsert(rows, { onConflict: 'org_id,trade,kind', ignoreDuplicates: true });
  if (error) throw error;
}

// ── put-on-contract: link a wage crew to a work order (reveals stages + the toggle) ──
export interface WOLite { wo_id: string; label: string; orderValue: number; stakeholderId: string | null }
export async function loadWorkOrdersForProject(projectId: string): Promise<WOLite[]> {
  const { data, error } = await supabase.from('work_orders')
    .select('wo_id, title, scope_of_work, order_value, status, stakeholder_id')
    .eq('project_id', projectId).not('status', 'in', '("Cancelled")').order('date_issued', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((w: any) => ({ wo_id: w.wo_id, label: w.title || w.scope_of_work || w.wo_id, orderValue: Number(w.order_value) || 0, stakeholderId: w.stakeholder_id ?? null }));
}
// A work order's phases/stages — for the "which phases apply" multi-select.
export interface WOStage { milestone_id: string; name: string; seq_no: number }
export async function loadWorkOrderStages(woId: string): Promise<WOStage[]> {
  const { data, error } = await supabase.from('wo_milestones').select('milestone_id, name, seq_no').eq('wo_id', woId).order('seq_no');
  if (error) throw error;
  return (data ?? []).map((m: any) => ({ milestone_id: m.milestone_id, name: m.name, seq_no: m.seq_no }));
}
// stageIds = the phases the crew works (null/empty → all phases).
export async function linkCrewToWorkOrder(crewId: string, woId: string, stageIds?: string[] | null): Promise<void> {
  const { error } = await supabase.from('labour_crews')
    .update({ wo_id: woId, is_contract: true, basis: 'contract', accrual_basis: 'work', basis_confirmed: true, stage_ids: stageIds && stageIds.length ? stageIds : null })
    .eq('crew_id', crewId);
  if (error) throw error;
}

// ── Put on contract — the daily-wage → contract cutover ────────────────────────────────────────────────
export type AccruedWages = { days: number; amount: number };
export type ContractMode = 'keep_wages' | 'fold';

/** Day-wages accrued by a CREW so far (Σ attendance value × that skill's rate) — the "N days · ₹X" a
 *  conversion must decide the fate of. Read-only. */
export async function accruedDayWagesForCrew(crewId: string): Promise<AccruedWages> {
  const { data: cats } = await supabase.from('labour_crew_categories').select('id, rate').eq('crew_id', crewId);
  const rateById: Record<string, number> = {};
  (cats ?? []).forEach((c: any) => { rateById[c.id] = Number(c.rate) || 0; });
  const ids = Object.keys(rateById);
  if (!ids.length) return { days: 0, amount: 0 };
  const { data: att } = await supabase.from('labour_attendance').select('value, category_id').eq('subject_type', 'crew_category').in('category_id', ids);
  let days = 0, amount = 0;
  (att ?? []).forEach((a: any) => { const v = Number(a.value) || 0; days += v; amount += v * (rateById[a.category_id] || 0); });
  return { days, amount: Math.round(amount) };
}

/** Day-wages accrued by a single DIRECT worker (Σ attendance value × their rate). Read-only. */
export async function accruedDayWagesForDirect(workerId: string, rate: number): Promise<AccruedWages> {
  const { data: att } = await supabase.from('labour_attendance').select('value').eq('subject_type', 'direct').eq('direct_worker_id', workerId);
  let days = 0; (att ?? []).forEach((a: any) => { days += Number(a.value) || 0; });
  return { days, amount: Math.round(days * (Number(rate) || 0)) };
}

/** Snapshot the accrued day-wages as ONE fixed certified credit at the cutover, so flipping the engagement
 *  to 'work' (which stops day-accrual) doesn't erase the money already earned by the day. */
async function snapshotDayWages(orgId: string, stakeholderId: string, projectId: string, amount: number, cutover: string): Promise<void> {
  if (!(amount > 0) || !stakeholderId) return;
  const { error } = await supabase.from('party_adjustments').insert({
    org_id: orgId, stakeholder_id: stakeholderId, project_id: projectId,
    adj_date: cutover, side: 'certified', amount: Math.round(amount),
    note: `Daily wages through ${cutover} (put on contract)`,
  });
  if (error) throw error;
}

/** Put a CREW on a contract with a dated cutover. 'keep_wages' snapshots the accrued day-wages as a fixed
 *  credit first; 'fold' discards them (the contract value absorbs that work). Non-destructive — attendance
 *  stays; it just stops accruing a wage from the cutover. */
// measure: how the contract is valued.
//   'percent' → paid by certified % of the stages (basis 'contract', accrual 'work'). The default.
//   'wages'   → a contract crew (phases show) that keeps daily attendance (accrual 'day'). The day-wages
//               are AUTO-folded into the chosen phase(s) on every attendance save — the fold certifies
//               against the phase (reduces its value) and marks the attendance settled. stage_ids = the
//               ordered phase(s) the wages subtract from (capped, rolling to the next).
export type MeasureMode = 'percent' | 'wages';
export async function putCrewOnContract(p: {
  crewId: string; orgId: string; projectId: string; stakeholderId: string | null;
  woId: string; stageIds?: string[] | null; mode: ContractMode; snapshotAmount?: number;
  measure?: MeasureMode;
}): Promise<void> {
  const cutover = new Date().toISOString().split('T')[0];
  const wages = p.measure === 'wages';
  // A snapshot only makes sense for 'percent' (there the day-accrual stops). In 'wages' mode the
  // day-wages keep counting, so there is nothing to freeze.
  if (!wages && p.mode === 'keep_wages' && p.stakeholderId && (p.snapshotAmount ?? 0) > 0) {
    await snapshotDayWages(p.orgId, p.stakeholderId, p.projectId, p.snapshotAmount!, cutover);
  }
  const { error } = await supabase.from('labour_crews').update({
    wo_id: p.woId, is_contract: true,
    basis: 'contract', accrual_basis: wages ? 'day' : 'work', basis_confirmed: true,
    basis_changed_at: cutover, stage_ids: p.stageIds && p.stageIds.length ? p.stageIds : null,
  }).eq('crew_id', p.crewId);
  if (error) throw error;
}

// Promote a single direct worker into a one-person crew on contract (so it gains the
// Contract/Labour toggle + stages). The old direct-worker row is removed (its attendance
// cascades away) — from here the person is tracked by the crew's % completion, not days.
export async function promoteDirectToCrew(
  orgId: string, projectId: string,
  worker: { id: string; name: string; category: string; rate: number; stakeholderId: string | null },
  woId: string, trade: string | null, stageIds?: string[] | null,
  opts?: { mode?: ContractMode; snapshotAmount?: number; measure?: MeasureMode },
): Promise<void> {
  const cutover = new Date().toISOString().split('T')[0];
  const wages = opts?.measure === 'wages';
  // Keep the day-wages this worker already earned before we drop the direct row (its attendance cascades).
  // Only for 'percent' — in 'wages' mode the day-wages keep counting into the contract.
  if (!wages && opts?.mode === 'keep_wages' && worker.stakeholderId && (opts.snapshotAmount ?? 0) > 0) {
    await snapshotDayWages(orgId, worker.stakeholderId, projectId, opts.snapshotAmount!, cutover);
  }
  const { data, error } = await supabase.from('labour_crews')
    .insert({ org_id: orgId, project_id: projectId, name: worker.name, stakeholder_id: worker.stakeholderId, trade, description: worker.category, is_contract: true, basis: 'contract', accrual_basis: wages ? 'day' : 'work', basis_confirmed: true, wo_id: woId, stage_ids: stageIds && stageIds.length ? stageIds : null, basis_changed_at: cutover })
    .select('crew_id').single();
  if (error) throw error;
  const { error: e2 } = await supabase.from('labour_crew_categories').insert({ org_id: orgId, crew_id: data!.crew_id, category: worker.category, rate: worker.rate });
  if (e2) throw e2;
  const { error: e3 } = await supabase.from('labour_direct_workers').delete().eq('id', worker.id);
  if (e3) throw e3;
}

// ── Settle attendance to a contract's phases ─────────────────────────────────────────────────────
// A crew linked to a WO but marked in daily LABOUR (accrual_basis='day') accrues day-wages. Settling
// folds those wages into the contract: each amount is certified against a phase (which reduces the
// phase's contract value AND posts the single ledger credit), and the underlying attendance rows are
// stamped settled_at so they stop minting a separate day-wage credit (no double-count). The phase is
// confirmed each time, capped at its remaining value, with the remainder rolling to the next phase.
export interface SettlementPhase {
  milestoneId: string; name: string; kind: 'lump' | 'measured';
  value: number;      // the phase's full contract value (planned_amount, or qty × rate)
  rate: number;       // measured: the unit rate; lump: 0
  certified: number;  // ₹ already approved-certified (latest lump / Σ measured)
  remaining: number;  // max(0, value − certified)
}
export interface SettlementRow { id: string; date: string; amount: number }
export interface CrewSettlement {
  woId: string | null; stakeholderId: string | null; projectId: string | null;
  unsettled: { days: number; amount: number };
  rows: SettlementRow[];     // unsettled day-wage rows, oldest first, ₹ each
  phases: SettlementPhase[]; // the crew's contract phases with remaining
}

async function crewPhases(woId: string, stageIds: string[] | null): Promise<SettlementPhase[]> {
  const { data: ms } = await supabase.from('wo_milestones')
    .select('milestone_id, name, unit_type, planned_amount, quantity, rate, seq_no').eq('wo_id', woId).order('seq_no');
  const rows = (ms ?? []).filter((m: any) => !stageIds || !stageIds.length || stageIds.includes(m.milestone_id));
  const ids = rows.map((m: any) => m.milestone_id);
  const certByMs: Record<string, { lump?: { amt: number; date: string }; measured: number }> = {};
  if (ids.length) {
    const { data: certs } = await supabase.from('work_certifications')
      .select('milestone_id, reading_kind, computed_amount, reading_date, status').in('milestone_id', ids).eq('status', 'approved');
    (certs ?? []).forEach((wc: any) => {
      const e = (certByMs[wc.milestone_id] ||= { measured: 0 });
      if (wc.reading_kind === 'lump') { if (!e.lump || wc.reading_date > e.lump.date) e.lump = { amt: Number(wc.computed_amount) || 0, date: wc.reading_date }; }
      else e.measured += Number(wc.computed_amount) || 0;
    });
  }
  return rows.map((m: any) => {
    const isLump = (m.unit_type || 'LS') === 'LS';
    const value = isLump ? (Number(m.planned_amount) || 0) : (Number(m.quantity) || 0) * (Number(m.rate) || 0);
    const c = certByMs[m.milestone_id];
    const certified = isLump ? (c?.lump?.amt || 0) : (c?.measured || 0);
    return { milestoneId: m.milestone_id, name: m.name, kind: isLump ? 'lump' as const : 'measured' as const, value, rate: Number(m.rate) || 0, certified, remaining: Math.max(0, value - certified) };
  });
}

/** What a crew can settle: its unsettled day-wage rows (oldest first) + the contract phases with room. */
export async function loadCrewSettlement(crewId: string): Promise<CrewSettlement> {
  const { data: crew } = await supabase.from('labour_crews')
    .select('crew_id, wo_id, stakeholder_id, project_id, stage_ids').eq('crew_id', crewId).single();
  const woId = crew?.wo_id ?? null;
  const { data: cats } = await supabase.from('labour_crew_categories').select('id, rate').eq('crew_id', crewId);
  const rateById: Record<string, number> = {}; (cats ?? []).forEach((c: any) => { rateById[c.id] = Number(c.rate) || 0; });
  const catIds = Object.keys(rateById);
  let rows: SettlementRow[] = []; let days = 0;
  if (catIds.length) {
    const { data: att } = await supabase.from('labour_attendance')
      .select('id, work_date, value, category_id')
      .eq('subject_type', 'crew_category').in('category_id', catIds).is('settled_at', null).gt('value', 0)
      .order('work_date', { ascending: true });
    (att ?? []).forEach((a: any) => {
      const v = Number(a.value) || 0; days += v;
      rows.push({ id: a.id, date: a.work_date, amount: Math.round(v * (rateById[a.category_id] || 0)) });
    });
  }
  const phases = woId ? await crewPhases(woId, (Array.isArray(crew?.stage_ids) && crew!.stage_ids.length ? crew!.stage_ids : null)) : [];
  return {
    woId, stakeholderId: crew?.stakeholder_id ?? null, projectId: crew?.project_id ?? null,
    unsettled: { days, amount: rows.reduce((s, r) => s + r.amount, 0) }, rows, phases,
  };
}

export interface SettlementStep { milestoneId: string; applied: number }
/** Commit a settlement: certify each step's amount to its phase (governed), then stamp the covered
 *  attendance rows settled_at so they no longer mint a day-wage credit. rowIds should cover Σ applied. */
export async function commitCrewSettlement(p: {
  orgId: string; crewId: string; projectId: string | null; woId: string; stakeholderId: string | null;
  phases: SettlementPhase[]; steps: SettlementStep[]; rowIds: string[]; settleDate: string;
}): Promise<void> {
  const byId: Record<string, SettlementPhase> = {}; p.phases.forEach(ph => { byId[ph.milestoneId] = ph; });
  for (const st of p.steps) {
    if (!(st.applied > 0)) continue;
    const ph = byId[st.milestoneId]; if (!ph) continue;
    let readingValue: number, computedAmount: number;
    if (ph.kind === 'lump') {
      const cum = ph.certified + st.applied;                 // lump: the cert asserts the CUMULATIVE ₹ (latest wins)
      readingValue = ph.value ? Math.round(cum / ph.value * 100) : 100;
      computedAmount = Math.round(cum);
    } else {
      readingValue = ph.rate ? st.applied / ph.rate : 0;     // measured: the INCREMENTAL qty (Σ approved = total)
      computedAmount = Math.round(st.applied);
    }
    await submitWorkCertification({
      orgId: p.orgId, projectId: p.projectId || '', woId: p.woId, milestoneId: st.milestoneId,
      crewId: p.crewId, stakeholderId: p.stakeholderId, readingKind: ph.kind,
      readingValue, computedAmount, readingDate: p.settleDate, note: `Attendance settled to ${ph.name}`,
    });
  }
  if (p.rowIds.length) {
    const { error } = await supabase.from('labour_attendance').update({ settled_at: p.settleDate }).in('id', p.rowIds);
    if (error) throw error;
  }
}

/** Auto-fold a wages-mode crew's unsettled day-wages into its chosen phases (stage_ids order, capped,
 *  rolling to the next). Certifies against each phase (reduces its value) and stamps the covered
 *  attendance settled. No-op when nothing is unsettled or no phase has room. Runs on each attendance save. */
export async function autoSettleCrewWages(crewId: string, orgId: string): Promise<void> {
  const s = await loadCrewSettlement(crewId);
  if (!s.woId || s.unsettled.amount <= 0 || !s.phases.length) return;
  let left = s.unsettled.amount;
  const steps: SettlementStep[] = [];
  for (const ph of s.phases) {                       // phases are in seq order
    if (left <= 0) break;
    if (ph.remaining <= 0) continue;
    const applied = Math.min(left, ph.remaining);
    steps.push({ milestoneId: ph.milestoneId, applied });
    left -= applied;
  }
  if (!steps.length) return;
  const placed = steps.reduce((a, b) => a + b.applied, 0);
  let cum = 0; const rowIds: string[] = [];
  for (const r of s.rows) { if (cum + r.amount <= placed) { cum += r.amount; rowIds.push(r.id); } else break; }
  let over = placed - cum;                            // trim the last step(s) so certified == settled (whole days)
  for (let k = steps.length - 1; k >= 0 && over > 0; k--) { const cut = Math.min(steps[k].applied, over); steps[k].applied -= cut; over -= cut; }
  const finalSteps = steps.filter((st) => st.applied > 0);
  if (!finalSteps.length || !rowIds.length) return;
  await commitCrewSettlement({ orgId, crewId, projectId: s.projectId, woId: s.woId, stakeholderId: s.stakeholderId, phases: s.phases, steps: finalSteps, rowIds, settleDate: new Date().toISOString().slice(0, 10) });
}

/** Remove a crew from the sheet (cascades its categories + attendance). */
// ── edits the phone's "Edit worker" sheet makes: the name, and a wage type's label + rate ──
export async function renameCrew(crewId: string, name: string): Promise<void> {
  const { error } = await supabase.from('labour_crews').update({ name }).eq('crew_id', crewId);
  if (error) throw error;
}
/** A crew's wage-type row: its label and/or its rate (a rate set here is the crew's own). */
export async function updateCategory(id: string, patch: { category?: string; rate?: number }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.category != null) row.category = patch.category;
  if (patch.rate != null) { row.rate = patch.rate; row.own_rate = true; }
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from('labour_crew_categories').update(row).eq('id', id);
  if (error) throw error;
}
/** A single worker: name, wage type and rate all live on the one row. */
export async function updateDirectWorker(id: string, patch: { name?: string; category?: string; rate?: number }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name != null) row.name = patch.name;
  if (patch.category != null) row.category = patch.category;
  if (patch.rate != null) { row.rate = patch.rate; row.own_rate = true; }
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from('labour_direct_workers').update(row).eq('id', id);
  if (error) throw error;
}

export async function removeCrew(crewId: string): Promise<void> {
  const { error } = await supabase.from('labour_crews').delete().eq('crew_id', crewId);
  if (error) throw error;
}
/** Remove a direct worker from the sheet (cascades its attendance). */
export async function removeDirectWorker(id: string): Promise<void> {
  const { error } = await supabase.from('labour_direct_workers').delete().eq('id', id);
  if (error) throw error;
}
/** Remove a skill (category) row from a crew (cascades its attendance). */
export async function removeCategory(id: string): Promise<void> {
  const { error } = await supabase.from('labour_crew_categories').delete().eq('id', id);
  if (error) throw error;
}

// Worker directory (Parties) — Worker stakeholders, for the add pickers.
export async function loadParties(): Promise<{ stakeholder_id: string; name: string; category: string | null }[]> {
  const { data, error } = await supabase.from('stakeholders').select('stakeholder_id, name, category').eq('type', 'Worker').order('name');
  if (error) throw error;
  return data ?? [];
}
