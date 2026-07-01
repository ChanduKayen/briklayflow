// Block B2 — the CHASE SCHEDULER. A cron-driven edge function (pg_cron + pg_net,
// daily) that finds issues/todos whose follow-up clock has arrived, BATCHES all
// of an owner's due items into ONE digest grouped by project, and enqueues it on
// the durable outbox (the same path every other WhatsApp message rides). It then
// records a `chase_sent` event on each item's trail (B1) and advances each
// issue's next_followup_at by its cause cadence so it re-fires on schedule, not
// every tick.
//
// DISCIPLINE (why this is the highest-risk feature and how it stays a foreman,
// not a nag): one digest per owner — NEVER N chases to one person; impact
// context carried so a chase reads as a colleague's heads-up; one-word
// answerable, colleague tone; weather/auspicious (null clock → null
// next_followup_at) are NEVER chased.
//
// DELIVERY CAVEAT (24h window): this enqueues FREE-FORM text via the outbox,
// which the WhatsApp Cloud API only delivers inside the 24h customer-service
// window. Supervisors who narrate daily are usually in-window; owners who have
// gone quiet for >24h need an approved template. The digest is a single string,
// so swapping to a `{{1}}`-body template later is a one-line change (send a
// { kind:'template' } instead of { kind:'text' }).
//
// AUTH: secret-guarded (SITEOPS_CHASE_SECRET), like the outbox drainer. Invoke
// with `?preview=1` for a dry run — renders every owner's digest and returns it
// WITHOUT sending, advancing, or logging (the B2 STOP test).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { send } from '../whatsapp-webhook/_format.ts'
import { loadCadenceMap, type CadenceMap } from '../whatsapp-webhook/_siteops_timing.ts'
import { upsertOpenBatch, type BatchItem } from '../whatsapp-webhook/_siteops_batch.ts'
import { buildTemplateMessage } from '../_shared/whatsapp.ts'
import type { TemplateKey } from '../_shared/wa-templates.ts'
import { renderDigest, renderDigestInline, promptFor, type ChaseItem, type OwnerDigest } from './_digest.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CHASE_SECRET      = Deno.env.get('SITEOPS_CHASE_SECRET')   // cron -> function auth
// Registry key of the APPROVED out-of-window chase template. Defaults to the registered
// 'issue_followup'; override via env only to swap templates or set '' to disable.
const FOLLOWUP_TEMPLATE = Deno.env.get('SITEOPS_FOLLOWUP_TEMPLATE') ?? 'issue_followup'
// Escalation thresholds. SILENCE: N unanswered chases (reply resets). AGE: an issue
// still open this many days escalates EVEN IF the owner keeps replying (reply does
// NOT reset this — it's the stuck-but-talking case). Escalating to the principal
// runs on a SLOWER cadence so we don't mute them.
const ESCALATE_AFTER     = Number(Deno.env.get('SITEOPS_ESCALATE_AFTER') ?? '2')
const ESCALATE_AGE_DAYS  = Number(Deno.env.get('SITEOPS_ESCALATE_AGE_DAYS') ?? '5')
const ESCALATION_CAD_MULT = Number(Deno.env.get('SITEOPS_ESCALATION_CADENCE_MULT') ?? '2')

const DAY_MS = 86_400_000

interface RawIssue {
  id: string; org_id: string; project_id: string | null; task_id: string | null
  title: string; cause: string | null; owner_id: string; next_followup_at: string
  created_at: string
  impact?: { implication?: string | null } | null
}
interface RawTodo {
  id: string; org_id: string; project_id: string | null; task_id: string | null
  text: string; owner_id: string; due_date: string
}

const uniq = (xs: (string | null)[]): string[] => [...new Set(xs.filter(Boolean) as string[])]

/** Issues whose chase clock has arrived and are still open (not RESOLVED). */
async function loadDueIssues(supabase: SB, now: Date): Promise<RawIssue[]> {
  const FULL = 'id, org_id, project_id, task_id, title, cause, owner_id, next_followup_at, created_at, impact'
  const BASE = 'id, org_id, project_id, task_id, title, cause, owner_id, next_followup_at, created_at'
  const q = (cols: string) => supabase.from('problems').select(cols)
    .neq('status', 'RESOLVED')
    .not('owner_id', 'is', null)
    .not('next_followup_at', 'is', null)
    .lte('next_followup_at', now.toISOString())
  let res = await q(FULL)
  if (res.error) res = await q(BASE)   // impact column not yet applied → degrade
  if (res.error) { console.error('[chase] loadDueIssues:', res.error); return [] }
  return (res.data ?? []) as RawIssue[]
}

/** To-dos due on/before today and still open — minus any already chased today. */
async function loadDueTodos(supabase: SB, today: string): Promise<RawTodo[]> {
  const { data, error } = await supabase.from('todos')
    .select('id, org_id, project_id, task_id, text, owner_id, due_date')
    .eq('status', 'OPEN')
    .not('owner_id', 'is', null)
    .not('due_date', 'is', null)
    .lte('due_date', today)
  if (error) { console.error('[chase] loadDueTodos:', error); return [] }
  const todos = (data ?? []) as RawTodo[]
  if (!todos.length) return []
  // to-dos have no chase clock to advance, so dedup on the trail: skip ones
  // already chased since IST midnight — one nudge per IST day, not per tick.
  const { data: ev } = await supabase.from('followup_events')
    .select('todo_id')
    .in('todo_id', todos.map((t) => t.id))
    .eq('type', 'chase_sent')
    .gte('created_at', `${today}T00:00:00+05:30`)
  const chased = new Set((ev ?? []).map((e: { todo_id: string }) => e.todo_id))
  return todos.filter((t) => !chased.has(t.id))
}

serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  if (!CHASE_SECRET || auth !== `Bearer ${CHASE_SECRET}`) return new Response('Forbidden', { status: 403 })

  const preview = new URL(req.url).searchParams.get('preview') === '1'
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const now = new Date()
  // Todos are date-grained: compute "today" on the IST calendar (UTC+5:30) so a due_date of
  // "01 Jul" is due at IST midnight, not 05:30 IST. Issues use next_followup_at (timestamptz,
  // absolute) and are compared with now() directly, so they need no offset.
  const today = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const dueIssues = await loadDueIssues(supabase, now)
  const dueTodos = await loadDueTodos(supabase, today)
  if (!dueIssues.length && !dueTodos.length) {
    return json({ ran_at: now.toISOString(), preview, owners: 0, issues: 0, todos: 0, note: 'nothing due' })
  }

  // ── resolve owner → WhatsApp number (wa_registered_numbers; prefer same-org) ──
  const ownerIds = uniq([...dueIssues, ...dueTodos].map((x) => x.owner_id))
  const { data: nums } = await supabase.from('wa_registered_numbers')
    .select('user_id, org_id, phone_number, name')
    .in('user_id', ownerIds)
    .eq('is_active', true)
  const byOrgUser = new Map<string, { phone: string; name: string | null }>()
  const byUser = new Map<string, { phone: string; name: string | null }>()
  for (const n of nums ?? []) {
    byUser.set(n.user_id, { phone: n.phone_number, name: n.name })
    if (n.org_id) byOrgUser.set(`${n.org_id}:${n.user_id}`, { phone: n.phone_number, name: n.name })
  }
  const resolvePhone = (orgId: string, userId: string) =>
    byOrgUser.get(`${orgId}:${userId}`) ?? byUser.get(userId) ?? null

  // ── names for the digest (projects + blocked tasks) ──
  const projectIds = uniq([...dueIssues, ...dueTodos].map((x) => x.project_id))
  const taskIds = uniq([...dueIssues, ...dueTodos].map((x) => x.task_id))
  const projName = new Map<string, string>()
  if (projectIds.length) {
    const { data } = await supabase.from('projects').select('project_id, name').in('project_id', projectIds)
    for (const p of data ?? []) projName.set(p.project_id, p.name)
  }
  const taskName = new Map<string, string>()
  if (taskIds.length) {
    const { data } = await supabase.from('site_tasks').select('task_id, name, floor_label').in('task_id', taskIds)
    for (const t of data ?? []) taskName.set(t.task_id, t.floor_label ? `${t.name} · ${t.floor_label}` : t.name)
  }

  // ── escalation prep (B3): chase UP — to the project supervisor, else the org
  //    principal — on SILENCE (unanswered streak) OR AGE (still open too long despite
  //    replies). When no one is above the owner (solo founder), raise VISIBILITY in
  //    their own view instead of messaging them about their own item. ──
  const orgIds = uniq([...dueIssues, ...dueTodos].map((x) => x.org_id))
  const streak = await unansweredStreak(supabase, dueIssues.map((p) => p.id))
  const ageDays = (iso: string) => (now.getTime() - new Date(iso).getTime()) / DAY_MS
  const supByProject = new Map<string, string | null>()
  if (projectIds.length) {
    const { data } = await supabase.from('projects').select('project_id, supervisor_id').in('project_id', projectIds)
    for (const p of data ?? []) supByProject.set(p.project_id, p.supervisor_id ?? null)
  }
  const principalByOrg = new Map<string, string>()
  const ownerNameById = new Map<string, string>()
  if (orgIds.length) {
    const { data } = await supabase.from('user_profiles').select('id, name, role, org_id').in('org_id', orgIds)
    for (const u of data ?? []) {
      if (u.role === 'principal') principalByOrg.set(u.org_id, u.id)
      if (u.name) ownerNameById.set(u.id, u.name)
    }
  }
  const escalationTarget = (issue: RawIssue, ownerId: string): { phone: string; name: string | null } | null => {
    const sup = issue.project_id ? supByProject.get(issue.project_id) ?? null : null
    const targetUser = (sup && sup !== ownerId) ? sup : (principalByOrg.get(issue.org_id) ?? null)
    if (!targetUser || targetUser === ownerId) return null
    return byUser.get(targetUser) ?? null
  }

  // ── batch per recipient (keyed by phone — one person, one digest) ──
  const owners = new Map<string, OwnerDigest>()
  let skippedNoPhone = 0
  const pushTo = (
    recipient: { phone: string; name: string | null }, orgId: string,
    base: { kind: 'issue' | 'todo'; id: string; projectId: string | null; taskId: string | null; title: string; impactImplication: string | null; cause: string | null },
    extra: { escalated?: boolean; ownerLabel?: string | null } = {},
  ) => {
    let d = owners.get(recipient.phone)
    if (!d) { d = { phone: recipient.phone, name: recipient.name, items: [] }; owners.set(recipient.phone, d) }
    d.items.push({
      kind: base.kind, id: base.id, orgId, projectId: base.projectId,
      projectName: base.projectId ? (projName.get(base.projectId) ?? 'Unassigned site') : 'Unassigned site',
      title: base.title, taskName: base.taskId ? (taskName.get(base.taskId) ?? null) : null,
      impactImplication: base.impactImplication, cause: base.cause,
      escalated: extra.escalated, ownerLabel: extra.ownerLabel ?? null,
    })
  }
  const visibilityRaises: RawIssue[] = []
  for (const p of dueIssues) {
    const base = { kind: 'issue' as const, id: p.id, projectId: p.project_id, taskId: p.task_id, title: p.title, impactImplication: p.impact?.implication ?? null, cause: p.cause }
    // escalate on SILENCE (streak) OR AGE (open too long even with replies — the
    // stuck-but-talking case; age does NOT reset on a reply).
    const escalate = (streak.get(p.id) ?? 0) >= ESCALATE_AFTER || ageDays(p.created_at) >= ESCALATE_AGE_DAYS
    if (escalate) {
      const esc = escalationTarget(p, p.owner_id)
      if (esc) { pushTo(esc, p.org_id, base, { escalated: true, ownerLabel: ownerNameById.get(p.owner_id) ?? 'the supervisor' }); continue }
      // no one reachable above the owner → VISIBILITY RAISE (no chase message)
      visibilityRaises.push(p); continue
    }
    const who = resolvePhone(p.org_id, p.owner_id)
    if (!who) { skippedNoPhone++; continue }
    pushTo(who, p.org_id, base)
  }
  for (const t of dueTodos) {
    const who = resolvePhone(t.org_id, t.owner_id)
    if (!who) { skippedNoPhone++; continue }
    pushTo(who, t.org_id, { kind: 'todo', id: t.id, projectId: t.project_id, taskId: t.task_id, title: t.text, impactImplication: null, cause: null })
  }

  // ── render → (send + record) per owner ──
  const cadenceCache = new Map<string, CadenceMap>()
  const cadenceFor = async (orgId: string): Promise<CadenceMap> => {
    let m = cadenceCache.get(orgId)
    if (!m) { m = await loadCadenceMap(supabase, orgId); cadenceCache.set(orgId, m) }
    return m
  }

  const digests: { phone: string; name: string | null; items: number; channel: string; text: string }[] = []
  let skippedOutOfWindow = 0
  for (const [phone, dig] of owners) {
    const orgId = dig.items[0]?.orgId ?? null
    const dedup = `chase:${phone}:${today}`
    const text = renderDigest(dig)

    // 24h WINDOW: an inbound within 24h keeps a free-text session open (cheaper, the
    // pretty multi-line digest). Outside it, WhatsApp REQUIRES an approved template —
    // free-text would be blocked — and the digest rides one newline-free variable.
    const inWindow = await hasOpenSession(supabase, phone)
    const channel: 'text' | 'template' | 'skipped' =
      inWindow ? 'text' : FOLLOWUP_TEMPLATE ? 'template' : 'skipped'
    digests.push({ phone, name: dig.name, items: dig.items.length, channel, text: channel === 'template' ? renderDigestInline(dig) : text })
    if (preview) continue

    let sent = false
    try {
      if (channel === 'text') {
        await send(supabase, phone, { kind: 'text', body: text }, { org_id: orgId, dedup_key: dedup }); sent = true
      } else if (channel === 'template') {
        const msg = buildTemplateMessage(FOLLOWUP_TEMPLATE as TemplateKey, {
          name: (dig.name ?? 'there').split(/\s+/)[0],   // {{1}} owner first name
          summary: renderDigestInline(dig),               // {{2}} the status list (newline-free)
        })
        await send(supabase, phone, msg, { org_id: orgId, dedup_key: dedup }); sent = true
      }
    } catch (e) {
      console.error('[chase] send failed for', phone, (e as Error).message)
    }
    // out-of-window with no approved template → nothing delivered; DON'T advance/record,
    // so the items stay due and go out the moment a template is configured.
    if (!sent) { skippedOutOfWindow++; continue }

    // open the PATIENT batch B3 matches replies against (replaces any prior open one).
    await upsertOpenBatch(supabase, orgId ?? '', phone, dig.items.map(toBatchItem))
    for (const it of dig.items) {
      if (it.escalated) await recordEscalation(supabase, it)
      await recordChase(supabase, it, dig.name)
      if (it.kind === 'issue') await advanceIssue(supabase, it, now, await cadenceFor(it.orgId))
    }
  }

  // VISIBILITY RAISES — terminal escalation (no one above the owner): mark escalated
  // and stop the self-chase clock; the issues view raises it (sort + marker). No message.
  if (!preview) for (const p of visibilityRaises) await raiseVisibility(supabase, p)

  return json({
    ran_at: now.toISOString(), preview,
    owners: digests.length, issues: dueIssues.length, todos: dueTodos.length,
    skippedNoPhone, skippedOutOfWindow, visibilityRaised: visibilityRaises.length,
    digests,
  })
})

/** Terminal escalation → raise the item's prominence in the owner's OWN view (an
 *  `escalated` trail event the UI reads), and stop the self-chase clock so no
 *  escalating message series fires at the principal about their own item. */
async function raiseVisibility(supabase: SB, p: RawIssue): Promise<void> {
  await supabase.from('followup_events').insert({
    org_id: p.org_id, problem_id: p.id, todo_id: null, type: 'escalated',
    body: 'Escalated for visibility — top of the chain, no one above to chase', actor_kind: 'system', actor_id: null,
  })
  // null the clock → not due again; the escalated marker + sort is the visibility raise
  await supabase.from('problems').update({ next_followup_at: null }).eq('id', p.id)
}

/** Does this number have an OPEN 24h session — an inbound within the last 24h? Free-text
 *  is only deliverable in-window; out-of-window a chase MUST be an approved template. */
async function hasOpenSession(supabase: SB, phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase.from('wa_message_log')
    .select('id').eq('phone_number', phone).eq('direction', 'IN').gte('created_at', since)
    .limit(1).maybeSingle()
  return !!data
}

/** The run of chase_sent events since each issue's last reply/status change (an
 *  unanswered streak). N consecutive unanswered chases → time to escalate. */
async function unansweredStreak(supabase: SB, problemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!problemIds.length) return out
  const { data } = await supabase.from('followup_events')
    .select('problem_id, type, created_at')
    .in('problem_id', problemIds)
    .in('type', ['chase_sent', 'reply_received', 'status_changed'])
    .order('created_at', { ascending: true })
  const seq = new Map<string, string[]>()
  for (const e of (data ?? []) as { problem_id: string; type: string }[]) {
    const a = seq.get(e.problem_id) ?? []
    a.push(e.type); seq.set(e.problem_id, a)
  }
  for (const [pid, types] of seq) {
    let s = 0
    for (const ty of types) s = ty === 'chase_sent' ? s + 1 : 0   // a reply/status change resets
    out.set(pid, s)
  }
  return out
}

/** ChaseItem → the BatchItem shape B3's reply-matcher consumes. */
function toBatchItem(it: ChaseItem): BatchItem {
  return { kind: it.kind, id: it.id, orgId: it.orgId, projectId: it.projectId, projectName: it.projectName, title: it.title, taskName: it.taskName, cause: it.cause }
}

/** Append an `escalated` event to the item's trail (B1) when it's chased up. */
async function recordEscalation(supabase: SB, it: ChaseItem): Promise<void> {
  const { error } = await supabase.from('followup_events').insert({
    org_id: it.orgId, problem_id: it.kind === 'issue' ? it.id : null, todo_id: it.kind === 'todo' ? it.id : null,
    type: 'escalated', body: `Escalated — no reply from ${it.ownerLabel ?? 'the owner'}`, actor_kind: 'system', actor_id: null,
  })
  if (error) console.error('[chase] recordEscalation:', error)
}

/** Append a `chase_sent` event to the item's trail (B1), system actor. Names the RECIPIENT
 *  (the digest owner — for a normal chase that's the assignee, self included; for an escalated
 *  item it's whoever it was chased up to) so the activity log reads "Follow-up sent to {name}". */
async function recordChase(supabase: SB, it: ChaseItem, recipientName: string | null): Promise<void> {
  const to = (recipientName ?? '').trim().split(/\s+/)[0] || 'the owner'
  const { error } = await supabase.from('followup_events').insert({
    org_id: it.orgId,
    problem_id: it.kind === 'issue' ? it.id : null,
    todo_id: it.kind === 'todo' ? it.id : null,
    type: 'chase_sent',
    body: `Follow-up sent to ${to} — "${promptFor(it)}"`,
    actor_kind: 'system',
    actor_id: null,
  })
  if (error) console.error('[chase] recordChase:', error)
}

/** Re-time an issue's next chase by its cause cadence. null cadence
 *  (weather/auspicious) → stop chasing (clear the clock). An escalated chase (to the
 *  principal) runs on a SLOWER cadence so we don't mute them. */
async function advanceIssue(supabase: SB, it: ChaseItem, now: Date, cadence: CadenceMap): Promise<void> {
  const row = cadence.get(it.cause ?? 'other') ?? cadence.get('other') ?? { clock: 2, cadence: 3 }
  let days = row.cadence ?? row.clock
  if (days != null && it.escalated) days = Math.ceil(days * ESCALATION_CAD_MULT)
  const next = days == null ? null : new Date(now.getTime() + days * DAY_MS).toISOString()
  const { error } = await supabase.from('problems').update({ next_followup_at: next }).eq('id', it.id)
  if (error) console.error('[chase] advanceIssue:', error)
}

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
}
