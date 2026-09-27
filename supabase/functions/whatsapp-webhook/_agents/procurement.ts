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
import { gateProcurement, extractProcurements, extractProcContext, titleWithCount, titleFor, type ProcRequest, type ProcItem } from '../_proc_extract.ts'
import { extractProcurementFromImage } from '../_extract.ts'
import { APP_ORIGIN } from '../_links.ts'
import { signedMediaUrl, storeMedia } from '../_normalize.ts'
import { recentInboundText } from './transaction.ts'   // reunite a photo with the site/vendor typed just before it
import { setPhotoPr } from '../_burst.ts'               // tag this photo's row with the request it landed in
import {
  mProcMultiGuard, buildSourcingPrompt, buildVendorList, mProcComplete,
  buildSelectVendorFlow, buildPickVendorsFlow, type FlowVendor,
} from '../_messages.ts'
import type { Lang } from '../_messages.ts'

export type ProcCtx = TxnCtx

// ── data loads ───────────────────────────────────────────────────────────────

type VendorRow = {
  stakeholder_id: string; name: string
  category: string | null; is_approved: boolean | null; rating: number | null
}
async function loadVendors(ctx: ProcCtx): Promise<VendorRow[]> {
  const { data } = await ctx.supabase.from('stakeholders')
    .select('stakeholder_id, name, category, is_approved, rating, aliases')
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
 *  3-retry (mirrors commitEntry). Returns the PR id, or null on a hard failure.
 *  imageUrl (when the request came from a PHOTO) rides ON the request so the reviewer
 *  sees the paper it was read from — the "show the source" a payment proof gets. */
async function stageRequest(
  ctx: ProcCtx, req: ProcRequest, requestIndex: number,
  vendorId: string | null, siteId: string | null, sourcing: string | null,
  imageUrl: string | null = null,
): Promise<string | null> {
  const items = req.items.map((it) => ({ item_name: it.item_name, quantity: it.quantity, unit: it.unit, width_mm: it.width_mm, height_mm: it.height_mm, spec: it.spec, brand: it.brand, note: it.note }))
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await ctx.supabase.rpc('stage_purchase_request', {
      p_org_id: ctx.orgId, p_sender: ctx.from, p_sender_name: ctx.senderName,
      p_wamid: ctx.wamid, p_request_index: requestIndex, p_status: 'draft',
      p_site_id: siteId, p_site_raw: req.site_raw,
      p_vendor_id: vendorId, p_vendor_raw: req.vendor_raw,
      p_sourcing_mode: sourcing, p_title: req.title,
      p_items: items, p_image_url: imageUrl,
    })
    const res = data as { id?: string; committed?: boolean } | null
    if (!error && res?.committed) return res.id ?? null
  }
  return null
}

/** The durable URL of the WhatsApp photo this request was read from — mirrors the
 *  transaction proof-image path: prefer the object _normalize already stored, else
 *  re-upload the bytes we still hold, then sign a long-TTL link the PR card renders.
 *  Best-effort — a missing image never blocks the request. */
const PROC_IMAGE_TTL = 315_360_000   // ~10y, matches attachProofImage
async function procImageUrl(ctx: ProcCtx): Promise<string | null> {
  if (!ctx.image) return null
  try {
    let path = ctx.image.storagePath ?? null
    if (!path && ctx.image.base64) {
      const bytes = Uint8Array.from(atob(ctx.image.base64), (c) => c.charCodeAt(0))
      path = await storeMedia(ctx.supabase, bytes, ctx.image.mime || 'image/jpeg', ctx.from)
    }
    if (!path) return null
    return await signedMediaUrl(ctx.supabase, path, PROC_IMAGE_TTL)
  } catch (e) { console.error('[proc] image url failed:', (e as Error).message); return null }
}

// ── multi-page photo batch (fold a follow-up page into the request the last page opened) ──────────────
// WhatsApp delivers several images sent together as separate messages; the per-sender lock in the webhook
// serialises them, so the 2nd photo runs after the 1st has staged its draft PR. This folds page 2..N into
// that same PR when they belong together, so one list photographed across pages is ONE request.
const PROC_BATCH_MS = Number(Deno.env.get('WA_PROC_BATCH_MS') ?? '90000')   // "sent together" ≈ seconds apart

type ProcHead = { vendor_raw: string | null; site_raw: string | null; title: string | null }

/** Fold an incoming page into the request's existing items — KEEP EVERY ROW, including repeats.
 *  A materials sheet lists a repeated line ON PURPOSE (the same fitting for two toilets, two runs of the
 *  same pipe); collapsing "identical" rows drops real quantity, so the request no longer matches the paper.
 *  We do NOT dedup here: the extracted count must equal the count on the doc. Idempotency against a page
 *  being processed twice is owned UPSTREAM — the webhook's wamid gate (wa_inbound_dedup + the processing_job
 *  unique key) makes the same message unrepeatable, so a duplicate row here is always a genuine second line,
 *  never a re-read of the same page. Pure — the DB read/write lives in tryBatchAppend. */
export function foldItems(existing: ProcItem[], incoming: ProcItem[]): { merged: ProcItem[]; added: number } {
  return { merged: [...existing, ...incoming], added: incoming.length }
}

/** Fold this photo into an already-open request (page 2+ of one list) and return that request's id. Returns
 *  null when there's nothing to fold into (no recent draft, or a page that names a DIFFERENT vendor/site — a
 *  separate request) → the caller stages a fresh one. Sends NOTHING: the batch finalizer confirms once the
 *  whole burst has settled. */
async function foldIntoOpenRequest(ctx: ProcCtx, newItems: ProcItem[], head: ProcHead): Promise<string | null> {
  const { supabase, from, orgId, wamid } = ctx
  try {
    const since = new Date(Date.now() - PROC_BATCH_MS).toISOString()
    const { data: recent } = await supabase.from('purchase_requests')
      .select('id, wa_message_id, vendor_id, vendor_raw, site_id, site_raw, title, status, image_url')
      .eq('org_id', orgId).eq('sender_number', from).eq('status', 'draft')
      .gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!recent || !recent.id) return null
    if (recent.wa_message_id && recent.wa_message_id === wamid) return null   // this very message's own PR — not a new page
    if (!recent.image_url) return null   // only fold a photo INTO another photo's request — never into a text order

    // COMPATIBILITY — a page that names a DIFFERENT vendor or site is a separate request, never a merge.
    const projects = await loadProjects(ctx)
    const vendors = await loadVendors(ctx)
    const newVendor = head.vendor_raw ? matchPayee(head.vendor_raw, vendors.map((v) => ({ stakeholder_id: v.stakeholder_id, name: v.name }))) : null
    const newSite = head.site_raw ? matchProject(head.site_raw, projects) : null
    const vendorConflict = (newVendor?.band === 'auto' && recent.vendor_id && newVendor.id !== recent.vendor_id)
      || rawConflict(head.vendor_raw, recent.vendor_raw)
    const siteConflict = (newSite?.band === 'auto' && recent.site_id && newSite.id !== recent.site_id)
      || rawConflict(head.site_raw, recent.site_raw)
    if (vendorConflict || siteConflict) return null

    // MERGE — existing items + EVERY row of this page (repeats kept: the extracted count must match the
    //         doc). The set is replaced atomically, so we re-send the union, not just the delta.
    const { data: existing } = await supabase.from('purchase_request_items')
      .select('item_name, quantity, unit, width_mm, height_mm, spec, brand, note')
      .eq('purchase_request_id', recent.id).order('item_index')
    const { merged } = foldItems((existing ?? []) as ProcItem[], newItems)

    const { data: res, error } = await supabase.rpc('set_purchase_request_items', { p_pr_id: recent.id, p_items: merged })
    if (error || !(res as { success?: boolean } | null)?.success) return null   // couldn't merge → let it stage fresh

    // Fill a header gap this page supplies (page 1 lacked the vendor/site/title; a later page names it).
    const patch: Record<string, unknown> = {}
    if (!recent.vendor_id && !recent.vendor_raw && head.vendor_raw) patch.vendor_raw = head.vendor_raw
    if (!recent.site_id && !recent.site_raw && head.site_raw) patch.site_raw = head.site_raw
    if (!recent.title && head.title) patch.title = head.title
    if (Object.keys(patch).length) await supabase.from('purchase_requests').update(patch).eq('id', recent.id)

    return recent.id as string
  } catch (e) {
    console.error('[proc] batch fold failed (staging fresh):', (e as Error)?.message ?? e)
    return null
  }
}

/** Two RAW references clearly name different things (both present, neither a substring of the other). */
export function rawConflict(a: string | null, b: string | null): boolean {
  const x = (a ?? '').trim().toLowerCase()
  const y = (b ?? '').trim().toLowerCase()
  if (!x || !y) return false
  return !(x === y || x.includes(y) || y.includes(x))
}

// ── entry (NEW_INTENT) ───────────────────────────────────────────────────────

export async function runProcurementMessage(
  ctx: ProcCtx, text: string, _opts: { prefix?: string; lingering?: ConvoRow | null } = {},
): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const meta = { org_id: orgId, wamid }

  // ── PHOTO of a materials list — ONE photo is ONE request. Read the items OFF THE IMAGE
  //    (every row its own line, not a text summary), attach the photo to the request, and
  //    create the draft directly. No sourcing question; the caption is only extra context. ──
  if (ctx.image) {
    const projNames = (await loadProjects(ctx)).map((p) => p.name)
    // A supervisor often types the SITE + VENDOR as a separate message right before the photo
    // ("Chakradhar site, pattabhi traders"). The photo carries no caption of its own, so reunite that
    // preceding text as the photo's context — the SAME thing the transaction path does with a proof
    // image — otherwise the request lands "vendor/site not set" despite both being given.
    const prior = ctx.image.caption ? null : await recentInboundText(supabase, from, wamid)
    const context = [ctx.image.caption, prior].map((s) => (s ?? '').trim()).filter(Boolean).join(' · ') || null
    const read = await extractProcurementFromImage(
      ctx.image.base64, ctx.image.mime, context, projNames,
    )
    const items = read.items.length
      ? read.items
      : [{ item_name: (read.title || ctx.image.caption || text || 'Materials').trim(), quantity: null, unit: null, width_mm: null, height_mm: null, spec: null, brand: null, note: null }]

    // ── MULTI-PAGE BATCH — a materials list photographed across 2+ images arrives as 2+ separate
    //    messages seconds apart. The per-sender lock serialises them, so by the time the 2nd photo
    //    runs the 1st has already staged its PR. If a fresh draft PR from THIS sender is still open
    //    within the batch window and this page doesn't CONTRADICT it (no different vendor/site), fold
    //    this page's items into that request instead of splitting one list across two PRs. A page
    //    that names a different vendor or site is its own request → falls through to a fresh stage.
    //
    //    We STAGE/FOLD SILENTLY and tag this photo's row with the request it landed in. The confirmation
    //    is NOT sent here — the batch finalizer (index.ts, after the burst settles) sends ONE card per
    //    request, so a 3-page list reads as one "Materials requested", not three fragments. ──
    const imageUrl = await procImageUrl(ctx)
    const batched = ctx.photoBatched === true   // false when the photo-batch buffer is down (e.g. migration not run yet)
    let prId = read.items.length ? await foldIntoOpenRequest(ctx, items, read) : null
    const folded = !!prId
    if (!prId) {
      const req: ProcRequest = {
        vendor_raw: read.vendor_raw, sourcing_intent: null,
        site_raw: read.site_raw, items, title: read.title,
      }
      // Silent when the burst will be finalized elsewhere; inline card otherwise so a request is never withheld.
      prId = await handleSingle(ctx, req, imageUrl, { silent: batched })
    }
    if (!prId) return
    if (batched) {
      await setPhotoPr(ctx.supabase, ctx.wamid, prId)   // the finalizer (index.ts) confirms once the burst settles
    } else if (folded) {
      // Buffer down AND this page folded into an open request (handleSingle didn't run) → confirm inline now.
      await sendProcConfirmationById(ctx.supabase, { orgId: ctx.orgId, from: ctx.from, wamid: ctx.wamid, lang: ctx.lang, prId })
    }
    return
  }

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

  // ── single segment — NO sourcing question: create the draft request directly, like a Day Book
  //    capture. The vendor is accepted if given (never re-asked); an unclear vendor or site is a gap
  //    the reviewer fills on the request card in the PO page — the request is never withheld for it. ──
  void vendorConfident
  const reqs = await extractProcurements(text, (await loadProjects(ctx)).map((p) => p.name))
  await handleSingle(ctx, reqs[0] ?? null)
}

/** Single-request: match vendor + site (accept what's given), stage a DRAFT, confirm with the
 *  transaction-style card + a link. No sourcing prompt, no "ready for approval" — it stays a draft
 *  the office reviews and turns into a PO or a quote request from the card.
 *
 *  Returns the staged PR id (null if nothing was staged). `silent` stages WITHOUT the card or the enrich
 *  window — the photo-batch path uses it so the finalizer confirms once for the whole burst (and arms the
 *  enrich window then, off the final merged request). */
async function handleSingle(
  ctx: ProcCtx, req: ProcRequest | null, imageUrl: string | null = null, opts: { silent?: boolean } = {},
): Promise<string | null> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const meta = { org_id: orgId, wamid }
  if (!req) return null                                              // nothing parseable; leave it
  // A request with NO items is context, not an order (a caption like "glass panel materials", or a
  // "Chakradhar site" line). Never stage a 0-item ghost PR — the photo path carries its own items and
  // reunites such text as context. This kills the duplicate "0 items read" request in the inbox.
  if (!req.items || req.items.length === 0) return null

  const vendors = await loadVendors(ctx)
  const projects = await loadProjects(ctx)
  const vendorM = matchPayee(req.vendor_raw, vendors.map((v) => ({ stakeholder_id: v.stakeholder_id, name: v.name })))
  const vendorAuto = vendorM.band === 'auto'
  const vendorId = vendorAuto ? vendorM.id : null
  const vendorDisplay = vendorAuto ? vendorM.name : req.vendor_raw
  const siteM = matchProject(req.site_raw, projects)
  const siteId = siteM.band === 'auto' ? siteM.id : null
  const siteDisplay = siteId ? siteM.name : req.site_raw

  const prId = await stageRequest(ctx, req, 0, vendorId, siteId, null, imageUrl)
  if (!prId) return null

  if (opts.silent) return prId   // batch path: the finalizer sends the card + arms enrich off the merged PR

  await send(supabase, from, mProcComplete(lang, {
    title: req.title ?? titleWithCount(req),
    site: siteDisplay,
    vendor: vendorDisplay,
    vendorMatched: vendorAuto,
    siteMissing: !siteId && !req.site_raw,
    itemsLine: req.items.map((i) => i.item_name).slice(0, 6).join(', '),
    prId,
  }), meta)

  // Under-specified (no vendor and/or no site)? Leave a short PROCUREMENT lingering window so a text sent
  // RIGHT AFTER the photo ("Chakradhar site, pattabhi traders") is CLAIMED by this agent and fills the
  // gaps — instead of being routed fresh to SiteOps. Mirrors the transaction note-hold. Only when needed.
  const hasVendor = !!(vendorId || req.vendor_raw)
  const hasSite = !!(siteId || req.site_raw)
  if (!hasVendor || !hasSite) await armEnrichWindow(ctx, prId)
  return prId
}

/** Send the ONE consolidated confirmation for a request a photo burst staged, reading the FULL merged
 *  request (all pages' items, the title/vendor/site as they settled). Called by the batch finalizer in
 *  index.ts once the burst is quiet — so a multi-page list is one "Materials requested", not three. Also
 *  arms the enrich window off the final gaps, so a trailing "Chakradhar site, pattabhi traders" still lands. */
export async function sendProcConfirmationById(
  supabase: ProcCtx['supabase'],
  p: { orgId: string; from: string; wamid: string; lang: Lang; prId: string },
): Promise<void> {
  const { orgId, from, wamid, lang, prId } = p
  try {
    const { data: pr } = await supabase.from('purchase_requests')
      .select('id, title, vendor_id, vendor_raw, site_id, site_raw')
      .eq('id', prId).maybeSingle()
    if (!pr) return
    const { data: itemRows } = await supabase.from('purchase_request_items')
      .select('item_name').eq('purchase_request_id', prId).order('item_index')
    const items = (itemRows ?? []) as { item_name: string }[]
    if (items.length === 0) return   // a request with no items has no confirmation to send

    // Resolve display names off the IDs the pages matched (raw text when unmatched — a gap the card names).
    let vendorName: string | null = pr.vendor_raw ?? null
    if (pr.vendor_id) {
      const { data: v } = await supabase.from('stakeholders').select('name').eq('stakeholder_id', pr.vendor_id).maybeSingle()
      vendorName = (v?.name as string) ?? pr.vendor_raw ?? null
    }
    let siteName: string | null = pr.site_raw ?? null
    if (pr.site_id) {
      const { data: s } = await supabase.from('projects').select('name').eq('project_id', pr.site_id).maybeSingle()
      siteName = (s?.name as string) ?? pr.site_raw ?? null
    }

    const names = items.map((i) => i.item_name)
    const n = names.length
    const pItems = items as unknown as ProcItem[]
    // Mirror titleWithCount: a given title stands alone; else 1–2 items read as their names, 3+ as "header · N items".
    const title = (pr.title as string)
      ?? (n <= 2 ? names.join(', ') : `${titleFor(pItems) ?? `${n} items`} · ${n} items`)
    await send(supabase, from, mProcComplete(lang, {
      title,
      site: siteName,
      vendor: vendorName,
      vendorMatched: !!pr.vendor_id,
      siteMissing: !pr.site_id && !pr.site_raw,
      itemsLine: items.map((i) => i.item_name).slice(0, 6).join(', '),
      prId,
    }), { org_id: orgId, wamid })

    // Under-specified? Leave the same short lingering window handleSingle would, off the FINAL request — so a
    // "Chakradhar site, pattabhi traders" typed after the photos is still claimed and fills the gaps.
    const hasVendor = !!(pr.vendor_id || pr.vendor_raw)
    const hasSite = !!(pr.site_id || pr.site_raw)
    if (!hasVendor || !hasSite) {
      await openConversation(supabase, {
        orgId, sender: from, owningAgent: 'PROCUREMENT',
        pendingQuestion: 'PROC_ENRICH', stagedEntryId: prId, lastMessageId: wamid,
      })
      await closeConversation(supabase, {
        orgId, sender: from, lastActionSummary: 'PR staged — open for site/vendor', stagedEntryId: prId, lastMessageId: wamid,
      })
    }
  } catch (e) {
    console.error('[proc] batch confirmation failed:', (e as Error)?.message ?? e)
  }
}

/** Leave a closed (lingering) PROCUREMENT conversation carrying the staged PR id, so the dispatcher hands a
 *  trailing text back to enrichProcurement within the window. open→close keeps owning_agent = PROCUREMENT. */
async function armEnrichWindow(ctx: ProcCtx, prId: string): Promise<void> {
  const { supabase, from, orgId, wamid } = ctx
  await openConversation(supabase, {
    orgId, sender: from, owningAgent: 'PROCUREMENT',
    pendingQuestion: 'PROC_ENRICH', stagedEntryId: prId, lastMessageId: wamid,
  })
  await closeConversation(supabase, {
    orgId, sender: from, lastActionSummary: 'PR staged — open for site/vendor', stagedEntryId: prId, lastMessageId: wamid,
  })
}

/** A text arriving in the lingering window right after a photo request — fill the request's missing site
 *  and/or vendor from it. Returns true when it CLAIMED the text (updated the request); false to let the
 *  dispatcher route it normally (it wasn't context, or the request is already complete). */
export async function enrichProcurement(ctx: ProcCtx, prId: string, text: string): Promise<boolean> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const meta = { org_id: orgId, wamid }
  const { data: pr } = await supabase.from('purchase_requests')
    .select('vendor_id, vendor_raw, site_id, site_raw, converted_po_id').eq('id', prId).maybeSingle()
  if (!pr || pr.converted_po_id) return false
  const hasVendor = !!(pr.vendor_id || pr.vendor_raw)
  const hasSite = !!(pr.site_id || pr.site_raw)
  if (hasVendor && hasSite) return false                        // nothing to fill — let it route fresh

  const projects = await loadProjects(ctx)
  const projNames = projects.map((p) => p.name)

  // CODE-FLOOR against the "swallowed order" bug: a trailing message that itself lists MATERIALS to order
  // is a NEW request, not context for the lingering one. Never enrich (which would drop its items) — return
  // false so the dispatcher routes it fresh (→ its own PR). The context LLM alone is probabilistic here
  // (it sometimes returned the site/vendor of a full order and swallowed the items), so this is deterministic.
  const reqs = await extractProcurements(text, projNames)
  if (reqs.some((r) => r.items.length > 0)) return false

  // Pure context (a site/vendor line, no items). Prefer what the deep pass saw; else the context extractor.
  let vendorRaw = reqs[0]?.vendor_raw ?? null
  let siteRaw = reqs[0]?.site_raw ?? null
  if (!vendorRaw && !siteRaw) { const c = await extractProcContext(text, projNames); vendorRaw = c.vendor_raw; siteRaw = c.site_raw }
  const parsed = { vendor_raw: vendorRaw, site_raw: siteRaw }
  if (!parsed.vendor_raw && !parsed.site_raw) return false      // not context → fall through

  const updates: Record<string, unknown> = {}
  let siteName: string | null = null, vendorName: string | null = null
  if (!hasSite && parsed.site_raw) {
    const m = matchProject(parsed.site_raw, projects)
    if (m.band === 'auto') { updates.site_id = m.id; updates.site_raw = null; siteName = m.name }
    else { updates.site_raw = parsed.site_raw; siteName = parsed.site_raw }
  }
  if (!hasVendor && parsed.vendor_raw) {
    const vendors = await loadVendors(ctx)
    const m = matchPayee(parsed.vendor_raw, vendors.map((v) => ({ stakeholder_id: v.stakeholder_id, name: v.name })))
    if (m.band === 'auto') { updates.vendor_id = m.id; updates.vendor_raw = null; vendorName = m.name }
    else { updates.vendor_raw = parsed.vendor_raw; vendorName = parsed.vendor_raw }
  }
  if (Object.keys(updates).length === 0) return false

  await supabase.from('purchase_requests').update(updates).eq('id', prId)
  const bits = [siteName, vendorName].filter(Boolean).join(' · ')
  void lang
  await send(supabase, from, {
    kind: 'cta', body: `✓ Added to the request${bits ? ` — ${bits}` : ''}`,
    cta: { text: 'Open the request', url: `${APP_ORIGIN}/purchase-orders/pr/${prId}` },
  }, meta)

  // Still missing the other half? Re-arm so a further text can fill it too.
  const nowVendor = hasVendor || !!(updates.vendor_id || updates.vendor_raw)
  const nowSite = hasSite || !!(updates.site_id || updates.site_raw)
  if (!nowVendor || !nowSite) await armEnrichWindow(ctx, prId)
  return true
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
    items: [{ item_name: description, quantity: null, unit: null, width_mm: null, height_mm: null, spec: null, brand: null, note: null }],
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
