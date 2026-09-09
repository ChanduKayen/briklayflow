import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import OpenAI from 'https://esm.sh/openai@4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { auditLines } from './_lineAudit.ts';
import { parseModelJson } from './_parseJson.ts';

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

// EXTRACT-ONLY mode (no PO to reconcile against): read the paper and report what it says.
//
// This prompt used to describe the document instead of the job — "a procurement AI for Indian
// construction companies", reading "a vendor's bill / invoice / estimate", finding "Tax Invoice"
// pages and "e-Way bills", naming items by "the standard industry name". Given a materials invoice
// that worked. Given an electricity bill, a rent receipt or a handwritten hardware chit, the model
// had been told so firmly what the paper was that it answered about the mismatch instead of
// answering the question — prose, not JSON, and the reader failed with "No JSON found".
//
// So it no longer says what the paper is. It says what to look for on any paper somebody has to
// pay, and takes the document's own vocabulary as it finds it.
const EXTRACT_PROMPT = `You are reading a piece of paper that somebody has to pay, or has paid.

It could be anything: a printed tax invoice, an electricity or water or telecom bill, a rent or hire
receipt, a freight note, a delivery challan priced in ink, a handwritten chit from a shop, a repair
estimate, a statement of account, a photographed message asking for money. Typed or handwritten,
stamped or scrawled, in any language or a mixture, sharp or badly photographed. One page or many —
and one file may hold several separate documents.

Read it the way a person would, on its own terms, and report what it says. Do not decide in advance
what kind of document it ought to be, and never force what you see into the shape of a materials
invoice.

FOUR THINGS MATTER, and nearly every such paper carries them under some name:

  WHO IS OWED   the issuer, biller, supplier, shop, landlord, contractor, department or person —
                whatever the paper puts at its head or signs at its foot. NOT the customer, not the
                consumer, not the "bill to" party. The one being PAID.
  HOW MUCH      the one amount payable, after every tax, charge, rebate, subsidy, arrear and
                rounding the paper itself applies. Whatever it calls it: amount payable, net
                payable, grand total, total due, balance, or a figure circled by hand.
  WHEN          the date the paper carries as its own — invoice date, bill date, reading date, the
                date written by hand. Not the due date, unless that is the only date on it.
  WHAT FOR      whatever the paper itemises, in the paper's own words.

WHAT COUNTS AS AN ITEM
Any priced line the document lists. Often that is goods with a quantity and a rate. Just as often it
is none of those:
  · a service, a job or a period — "Rent — Sept 2026", "AMC 1 Apr to 31 Mar"
  · a charge on a utility bill — energy charge, fixed charge, meter rent, duty, fuel adjustment,
    late payment surcharge, arrears, previous balance
  · a reading-based charge — units consumed at a tariff
  · a DEDUCTION, which is negative — subsidy, rebate, discount, advance adjusted, credit note
  · one line that is the whole job — "Painting work as agreed — 45000"
If the paper itemises nothing — a chit carrying only a name and a figure — return an empty list. An
empty list is a correct answer. Never invent a line to fill it.

NAME EACH ITEM AS THE PAPER NAMES IT. Copy its words, tidied only of obvious abbreviation and OCR
noise. Do not translate it into a catalogue name, do not classify it, do not add a word the paper
does not have.

MORE THAN ONE PAGE, MORE THAN ONE DOCUMENT
Read every page to the end before answering. One file often holds several documents: several
invoices; a bill and its receipt; an invoice and its transport page; a statement listing many bills.
Where several of them each charge for something —
  · return the lines of EVERY one, in page order, each tagged with the document it came from;
  · never merge, deduplicate or collapse lines that look alike — the same thing at the same price on
    two documents is two lines, and repetition is normal;
  · the amount payable is the sum across them;
  · a page that only repeats another page's value — a transport or e-way page, a duplicate copy, a
    payment acknowledgement — adds no lines. Use it only to confirm a number or a date.

WHEN SOMETHING IS NOT THERE
Return null. Do not guess it, do not compute a plausible value, do not carry a number over from
another field because it looks similar. A missing bill number is null — not the account number,
unless the account or consumer number is the only reference the paper carries, in which case use it
and say what it is called.

OUTPUT
Return ONLY a JSON object. No markdown fence, no sentence before or after it, no apology, and no
explanation of what the document is. Whatever the paper turns out to be, and however little of it
you can read, the answer is this object, with null wherever you could not read:

{
  "doc_type": "what this paper appears to be, in a few of your own words",
  "vendor_name": "who is to be paid, or null",
  "bill_number": "the paper's own reference, or null",
  "reference_kind": "what that reference is called on the paper (invoice no, consumer no, receipt no, …), or null",
  "bill_date": "YYYY-MM-DD, or null",
  "period": "the period it covers, if it states one, else null",
  "bill_total_extracted": number or null,
  "tax_amount": number or null,
  "gst_amount": number or null,
  "line_items": [
    { "item": "the line as the paper words it", "qty": number or null, "unit": "string or null",
      "rate": number or null, "amount": number or null, "rate_basis": "per_unit" or "lot",
      "source_doc": "which document in the file this line came from, or null if there is only one" }
  ]
}

Numbers are plain: no currency symbol, no thousands separator, a decimal point only if the paper has
one, and a MINUS SIGN on anything deducted.

PRICING BASIS
"amount" is always the printed total of that line, exactly as written.
  "per_unit" — the rate is the price of ONE unit, and amount = qty x rate.
  "lot"      — the printed price covers the whole line however many it covers ("Door set — 4 Nos —
               8000" where 8000 is the total, not per door), or there is no quantity at all (rent, a
               fixed charge, a lump-sum job). Put the whole price in "amount"; set rate = amount /
               qty, or null.
Never multiply a lot price by its quantity.

BEFORE YOU ANSWER
Add your line amounts up. If they, together with the tax and charges the paper prints, cannot reach
the amount payable, you have most likely stopped before the last page or missed a second document in
the file — go back through it and add what you skipped. A shortfall the paper itself explains
(arrears, a previous balance, a charge it never itemised) is fine and needs no line.`;

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
      ? 'Read the attached document — every page of it — and return the JSON described above: who is to be paid, the amount payable, the date, and whatever it itemises.'
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
      // The model answers in JSON or not at all. Without this a document that surprises it — an
      // electricity bill where it expected an invoice — comes back as a paragraph explaining itself.
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: extractOnly ? EXTRACT_PROMPT : SYSTEM_PROMPT },
        { role: 'user',   content: [mediaPart, { type: 'text', text: userText }] as any },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    let result = parseModelJson(raw);

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
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: EXTRACT_PROMPT },
            { role: 'user', content: [mediaPart, { type: 'text', text: userText }] as any },
            { role: 'assistant', content: raw },
            { role: 'user', content:
              `Your lines add up to ${audit.lineSum}. Even allowing for the most tax this paper ` +
              `could be carrying, an amount payable of ${audit.total} needs at least ${audit.basic} ` +
              `of lines to explain it, so about ${audit.missing} is unaccounted for. That is ` +
              `usually a page you stopped before, or a second document inside the same file. Go ` +
              `through EVERY page again and return the complete JSON, with every line from every ` +
              `document, each tagged with its source_doc. Do not merge lines that repeat. If the ` +
              `paper genuinely itemises no more than you already found — the rest being arrears, a ` +
              `previous balance or a charge it never broke down — return what you have unchanged.` },
          ],
        });
        const rawRetry = retry.choices[0]?.message?.content?.trim() ?? '';
        try {
          const second = parseModelJson(rawRetry);
          // Keep the second reading only if it actually accounts for more of the paper.
          if (auditLines(second).lineSum > audit.lineSum) result = second;
        } catch { /* keep the first reading */ }
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
