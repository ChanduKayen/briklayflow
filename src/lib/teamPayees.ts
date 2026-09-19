// Teammates as payees.
//
// A person can be both a TEAMMATE (an org member who signs in / holds a site-cash wallet) and a PARTY
// (a stakeholders row you pay). When the picker offered only parties, paying a teammate meant typing
// their name and creating a SECOND, unlinked party — a duplicate. So the payee dropdowns now surface
// teammates directly (a "Team" group, mirroring the GEN-heads group), and picking one resolves to that
// teammate's ONE canonical party — reused if it exists, created-and-linked the first time — so no
// duplicate is ever born and their wallet resolves through stakeholders.user_id.
//
// A teammate who ALREADY has a linked party is that party: they show in the normal party list under
// their name, so a picker's Team group lists only the members WITHOUT a linked party yet.
import { supabase } from './supabase';

export interface TeamCandidate {
  userId: string;
  name: string;
  role: string;
  phone: string | null;
  stakeholderId: string | null;   // the member's linked party, when one already exists
}

/** Active org members as payee candidates, each tagged with their linked party (stakeholders.user_id)
 *  and WhatsApp number (wa_registered_numbers). Two-step reads to dodge the org_id-ambiguous embed. */
export async function loadTeamCandidates(orgId: string): Promise<TeamCandidate[]> {
  const { data: mem } = await supabase
    .from('org_memberships').select('user_id, role, status').eq('org_id', orgId).eq('status', 'active');
  const ids = [...new Set((mem ?? []).map((r: any) => r.user_id).filter(Boolean))] as string[];
  if (!ids.length) return [];
  const [{ data: profs }, { data: regs }, stkRes] = await Promise.all([
    supabase.from('user_profiles').select('id, name').in('id', ids),
    supabase.from('wa_registered_numbers').select('user_id, phone_number').eq('org_id', orgId).in('user_id', ids),
    // stakeholders.user_id only exists after migration 20260921000000 — tolerate its absence.
    supabase.from('stakeholders').select('stakeholder_id, user_id').eq('org_id', orgId).in('user_id', ids).is('merged_into', null),
  ]);
  const nameBy = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.name as string]));
  const phoneBy = new Map<string, string>();
  (regs ?? []).forEach((r: any) => { if (r.user_id && r.phone_number && !phoneBy.has(r.user_id)) phoneBy.set(r.user_id, r.phone_number); });
  const stkBy = new Map<string, string>();
  (stkRes.data ?? []).forEach((s: any) => { if (s.user_id && !stkBy.has(s.user_id)) stkBy.set(s.user_id, s.stakeholder_id); });
  return (mem ?? [])
    .map((r: any) => ({ userId: r.user_id, name: (nameBy.get(r.user_id) ?? '').trim(), role: r.role, phone: phoneBy.get(r.user_id) ?? null, stakeholderId: stkBy.get(r.user_id) ?? null }))
    .filter((m: TeamCandidate) => !!m.name);
}

/**
 * Resolve a teammate to their single canonical party. Returns the linked party when there is one, else
 * creates it — a real stakeholders row carrying `user_id` (so the wallet resolves) + `contact` (so a
 * later hand-merge of any older duplicate is easy). The `user_id` is set in a follow-up update that is
 * swallowed if the column isn't there yet (pre-migration) — the party is still created and payable,
 * just not wallet-linked until the migration lands. Type defaults to Worker (site labour), editable.
 */
export async function resolveTeammateParty(
  orgId: string,
  member: { userId: string; name: string; phone?: string | null; stakeholderId?: string | null },
): Promise<{ id: string; name: string }> {
  if (member.stakeholderId) return { id: member.stakeholderId, name: member.name };
  // Another pick (or a rename) may have created it since the list was loaded — re-check by identity.
  try {
    const { data: existing } = await supabase
      .from('stakeholders').select('stakeholder_id, name').eq('org_id', orgId).eq('user_id', member.userId).is('merged_into', null).maybeSingle();
    if (existing) return { id: (existing as any).stakeholder_id, name: (existing as any).name ?? member.name };
  } catch { /* user_id column not there yet — fall through to create */ }

  const id = 'STK-' + Math.random().toString(36).slice(2, 10);
  const { error } = await supabase.from('stakeholders').insert({
    stakeholder_id: id, name: member.name, type: 'Worker', category: 'Site Supervisor',
    contact: member.phone ? String(member.phone) : null, org_id: orgId,
  });
  if (error) throw error;
  try { await supabase.from('stakeholders').update({ user_id: member.userId }).eq('stakeholder_id', id); } catch { /* pre-migration: unlinked but usable */ }
  return { id, name: member.name };
}
