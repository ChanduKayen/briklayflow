// WhatsApp Sprint 2 -- output formatter + the single outbound send() surface.
//
// renderToWhatsApp(to, msg) -> the exact WhatsApp Cloud API request body per kind.
// send(supabase, to, msg) -> enqueues the rendered body into the outbox, so EVERY
// outbound inherits durability + backoff + TTL. The drainer POSTs it as-is.
// (Typing indicators are NOT durable -- see sendTypingIndicator, sent inline.)

import type { CaptureRef } from './_wa_message_map.ts'

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
  // WhatsApp Flow (interactive form). `data` is injected into the first `screen`;
  // `flowToken` is required on send but terminal flows echo NO token back (completion
  // is bound by the open wa_conversation, not the token). header/footer optional.
  // `draft: true` sends an UNPUBLISHED flow (required to test before publishing).
  | { kind: 'flow'; body: string; flowId: string; cta: string; screen: string
      data: Record<string, unknown>; flowToken: string; draft?: boolean; header?: string; footer?: string }

// ── CONVERSATION HISTORY (the router's context) ───────────────────────────────
// Every outbound message the system produces — from EVERY edge function — passes through send() or
// sendNow(). That makes this the one place an assistant turn can be recorded, so the router can read the
// conversation instead of guessing at it from a one-line summary.
//
// WHY (2026-07-09): `wa_message_log.direction` has always admitted 'OUT'; nothing ever wrote one. So the
// router could not see that we had just asked the supervisor about five open items, and a bare "ok" was
// reasoned about as "bare affirmation, nothing pending → chitchat". The compensating hacks (a chase-batch
// routing override, three hand-maintained ack word-lists) all existed to paper over that one missing fact.
// The chase digest itself rides send() from siteops-chase, so logging here captures the question we asked.
//
// Best-effort: a history write must NEVER fail a send (capture-first). It is context, not payload.

/** The human-readable body of an OutMessage — what a reader of the transcript would see. */
export function outMessageText(msg: OutMessage): string | null {
  switch (msg.kind) {
    case 'text': case 'buttons': case 'list': case 'cta': case 'flow': return msg.body
    case 'template': return `[template: ${msg.name}]`
    case 'reaction': return null   // a ✓-react is not a conversational turn
  }
}

/** wa_message_log.message_type for an OutMessage (CHECK-admitted since 20260620000003). */
function outMessageType(msg: OutMessage): string {
  return msg.kind === 'text' ? 'text' : msg.kind === 'reaction' ? 'reaction' : 'interactive'
}

/** Record an assistant turn. Never throws; never blocks the send. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logOutbound(supabase: any, to: string, msg: OutMessage): Promise<void> {
  const content = outMessageText(msg)
  if (content === null) return                    // reactions/typing are not turns
  try {
    const { error } = await supabase.from('wa_message_log').insert({
      phone_number: to, direction: 'OUT', message_type: outMessageType(msg),
      content, media_url: null,
    })
    if (error) console.error('[format] history log error:', error.message)
  } catch (e) {
    console.error('[format] history log threw (ignored):', (e as Error)?.message ?? e)
  }
}

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

    case 'flow':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'flow',
          ...(msg.header ? { header: { type: 'text', text: msg.header } } : {}),
          body: { text: msg.body },
          ...(msg.footer ? { footer: { text: msg.footer } } : {}),
          action: {
            name: 'flow',
            parameters: {
              flow_message_version: '3',
              flow_token: msg.flowToken,
              flow_id: msg.flowId,
              flow_cta: msg.cta,
              flow_action: 'navigate',
              ...(msg.draft ? { mode: 'draft' } : {}),
              flow_action_payload: { screen: msg.screen, data: msg.data },
            },
          },
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
  // STEP 4a — `capture` (optional): a ref the drainer stamps into wa_message_map once it learns this
  // message's outbound wamid, so a later reaction/quoted-reply can resolve back to it. Only readbacks/
  // picks set it; every other send is byte-identical to before.
  opts: { org_id?: string | null; wamid?: string | null; dedup_key?: string | null; capture?: CaptureRef | null } = {},
): Promise<void> {
  const base = {
    org_id: opts.org_id ?? null,
    target: to,
    payload: msg,                         // OutMessage (traceability/debug)
    rendered: renderToWhatsApp(to, msg),  // full WA Cloud API body the drainer POSTs
    wamid: opts.wamid ?? null,
    dedup_key: opts.dedup_key ?? null,
  }
  const row = opts.capture ? { ...base, capture_ref: opts.capture } : base
  const enqueue = (r: typeof base | (typeof base & { capture_ref: CaptureRef })) => opts.dedup_key
    ? supabase.from('outbox').upsert(r, { onConflict: 'dedup_key', ignoreDuplicates: true })
    : supabase.from('outbox').insert(r)
  let { error } = await enqueue(row)
  // Degrade if capture_ref isn't migrated yet — the MESSAGE must still send (capture is a bonus).
  if (error && opts.capture) ({ error } = await enqueue(base))
  if (error) console.error('[format] send/enqueue error:', error)
  // Record the assistant turn for the router's history. Logged at ENQUEUE (intent order), not at drain:
  // the drainer's delivery order is the same, and a row that failed to enqueue is not a turn we had.
  if (!error) await logOutbound(supabase, to, msg)
}

/**
 * Send a message RIGHT NOW, bypassing the durable outbox/drainer. For EPHEMERAL,
 * order-critical messages (the instant routing ack) that must land before the slower
 * queued confirmation — a drained-15s-later "recording…" arriving after "Added" is
 * nonsense. Best-effort: never throws into the caller (a failed ack must not fail the
 * job; the real confirmation still goes through the durable path).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendNow(supabase: any, to: string, msg: OutMessage): Promise<void> {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(renderToWhatsApp(to, msg)),
    })
    if (!res.ok) console.warn('[format] sendNow non-2xx:', res.status, await res.text().catch(() => ''))
  } catch (e) {
    console.warn('[format] sendNow failed (ignored):', (e as Error)?.message ?? e)
  }
  // An instant ack is still a turn the supervisor saw — it belongs in the history the router reads.
  await logOutbound(supabase, to, msg)
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
