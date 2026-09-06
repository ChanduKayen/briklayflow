/**
 * poVendorSend — the single seam for "send a PO to its vendor over WhatsApp".
 *
 * DECISIONS (locked with product):
 *  · The vendor's WhatsApp number is stored in `stakeholders.contact` (no new column).
 *    If it's empty we ask once and save it there; if it already holds a number we use it
 *    and never ask again. `contact` may hold several numbers (comma/slash/semicolon
 *    separated) — we treat the FIRST as the WhatsApp number.
 *  · The actual Meta send is a STUB for now (`sendPoToVendor`). The message design and the
 *    approved Meta template land later; until then this records intent and resolves ok
 *    without hitting Meta, so the whole flow (summary + number capture + save) is real and
 *    testable. Swap the body of `sendPoToVendor` for the send-template call when the
 *    `po_to_vendor` template is approved — no caller changes.
 */
import { supabase } from './supabase';
import { queryClient } from './queryClient';

/** Normalise a typed number to E.164 (+<cc><national>). Assumes India (+91) for a bare
 *  10-digit number. Returns null when it can't be a real WhatsApp number. */
export function normalizeWhatsApp(raw: string | null | undefined): string | null {
  let d = String(raw || '').replace(/[^\d]/g, '');
  if (!d) return null;
  d = d.replace(/^0+/, '');            // strip trunk zeros
  if (d.length === 10) d = '91' + d;   // bare Indian mobile → prepend country code
  if (d.length < 11 || d.length > 15) return null; // E.164 is 8–15; be a little strict
  return '+' + d;
}

/** The vendor's saved WhatsApp number (first entry of `contact`), normalised — or null. */
export function vendorWhatsAppFrom(contact: string | null | undefined): string | null {
  if (!contact) return null;
  const first = String(contact).split(/[,;/]/)[0]?.trim();
  return first ? normalizeWhatsApp(first) : null;
}

/** Save the vendor's WhatsApp number to `stakeholders.contact` (the one-time capture, so we
 *  never ask again). Stores the normalised E.164 form. */
export async function saveVendorWhatsApp(stakeholderId: string, e164: string): Promise<void> {
  const { error } = await supabase
    .from('stakeholders')
    .update({ contact: e164 })
    .eq('stakeholder_id', stakeholderId);
  if (error) throw error;
}

export interface SendPoArgs {
  poId: string;
  /** normalised E.164 destination */
  to: string;
  vendorName?: string | null;
  /** pre-formatted total, e.g. "₹32,210" */
  totalLabel?: string | null;
  projectName?: string | null;
}
export interface SendPoResult { ok: boolean; error?: string }

/**
 * Send the PO to the vendor over WhatsApp, with the signed PO PDF attached.
 *
 * A proactive first message to a vendor is outside the 24h session window, so it rides the
 * approved Meta `purchase_order` template (vendor name · builder name · PO number + a PDF
 * document header). We generate the PDF here (same layout as the download) and hand it to the
 * `send-po-to-vendor` edge function, which uploads it, mints a signed URL, and sends the template.
 */
export async function sendPoToVendor(args: SendPoArgs): Promise<SendPoResult> {
  try {
    // jsPDF is ~125 kB gzipped. Statically importing the builder here put the whole of it behind
    // the purchase-orders LIST, which most people open far more often than they send a PDF.
    // Loading it at the moment a PDF is actually built keeps that weight off the tab.
    const { buildPoPdfBase64 } = await import('./poPdf');
    const pdfBase64 = await buildPoPdfBase64(args.poId);
    const { data, error } = await supabase.functions.invoke('send-po-to-vendor', {
      body: { poId: args.poId, to: args.to.replace(/^\+/, ''), pdfBase64 },
    });
    if (error) {
      // supabase-js wraps a non-2xx response as FunctionsHttpError whose `.message` is the
      // generic "non-2xx status code" — the ACTUAL reason (our { error } body, or Meta's) is
      // in `error.context` (the Response). Read it so the user sees a real message, not "non-2xx".
      const msg = await extractFnError(error);
      // eslint-disable-next-line no-console
      console.error('[sendPoToVendor] edge function error:', msg, error);
      return { ok: false, error: msg };
    }
    const res = data as SendPoResult | null;
    if (!res?.ok) {
      // eslint-disable-next-line no-console
      console.error('[sendPoToVendor] send failed:', res?.error, res);
      return { ok: false, error: res?.error || 'Could not send. Try again.' };
    }
    // The edge fn stamped purchase_orders.sent_to_vendor_at — refresh the lists that show it so
    // the "PO sent" status appears without a manual reload.
    queryClient.invalidateQueries({ queryKey: ['po_list_sheet'] });
    queryClient.invalidateQueries({ queryKey: ['po_detail', args.poId] });
    queryClient.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[sendPoToVendor] threw before/at invoke:', e);
    return { ok: false, error: (e as { message?: string })?.message || 'Could not prepare the PO. Try again.' };
  }
}

/** Pull the real error text out of a supabase-js FunctionsError (the body of a non-2xx response). */
async function extractFnError(error: unknown): Promise<string> {
  const fallback = (error as { message?: string })?.message || 'Could not send. Try again.';
  const ctx = (error as { context?: unknown })?.context;
  // `context` is the raw Response for FunctionsHttpError.
  if (ctx && typeof (ctx as Response).clone === 'function') {
    try {
      const body = await (ctx as Response).clone().json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      try {
        const text = await (ctx as Response).clone().text();
        if (text) return text.slice(0, 300);
      } catch { /* give up → fallback */ }
    }
  }
  return fallback;
}
