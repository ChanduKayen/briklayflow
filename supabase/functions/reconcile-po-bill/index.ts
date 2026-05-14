import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Anthropic from 'npm:@anthropic-ai/sdk';

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
    const body = await req.json();
    const {
      po_id,
      po_line_items,
      bill_base64,
      bill_mime_type,
      bill_url,
      bill_total,
    } = body;

    if (!po_line_items?.length) throw new Error('po_line_items is required');

    // Resolve the bill image ─────────────────────────────────────────────────
    let imageBase64: string = bill_base64 ?? '';
    let imageMime: string   = bill_mime_type ?? 'image/jpeg';

    if (!imageBase64 && bill_url) {
      const res = await fetch(bill_url);
      if (!res.ok) throw new Error(`Could not fetch bill document (HTTP ${res.status})`);
      imageBase64 = bufToBase64(await res.arrayBuffer());
      imageMime   = res.headers.get('content-type') ?? 'image/jpeg';
    }

    if (!imageBase64) throw new Error('Either bill_base64 or bill_url is required');

    // Claude only accepts these image types
    const VALID_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    type ValidType = typeof VALID_TYPES[number];
    const safeMedia: ValidType = (VALID_TYPES as readonly string[]).includes(imageMime)
      ? imageMime as ValidType
      : 'image/jpeg';

    // Build PO context ────────────────────────────────────────────────────────
    const poLines = (po_line_items as any[]).map((li: any, i: number) => {
      const spec = li.specification ? ` [spec: ${li.specification}]` : '';
      return `${i + 1}. ${li.item_name}${spec} — ${li.quantity_ordered} ${li.unit} @ ₹${li.unit_rate} = ₹${li.total_amount} (GST ${li.gst_rate ?? 0}%)`;
    }).join('\n');

    const userText = [
      `PO Reference: ${po_id ?? 'unknown'}`,
      bill_total ? `PO Grand Total: ₹${bill_total}` : null,
      '',
      'PO Line Items:',
      poLines,
      '',
      'Examine the attached vendor bill/invoice image and compare it item-by-item against the PO lines above.',
    ].filter((l): l is string => l !== null).join('\n');

    // Call Claude ─────────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system:     SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: safeMedia, data: imageBase64 },
          },
          { type: 'text', text: userText },
        ],
      }],
    });

    const textBlock = message.content.find((c: any) => c.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Unexpected AI response type');

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
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
