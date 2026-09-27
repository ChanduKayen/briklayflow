// Inbound VENDOR QUOTE reply — a vendor answers an RFQ on the WhatsApp number.
//
// send-rfq WhatsApps each vendor a tokenised link to enter rates. Many vendors just reply on WhatsApp with a
// photo of their quotation instead. This reads that photo AGAINST the enquiry's asked lines (reconcile-po-bill
// QUOTE mode, line-aligned by meaning) and records it on the vendor's recipient via submit_rfq_quote — exactly
// as if they'd used their link — then thanks them. Their reply opened a 24h window, so a plain text ack lands.
import { normalize, signedMediaUrl } from './_normalize.ts'
import { send } from './_format.ts'

const SOURCE_TTL = 315_360_000   // ~10y signed URL, matches the PR/proof image path

const QUOTE_LINK_BASE = Deno.env.get('WA_QUOTE_LINK_BASE') ?? 'https://www.briklay.app/quote'

export interface VendorQuoteInbound {
  from: string
  wamid: string
  message: any
  recipient: {
    recipient_id: string; rfq_id: string; org_id: string; token: string
    vendor_name: string | null; stakeholder_id: string | null; items: any[]
  }
}

/** Digit-form variants of an inbound WhatsApp number, to match rfq_recipients.vendor_phone (which send-rfq
 *  stores digits-only, leading-zeros stripped, `91`-prefixed for a bare 10-digit Indian mobile). */
export function phoneCandidates(from: string): string[] {
  const d = String(from || '').replace(/\D/g, '').replace(/^0+/, '')
  const set = new Set<string>()
  if (d) set.add(d)
  if (d.length === 10) set.add('91' + d)
  if (d.length === 12 && d.startsWith('91')) set.add(d.slice(2))
  return [...set]
}

export async function handleVendorQuote(supabase: any, inb: VendorQuoteInbound): Promise<void> {
  const { from, wamid, message, recipient } = inb
  const meta = { org_id: recipient.org_id, wamid }
  const link = `${QUOTE_LINK_BASE}/${recipient.token}`
  const who = (recipient.vendor_name || 'there').split(' ')[0]
  const items = recipient.items ?? []

  let norm: any = null
  try { norm = await normalize(supabase, message, { orgId: recipient.org_id, from, wamid }) }
  catch (e) { console.error('[rfq-inbound] normalize failed:', (e as Error)?.message ?? e) }

  const img = norm?.image
  // No photo/PDF (a bare text) → point them to their link. Their inbound opened a 24h window, so text lands.
  if (!img?.base64) {
    await send(supabase, from, { kind: 'text', body: `Thanks ${who}! To send your quote, reply with a photo or PDF of your rates — or enter them here (no login): ${link}` }, meta)
    return
  }

  // Keep the ORIGINAL file on the enquiry so the buyer can open and verify it (matters most for a handwritten
  // chit). Do this FIRST and independent of extraction — even if the read fails, the paper is there to check.
  const storagePath = (norm?.attachments?.[0] as { storage_path?: string } | undefined)?.storage_path
  if (storagePath) {
    try {
      const url = await signedMediaUrl(supabase, storagePath, SOURCE_TTL)
      if (url) await supabase.rpc('rfq_add_source_url', { p_token: recipient.token, p_url: url })
    } catch (e) { console.error('[rfq-inbound] source-url link failed (non-fatal):', (e as Error)?.message ?? e) }
  }

  // Read the quote against the asked lines (context-aware, line-aligned, terms captured).
  const askItems = items.map((it: any) => ({ line: it.line, item_name: it.item_name, spec: it.spec ?? null, unit: it.unit ?? null, qty: it.qty ?? null }))
  let res: any = null
  try {
    const { data, error } = await supabase.functions.invoke('reconcile-po-bill', {
      body: { rfq_items: askItems, bill_base64: img.base64, bill_mime_type: img.mime, internal_secret: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') },
    })
    if (error) throw error
    res = data
  } catch (e) { console.error('[rfq-inbound] extract failed:', (e as Error)?.message ?? e) }

  if (!res || res.ok === false || !Array.isArray(res.lines)) {
    await send(supabase, from, { kind: 'text', body: `Thanks ${who} — I couldn't read the rates off that. Please resend a clearer photo, or enter them here: ${link}` }, meta)
    return
  }

  // Line-aligned rates (honouring lot/per-unit like the compare page's photo path), then record by token.
  const byLine = new Map<number, any>((res.lines as any[]).map((l) => [Number(l.line), l]))
  let total = 0; let priced = 0
  const p_lines = items.map((it: any) => {
    const qty = Number(it.qty) || 0
    const m = byLine.get(it.line)
    let rate: number | null = null
    const variant = (m?.variant_note ?? '').toString().trim()
    if (m && m.supplied !== false && (m.unit_rate != null || m.amount != null)) {
      const amt = m.amount != null ? Number(m.amount) : null
      const unit = m.unit_rate != null ? Number(m.unit_rate) : null
      if (m.rate_basis === 'lot') rate = amt != null && qty > 0 ? amt / qty : unit
      else rate = unit != null ? unit : (amt != null && qty > 0 ? amt / qty : null)
    }
    const ok = rate != null && isFinite(rate)
    if (ok) { total += (rate as number) * qty; priced++ }
    return { line: it.line, item_name: it.item_name, unit_rate: ok ? Math.round((rate as number) * 100) / 100 : null, supplied: ok, variant_note: variant || null }
  })

  const p_extras = {
    transport_included: res.transport_included === true,
    gst_included: res.gst_included === true,
    valid_days: res.valid_days != null ? Number(res.valid_days) : null,
    vendor_note: (res.vendor_note ?? '').toString().trim() || null,
    quoted_total: total,
  }

  // MERGE (not replace) — a quote sent as several images accumulates page by page instead of the last one
  // wiping the rest. A single-message multi-page PDF is read whole, so it merges its lines in one call too.
  const { data: sub, error: subErr } = await supabase.rpc('merge_rfq_quote', { p_token: recipient.token, p_lines, p_extras })
  if (subErr || (sub as any)?.ok === false) {
    console.error('[rfq-inbound] merge failed:', subErr?.message ?? (sub as any)?.error)
    await send(supabase, from, { kind: 'text', body: `Thanks ${who} — got your quote but couldn't save it just now. Please try your link: ${link}` }, meta)
    return
  }

  await send(supabase, from, { kind: 'text', body: `Got it, ${who} — recorded your rates for ${priced} item${priced === 1 ? '' : 's'}. Thank you! To change anything, use your link: ${link}` }, meta)
}
