// send-po-to-vendor — proactively WhatsApp a placed PO to its vendor, with the signed PO PDF
// attached as the template's document header.
//
// The client generates the PO PDF (jsPDF, same layout as the download) and hands it here as
// base64. This function (service role):
//   1. reads the PO → vendor name (stakeholders) + builder name (organizations),
//   2. uploads the PDF to the private `documents` bucket and mints a short-lived SIGNED URL
//      (Meta fetches the header media anonymously at send time; a signed URL is publicly
//      fetchable for its TTL, so the PO never has to live in a public bucket),
//   3. sends the approved `purchase_order` template via sendTemplate.
//
// DEPLOY NOTE: after `supabase functions deploy send-po-to-vendor`, confirm verify_jwt is ON
// (the browser calls it with the user's Supabase JWT). Requires WA_* secrets (see _shared/whatsapp.ts)
// and the `purchase_order` template APPROVED in Meta.

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // ── Authenticate the caller (no more anonymous PO-sends) ──────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ ok: false, error: 'Missing authorization' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: 'Invalid session' }, 401);

    const { poId, to, pdfBase64 } = await req.json();
    console.log('[send-po-to-vendor] request', { poId, to, pdfBytes: pdfBase64 ? String(pdfBase64).length : 0 });
    if (!poId || !to || !pdfBase64) return json({ ok: false, error: 'poId, to and pdfBase64 are required' }, 400);

    // Destination must be E.164 digits, no "+".
    const dest = String(to).replace(/[^\d]/g, '');
    if (dest.length < 11 || dest.length > 15) return json({ ok: false, error: `Invalid destination number: "${to}"` }, 400);

    // 1. PO → vendor + builder names.
    const { data: po, error: poErr } = await admin
      .from('purchase_orders')
      .select('po_id, org_id, stakeholder_id, stakeholders(name)')
      .eq('po_id', poId)
      .single();
    if (poErr || !po) { console.error('[send-po-to-vendor] PO read failed', poErr); return json({ ok: false, error: poErr?.message ?? 'PO not found' }, 404); }

    // ── Authorize: caller must be an active member of THIS PO's org ───────────
    const { data: mem } = await admin
      .from('org_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', (po as any).org_id)
      .eq('status', 'active')
      .maybeSingle();
    if (!mem) return json({ ok: false, error: "Forbidden: not a member of this PO's organisation" }, 403);

    const vendorName = (po as any).stakeholders?.name ?? 'Vendor';
    let builderName = 'Your builder';
    if ((po as any).org_id) {
      const { data: org } = await admin.from('organizations').select('name').eq('org_id', (po as any).org_id).single();
      if (org?.name) builderName = org.name;
    }

    // 2. Upload the PDF and mint a signed URL for Meta.
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const path = `po-vendor/${poId}-${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage.from('documents').upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upErr) { console.error('[send-po-to-vendor] upload failed', upErr); return json({ ok: false, error: `Upload failed: ${upErr.message}` }, 500); }

    const { data: signed, error: signErr } = await admin.storage.from('documents').createSignedUrl(path, 3600);
    if (signErr || !signed?.signedUrl) { console.error('[send-po-to-vendor] sign failed', signErr); return json({ ok: false, error: signErr?.message ?? 'Could not sign the PDF' }, 500); }

    // 3. Send the template.
    console.log('[send-po-to-vendor] sending', { poId, dest, vendorName, builderName });
    const { wamid } = await sendTemplate('purchase_order', dest, {
      vendor_name: vendorName,
      builder_name: builderName,
      po_number: poId,
      headerDocument: signed.signedUrl,
      headerDocumentFilename: `${poId}.pdf`,
    });

    console.log('[send-po-to-vendor] sent', { poId, dest, wamid });

    // Stamp the PO as sent (drives the "PO sent" status in the list). Best-effort — the message
    // already went out, so a failed stamp must not fail the send.
    const { error: stampErr } = await admin
      .from('purchase_orders')
      .update({ sent_to_vendor_at: new Date().toISOString() })
      .eq('po_id', poId);
    if (stampErr) console.error('[send-po-to-vendor] sent-stamp failed (message still sent)', stampErr);

    return json({ ok: true, wamid });
  } catch (e) {
    console.error('[send-po-to-vendor]', e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
