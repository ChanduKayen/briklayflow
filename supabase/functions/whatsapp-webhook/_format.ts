// WhatsApp Sprint 2 -- output formatter + the single outbound send() surface.
//
// renderToWhatsApp(to, msg) -> the exact WhatsApp Cloud API request body per kind.
// send(supabase, to, msg) -> enqueues the rendered body into the outbox, so EVERY
// outbound inherits durability + backoff + TTL. The drainer POSTs it as-is.
// (Typing indicators are NOT durable -- see sendTypingIndicator, sent inline.)

const WA_ACCESS_TOKEN    = Deno.env.get('WA_ACCESS_TOKEN')!
const WA_PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID')!

// ── Typed message union every agent uses ───────────────────────────────────────
export type OutMessage =
  | { kind: 'text';     body: string }
  | { kind: 'buttons';  body: string; buttons: { id: string; title: string }[] } // <= 3
  | { kind: 'list';     body: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { kind: 'cta';      body: string; cta: { text: string; url: string } }
  | { kind: 'reaction'; messageId: string; emoji: string }   // ✓-react an inbound message
  | { kind: 'template'; name: string; language: string; components?: unknown[] }

/** Render an OutMessage to the WhatsApp Cloud API request body for `to`. */
export function renderToWhatsApp(to: string, msg: OutMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to }
  switch (msg.kind) {
    case 'text':
      return { ...base, type: 'text', text: { preview_url: false, body: msg.body } }

    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: msg.body },
          action: {
            buttons: msg.buttons.slice(0, 3).map((b) => ({
              type: 'reply', reply: { id: b.id, title: b.title },
            })),
          },
        },
      }

    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: msg.body },
          action: {
            button: msg.button,
            sections: [{
              rows: msg.rows.map((r) => ({
                id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}),
              })),
            }],
          },
        },
      }

    case 'cta':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: msg.body },
          action: { name: 'cta_url', parameters: { display_text: msg.cta.text, url: msg.cta.url } },
        },
      }

    case 'reaction':
      return { ...base, type: 'reaction', reaction: { message_id: msg.messageId, emoji: msg.emoji } }

    case 'template':
      return {
        ...base,
        type: 'template',
        template: {
          name: msg.name,
          language: { code: msg.language },
          ...(msg.components ? { components: msg.components } : {}),
        },
      }
  }
}

/**
 * The single durable outbound surface. Renders `msg` and enqueues it into the
 * outbox (rendered body + the OutMessage for traceability). The drainer sends it
 * with backoff/TTL. dedup_key makes the enqueue idempotent when supplied.
 */
export async function send(
  supabase: any,
  to: string,
  msg: OutMessage,
  opts: { org_id?: string | null; wamid?: string | null; dedup_key?: string | null } = {},
): Promise<void> {
  const row = {
    org_id: opts.org_id ?? null,
    target: to,
    payload: msg,                         // OutMessage (traceability/debug)
    rendered: renderToWhatsApp(to, msg),  // full WA Cloud API body the drainer POSTs
    wamid: opts.wamid ?? null,
    dedup_key: opts.dedup_key ?? null,
  }
  const { error } = opts.dedup_key
    ? await supabase.from('outbox').upsert(row, { onConflict: 'dedup_key', ignoreDuplicates: true })
    : await supabase.from('outbox').insert(row)
  if (error) console.error('[format] send/enqueue error:', error)
}

/**
 * Mark-read + typing indicator on an inbound message. EPHEMERAL: sent inline,
 * best-effort, fire-and-forget -- a typing indicator drained 15s later is nonsense.
 * Never throws into the caller; failures here must not affect the job.
 */
export async function sendTypingIndicator(wamid: string): Promise<void> {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: wamid,
        typing_indicator: { type: 'text' },
      }),
    })
  } catch (e) {
    console.warn('[format] typing indicator failed (ignored):', (e as Error)?.message ?? e)
  }
}
