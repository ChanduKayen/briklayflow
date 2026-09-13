import { supabase } from './supabase';

/**
 * Merge several duplicate parties into one. `survivorId` is kept (and renamed to `newName`); every other
 * id in `loserIds` is folded into it — its records repointed, openings netted, then soft-deleted. See the
 * merge_stakeholders migration for the full contract. All-or-nothing on the server.
 */
export async function mergeStakeholders(
  orgId: string, survivorId: string, loserIds: string[], newName: string,
): Promise<void> {
  const { error } = await supabase.rpc('merge_stakeholders', {
    p_org_id: orgId, p_survivor: survivorId, p_losers: loserIds, p_new_name: newName,
  });
  if (error) throw error;
}

/**
 * Add an alias (another name) to a party, deduped case-insensitively and never duplicating the party's own
 * name. Aliases are match-only, never displayed. Returns the new alias list. No-op if already present.
 */
export async function addStakeholderAlias(
  stakeholderId: string, alias: string, existing: string[] | null | undefined, canonicalName?: string,
): Promise<string[]> {
  const a = alias.trim();
  const cur = existing ?? [];
  if (!a) return cur;
  const lower = a.toLowerCase();
  if (lower === (canonicalName ?? '').trim().toLowerCase()) return cur;   // the name isn't its own alias
  if (cur.some((x) => x.trim().toLowerCase() === lower)) return cur;      // already known
  const next = [...cur, a];
  const { error } = await supabase.from('stakeholders').update({ aliases: next }).eq('stakeholder_id', stakeholderId);
  if (error) throw error;
  return next;
}
