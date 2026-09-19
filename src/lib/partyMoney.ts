/**
 * What each party is owed, owes, and has been paid — read ONCE, for every page that shows it.
 *
 * The Parties list (desktop and phone) and the party's own ledger have to agree to the rupee, and the
 * three figures come from three different places:
 *
 *   paid        · every live transaction to them, summed.
 *   outstanding · a new-ledger org reads the allocation projection (the honest dues); an older org
 *                 nets billed − paid from v_party_orders. One switch, so a page never picks its own.
 *   ahead       · the same switch: the projection's unclassified advance, or paid beyond billed.
 *
 * Same query keys on both surfaces, so the two share one cache and cannot drift apart.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { isNewLedgerOrg, loadProjectionMap } from './ledgerRead';
import type { PartyProjection } from './ledgerRead';

const num = (v: unknown) => Number(v) || 0;

export async function loadPaidMap(orgId: string): Promise<Record<string, number>> {
  const { data } = await supabase.from('transactions')
    .select('stakeholder_id, total_amount').eq('org_id', orgId).eq('status', 'Active');
  const map: Record<string, number> = {};
  (data ?? []).forEach((t: { stakeholder_id: string | null; total_amount: number | null }) => {
    if (t.stakeholder_id) map[t.stakeholder_id] = (map[t.stakeholder_id] || 0) + num(t.total_amount);
  });
  return map;
}

export async function loadBilledMap(orgId: string): Promise<Record<string, number>> {
  const { data } = await supabase.from('v_party_orders').select('stakeholder_id, billed').eq('org_id', orgId);
  const map: Record<string, number> = {};
  (data ?? []).forEach((r: { stakeholder_id: string | null; billed: number | null }) => {
    if (r.stakeholder_id) map[r.stakeholder_id] = (map[r.stakeholder_id] || 0) + num(r.billed);
  });
  return map;
}

export interface PartyMoney {
  /** The raw reads, so a caller can memoize on them — closures would change identity every render. */
  paidMap: Record<string, number> | undefined;
  billedMap: Record<string, number> | undefined;
  projMap: Record<string, PartyProjection> | undefined;
  newLedger: boolean | undefined;
  ready: boolean;
}

/** Paid to them, to date. */
export const paidOf = (m: PartyMoney, id: string) => m.paidMap?.[id] ?? 0;
/** What is still owed TO them. */
export const outstandingOf = (m: PartyMoney, id: string) =>
  m.newLedger ? (m.projMap?.[id]?.toPay ?? 0) : Math.max((m.billedMap?.[id] ?? 0) - (m.paidMap?.[id] ?? 0), 0);
/** Paid beyond what their bills add up to — a flag, not a boast: bills are missing or unlinked. */
export const creditOf = (m: PartyMoney, id: string) =>
  m.newLedger ? (m.projMap?.[id]?.unclassifiedAhead ?? 0) : Math.max((m.paidMap?.[id] ?? 0) - (m.billedMap?.[id] ?? 0), 0);

/** The three figures, on the same query keys the desktop Parties page has always used. */
export function usePartyMoney(orgId: string | null | undefined): PartyMoney {
  const { data: paidMap } = useQuery({
    queryKey: ['stakeholders_paid', orgId], enabled: !!orgId, queryFn: () => loadPaidMap(orgId!),
  });
  const { data: billedMap } = useQuery({
    queryKey: ['stakeholders_billed', orgId], enabled: !!orgId, queryFn: () => loadBilledMap(orgId!),
  });
  const { data: newLedger } = useQuery({
    queryKey: ['org_new_ledger', orgId], enabled: !!orgId, queryFn: () => isNewLedgerOrg(orgId!),
  });
  const { data: projMap } = useQuery({
    queryKey: ['party_projection', orgId], enabled: !!orgId && !!newLedger, queryFn: () => loadProjectionMap(orgId!),
  });

  // One stable object: a fresh literal every render would defeat every useMemo that reads it, and
  // the lists on both surfaces are rebuilt from it.
  return useMemo(
    () => ({ paidMap, billedMap, projMap, newLedger, ready: !!paidMap && !!billedMap }),
    [paidMap, billedMap, projMap, newLedger],
  );
}
