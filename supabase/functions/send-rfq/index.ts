// send-rfq — request a quotation from vendors.
//
// Three modes:
//   NEW    : { orgId, projectId, deliveryLocation, quoteBy, items, recipients } → create an RFQ +
//            a recipient per vendor (each a token), WhatsApp the request_for_quotation template.
//   APPEND : { rfqId, recipients } → add more vendors to an existing RFQ and send to them.
//   RESEND : { rfqId, resendRecipientId } → re-send to one existing recipient (its token).
//
// Auth: caller must be an active management/principal member of the RFQ's org.
//
// DEPLOY: supabase functions deploy send-rfq · needs WA_* secrets and the approved template.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendTemplate } from '../_shared/whatsapp.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface RfqItem { line?: number; item_name?: string; unit?: string; qty?: number | string; spec?: string }
interface Recipient { stakeholderId?: string | null; name?: string; phone?: string }

function itemsSummary(items: RfqItem[]): string {
  const names = items.map((i) => (i.item_name ?? '').trim()).filter(Boolean);
  const n = names.length;
  if (n === 0) return `${items.length} item(s)`;
  if (n <= 2) return `${names.join(', ')} (${n} item${n > 1 ? 's' : ''})`;
  return `${names.slice(0, 2).join(', ')} +${n - 2} more (${n} items)`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ ok: false, error: 'Missing authorization' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: 'Invalid session' }, 401);

    const body = await req.json() as {
      orgId?: string; projectId?: string; deliveryLocation?: string; quoteBy?: string;
      items?: RfqItem[]; recipients?: Recipient[]; rfqId?: string; resendRecipientId?: string;
    };

    // Resolve the RFQ (existing for APPEND/RESEND, or create for NEW) → org, items, delivery.
    let orgId = body.orgId ?? '';
    let items: RfqItem[] = body.items ?? [];
    let deliveryLocation = body.deliveryLocation ?? '';
    let rfqId = body.rfqId ?? '';

    if (rfqId) {
      const { data: rfq } = await admin.from('rfqs').select('org_id, items, delivery_location').eq('rfq_id', rfqId).maybeSingle();
      if (!rfq) return json({ ok: false, error: 'Enquiry not found' }, 404);
      orgId = rfq.org_id;
      items = (rfq.items ?? []) as RfqItem[];
      deliveryLocation = rfq.delivery_location ?? '';
    }
    if (!orgId) return json({ ok: false, error: 'orgId is required' }, 400);

    const { data: mem } = await admin.from('org_memberships').select('role')
      .eq('user_id', user.id).eq('org_id', orgId).eq('status', 'active')
      .in('role', ['management', 'principal']).maybeSingle();
    if (!mem) return json({ ok: false, error: 'Forbidden: only management or principal can request quotes' }, 403);

    let builderName = 'Your builder';
    const { data: org } = await admin.from('organizations').select('name').eq('org_id', orgId).maybeSingle();
    if (org?.name) builderName = org.name;
    const summary = itemsSummary(items);
    const address = (deliveryLocation ?? '').trim() || 'the site';
    const wa = (dest: string, name: string, token: string) => sendTemplate('request_for_quotation', dest, {
      vendor_name: name, builder_name: builderName, items_summary: summary, delivery_location: address,
      token_path: String(token),   // Meta base https://www.briklay.app/quote/{{1}} → {{1}} = token
    });

    // ── RESEND to one existing recipient ──────────────────────────────────────
    if (body.resendRecipientId) {
      const { data: r } = await admin.from('rfq_recipients').select('token, vendor_name, vendor_phone').eq('recipient_id', body.resendRecipientId).maybeSingle();
      if (!r) return json({ ok: false, error: 'Recipient not found' }, 404);
      let dest = String(r.vendor_phone ?? '').replace(/[^\d]/g, '').replace(/^0+/, '');
      if (dest.length === 10) dest = '91' + dest;   // bare Indian mobile → E.164 (matches the PO path)
      if (dest.length < 11 || dest.length > 15) return json({ ok: false, error: 'That vendor has no valid number' }, 400);
      try { await wa(dest, r.vendor_name ?? 'there', r.token); await admin.from('rfq_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('recipient_id', body.resendRecipientId); }
      catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }
      return json({ ok: true, resent: r.vendor_name });
    }

    // ── NEW: create the RFQ header ────────────────────────────────────────────
    if (!rfqId) {
      if (!Array.isArray(items) || items.length === 0) return json({ ok: false, error: 'items are required' }, 400);
      const { data: rfq, error: rfqErr } = await admin.from('rfqs').insert({
        org_id: orgId, project_id: body.projectId ?? null, created_by: user.id,
        quote_by: body.quoteBy || null, delivery_location: body.deliveryLocation ?? null, items,
      }).select('rfq_id').single();
      if (rfqErr || !rfq) return json({ ok: false, error: rfqErr?.message ?? 'Could not create the request' }, 500);
      rfqId = rfq.rfq_id;
    }

    // ── NEW / APPEND: a recipient + a WhatsApp per vendor ──────────────────────
    const recipients = body.recipients ?? [];
    if (recipients.length === 0) return json({ ok: false, error: 'recipients are required' }, 400);
    const sent: string[] = [];
    const failed: { name?: string; error: string }[] = [];
    for (const r of recipients) {
      let dest = String(r.phone ?? '').replace(/[^\d]/g, '').replace(/^0+/, '');
      if (dest.length === 10) dest = '91' + dest;   // bare Indian mobile → E.164 (matches the PO path)
      if (dest.length < 11 || dest.length > 15) { failed.push({ name: r.name, error: `Invalid number: "${r.phone}"` }); continue; }
      const { data: rcpt, error: rcptErr } = await admin.from('rfq_recipients').insert({
        rfq_id: rfqId, org_id: orgId, stakeholder_id: r.stakeholderId ?? null, vendor_name: r.name ?? null, vendor_phone: dest,
      }).select('token').single();
      if (rcptErr || !rcpt) { failed.push({ name: r.name, error: rcptErr?.message ?? 'record failed' }); continue; }
      try { await wa(dest, r.name ?? 'there', rcpt.token); sent.push(r.name ?? dest); }
      catch (e) { failed.push({ name: r.name, error: (e as Error).message }); }
    }
    return json({ ok: true, rfq_id: rfqId, sent, failed });
  } catch (e) {
    console.error('[send-rfq] error', e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
