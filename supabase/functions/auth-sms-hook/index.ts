// Supabase "Send SMS Hook" — delivers the auth OTP over WhatsApp instead of SMS.
//
// Supabase generates the code, manages expiry/rate-limiting, and verifies it on
// verifyOtp(). This hook only DELIVERS the code — it hands the OTP to our existing
// WhatsApp sender (send-template / _shared/whatsapp.ts) as an approved AUTHENTICATION
// template. So phone signup rides Supabase's native flow, but the message goes out on
// the WhatsApp Business API we already run — no third-party SMS, no DLT-SMS registration.
//
// WIRE-UP:
//   1. Deploy:  supabase functions deploy auth-sms-hook   (then turn verify_jwt OFF —
//      Supabase's auth server calls this, not a user JWT; we authenticate via the
//      Standard Webhooks signature below).
//   2. Dashboard → Auth → Hooks → "Send SMS" → HTTP → this function's URL. Copy the
//      generated secret into the SEND_SMS_HOOK_SECRET function secret.
//   3. Dashboard → Auth → Providers → Phone → ENABLE (SMS provider can stay unset; the
//      hook overrides delivery).
//   4. Have the WhatsApp AUTHENTICATION template approved and set its name in
//      _shared/wa-templates.ts → auth_otp.

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { sendTemplate } from "../_shared/whatsapp.ts";

interface HookPayload {
  // Login/signup OTP carries the number in user.phone. A phone CHANGE (from an account that has no
  // phone yet) carries the NEW number in user.new_phone / user.phone_change instead — so read all.
  user?: { phone?: string | null; new_phone?: string | null; phone_change?: string | null };
  phone?: string | null;
  sms?: { otp?: string };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: { http_code: 405, message: "method not allowed" } }, 405);

  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!secret) return json({ error: { http_code: 500, message: "hook not configured (missing SEND_SMS_HOOK_SECRET)" } }, 500);

  const raw = await req.text();

  // Authenticate the call: Supabase signs it per the Standard Webhooks spec. The stored secret is
  // "v1,whsec_<base64>"; the verifier wants the base64 part.
  let payload: HookPayload;
  try {
    const wh = new Webhook(secret.replace("v1,whsec_", ""));
    payload = wh.verify(raw, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    }) as HookPayload;
  } catch (e) {
    return json({ error: { http_code: 401, message: `invalid signature: ${String((e as Error).message ?? e)}` } }, 401);
  }

  // Log the payload SHAPE (OTP redacted) so an unexpected variant — a phone CHANGE, whose new number
  // is NOT in user.phone — is diagnosable from the logs rather than guessed at.
  try {
    const shape = JSON.parse(JSON.stringify(payload));
    if (shape?.sms?.otp) shape.sms.otp = "***";
    console.log("[auth-sms-hook] payload", JSON.stringify(shape));
  } catch { /* ignore */ }

  const u = (payload.user ?? {}) as Record<string, unknown>;
  // A phone ADD/CHANGE from an account with no phone yet sends user.phone as an EMPTY STRING and
  // carries the new number in user.new_phone / user.phone_change. `??` only falls through on
  // null/undefined, so it would return "" and never reach new_phone — pick the first NON-EMPTY.
  const rawPhone =
    [u.phone, u.new_phone, u.phone_change, payload.phone].find(
      (v) => typeof v === "string" && v.trim() !== "",
    ) ?? "";
  const phone = String(rawPhone).replace(/[^\d]/g, ""); // WhatsApp wants E.164 digits, no "+"
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    console.error("[auth-sms-hook] missing phone/otp", JSON.stringify({ user_keys: Object.keys(u), has_otp: !!otp }));
    return json({ error: { http_code: 400, message: "missing phone or otp in hook payload" } }, 400);
  }

  try {
    // signup_otp body: "OTP Code: {{1}}. This is your OTP code for {{2}}. ..." — {{2}} is the
    // purpose label; "Login" matches the approved template sample.
    await sendTemplate("auth_otp", phone, { code: otp, purpose: "Login" });
  } catch (e) {
    // A non-2xx tells Supabase the delivery failed, so the client sees an error instead of a
    // silent "code sent" for a message that never went out.
    return json({ error: { http_code: 502, message: `whatsapp delivery failed: ${String((e as Error).message ?? e)}` } }, 502);
  }

  return json({}, 200);
});
