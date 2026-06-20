// Procurement agent — the structural twin of the transaction agent. Capture-first
// throughout: the deep extraction NEVER blocks the user. The fast gate computes the
// segment count; the ONE-PR guard at the single flip-point (gate.segments >= 2)
// redirects instead of silently merging — and IS the future multi-PR segmenter
// (the deep pass already returns Request[]). Sourcing is decoupled from the parse:
// vendor named & confident -> instant ack; vendor absent -> prompt NOW, extract in
// parallel, stage a draft regardless (so an ignored prompt never loses the request).

import { send } from '../_format.ts'
import type { TxnCtx } from './transaction.ts'
import type { ConvoRow } from '../_conversation.ts'
import { openConversation } from '../_conversation.ts'
import { matchPayee, matchProject } from '../_match.ts'
import { gateProcurement, extractProcurements, titleWithCount, type ProcRequest } from '../_proc_extract.ts'
import {
  mProcAck, mProcMultiGuard, buildSourcingPrompt, buildVendorList, mProcComplete,
} from '../_messages.ts'

export type ProcCtx = TxnCtx

// ── data loads ───────────────────────────────────────────────────────────────

async function loadVendors(ctx: ProcCtx): Promise<{ stakeholder_id: string; name: string }[]> {
  const { data } = await ctx.supabase.from('stakeholders')
    .select('stakeholder_id, name').eq('org_id', ctx.orgId).eq('type', 'Vendor')
  return (data ?? []) as { stakeholder_id: string; name: string }[]
}
async function loadProjects(ctx: ProcCtx): Promise<{ project_id: string; name: string }[]> {
  const { data } = await ctx.supabase.from('projects').select('project_id, name').eq('org_id', ctx.orgId)
  return (data ?? []) as { project_id: string; name: string }[]
}
/** Any active member who can approve procurement => NOT solo mode. */
async function loadApprover(ctx: ProcCtx): Promise<{ has: boolean; name: string | null }> {
  const { data } = await ctx.supabase.from('org_memberships')
    .select('user_id, user_profiles(name)')
    .eq('org_id', ctx.orgId).eq('status', 'active').eq('can_approve_procurement', true).limit(1)
  const row = (data ?? [])[0] as { user_profiles?: { name?: string } | null } | undefined
  if (!row) return { has: false, name: null }
  return { has: true, name: row.user_profiles?.name ?? null }
}

/** Stage a request as a draft PR + its items — idempotent on (wamid, request_index),
 *  3-retry (mirrors commitEntry). Returns the PR id, or null on a hard failure. */
async function stageRequest(
  ctx: ProcCtx, req: ProcRequest, requestIndex: number,
  vendorId: string | null, siteId: string | null, sourcing: string | null,
): Promise<string | null> {
  const items = req.items.map((it) => ({ item_name: it.item_name, quantity: it.quantity, unit: it.unit, note: it.note }))
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await ctx.supabase.rpc('stage_purchase_request', {
      p_org_id: ctx.orgId, p_sender: ctx.from, p_sender_name: ctx.senderName,
      p_wamid: ctx.wamid, p_request_index: requestIndex, p_status: 'draft',
      p_site_id: siteId, p_site_raw: req.site_raw,
      p_vendor_id: vendorId, p_vendor_raw: req.vendor_raw,
      p_sourcing_mode: sourcing, p_title: req.title,
      p_items: items,
    })
    const res = data as { id?: string; committed?: boolean } | null
    if (!error && res?.committed) return res.id ?? null
  }
  return null
}

// ── entry (NEW_INTENT) ───────────────────────────────────────────────────────

export async function runProcurementMessage(
  ctx: ProcCtx, text: string, _opts: { prefix?: string; lingering?: ConvoRow | null } = {},
): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const meta = { org_id: orgId, wamid }

  // FAST gate — distinct (vendor,site) segments + per-request vendor/sourcing signal.
  const gate = await gateProcurement(text)
  const seg0 = gate.segments[0]
  const vendorConfident = !!seg0?.vendor_named && seg0?.vendor_confidence === 'high'

  // ── ONE-PR GUARD — the single flip-point (multi-PR later = loop here) ──────
  if (gate.segments.length >= 2) {
    const reqs = await extractProcurements(text, (await loadProjects(ctx)).map((p) => p.name))
    if (reqs.length >= 2) {
      const labels = reqs.map((r) => ({ label: `${r.items[0]?.item_name ?? 'items'}${r.vendor_raw ? ` from ${r.vendor_raw}` : ''}` }))
      await send(supabase, from, mProcMultiGuard(lang, { requests: labels }), meta)
      return   // NO staging, NO silent merge
    }
    // deep pass disagreed (single) -> handle as one
    await handleSingle(ctx, reqs[0] ?? null)
    return
  }

  // ── single segment ────────────────────────────────────────────────────────
  if (vendorConfident) {
    await send(supabase, from, mProcAck(lang), meta)                 // instant ack
    const reqs = await extractProcurements(text, (await loadProjects(ctx)).map((p) => p.name))
    await handleSingle(ctx, reqs[0] ?? null)
    return
  }

  // vendor absent/unclear -> sourcing prompt IMMEDIATELY, deep extract after (parallel
  // in effect: the prompt is already enqueued before the slow parse runs).
  const approver = await loadApprover(ctx)
  await send(supabase, from, buildSourcingPrompt(lang, { requests: [{ label: '' }], hasApprover: approver.has, approverName: approver.name }), meta)

  const projects = await loadProjects(ctx)
  const reqs = await extractProcurements(text, projects.map((p) => p.name))
  const req = reqs[0]
  if (!req) return                                                   // nothing parsed; the prompt went

  // capture-first: persist the draft (sourcing pending) even if the prompt is ignored.
  const siteM = matchProject(req.site_raw, projects)
  const siteId = siteM.band === 'auto' ? siteM.id : null
  const prId = await stageRequest(ctx, req, 0, null, siteId, null)
  if (prId) {
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'PROCUREMENT',
      pendingQuestion: 'AWAIT_SOURCING', stagedEntryId: prId, lastMessageId: wamid,
    })
  }
}

/** Single-request: silently match vendor + site, stage, confirm (capture-first). */
async function handleSingle(ctx: ProcCtx, req: ProcRequest | null): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const meta = { org_id: orgId, wamid }
  if (!req) return                                                   // ack already went; nothing to stage

  const vendors = await loadVendors(ctx)
  const projects = await loadProjects(ctx)
  const vendorM = matchPayee(req.vendor_raw, vendors.map((v) => ({ stakeholder_id: v.stakeholder_id, name: v.name })))
  const vendorAuto = vendorM.band === 'auto'
  const vendorId = vendorAuto ? vendorM.id : null
  const vendorDisplay = vendorAuto ? vendorM.name : req.vendor_raw
  const siteM = matchProject(req.site_raw, projects)
  const siteId = siteM.band === 'auto' ? siteM.id : null
  const siteDisplay = siteId ? siteM.name : req.site_raw

  const prId = await stageRequest(ctx, req, 0, vendorId, siteId, 'direct')
  if (!prId) return

  await send(supabase, from, mProcComplete(lang, {
    headline: titleWithCount(req),
    site: siteDisplay,
    vendor: vendorDisplay,
    vendorMatched: vendorAuto,
    siteMissing: !siteId && !req.site_raw,
  }), meta)
}

// ── ANSWERS_PENDING — sourcing button taps + vendor list pick (Part 4) ───────

export async function answerProcurement(ctx: ProcCtx, _text: string, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid, lang, interactiveId } = ctx
  const meta = { org_id: orgId, wamid }
  const prId = convo.staged_entry_id
  if (!prId) return

  if (interactiveId === 'proc_src_defer') {
    await supabase.from('purchase_requests').update({ sourcing_mode: 'defer' }).eq('id', prId)
    await send(supabase, from, { kind: 'text', body: 'Okay — left for your approver to decide.' }, meta)
    return
  }
  if (interactiveId === 'proc_src_direct' || interactiveId === 'proc_src_rfq') {
    await supabase.from('purchase_requests').update({ sourcing_mode: interactiveId === 'proc_src_rfq' ? 'rfq' : 'direct' }).eq('id', prId)
    const vendors = await loadVendors(ctx)
    await send(supabase, from, buildVendorList(lang, vendors.map((v) => ({ id: v.stakeholder_id, name: v.name }))), meta)
    return
  }
  if (interactiveId && interactiveId.startsWith('proc_vendor_')) {
    const vid = interactiveId.slice('proc_vendor_'.length)
    if (vid && vid !== 'yes' && vid !== 'no_choose' && vid !== 'none') {
      await supabase.from('purchase_requests').update({ vendor_id: vid }).eq('id', prId)
      await send(supabase, from, { kind: 'text', body: '✓ Vendor set — your request is ready.' }, meta)
      return
    }
  }
  await send(supabase, from, { kind: 'text', body: 'Tap one of the options above to set how to source this.' }, meta)
}
