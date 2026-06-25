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
import { openConversation, closeConversation, abandonConversation } from '../_conversation.ts'
import { matchPayee, matchProject } from '../_match.ts'
import { gateProcurement, extractProcurements, titleWithCount, type ProcRequest } from '../_proc_extract.ts'
import {
  mProcMultiGuard, buildSourcingPrompt, buildVendorList, mProcComplete,
  buildSelectVendorFlow, buildPickVendorsFlow, type FlowVendor,
} from '../_messages.ts'

export type ProcCtx = TxnCtx

// ── data loads ───────────────────────────────────────────────────────────────

type VendorRow = {
  stakeholder_id: string; name: string
  category: string | null; is_approved: boolean | null; rating: number | null
}
async function loadVendors(ctx: ProcCtx): Promise<VendorRow[]> {
  const { data } = await ctx.supabase.from('stakeholders')
    .select('stakeholder_id, name, category, is_approved, rating')
    .eq('org_id', ctx.orgId).eq('type', 'Vendor')
  return (data ?? []) as VendorRow[]
}

/** Map a vendor row to the Flow's ${data.vendors} item — ALL four fields, always
 *  non-empty (the flow data schema declares id/title/description/metadata). */
function toFlowVendor(v: VendorRow): FlowVendor {
  const tags: string[] = []
  if (v.is_approved) tags.push('Preferred')
  if (typeof v.rating === 'number' && v.rating > 0) tags.push(`★ ${v.rating.toFixed(1)}`)
  const cat = (v.category ?? '').trim()
  return {
    id: v.stakeholder_id,
    title: (v.name ?? '').slice(0, 80) || 'Vendor',
    description: cat || 'Vendor',
    metadata: tags.length ? tags.join(' · ') : 'Vendor',
  }
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

/** Advance a sourced PR draft -> sent_for_approval, but ONLY if an approver exists
 *  (solo orgs have no one to route to, so their PRs stay draft for the owner to act
 *  on in-app). The .eq('status','draft') guard never downgrades an approved PR.
 *  NOTE: the WhatsApp approver PUSH (template + signed deep-link) is a separate
 *  milestone; this just moves the lifecycle so the in-app approval surface is correct. */
async function markReadyForApproval(ctx: ProcCtx, prId: string): Promise<void> {
  const approver = await loadApprover(ctx)
  if (!approver.has) return
  await ctx.supabase.from('purchase_requests')
    .update({ status: 'sent_for_approval' }).eq('id', prId).eq('status', 'draft')
}

/** Resolve the WhatsApp sender to a user_id IFF they are an active procurement
 *  approver in this org (phone -> wa_registered_numbers.user_id -> membership flag).
 *  Returns null otherwise (unknown number, no membership, or not an approver). */
async function senderApproverId(ctx: ProcCtx): Promise<string | null> {
  const { data: reg } = await ctx.supabase.from('wa_registered_numbers')
    .select('user_id').eq('phone_number', ctx.from).maybeSingle()
  const uid = (reg as { user_id?: string | null } | null)?.user_id
  if (!uid) return null
  const { data: m } = await ctx.supabase.from('org_memberships')
    .select('can_approve_procurement')
    .eq('user_id', uid).eq('org_id', ctx.orgId).eq('status', 'active').maybeSingle()
  return (m as { can_approve_procurement?: boolean } | null)?.can_approve_procurement ? uid : null
}

/** After a single (direct) vendor is set on the PR: if the SENDER can approve,
 *  promote straight to a live PO (auto-approve); otherwise send for approval so it
 *  lands in the /purchase-orders?status=draft queue. Closes the conversation either
 *  way. Promotion that can't proceed yet (e.g. no site) falls back to sent_for_approval. */
async function finalizeDirectVendor(ctx: ProcCtx, prId: string): Promise<void> {
  const { supabase, from, orgId, wamid } = ctx
  const meta = { org_id: orgId, wamid }

  const approverUid = await senderApproverId(ctx)
  if (approverUid) {
    const { data } = await supabase.rpc('promote_purchase_request_to_po', {
      p_pr_id: prId, p_approver_id: approverUid,
    })
    const res = data as { success?: boolean; po_id?: string; error?: string } | null
    if (res?.success && res.po_id) {
      await closeConversation(supabase, { orgId, sender: from, lastActionSummary: `PR -> PO ${res.po_id}`, stagedEntryId: prId, lastMessageId: wamid })
      await send(supabase, from, { kind: 'text', body: `✓ Approved — purchase order ${res.po_id} created.` }, meta)
      return
    }
    // Couldn't promote yet (missing site / no project code) -> fall through to approval queue.
  }

  await markReadyForApproval(ctx, prId)
  await closeConversation(supabase, { orgId, sender: from, lastActionSummary: 'PR sent for approval', stagedEntryId: prId, lastMessageId: wamid })
  await send(supabase, from, { kind: 'text', body: '✓ Vendor set — sent for approval.' }, meta)
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
    // (the instant routing ack is already sent in dispatch — no second "Got it" here)
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
  await markReadyForApproval(ctx, prId)   // vendor decided -> ready for approval

  await send(supabase, from, mProcComplete(lang, {
    headline: titleWithCount(req),
    site: siteDisplay,
    vendor: vendorDisplay,
    vendorMatched: vendorAuto,
    siteMissing: !siteId && !req.site_raw,
  }), meta)
}

// ── Interruption — a NEW order arrives mid-sourcing ─────────────────────────────

/** A new request interrupts an open sourcing/vendor conversation. Capture-first: the
 *  half-finished draft is KEPT (finish or discard it in-app); we just close the old
 *  conversation and tell the user it was saved. Returns '' because runProcurementMessage
 *  ignores the folded prefix — so the ack is sent here directly. */
export async function commitInterruptedProc(ctx: ProcCtx, convo: ConvoRow): Promise<string> {
  const { supabase, from, orgId, wamid } = ctx
  const prId = convo.staged_entry_id
  if (prId) {
    await closeConversation(supabase, {
      orgId, sender: from, stagedEntryId: prId, lastMessageId: wamid,
      lastActionSummary: 'Saved earlier request as a draft',
    })
    await send(supabase, from, { kind: 'text', body: '📝 Saved your earlier request as a draft — finish or discard it in the app.' }, { org_id: orgId, wamid })
  } else {
    await abandonConversation(supabase, orgId, from)
  }
  return ''
}

// ── Vendor Flow send ──────────────────────────────────────────────────────────

const flowIdFor = (mode: 'single' | 'rfq') =>
  (mode === 'rfq' ? Deno.env.get('WA_FLOW_RFQ_PICK_VENDORS_ID') : Deno.env.get('WA_FLOW_SELECT_VENDOR_ID')) ?? ''

/** Send the vendor Flow for an EXISTING PR (single -> SELECT_VENDOR / RadioButtonsGroup,
 *  rfq -> PICK_VENDORS / CheckboxGroup) and re-point the open conversation at the Flow's
 *  pending question. Returns false WITHOUT sending if the Flow isn't configured (no env
 *  id) so the caller can fall back to the plain vendor list. Completion lands in
 *  answerProcurement via the open conversation (terminal flow, no token echo; flow_token
 *  carries the PR id as a belt-and-suspenders hint only). */
async function sendVendorFlow(ctx: ProcCtx, mode: 'single' | 'rfq', prId: string): Promise<boolean> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const meta = { org_id: orgId, wamid }

  const flowId = flowIdFor(mode)
  if (!flowId) return false   // not configured -> caller falls back to the list

  const vendors = await loadVendors(ctx)
  if (vendors.length === 0) {
    await send(supabase, from, { kind: 'text', body: 'No vendors yet — add a vendor first.' }, meta)
    return true   // handled (an empty Flow/list helps no one)
  }

  await openConversation(supabase, {
    orgId, sender: from, owningAgent: 'PROCUREMENT',
    pendingQuestion: mode === 'rfq' ? 'AWAIT_RFQ_FLOW' : 'AWAIT_VENDOR_FLOW',
    stagedEntryId: prId, lastMessageId: wamid,
  })

  const flowVendors = vendors.slice(0, 30).map(toFlowVendor)
  const draft = (Deno.env.get('WA_FLOW_MODE') ?? '').toLowerCase() === 'draft'
  const msg = mode === 'rfq'
    ? buildPickVendorsFlow(lang, { flowId, flowToken: prId, vendors: flowVendors, draft })
    : buildSelectVendorFlow(lang, { flowId, flowToken: prId, vendors: flowVendors, draft })
  await send(supabase, from, msg, meta)
  return true
}

/** TEST trigger `pr single|rfq <text>`: stage a draft PR from <description>, then send
 *  the matching vendor Flow. Bails with a clear setup message if the Flow id env is
 *  unset (so we don't orphan a draft PR for a test that can't complete). */
export async function startVendorFlow(
  ctx: ProcCtx, mode: 'single' | 'rfq', description: string,
): Promise<void> {
  const { supabase, from, orgId, wamid } = ctx
  const meta = { org_id: orgId, wamid }

  if (!flowIdFor(mode)) {
    const envName = mode === 'rfq' ? 'WA_FLOW_RFQ_PICK_VENDORS_ID' : 'WA_FLOW_SELECT_VENDOR_ID'
    await send(supabase, from, { kind: 'text', body: `Flow not configured — set ${envName} to the published Flow id.` }, meta)
    return
  }

  const req: ProcRequest = {
    vendor_raw: null, sourcing_intent: mode === 'rfq' ? 'rfq' : 'direct', site_raw: null,
    items: [{ item_name: description, quantity: null, unit: null, note: null }],
    title: description,
  }
  const prId = await stageRequest(ctx, req, 0, null, null, mode === 'rfq' ? 'rfq' : null)
  if (!prId) {
    await send(supabase, from, { kind: 'text', body: "Couldn't stage the request — try again." }, meta)
    return
  }
  await sendVendorFlow(ctx, mode, prId)
}

// ── ANSWERS_PENDING — Flow completion + sourcing button taps + vendor list pick ──

/** Flow radio/checkbox values bind to the item id; tolerate {id} objects too. */
function pickVendorId(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
    return ((v as { id: string }).id).trim() || null
  }
  return null
}
/** CheckboxGroup returns an array of ids; tolerate a JSON-stringified array / single id. */
function pickVendorIds(v: unknown): string[] {
  const arr: unknown[] = Array.isArray(v) ? v
    : typeof v === 'string'
      ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v] } catch { return v ? [v] : [] } })()
      : []
  const out: string[] = []
  for (const x of arr) { const id = pickVendorId(x); if (id) out.push(id) }
  return out
}

export async function answerProcurement(ctx: ProcCtx, _text: string, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid, lang, interactiveId, flowResponse } = ctx
  const meta = { org_id: orgId, wamid }
  const prId = convo.staged_entry_id
  if (!prId) return

  // ── WhatsApp Flow completion (terminal nfm_reply.response_json) ───────────────
  // Bound by THIS open conversation (owning_agent=PROCUREMENT, staged_entry_id=prId).
  //   select_vendor    -> { mode:"single", vendor:"<stakeholder_id>" }
  //   rfq_pick_vendors -> { mode:"rfq", selected_vendors:["<stakeholder_id>", …] }
  if (flowResponse) {
    const fmode = typeof flowResponse.mode === 'string' ? flowResponse.mode : null

    // single -> vendor_id + sent_for_approval
    if (fmode === 'single' || flowResponse.vendor != null) {
      const vendorId = pickVendorId(flowResponse.vendor)
      if (!vendorId) {
        await send(supabase, from, { kind: 'text', body: "Didn't catch the vendor — tap the button again." }, meta)
        return
      }
      await supabase.from('purchase_requests')
        .update({ vendor_id: vendorId, sourcing_mode: 'direct' }).eq('id', prId)
      await finalizeDirectVendor(ctx, prId)   // auto-approve -> live PO if sender can approve
      return
    }

    // rfq -> sourcing_mode 'rfq' + selected_vendor_ids, stays draft
    if (fmode === 'rfq' || flowResponse.selected_vendors != null) {
      const ids = pickVendorIds(flowResponse.selected_vendors)
      if (ids.length === 0) {
        await send(supabase, from, { kind: 'text', body: 'Pick at least one vendor to quote.' }, meta)
        return
      }
      await supabase.from('purchase_requests')
        .update({ sourcing_mode: 'rfq', selected_vendor_ids: ids }).eq('id', prId)
      await closeConversation(supabase, { orgId, sender: from, lastActionSummary: 'PR RFQ vendors selected (flow)', stagedEntryId: prId, lastMessageId: wamid })
      await send(supabase, from, { kind: 'text', body: `✓ Quotes requested from ${ids.length} vendor${ids.length > 1 ? 's' : ''}.` }, meta)
      return
    }

    await send(supabase, from, { kind: 'text', body: "Didn't recognise that selection — try again." }, meta)
    return
  }

  if (interactiveId === 'proc_src_defer') {
    await supabase.from('purchase_requests').update({ sourcing_mode: 'defer' }).eq('id', prId)
    await markReadyForApproval(ctx, prId)
    await send(supabase, from, { kind: 'text', body: 'Okay — left for your approver to decide.' }, meta)
    return
  }
  if (interactiveId === 'proc_src_direct' || interactiveId === 'proc_src_rfq') {
    const mode = interactiveId === 'proc_src_rfq' ? 'rfq' : 'single'
    await supabase.from('purchase_requests').update({ sourcing_mode: mode === 'rfq' ? 'rfq' : 'direct' }).eq('id', prId)
    // Open the vendor Flow directly; fall back to the plain list if it isn't configured.
    const sent = await sendVendorFlow(ctx, mode, prId)
    if (!sent) {
      const vendors = await loadVendors(ctx)
      await send(supabase, from, buildVendorList(lang, vendors.map((v) => ({ id: v.stakeholder_id, name: v.name }))), meta)
    }
    return
  }
  if (interactiveId && interactiveId.startsWith('proc_vendor_')) {
    const vid = interactiveId.slice('proc_vendor_'.length)
    if (vid && vid !== 'yes' && vid !== 'no_choose' && vid !== 'none') {
      await supabase.from('purchase_requests').update({ vendor_id: vid, sourcing_mode: 'direct' }).eq('id', prId)
      await finalizeDirectVendor(ctx, prId)   // auto-approve -> live PO if sender can approve
      return
    }
  }
  // Nothing matched (they typed instead of tapping, or the buttons scrolled off):
  // RE-SEND the prompt we're actually waiting on, so there's always a live control.
  const pq = convo.pending_question
  if (pq === 'AWAIT_VENDOR_FLOW' || pq === 'AWAIT_RFQ_FLOW') {
    const mode: 'single' | 'rfq' = pq === 'AWAIT_RFQ_FLOW' ? 'rfq' : 'single'
    if (!(await sendVendorFlow(ctx, mode, prId))) {
      const vendors = await loadVendors(ctx)
      await send(supabase, from, buildVendorList(lang, vendors.map((v) => ({ id: v.stakeholder_id, name: v.name }))), meta)
    }
    return
  }
  // default: AWAIT_SOURCING -> re-send the sourcing buttons (direct / get quotes / defer)
  const approver = await loadApprover(ctx)
  await send(supabase, from, buildSourcingPrompt(lang, {
    requests: [{ label: '' }], hasApprover: approver.has, approverName: approver.name,
  }), meta)
}
