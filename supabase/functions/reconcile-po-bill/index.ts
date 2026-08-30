import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import OpenAI from 'https://esm.sh/openai@4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Same LLM provider/key as the other AI functions (sku-matcher, ai-extract-entry, …). Anthropic
// was never wired up as a secret for this project, so this function uses OpenAI's GPT-4o.
const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

// Service-role storage client — downloads the bill object directly, so we never depend on a
// client-minted signed URL (those were 400-ing when the stored path didn't match the object).
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a procurement audit AI for Indian construction companies.

You receive PO (Purchase Order) line items and an image of the vendor's bill/invoice.
Compare every PO line against the bill and detect ALL discrepancies.

Return ONLY valid JSON — no markdown, no explanation outside the JSON:
{
  "summary": "one-sentence verdict (e.g. '2 items overcharged, 1 ghost item — MEDIUM risk')",
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "bill_total_extracted": number or null,
  "line_matches": [
    {
      "po_line": "item name exactly as in PO",
      "bill_line": "matching text from bill, or null if not found",
      "matched": true | false,
      "flags": ["FLAG_CODE"],
      "flag_details": "plain English: what specifically differs",
      "po_qty": number,
      "bill_qty": number or null,
      "po_rate": number,
      "bill_rate": number or null,
      "po_amount": number,
      "bill_amount": number or null
    }
  ],
  "ghost_items": [
    { "item": "item name from bill not in PO", "amount": number }
  ],
  "overall_flags": ["FLAG_CODE"]
}

Flag codes:
  BRAND_STRIPPED       — bill omits brand/grade that PO specified
  GRADE_DOWNGRADE      — lower grade than PO (OPC43→OPC33, Fe500→Fe415, etc.)
  QTY_INFLATION        — bill qty > PO qty by ≥2%
  RATE_INCREASE        — bill rate > PO rate by ≥2%
  UNIT_MISMATCH        — unit changed between PO and bill (bag→MT, Nos→Set)
  GHOST_ITEM           — bill has item not in PO
  DUPLICATE_ITEM       — same item appears twice in bill
  AMOUNT_ARITHMETIC_ERROR — qty × rate ≠ bill line total by >1%
  HSN_MISMATCH         — HSN/SAC code does not match item type

Risk level rules:
  LOW    — no flags or only cosmetic differences; safe to approve payment
  MEDIUM — 1-2 flags, <5% overcharge; flag for review before payment
  HIGH   — any GHOST_ITEM, GRADE_DOWNGRADE, or total overcharge >5%; escalate`;

// EXTRACT-ONLY mode (no PO to reconcile against): just read the bill and return its lines + total.
// Used by the transactions "Attach bill" flow, where there is no existing PO yet.
const EXTRACT_PROMPT = `You are a procurement AI for Indian construction companies. You receive an image of a
vendor's bill / invoice / estimate. Read it and extract its contents.

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "vendor_name": "string or null",
  "bill_number": "string or null",
  "bill_date": "YYYY-MM-DD or null",
  "bill_total_extracted": number or null,   // the grand total payable (incl. taxes) if printed
  "gst_amount": number or null,             // total GST if shown, else null
  "line_items": [
    { "item": "standard item name", "qty": number or null, "unit": "string or null", "rate": number or null, "amount": number or null }
  ]
}

Rules: item names should be the standard industry name, not vendor shorthand. Numbers are plain
(no currency symbols/commas). If the grand total is not clearly printed, sum the line amounts. Do NOT
invent values that aren't on the bill.`;

// Convert ArrayBuffer to base64 in chunks to avoid call-stack limits
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Authenticate the caller (this function reads storage with the service role) ──
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const {
      po_id,
      po_line_items,
      bill_base64,
      bill_mime_type,
      bill_url,
      bill_bucket,
      bill_path,
      bill_total,
    } = body;

    // If a PO is named, the caller must belong to its org.
    if (po_id) {
      const { data: po } = await admin.from('purchase_orders').select('org_id').eq('po_id', po_id).maybeSingle();
      if (po?.org_id) {
        const { data: mem } = await admin.from('org_memberships').select('role')
          .eq('user_id', user.id).eq('org_id', po.org_id).eq('status', 'active').maybeSingle();
        if (!mem) return new Response(JSON.stringify({ error: "Forbidden: not a member of this PO's organisation" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // No PO lines → EXTRACT-ONLY mode (read the bill on its own). With PO lines → reconcile.
    const extractOnly = !po_line_items?.length;

    // Resolve the bill image ─────────────────────────────────────────────────
    let imageBase64: string = bill_base64 ?? '';
    let imageMime: string   = bill_mime_type ?? 'image/jpeg';

    // Preferred: download the object with the service role (no client signed URL needed).
    if (!imageBase64 && bill_bucket && bill_path) {
      const { data: blob, error: dlErr } = await admin.storage.from(bill_bucket).download(bill_path);
      if (dlErr || !blob) throw new Error(`The attached bill file is missing (${bill_path}). Re-upload it.`);
      imageBase64 = bufToBase64(await blob.arrayBuffer());
      imageMime   = blob.type || 'image/jpeg';
    }

    if (!imageBase64 && bill_url) {
      const res = await fetch(bill_url);
      if (!res.ok) throw new Error(`Could not fetch bill document (HTTP ${res.status})`);
      imageBase64 = bufToBase64(await res.arrayBuffer());
      imageMime   = res.headers.get('content-type') ?? 'image/jpeg';
    }

    if (!imageBase64) throw new Error('No bill document supplied (bill_base64, bill_bucket/bill_path, or bill_url).');

    // A bill can be a photo OR a PDF. GPT-4o's vision `image_url` cannot read a PDF — it must go in
    // as a `file` content part (file_data), which gpt-4o parses natively (same shape as sku-matcher).
    const isPdf = imageMime === 'application/pdf';
    const VALID_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const safeMedia = VALID_TYPES.includes(imageMime) ? imageMime : 'image/jpeg';
    const mediaPart: any = isPdf
      ? { type: 'file', file: { filename: 'bill.pdf', file_data: `data:application/pdf;base64,${imageBase64}` } }
      : { type: 'image_url', image_url: { url: `data:${safeMedia};base64,${imageBase64}`, detail: 'high' } };

    // Build user text ───────────────────────────────────────────────────────
    const userText = extractOnly
      ? 'Read the attached vendor bill/invoice (image or PDF) and extract its vendor, total, and line items as JSON.'
      : [
          `PO Reference: ${po_id ?? 'unknown'}`,
          bill_total ? `PO Grand Total: ₹${bill_total}` : null,
          '',
          'PO Line Items:',
          (po_line_items as any[]).map((li: any, i: number) => {
            const spec = li.specification ? ` [spec: ${li.specification}]` : '';
            return `${i + 1}. ${li.item_name}${spec} — ${li.quantity_ordered} ${li.unit} @ ₹${li.unit_rate} = ₹${li.total_amount} (GST ${li.gst_rate ?? 0}%)`;
          }).join('\n'),
          '',
          'Examine the attached vendor bill/invoice image and compare it item-by-item against the PO lines above.',
        ].filter((l): l is string => l !== null).join('\n');

    // Call GPT-4o (OpenAI) ─────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model:       'gpt-4o',
      max_tokens:  2048,
      temperature: 0.1,
      messages: [
        { role: 'system', content: extractOnly ? EXTRACT_PROMPT : SYSTEM_PROMPT },
        { role: 'user',   content: [mediaPart, { type: 'text', text: userText }] as any },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const jsonMatch = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const result = JSON.parse(jsonMatch[0]);

    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
