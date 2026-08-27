import { supabase } from '../supabase';

/**
 * Email the org-invite join link to the invitee via the `send-invite-email` edge
 * function (Resend). Best-effort by contract: returns an error message string on
 * failure (so the caller can surface a warning) and `undefined` on success. Never
 * throws — a failed email must not fail the invite, which already exists in the DB.
 */
export async function emailInviteLink(args: {
  to: string;
  link: string;
  orgName?: string;
  inviterName?: string;
  role?: string;
}): Promise<string | undefined> {
  const { data, error } = await supabase.functions.invoke('send-invite-email', { body: args });
  if (error) {
    // Prefer the function's JSON error body (Resend/config message) over the generic one.
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
      if (parsed?.error) msg = parsed.error;
    } catch { /* fall back to error.message */ }
    return msg || 'Could not send the invite email';
  }
  if (data && data.ok === false) return data.error || 'Could not send the invite email';
  return undefined;
}

/**
 * Notify the invitee on WhatsApp (the `team_invite` template — "Hi {invitee}, {inviter} invited you…"
 * with a static button to the signup page, where they enter their number and our OTP takes over; org
 * linking is by phone). Best-effort, same contract as emailInviteLink: returns an error string on
 * failure, `undefined` on success, never throws. `to` is E.164 digits without "+", e.g. "9198...".
 */
export async function whatsappInviteLink(args: {
  to: string;
  invitee?: string;
  inviter?: string;
}): Promise<string | undefined> {
  const { data, error } = await supabase.functions.invoke('send-template', {
    body: { templateKey: 'team_invite', to: args.to, params: { invitee: args.invitee || 'there', inviter: args.inviter || 'A teammate' } },
  });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
      if (parsed?.error) msg = parsed.error;
    } catch { /* fall back to error.message */ }
    return msg || 'Could not send the WhatsApp invite';
  }
  if (data && data.ok === false) return data.error || 'Could not send the WhatsApp invite';
  return undefined;
}
