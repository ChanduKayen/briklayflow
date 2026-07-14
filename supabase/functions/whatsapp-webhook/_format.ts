// WhatsApp Sprint 2 -- output formatter + the single outbound send() surface.
//
// renderToWhatsApp(to, msg) -> the exact WhatsApp Cloud API request body per kind.
// send(supabase, to, msg) -> enqueues the rendered body into the outbox, so EVERY
// outbound inherits durability + backoff + TTL. The drainer POSTs it as-is.
// (Typing indicators are NOT durable -- see sendTypingIndicator, sent inline.)

import type { CaptureRef } from './_wa_message_map.ts'
import { parseSentWamid, buildMapRow } from './_wa_message_map.ts'

const WA_ACCESS_TOKEN    = Deno.env.get('WA_ACCESS_TOKEN')!
const WA_PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID')!

// ── Typed message union every agent uses ───────────────────────────────────────
//
// `footer` — THE REPAIR HANDLE'S HOME. WhatsApp renders a footer small and grey, which is exactly the
// weight meta-text should have; in the body it sits at full size and shouts, competing with the fact it
// is offering to correct. Only interactive messages have a footer field, so a plain text message keeps
// its handle in the body — which is right, because there is nothing else in it to compete with.
//
// `replyTo` — NATIVE REPLY-THREADING. A readback sent as a contextual reply to the photo it is about
// makes WhatsApp draw the photo's own thumbnail above it, for free. That is a better quote than any
// "You said:" line we could write, and it is the ORIGINAL, not our transcription of it. The wamid of
// the inbound message is all it takes.
export type OutMessage =
  | { kind: 'text';     body: string; replyTo?: string }
  | { kind: 'buttons';  body: string; buttons: { id: string; title: string }[]; footer?: string; replyTo?: string } // <= 3
  | { kind: 'list';     body: string; button: string; rows: { id: string; title: string; description?: string }[]; footer?: string; replyTo?: string }
  | { kind: 'cta';      body: string; cta: { text: string; url: string }; footer?: string; replyTo?: string }
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
  // A message that names an inbound wamid is sent AS A REPLY to it — WhatsApp draws the quoted bubble
  // (a photo's own thumbnail, the voice note's waveform) natively, above ours.
  const ctx = 'replyTo' in msg && msg.replyTo ? { context: { message_id: msg.replyTo } } : {}
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...ctx }
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
          ...(msg.footer ? { footer: { text: msg.footer } } : {}),
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
          ...(msg.footer ? { footer: { text: msg.footer } } : {}),
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
          ...(msg.footer ? { footer: { text: msg.footer } } : {}),
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
 * SEND IT NOW, BUT DO NOT LOSE IT — the durable path, minus the queue wait.
 *
 * The outbox is drained by a pg_cron on a 10-second tick, so a readback enqueued the instant we finished
 * thinking still sat there for up to ten more seconds. On a turn already running ~30s that is a tenth of
 * the wait, spent doing nothing at all.
 *
 * `sendNow` alone would fix the latency and lose the guarantee: no retry, no backoff, no TTL. So: TRY to
 * send it directly, and fall back to the outbox if the direct send fails for ANY reason. The happy path is
 * instant; the unhappy path is exactly as durable as it was before, because it IS what it was before.
 *
 * Only the messages a human is actively waiting on should use this. Anything that can wait, should — the
 * queue exists for good reasons and this deliberately opts out of most of them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendNowDurable(
  supabase: any,
  to: string,
  msg: OutMessage,
  opts: { org_id?: string | null; wamid?: string | null; dedup_key?: string | null; capture?: CaptureRef | null } = {},
): Promise<void> {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(renderToWhatsApp(to, msg)),
    })
    if (res.ok) {
      const body = await res.text().catch(() => '')
      // THE CAPTURE STILL HAPPENS. A readback/pick carries a `capture` so a later 👍 or quoted-reply can
      // resolve back to the objects it confirmed — and only the sender learns the outbound wamid. The
      // DRAINER used to be the only sender, so it was the only place that could stamp wa_message_map.
      // The Meta response carries the id too, so we stamp it here with the SAME shared helpers the
      // drainer uses (parseSentWamid/buildMapRow) — one shape, two senders, no drift.
      // Swallowed on failure, exactly as in the drainer: a capture is a bonus, never a send failure.
      if (opts.capture) {
        try {
          const wamid = parseSentWamid(body)   // raw response text — the same input the drainer parses
          const mapRow = buildMapRow(opts.org_id ?? null, opts.capture, wamid)
          if (mapRow) {
            const { error } = await supabase.from('wa_message_map')
              .upsert(mapRow, { onConflict: 'outbound_wamid', ignoreDuplicates: true })
            if (error) console.warn('[format] wa_message_map write skipped:', error.message)
          }
        } catch (e) {
          console.warn('[format] capture stamp skipped (ignored):', (e as Error)?.message ?? e)
        }
      }
      await logOutbound(supabase, to, msg)
      return
    }
    console.warn('[format] sendNowDurable non-2xx — falling back to the outbox:', res.status, await res.text().catch(() => ''))
  } catch (e) {
    console.warn('[format] sendNowDurable failed — falling back to the outbox:', (e as Error)?.message ?? e)
  }
  await send(supabase, to, msg, opts)   // the durable path, unchanged: retry, backoff, TTL, dedup, capture
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

/**
 * KEEP THE TYPING INDICATOR ALIVE FOR AS LONG AS WE ARE ACTUALLY THINKING.
 *
 * WhatsApp's typing indicator has a **25-second TTL** and is dismissed the moment we send anything. A
 * SiteOps voice turn measured ~30s end to end — so the supervisor watched "typing…" for 25 seconds,
 * watched it VANISH, and then sat in silence for the rest. That is worse than never showing it: an
 * indicator that disappears reads as "he gave up on me", which is the exact opposite of the truth.
 *
 * So re-arm it on a timer until the turn ends. Returns a stop() the caller MUST call in a finally —
 * a timer left running in an edge isolate would re-arm against a message we already answered.
 *
 * Everything here is best-effort and swallowed: a typing indicator is a courtesy, and a courtesy must
 * never be able to fail a job.
 */
const TYPING_TTL_MS = 25_000
const TYPING_REARM_MS = 20_000          // comfortably inside the TTL, so there is no visible flicker
const TYPING_MAX_MS = 3 * 60_000        // a backstop: never re-arm forever if a caller forgets to stop

export function keepTyping(wamid: string | null): () => void {
  if (!wamid) return () => {}
  void sendTypingIndicator(wamid)       // the first one, immediately
  const started = Date.now()
  const timer = setInterval(() => {
    if (Date.now() - started > TYPING_MAX_MS) { clearInterval(timer); return }
    void sendTypingIndicator(wamid)
  }, TYPING_REARM_MS)
  return () => clearInterval(timer)
}
export const TYPING_TTL_MS_FOR_TEST = TYPING_TTL_MS
