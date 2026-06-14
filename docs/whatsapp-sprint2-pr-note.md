# WhatsApp Sprint 2 — Normalization & Formatter

Branch: `wa/sprint-2-normalize`

Two things, before the router: (T2.1) one outbound `send()` surface rendering all
WhatsApp message types, and (T2.2) a `NormalizedMessage` envelope so every inbound
type reaches the orchestrator as the same shape. No router/agents built here.

## New files
- **`whatsapp-webhook/_format.ts`** — `OutMessage` union; `renderToWhatsApp(to, msg)`
  (text/buttons/list/cta/template → exact WA Cloud API body); `send(supabase, to, msg)`
  the single durable outbound surface (enqueues the rendered body into the outbox);
  `sendTypingIndicator(wamid)` (ephemeral, inline).
- **`whatsapp-webhook/_normalize.ts`** — `NormalizedMessage` + `normalize()` for every
  inbound type; private-bucket media download/store; `describeImage` (vision);
  `transcribeAudio` (Sarvam→Whisper); `signedMediaUrl` helper.
- **`migrations/20260613000012_sprint2_media_outbox.sql`** — additive outbox `rendered`
  column + `rough-entry-media` made private with authenticated-read.

## T2.1 — Formatter + one `send()`
- `renderToWhatsApp` ports the plain/button/list/cta/template shapes into fresh TS
  (Babai `builder_out.py` was reference only).
- `send()` renders, then enqueues `{ payload: OutMessage, rendered: <WA body> }` into
  the outbox → inherits durability/backoff/TTL. The **drainer** now POSTs `rendered`
  as-is when present, else falls back to the existing `{type:'text',text}` text-render
  path (watchdog / job-failure rows). **Outbox migration is additive** (`rendered jsonb`
  nullable) — the working text path is untouched.
- **Typing indicator** is sent **inline, best-effort, fire-and-forget** at the start of
  `processJob` (`sendTypingIndicator(wamid).catch(()=>{})`) — never an outbox message,
  never affects the job.

## T2.2 — NormalizedMessage envelope
- `normalize()` produces the envelope (with `text` populated) for **all** types:
  text → body; interactive → selection title (id kept); image → download+store+vision;
  voice → transcribe (flagged); else `unsupported`.
- **Image vision** reuses the server-side LLM (Anthropic vision → OpenAI fallback,
  existing keys) to extract a concise line (bill amount+payee / material list / brief
  description) into `text` — a description, **not** a transaction decision.
- **Voice** behind `WA_VOICE_ENABLED` (default off) + `SARVAM_API_KEY`: Sarvam primary
  (TE/HI/English code-mix), Whisper (`OPENAI_API_KEY`) fallback, **no language
  pre-detection**. Flag off / no Sarvam key → `text=''` and a graceful "voice coming
  soon" reply; job still terminal.
- **Media** downloaded via the WA media API and stored in the now-private
  `rough-entry-media` bucket; `storage_path` kept on the attachment; served via signed
  URLs (`signedMediaUrl` / client `resolveDocUrl`).

## Integration (this sprint)
`processJob` now: typing indicator → `normalize` → graceful reply for
`unsupported`/voice-off (terminal) → otherwise **feed `normalized.text` into the legacy
path** via `dispatchNormalized` (session reply, else classify → handleFinancial/Query/
General). So a voice note transcribing to "ramu 5000 cash" flows into the legacy
transaction handler as if typed.

**Behavior change to flag:** because `normalize` now owns image→vision and feeds text
to the legacy **text** path, the legacy rich image handler (`handleImageMessage`,
AWAITING_CONTEXT staging, list-image extraction) is **bypassed** by this path. It's kept
in `_handlers.ts` for the router cutover. Image attachments are stored + vision-extracted
but not yet linked onto the created `rough_entry` (the router will consume
`NormalizedMessage.attachments` properly next sprint). Interactive replies route by their
title (id is captured but not yet acted on). Per the spec: "don't special-case it."

## Legacy replies: TODO'd, not moved
The ~40 `sendWA(...)` calls are deep inside `_handlers.ts` (the transaction flow). Per
the spec's escape hatch, **left as direct sends with a follow-up** rather than risk the
working flow — moving them onto `send()` is a mechanical-but-broad change for the router
sprint. NEW replies (unregistered/no_org/unsupported/voice-soon, and job-failure) all go
through `send()`→outbox. *(TODO: route `_handlers.ts` replies through `send()`.)*

## Spine invariants — intact (not touched)
record-before-ack (`recordInbound` awaited), `EdgeRuntime.waitUntil(processJob)`,
200-after-signature, outbox+TTL, no silent failure (every `processJob` ends terminal +
reply). normalize/typing were added **inside** `processJob`; signature verify, dedup,
the ack boundary, watchdog, and TTL were not modified.

## New secrets / flags
| Name | Purpose | Default |
|---|---|---|
| `SARVAM_API_KEY` | voice transcription (primary) | unset → voice stays off |
| `WA_VOICE_ENABLED` | feature flag for voice | `false` |

`supabase secrets set SARVAM_API_KEY=… WA_VOICE_ENABLED=true` to enable voice.

## Security
`rough-entry-media` is now **private** (migration 0012): `public=false`, the
`public_read_rough_entry_media` policy dropped, replaced by authenticated-read; media
served via short-TTL signed URLs. No public read policy remains.

## Apply / deploy
1. SQL editor: run `20260613000012_sprint2_media_outbox.sql`.
2. Redeploy `whatsapp-webhook` and `wa-outbox-drainer`.
3. (Optional) set `SARVAM_API_KEY` + `WA_VOICE_ENABLED=true` to enable voice.
4. Formatter check: enqueue one of each kind via `send()` (or insert an outbox row with
   a `rendered` body) and confirm each renders on your real number.
