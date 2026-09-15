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
    // Log every request so a send is never invisible in the function logs (mask the number).
    const masked = typeof to === "string" && to.length > 4 ? "••••" + to.slice(-4) : String(to);
    console.log("[send-template] request", { templateKey, to: masked, params });
    if (!templateKey || !to) {
      console.error("[send-template] bad request: templateKey and to are required", { templateKey, to: masked });
      return new Response(JSON.stringify({ error: "templateKey and to are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await sendTemplate(templateKey as TemplateKey, to, params ?? {});
    console.log("[send-template] sent", { templateKey, to: masked, wamid: result.wamid });
    return new Response(JSON.stringify({ ok: true, wamid: result.wamid }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e as Error;
    // Full error + stack in the logs; the message goes back to the caller too.
    console.error("[send-template] FAILED", err?.message ?? String(e), err?.stack ?? "");
    return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
