// send-rfq — request a quotation from one or more vendors.
//
// Creates an RFQ (the BOQ, no prices) + one recipient row per vendor (each with an
// unguessable token), then WhatsApps every vendor the approved `request_for_quotation`
// template with a per-vendor link to https://www.briklay.app/quote/<token> — a no-login
// page (Phase 2) where they type their rates.
//
// Auth: caller must be an active management/principal member of the RFQ's org (same
// authority that creates a PO). Runs the writes with the service role.
//
// DEPLOY: supabase functions deploy send-rfq  · needs WA_* secrets and the
// `request_for_quotation` template APPROVED in Meta.

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
    // ── Authenticate the caller ───────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ ok: false, error: 'Missing authorization' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: 'Invalid session' }, 401);

    const { orgId, projectId, deliveryLocation, quoteBy, items, recipients } = await req.json() as {
      orgId: string; projectId?: string; deliveryLocation?: string; quoteBy?: string;
      items: RfqItem[]; recipients: Recipient[];
    };
    if (!orgId || !Array.isArray(items) || items.length === 0 || !Array.isArray(recipients) || recipients.length === 0) {
      return json({ ok: false, error: 'orgId, items and recipients are required' }, 400);
    }

    // ── Authorize: management/principal of THIS org (same as creating a PO) ────
    const { data: mem } = await admin.from('org_memberships').select('role')
      .eq('user_id', user.id).eq('org_id', orgId).eq('status', 'active')
      .in('role', ['management', 'principal']).maybeSingle();
    if (!mem) return json({ ok: false, error: 'Forbidden: only management or principal can request quotes' }, 403);

    // Builder name for the message.
    let builderName = 'Your builder';
    const { data: org } = await admin.from('organizations').select('name').eq('org_id', orgId).maybeSingle();
    if (org?.name) builderName = org.name;

    const summary = itemsSummary(items);
    const address = (deliveryLocation ?? '').trim() || 'the site';

    // ── Create the RFQ header ─────────────────────────────────────────────────
    const { data: rfq, error: rfqErr } = await admin.from('rfqs').insert({
      org_id: orgId, project_id: projectId ?? null, created_by: user.id,
      quote_by: quoteBy || null, delivery_location: deliveryLocation ?? null, items,
    }).select('rfq_id').single();
    if (rfqErr || !rfq) return json({ ok: false, error: rfqErr?.message ?? 'Could not create the request' }, 500);

    // ── One recipient + one WhatsApp per vendor ───────────────────────────────
    const sent: string[] = [];
    const failed: { name?: string; error: string }[] = [];
    for (const r of recipients) {
      const dest = String(r.phone ?? '').replace(/[^\d]/g, '');
      if (dest.length < 11 || dest.length > 15) { failed.push({ name: r.name, error: `Invalid number: "${r.phone}"` }); continue; }

      const { data: rcpt, error: rcptErr } = await admin.from('rfq_recipients').insert({
        rfq_id: rfq.rfq_id, org_id: orgId, stakeholder_id: r.stakeholderId ?? null,
        vendor_name: r.name ?? null, vendor_phone: dest,
      }).select('token').single();
      if (rcptErr || !rcpt) { failed.push({ name: r.name, error: rcptErr?.message ?? 'record failed' }); continue; }

      try {
        await sendTemplate('request_for_quotation', dest, {
          vendor_name: r.name ?? 'there',
          builder_name: builderName,
          items_summary: summary,
          delivery_location: address,
          token_path: String(rcpt.token),   // Meta button base must be https://www.briklay.app/quote/{{1}} → {{1}} = token
        });
        sent.push(r.name ?? dest);
      } catch (e) {
        failed.push({ name: r.name, error: (e as Error).message });
      }
    }

    return json({ ok: true, rfq_id: rfq.rfq_id, sent, failed });
  } catch (e) {
    console.error('[send-rfq] error', e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
