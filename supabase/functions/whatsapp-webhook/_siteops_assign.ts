// Block B — shared assignment-notify core. ONE implementation behind both triggers:
//   • a MANUAL hand-off in the UI (siteops-notify-assignment edge fn), and
//   • a NAMED, non-self assignment at issue/todo CREATION (createProblem/createTodo).
// In-window (the owner messaged within 24h) → free-text; out-of-window → the approved
// issue_assignment template — both routed through the durable outbox.

import { send } from './_format.ts'
import { buildTemplateMessage } from '../_shared/whatsapp.ts'
import type { TemplateKey } from '../_shared/wa-templates.ts'
import { addToOpenBatch, type BatchItem } from './_siteops_batch.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const ASSIGN_TEMPLATE = Deno.env.get('SITEOPS_ASSIGNMENT_TEMPLATE') ?? 'issue_assignment'   // approved registry key
const fmtDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null

/** Open 24h session? (an inbound within 24h). Free-text only delivers in-window. */
export async function hasOpenSession(supabase: SB, phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase.from('wa_message_log')
    .select('id').eq('phone_number', phone).eq('direction', 'IN').gte('created_at', since).limit(1).maybeSingle()
  return !!data
}

/** A user's active WhatsApp number, or null. */
export async function ownerPhone(supabase: SB, userId: string): Promise<string | null> {
  const { data } = await supabase.from('wa_registered_numbers')
    .select('phone_number').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle()
  return data?.phone_number ?? null
}

/** Notify an owner they hold an item: free-text in-window, issue_assignment template out.
 *  On a successful send, opens a reply-batch holding `batchItem` so the owner's reply
 *  ("done"/"sorted") resolves THAT item instead of being read as a new narration. */
export async function notifyOwnerAssignment(supabase: SB, opts: {
  orgId: string
  ownerPhone: string
  ownerName: string | null
  title: string
  due: string | null          // ISO date or null
  byName?: string | null       // assigner (free-text variant only)
  batchItem: BatchItem         // opened so the assignee's reply resolves against it
}): Promise<{ notified: boolean; channel: 'text' | 'template' | 'skipped' }> {
  const inWindow = await hasOpenSession(supabase, opts.ownerPhone)
  let channel: 'text' | 'template' | 'skipped' = 'skipped'
  if (inWindow) {
    const by = opts.byName ? `${opts.byName} assigned you` : `You've been assigned`
    const body = `📌 ${by}: ${opts.title}${opts.due ? `, by ${fmtDay(opts.due)}` : ''}.\nReply here with how it's going.`
    await send(supabase, opts.ownerPhone, { kind: 'text', body }, { org_id: opts.orgId })
    channel = 'text'
  } else if (ASSIGN_TEMPLATE) {
    const msg = buildTemplateMessage(ASSIGN_TEMPLATE as TemplateKey, {
      name: (opts.ownerName ?? 'there').split(/\s+/)[0],   // {{1}}
      item: opts.title,                                     // {{2}}
      due: fmtDay(opts.due) ?? 'soon',                      // {{3}} (template requires it)
    })
    await send(supabase, opts.ownerPhone, msg, { org_id: opts.orgId })
    channel = 'template'
  }
  // open the reply-context so the assignee's "done/sorted" resolves THIS item
  if (channel !== 'skipped') await addToOpenBatch(supabase, opts.batchItem.orgId, opts.ownerPhone, opts.batchItem)
  return { notified: channel !== 'skipped', channel }
}
