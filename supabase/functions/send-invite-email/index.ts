// Sends the org-invite email — the join link an admin generates via create_invite,
// delivered to the invitee's inbox (previously the link was only shown for manual
// copy, so nothing ever reached the invitee).
//
// Transport: Resend's HTTP API (no SMTP libs needed in Deno). Requires two secrets:
//   RESEND_API_KEY    — your Resend API key
//   INVITE_FROM_EMAIL — a verified sender, e.g. "Briklay <invites@yourdomain.com>"
// Both are read at request time so a clear error surfaces (rather than a silent
// no-send) when they're missing.
//
// DEPLOY NOTE: after `supabase functions deploy send-invite-email`, this is invoked
// from the browser (supabase.functions.invoke) with the caller's JWT — leave the
// gateway's default verify_jwt ON so only authenticated users can send.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function inviteHtml(opts: { link: string; orgName?: string; inviterName?: string; role?: string }) {
  const org = opts.orgName ? escapeHtml(opts.orgName) : "the team";
  const who = opts.inviterName ? escapeHtml(opts.inviterName) : "Your team";
  const roleLine = opts.role
    ? `<p style="margin:0 0 20px;color:#6b625a;font-size:14px">You're being added as <strong>${escapeHtml(cap(opts.role))}</strong>.</p>`
    : "";
  const link = escapeHtml(opts.link);
  return `<!doctype html><html><body style="margin:0;background:#f5f1ea;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e7e0d6">
        <tr><td style="padding:28px 32px">
          <p style="margin:0 0 20px;color:#8f3318;font-size:22px;font-weight:800;letter-spacing:-0.02em">Briklay</p>
          <p style="margin:0 0 8px;color:#1e1a15;font-size:17px;font-weight:600">You've been invited to join ${org}</p>
          <p style="margin:0 0 16px;color:#6b625a;font-size:14px;line-height:1.5">${who} invited you to Briklay. Click below to accept the invite and set up your account.</p>
          ${roleLine}
          <a href="${link}" style="display:inline-block;background:#8f3318;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:12px">Accept invite</a>
          <p style="margin:20px 0 0;color:#a89f95;font-size:12px;line-height:1.5">Or paste this link into your browser:<br><span style="color:#6b625a;word-break:break-all">${link}</span></p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;color:#a89f95;font-size:11px">If you weren't expecting this, you can ignore this email.</p>
    </td></tr></table>
  </body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // ── Only an admin (management/principal) may send an invite email ─────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ ok: false, error: "Missing authorization" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: "Invalid session" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: adminMem } = await admin
      .from("org_memberships").select("org_id")
      .eq("user_id", user.id).eq("status", "active")
      .in("role", ["principal", "management"]).maybeSingle();
    if (!adminMem) return json({ ok: false, error: "Forbidden: only management or principal can send invites" }, 403);

    const { to, link, orgName, inviterName, role } = await req.json();
    if (!to || !link) return json({ ok: false, error: "to and link are required" }, 400);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("INVITE_FROM_EMAIL");
    if (!apiKey) return json({ ok: false, error: "Email is not configured (missing RESEND_API_KEY)" }, 500);
    if (!from) return json({ ok: false, error: "Email is not configured (missing INVITE_FROM_EMAIL)" }, 500);

    const subject = orgName ? `You're invited to join ${orgName} on Briklay` : "You're invited to Briklay";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html: inviteHtml({ link, orgName, inviterName, role }) }),
    });

    if (!res.ok) {
      // Surface Resend's message (invalid key, unverified domain, bad address) verbatim.
      let msg = `Email provider returned ${res.status}`;
      try { const b = await res.json(); msg = b?.message || b?.error?.message || msg; } catch { /* keep default */ }
      return json({ ok: false, error: msg }, 502);
    }

    const body = await res.json().catch(() => ({}));
    return json({ ok: true, id: body?.id ?? null });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
