import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import OpenAI from 'https://esm.sh/openai@4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { auditLines } from './_lineAudit.ts';
import { parseModelJson } from './_parseJson.ts';
import { openAIMediaPart, anthropicMediaPart, isPdf } from '../_shared/visionDoc.ts';

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

// QUOTE mode — read a VENDOR'S QUOTATION against the exact list of items the buyer asked to be quoted.
//
// Unlike EXTRACT_PROMPT (which reads a payable blind), this is given the enquiry's lines up front, so the
// MODEL does the matching — semantically, by meaning — and returns a rate PER REQUESTED LINE (by number),
// plus the terms of the offer and any extra lines the vendor added. That is what the RFQ compare page needs:
// like-for-like rates aligned to the asked items, with variants flagged.
const QUOTE_PROMPT = `You are reading a VENDOR'S QUOTATION — a supplier's price offer sent in reply to a request for rates from an Indian construction company. It may be a typed quotation, a printed estimate, a handwritten rate chit, a photographed WhatsApp price list, or a screenshot. Typed or handwritten, any language or a mixture, sharp or badly shot, one page or several.

You are ALSO given the exact list of items the buyer asked to be quoted, each with a line number, a unit and a quantity. Your job: for EACH requested line, find the vendor's rate on this paper, and report the terms of the offer.

MATCH BY MEANING, not by spelling. A vendor writes items their own way — short forms, brand first, a local or slang name, a different order, extra words. Align each requested line to the vendor's line that means the SAME material. Use the spec and the unit to tell close things apart: "Cement OPC 43" and "OPC 53" are DIFFERENT lines; "8mm rod" and "10mm rod" are different; a size or grade that differs is not a match — it is a variant.

FOR EACH REQUESTED LINE, return an object:
  · line        — the requested line number, echoed back.
  · matched     — true if this paper prices this SAME material (same type/grade/spec); false otherwise.
  · supplied    — true if the vendor gives a price for it. false if the vendor explicitly says N.A. / "not supplying". A line the paper simply does not mention → matched:false, supplied:false, unit_rate:null.
  · unit_rate   — the vendor's price for ONE of the BUYER'S requested unit. If the vendor quotes in a DIFFERENT unit, convert to the asked unit ONLY when the conversion is unambiguous, and say so in variant_note; if you cannot convert safely, give the vendor's own rate and put the unit they used in variant_note.
  · unit        — the unit the vendor's price is written in.
  · amount      — the printed line total if the paper shows one for this line, else null.
  · rate_basis  — "per_unit" when the price is for one unit; "lot" when the printed price covers the whole line/lot regardless of quantity ("Door set — 4 Nos — 8000" where 8000 is the total).
  · variant_note — a SHORT note ONLY when the vendor's offer is NOT like-for-like with what was asked: a different brand/grade/spec/size, a different unit, a lot price, a minimum order, or a condition attached to that line. Else null. This is the warning that the number is not directly comparable.

ALSO return:
  · extra_lines  — priced lines ON THE PAPER that are NOT any of the requested items (things the vendor added). Each { "item": string, "unit_rate": number or null, "unit": string or null, "amount": number or null }.
  · vendor_name  — who is quoting (the supplier / shop / person), or null.
  · quote_total  — the grand total the paper prints, or null.
  · transport_included — true / false / null: does the quote say delivery, freight or transport is included?
  · gst_included — true / false / null: are the rates inclusive of GST / tax?
  · valid_days   — how many days the quote is valid, if stated, else null.
  · vendor_note  — any overall condition the vendor states (payment terms, minimum order, "rates firm 7 days", advance), or null.

NEVER invent a rate. If a requested line has no price on the paper, unit_rate is null and supplied is false — do not guess it from a similar item. Numbers are plain: no currency symbol, no thousands separator, a decimal point only if the paper has one.

Return ONLY a JSON object, no markdown fence and no prose:
{
  "vendor_name": string or null, "quote_total": number or null,
  "transport_included": boolean or null, "gst_included": boolean or null,
  "valid_days": number or null, "vendor_note": string or null,
  "lines": [ { "line": number, "matched": boolean, "supplied": boolean, "unit_rate": number or null,
              "unit": string or null, "amount": number or null, "rate_basis": "per_unit" or "lot",
              "variant_note": string or null } ],
  "extra_lines": [ { "item": string, "unit_rate": number or null, "unit": string or null, "amount": number or null } ]
}`;

interface RfqAskItem { line?: number; item_name?: string; spec?: string; unit?: string; qty?: number | string }

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

// Several media parts can ride in ONE message — so a quote shot across pages, or a mix of photos and a PDF,
// is read together as a single document. The per-part builders are the shared visionDoc helpers.
const MAX_FILES = 8;

// Read documents with the best model FOR THIS JOB. A bill / quotation is often HANDWRITTEN and densely
// tabular, so we use OpenAI's stronger gpt-4.1 (the same model the WhatsApp procurement reader already uses
// for handwritten indents) rather than gpt-4o. All env-tunable. An Anthropic path is used ONLY if an
// ANTHROPIC_API_KEY is configured (none by default) — otherwise it is pure OpenAI, exactly as before.
const ANTHROPIC_KEY       = Deno.env.get('ANTHROPIC_API_KEY');
const DOC_MODEL_ANTHROPIC = Deno.env.get('RECONCILE_DOC_MODEL')    ?? 'claude-sonnet-4-20250514';
const DOC_MODEL_OPENAI    = Deno.env.get('RECONCILE_OPENAI_MODEL') ?? 'gpt-4.1';

type MediaRaw = { base64: string; mime: string };

/** One document read. Prefers Anthropic Claude (stronger on handwriting) when its key is set; otherwise
 *  OpenAI gpt-4o. `prior` carries a follow-up turn (the missed-page re-read). Returns the raw model text. */
async function visionExtract(
  system: string, userText: string, media: MediaRaw[], maxTokens: number, temperature: number,
  prior?: { assistant: string; followup: string },
): Promise<string> {
  if (ANTHROPIC_KEY) {
    try {
      const messages: any[] = [{ role: 'user', content: [...media.map((m) => anthropicMediaPart(m.base64, m.mime)), { type: 'text', text: userText }] }];
      if (prior) { messages.push({ role: 'assistant', content: prior.assistant }); messages.push({ role: 'user', content: prior.followup }); }
      const anyPdf = media.some((m) => isPdf(m.mime));
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(anyPdf ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {}) },
        body: JSON.stringify({ model: DOC_MODEL_ANTHROPIC, max_tokens: maxTokens, temperature, system, messages }),
      });
      if (res.ok) return ((await res.json()).content?.[0]?.text ?? '').trim();
      console.error('[reconcile] anthropic', res.status, (await res.text()).slice(0, 300));   // fall through to OpenAI
    } catch (e) { console.error('[reconcile] anthropic error, falling back to OpenAI:', (e as Error)?.message ?? e); }
  }
  const messages: any[] = [
    { role: 'system', content: system },
    { role: 'user', content: [...media.map((m) => openAIMediaPart(m.base64, m.mime)), { type: 'text', text: userText }] },
  ];
  if (prior) { messages.push({ role: 'assistant', content: prior.assistant }); messages.push({ role: 'user', content: prior.followup }); }
  const completion = await openai.chat.completions.create({
    model: DOC_MODEL_OPENAI, max_tokens: maxTokens, temperature, response_format: { type: 'json_object' }, messages: messages as any,
  });
  return completion.choices[0]?.message?.content?.trim() ?? '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Read the body first so an INTERNAL caller (another edge function) can present a shared secret.
    const authHeader = req.headers.get('Authorization') ?? '';
    const body = await req.json();
    const {
      po_id,
      po_line_items,
      rfq_items,
      bill_base64,
      bill_mime_type,
      bill_files,
      bill_url,
      bill_bucket,
      bill_path,
      bill_total,
      internal_secret,
    } = body;

    // ── Authenticate the caller (this function reads storage with the service role) ──
    // INTERNAL: the WhatsApp webhook (service role, no user session) reads a vendor's quote reply and calls
    // QUOTE mode. It presents the service-role key as internal_secret → skip the user-session check. Every
    // other caller still needs a real user JWT, exactly as before.
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const internal = !!internal_secret && !!SERVICE_KEY && internal_secret === SERVICE_KEY;
    let user: { id: string } | null = null;
    if (!internal) {
      if (!authHeader) return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user: u }, error: userErr } = await userClient.auth.getUser();
      if (userErr || !u) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      user = u;
    }

    // QUOTE mode — the caller gave the enquiry's asked lines; read a vendor quotation against them.
    const quoteMode = Array.isArray(rfq_items) && rfq_items.length > 0;

    // If a PO is named, the caller must belong to its org (internal service callers are already trusted).
    if (po_id && user) {
      const { data: po } = await admin.from('purchase_orders').select('org_id').eq('po_id', po_id).maybeSingle();
      if (po?.org_id) {
        const { data: mem } = await admin.from('org_memberships').select('role')
          .eq('user_id', user.id).eq('org_id', po.org_id).eq('status', 'active').maybeSingle();
        if (!mem) return new Response(JSON.stringify({ error: "Forbidden: not a member of this PO's organisation" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // No PO lines → EXTRACT-ONLY mode (read the bill on its own). With PO lines → reconcile.
    // QUOTE mode overrides both.
    const extractOnly = !quoteMode && !po_line_items?.length;

    // Resolve the document(s) → one or more OpenAI media parts ────────────────
    // MULTI: a quote (or bill) can arrive as SEVERAL images sent together — read them as ONE document in a
    // single call. SINGLE: the existing base64 / storage-object / URL paths, unchanged.
    let mediaRaw: MediaRaw[] = [];
    if (Array.isArray(bill_files) && bill_files.length) {
      mediaRaw = (bill_files as { base64?: string; mime?: string }[])
        .filter((f) => f?.base64)
        .slice(0, MAX_FILES)
        .map((f) => ({ base64: f.base64 as string, mime: f.mime || 'image/jpeg' }));
    }

    if (mediaRaw.length === 0) {
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

      if (!imageBase64) throw new Error('No bill document supplied (bill_files, bill_base64, bill_bucket/bill_path, or bill_url).');
      mediaRaw = [{ base64: imageBase64, mime: imageMime }];
    }

    // Build user text ───────────────────────────────────────────────────────
    const userText = quoteMode
      ? [
          'Items the buyer asked to be quoted — find the vendor\'s rate for EACH, by its line number:',
          (rfq_items as RfqAskItem[]).map((it) => {
            const spec = it.spec ? ` [spec: ${it.spec}]` : '';
            const qty = it.qty != null && it.qty !== '' ? ` — ${it.qty}${it.unit ? ' ' + it.unit : ''}` : (it.unit ? ` — per ${it.unit}` : '');
            return `${it.line}. ${it.item_name}${spec}${qty}`;
          }).join('\n'),
          '',
          'Read the attached vendor quotation — every page — and return the JSON described above: a rate per requested line (matched by meaning), the offer\'s terms, and any extra priced lines not in this list.',
        ].join('\n')
      : extractOnly
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

    // Read the document with the best available model (Anthropic Claude preferred; gpt-4o fallback). The
    // JSON-only discipline is in the prompts (and OpenAI's response_format); a surprising document still
    // answers as the JSON object, never a paragraph.
    const system = quoteMode ? QUOTE_PROMPT : extractOnly ? EXTRACT_PROMPT : SYSTEM_PROMPT;
    const raw = await visionExtract(system, userText, mediaRaw, 8000, 0.1);
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
        const followup =
          `Your lines add up to ${audit.lineSum}. Even allowing for the most tax this paper ` +
          `could be carrying, an amount payable of ${audit.total} needs at least ${audit.basic} ` +
          `of lines to explain it, so about ${audit.missing} is unaccounted for. That is ` +
          `usually a page you stopped before, or a second document inside the same file. Go ` +
          `through EVERY page again and return the complete JSON, with every line from every ` +
          `document, each tagged with its source_doc. Do not merge lines that repeat. If the ` +
          `paper genuinely itemises no more than you already found — the rest being arrears, a ` +
          `previous balance or a charge it never broke down — return what you have unchanged.`;
        const rawRetry = await visionExtract(EXTRACT_PROMPT, userText, mediaRaw, 8000, 0, { assistant: raw, followup });
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
