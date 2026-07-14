// THE LEGACY SNAG BRIDGE — one item store, two old screens.
//
// The legacy Issues/Snags pages were built when a snag WAS a `todos` row. It is not any more: a snag
// is `problems.kind='snag'`, and a to-do is a planned one (20260713000001). Those pages are being
// retired, but they are still what the founder opens today — so until they go, they read the one
// store like everything else. A retired table they cannot write to (it has a trigger now) would just
// give them a Snags tab full of rows that no longer exist and buttons that throw.
//
// This is a BRIDGE, not a home: when the legacy pages go, so does this file.

import { supabase } from '../supabase'
import type { DeskSnag } from '../../components/siteOps/ItemsTable'

/** The columns the legacy snag row needs, from the store it actually lives in now. */
const SNAG_COLS = 'id, title, status, owner_id, deadline, task_id, project_id, created_at'

interface ProblemSnagRow {
  id: string
  title: string
  status: string
  owner_id: string | null
  deadline: string | null
  task_id: string | null
  project_id: string | null
  created_at: string
}

/**
 * problems(kind='snag') → the shape the old table renders.
 *
 * The status vocabularies differ, and the mapping is the honest one: RESOLVED and DISMISSED are both
 * TERMINAL — the work is not coming back — so both read as DONE on a screen whose only two states are
 * OPEN and DONE. Collapsing a dismissal into "open" (which the old code did, by testing `!== 'DONE'`)
 * is how a retracted item sat in the list forever.
 */
export const toLegacySnag = (r: ProblemSnagRow): DeskSnag => ({
  id: r.id,
  text: r.title,
  owner_id: r.owner_id,
  due_date: r.deadline,
  status: r.status === 'RESOLVED' || r.status === 'DISMISSED' ? 'DONE' : 'OPEN',
  task_id: r.task_id,
  project_id: r.project_id,
  created_at: r.created_at,
})

/** Snags for one project — or, with no project, every snag in the org. */
export async function fetchSnags(opts: { projectId?: string; orgId?: string }): Promise<DeskSnag[]> {
  let q = supabase.from('problems').select(SNAG_COLS).eq('kind', 'snag')
  if (opts.projectId) q = q.eq('project_id', opts.projectId)
  if (opts.orgId) q = q.eq('org_id', opts.orgId)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as unknown as ProblemSnagRow[]).map(toLegacySnag)
}

/**
 * Ticking a snag DONE closes a problem — with the chase clock and the readback button turned OFF.
 *
 * Writing `status` alone is what left WhatsApp chasing items the portal showed as closed: the cron
 * reads `next_followup_at`, and a stale `active_resolve_event` lets an old "Not resolved" tap re-arm
 * a row behind your back. Every closer in this codebase now writes all three.
 */
export async function setSnagDone(id: string, done: boolean): Promise<void> {
  const patch = done
    ? { status: 'RESOLVED', next_followup_at: null, active_resolve_event: null }
    // reopened: live again, so chased again — from tomorrow, never from a date in the past
    : { status: 'OPEN', next_followup_at: new Date(Date.now() + 86_400_000).toISOString(), active_resolve_event: null }
  const { error } = await supabase.from('problems').update(patch).eq('id', id)
  if (error) throw error
}

/** The other editable fields the old table offers (owner, due date). */
export async function patchSnag(id: string, patch: Partial<DeskSnag>): Promise<void> {
  const row: Record<string, unknown> = {}
  if ('text' in patch) row.title = patch.text
  if ('owner_id' in patch) row.owner_id = patch.owner_id
  if ('due_date' in patch) row.deadline = patch.due_date
  if ('status' in patch) row.status = patch.status === 'DONE' ? 'RESOLVED' : 'OPEN'
  if (!Object.keys(row).length) return
  const { error } = await supabase.from('problems').update(row).eq('id', id)
  if (error) throw error
}
