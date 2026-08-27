// Sends the org-invite email — the join link an admin generates via create_invite,
// delivered to the invitee's inbox (previously the link was only shown for manual
// copy, so nothing ever reached the invitee).
//
// Transport: Google Workspace SMTP (smtp.gmail.com over implicit TLS), so the mail
// comes from your own domain — no third-party email vendor. Requires:
//   SMTP_USER         — the Workspace mailbox that authenticates + sends, e.g. admin@briklay.app
//   SMTP_PASS         — an APP PASSWORD for that account (Google account → Security →
//                       2-Step Verification → App passwords). NOT the normal login password.
//   INVITE_FROM_EMAIL — optional display From, e.g. "Briklay <admin@briklay.app>". Defaults to
//                       "Briklay <SMTP_USER>". Gmail requires the From to be SMTP_USER or one of
//                       its verified "Send mail as" aliases, else it gets rewritten to SMTP_USER.
// All read at request time so a clear error surfaces (rather than a silent no-send) when missing.
//
// DEPLOY NOTE: after `supabase functions deploy send-invite-email`, this is invoked
// from the browser (supabase.functions.invoke) with the caller's JWT — leave the
// gateway's default verify_jwt ON so only authenticated users can send.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
    const { to, link, orgName, inviterName, role } = await req.json();
    if (!to || !link) return json({ ok: false, error: "to and link are required" }, 400);

    const user = Deno.env.get("SMTP_USER");
    const pass = Deno.env.get("SMTP_PASS");
    if (!user) return json({ ok: false, error: "Email is not configured (missing SMTP_USER)" }, 500);
    if (!pass) return json({ ok: false, error: "Email is not configured (missing SMTP_PASS — use a Google App Password)" }, 500);
    const from = Deno.env.get("INVITE_FROM_EMAIL") || `Briklay <${user}>`;

    const subject = orgName ? `You're invited to join ${orgName} on Briklay` : "You're invited to Briklay";
    const html = inviteHtml({ link, orgName, inviterName, role });

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: user, password: pass },
      },
    });

    try {
      await client.send({
        from,
        to,
        subject,
        content: `You've been invited to Briklay. Accept your invite: ${link}`,
        html,
      });
    } finally {
      // Always release the connection; a leaked socket wedges the isolate for the next request.
      try { await client.close(); } catch { /* ignore */ }
    }

    return json({ ok: true });
  } catch (e) {
    // Surface the SMTP error verbatim (bad app password, blocked sender, bad address).
    return json({ ok: false, error: String((e as Error).message ?? e) }, 502);
  }
});
