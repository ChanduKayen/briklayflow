// Thin HTTP wrapper around sendTemplate so any caller (the app, another edge
// function, a webhook) can send an approved WhatsApp template by key. Other edge
// functions can also import sendTemplate from ../_shared/whatsapp.ts directly.
//
// DEPLOY NOTE: after `supabase functions deploy send-template`, confirm
// verify_jwt is OFF if internal callers hit this without a Supabase JWT
// (deploy re-enables it every time).

import { sendTemplate } from "../_shared/whatsapp.ts";
import type { TemplateKey } from "../_shared/wa-templates.ts";

// Browser callers (the Day Book Manage-team slide-over invokes this via
// supabase.functions.invoke) trigger a CORS preflight; without these headers the
// fetch fails as "Failed to send a request to the Edge Function".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { templateKey, to, params } = await req.json();
    if (!templateKey || !to) {
      return new Response(JSON.stringify({ error: "templateKey and to are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await sendTemplate(templateKey as TemplateKey, to, params ?? {});
    return new Response(JSON.stringify({ ok: true, wamid: result.wamid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
