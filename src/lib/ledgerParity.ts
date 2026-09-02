// The Allocation Ledger — Phase-1 parity gate.
//
// For every party, compute the position TWICE — the old netting (partyLedgerApi.loadPartyLedger)
// and the new allocation derivation (ledgerDerive.deriveParty) — and diff. A clean party has no
// diff. A diff is either a bug in the old calc (→ a cutover adjustment) or a real discrepancy to
// carry (→ an opening-balance-style adjustment); this list is the migration QA, resolved before any
// user-visible change ships. Read-only; runs as the signed-in user, scoped to their org by RLS.
import { loadPartyLedger } from './partyLedgerApi';
import { deriveParty } from './ledgerDerive';
import { supabase } from './supabase';

const TOL = 1; // rupee

export interface ParityMetric { metric: string; old: number; neo: number; delta: number; flag: boolean }
export interface ParityRow { stakeholderId: string; name: string; type: string; metrics: ParityMetric[]; hasDiff: boolean; error?: string }
export interface ParityReport { rows: ParityRow[]; parties: number; clean: number; diffs: number; errored: number }

export async function parityParty(stakeholderId: string): Promise<ParityRow> {
  const [oldL, neo] = await Promise.all([loadPartyLedger(stakeholderId), deriveParty(stakeholderId)]);
  const m = (metric: string, o: number, n: number): ParityMetric => ({ metric, old: o, neo: n, delta: n - o, flag: Math.abs(n - o) > TOL });
  const metrics = [
    m('paid', oldL.totalPaid, neo.totalPaid),
    m('net (ahead)', oldL.aheadNow, neo.net),
    m('to pay', oldL.toPay, neo.toPay),
    m('advance', oldL.advance, neo.advance),
  ];
  return { stakeholderId, name: oldL.stakeholder.name, type: neo.type, metrics, hasDiff: metrics.some(x => x.flag) };
}

export async function parityOrg(onProgress?: (done: number, total: number) => void): Promise<ParityReport> {
  const { data, error } = await supabase.from('stakeholders').select('stakeholder_id').order('created_at');
  if (error) throw error;
  const ids = (data ?? []).map((s: any) => s.stakeholder_id);
  const rows: ParityRow[] = [];
  for (let i = 0; i < ids.length; i++) {
    try { rows.push(await parityParty(ids[i])); }
    catch (e: any) { rows.push({ stakeholderId: ids[i], name: ids[i], type: '', metrics: [], hasDiff: false, error: e?.message || 'error' }); }
    onProgress?.(i + 1, ids.length);
  }
  const errored = rows.filter(r => r.error).length;
  const diffs = rows.filter(r => r.hasDiff).length;
  return { rows, parties: ids.length, clean: ids.length - diffs - errored, diffs, errored };
}
