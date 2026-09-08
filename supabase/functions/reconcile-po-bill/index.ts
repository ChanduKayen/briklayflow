import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import OpenAI from 'https://esm.sh/openai@4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { auditLines } from './_lineAudit.ts';

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

You receive PO (Purchase Order) line items and the vendor's bill/invoice — a photo, or a PDF that
MAY RUN TO MANY PAGES and hold SEVERAL invoices, each followed by its own e-Way bill page.
Read every page to the end. Every "Tax Invoice" page carries its own line items, and the same
material billed twice on two invoices is two bill lines, never one. Compare every PO line against
everything the bill charges for, across all of it, and detect ALL discrepancies.

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
      "bill_amount": number or null,
      "rate_basis": "per_unit" or "lot"
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
  AMOUNT_ARITHMETIC_ERROR — for a PER-UNIT line only, qty × rate ≠ bill line total by >1% (never flag a lot-priced line, where the price is for the whole lot)
  HSN_MISMATCH         — HSN/SAC code does not match item type

PRICING BASIS (do not always assume per-piece):
  "bill_amount" is ALWAYS the true printed total for that bill line, exactly as written.
  rate_basis = "per_unit" when bill_rate is the price of ONE unit (bill_amount = bill_qty × bill_rate).
  rate_basis = "lot" when the printed price is for the WHOLE line/lot regardless of qty (e.g.
  "Door set — 4 Nos — ₹8,000" where ₹8,000 is the total, not per door). For a lot line put the whole
  price in bill_amount and set bill_rate = bill_amount / bill_qty (or null). NEVER multiply a lot price
  by qty, and never raise AMOUNT_ARITHMETIC_ERROR on a lot line.

Risk level rules:
  LOW    — no flags or only cosmetic differences; safe to approve payment
  MEDIUM — 1-2 flags, <5% overcharge; flag for review before payment
  HIGH   — any GHOST_ITEM, GRADE_DOWNGRADE, or total overcharge >5%; escalate`;

// EXTRACT-ONLY mode (no PO to reconcile against): just read the bill and return its lines + total.
// Used by the transactions "Attach bill" flow, where there is no existing PO yet.
const EXTRACT_PROMPT = `You are a procurement AI for Indian construction companies. You receive a
vendor's bill / invoice / estimate — a photo, or a PDF that MAY RUN TO MANY PAGES. Read ALL of it and
extract its contents.

THE DOCUMENT IS OFTEN MORE THAN ONE PAGE, AND OFTEN MORE THAN ONE INVOICE.
A single upload from an Indian vendor is routinely a PDF holding several tax invoices, each followed
by its own e-Way bill page. You must read EVERY page to the end before answering.

  · Go page by page. Every "Tax Invoice" page you find is a separate document with its own number,
    its own date and its OWN line items.
  · Return the line items from EVERY invoice on EVERY page, in page order. A four-page PDF with
    three invoices of one line each returns THREE line items — never one.
  · NEVER merge, deduplicate or collapse lines that look alike. The same material at the same rate
    on two different invoices is TWO lines, not one. Repetition is normal and must be preserved.
  · Ignore e-Way bill pages for line items — they repeat the invoice value, they do not add goods.
    Use them only to confirm an invoice number or a date.

Return ONLY valid JSON — no markdown, no prose outside the JSON:
{
  "vendor_name": "string or null",
  "bill_number": "string or null",           // several invoices → join their numbers, e.g. "3445/3446/3455"
  "bill_date": "YYYY-MM-DD or null",         // several invoices → the latest date
  "bill_total_extracted": number or null,    // grand total payable incl. taxes — the SUM across every invoice in the file
  "gst_amount": number or null,              // total GST across every invoice, else null
  "line_items": [
    { "item": "standard item name", "qty": number or null, "unit": "string or null", "rate": number or null,
      "amount": number or null, "rate_basis": "per_unit" or "lot",
      "source_doc": "the invoice number this line came from, or null if the file holds only one invoice" }
  ]
}

Rules: item names should be the standard industry name, not vendor shorthand. Numbers are plain
(no currency symbols/commas). Do NOT invent values that aren't on the bill.

BEFORE YOU ANSWER, CHECK YOUR OWN ARITHMETIC:
  Σ(line amounts) + total GST should equal bill_total_extracted. If it falls short, you have almost
  certainly missed an invoice or a page — go back through the file and add the lines you skipped.
  (Example: three invoices totalling 29,500 + 29,500 + 14,750 = 73,750 gross must return three
  lines summing to 62,500 basic, with 11,250 GST — not a single line of 25,000.)

PRICING BASIS (critical — do not always assume per-piece):
- "amount" is ALWAYS the true printed total for that line, exactly as written on the bill.
- rate_basis = "per_unit" when the rate is the price of ONE unit and the line total = qty × rate.
- rate_basis = "lot" when the printed price is for the WHOLE line/lot regardless of qty (e.g. one
  "Door set — 4 Nos — ₹8,000" line where ₹8,000 is the total, not per door). For a lot line, put the
  whole-line price in "amount" and set rate = amount / qty (or null if qty unknown). NEVER multiply a
  lot price by qty.`;

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
      max_tokens:  8000,
      temperature: 0.1,
      messages: [
        { role: 'system', content: extractOnly ? EXTRACT_PROMPT : SYSTEM_PROMPT },
        { role: 'user',   content: [mediaPart, { type: 'text', text: userText }] as any },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const jsonMatch = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    let result = JSON.parse(jsonMatch[0]);

    // ── The arithmetic is the proof that every page was read ────────────────────
    //
    // A vendor's upload is routinely one PDF holding three tax invoices, each with its own e-Way
    // bill page. The failure we actually saw was the reader returning the FIRST invoice's single
    // line while correctly summing all three totals — so the header said ₹73,750 and the lines said
    // ₹25,000, and two thirds of the goods were silently missing.
    //
    // That gap is detectable without another opinion: the printed lines, plus GST, must reconcile to
    // the grand total. When they fall materially short we know pages were skipped, so we say exactly
    // what is missing and ask once more — once, and only when it already found SOME lines, since a
    // bill with no itemisation at all is a different thing and re-reading it would find nothing.
    if (extractOnly) {
      const audit = auditLines(result);
      if (audit.retry) {
        const retry = await openai.chat.completions.create({
          model: 'gpt-4o', max_tokens: 8000, temperature: 0,
          messages: [
            { role: 'system', content: EXTRACT_PROMPT },
            { role: 'user', content: [mediaPart, { type: 'text', text: userText }] as any },
            { role: 'assistant', content: raw },
            { role: 'user', content:
              `Your line items add up to ${audit.lineSum}, but this document's goods come to ` +
              `${audit.basic} before tax (grand total ${audit.total}). You have missed ` +
              `${audit.missing} worth of lines — almost certainly a later page, or a second or ` +
              `third tax invoice inside the same file. Go through EVERY page again and return the ` +
              `complete JSON with every line from every invoice, each tagged with its source_doc. ` +
              `Do not merge lines that repeat.` },
          ],
        });
        const rawRetry = retry.choices[0]?.message?.content?.trim() ?? '';
        const m2 = rawRetry.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').match(/\{[\s\S]*\}/);
        if (m2) {
          try {
            const second = JSON.parse(m2[0]);
            // Keep the second reading only if it actually accounts for more of the bill.
            if (auditLines(second).lineSum > audit.lineSum) result = second;
          } catch { /* keep the first reading */ }
        }
      }
    }

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
