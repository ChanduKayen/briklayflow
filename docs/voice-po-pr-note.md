# Voice input on the New PO screen — record, then transcribe on the server

## What changed

The phone records a voice note and uploads it. Nothing is transcribed in the browser any
more: the Web Speech API cannot hold Telugu/Hindi code-mix, and it showed a half-heard
sentence rewriting itself while the user spoke.

Transcription reuses the chain built for WhatsApp site voice notes — Sarvam saarika first,
OpenAI Whisper as the fallback — now shared at `supabase/functions/_shared/transcribe.ts`.
The domain priming prompt is a per-caller argument, because priming a materials order with
the site-report/payment vocabulary is the same mistake that once inverted the meaning of
site reports.

- `sku-matcher` accepts `audio_base64` / `audio_mime` / `language`, transcribes, then runs its
  ordinary text path. It echoes `transcript` back so the screen can show what was heard.
- `whatsapp-webhook` imports the shared module instead of its own copy. Behaviour unchanged.

## Deploy

**The frontend and the edge functions deploy separately.** Shipping the frontend alone leaves
the app sending audio to a `sku-matcher` that does not understand it, which fails with
`Provide text, image_base64, or image_url`.

```sh
supabase functions deploy sku-matcher      --project-ref momzyincivvpngazvfgq
supabase functions deploy whatsapp-webhook --no-verify-jwt --project-ref momzyincivvpngazvfgq
```

`sku-matcher` is the one that unblocks voice. `whatsapp-webhook` only needs redeploying to pick
up the shared module; the copy already running keeps working until then.

## Secrets

`sku-matcher` now needs a transcription provider. These are project-wide, so they are almost
certainly already set for `whatsapp-webhook`; check with `supabase secrets list`.

- `SARVAM_API_KEY` — preferred, handles Telugu/Hindi code-mix
- `OPENAI_API_KEY` — fallback (also already used by `sku-matcher` for extraction)

With neither, the function returns "Voice is not set up on this deployment" rather than failing
obscurely.
