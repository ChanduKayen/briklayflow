// CONSTITUTIONAL RECONNECTION · step 5 — pin the last UNGUARDED clause. Clause 1 (evidence findable) has a
// guard for the siteops SIDE (voice_audio_findable: given ctx.audio → an attachment row), but the ENTRY-side
// threading — the one line in the webhook handler that decides whether a voice note's stored audio even
// REACHES siteops — had none. It regressed once (audio dropped; only images were threaded). Extracting it to
// deriveDispatchMedia made it pinnable; this locks it so it can't silently drop again.
//
// Not red — the behaviour is correct today. A pin of a REGRESSION-PRONE seam: revert the helper to image-only
// and (voice) fails. (The voice→TEXT transcription itself is network/LLM-bound, so it stays a deployed-but-
// unpinnable secondary — this pins the deterministic threading, the part that actually dropped evidence.)

import { suite, test, expect } from './harness'
import { deriveDispatchMedia, type NormalizedMessage } from '../_normalize.ts'

const base = (over: Partial<NormalizedMessage>): NormalizedMessage => ({
  org_id: 'org-1', sender: '919900000000', wamid: 'w-1', text: '', source_type: 'text',
  attachments: [], timestamp: '2026-07-07T00:00:00Z', ...over,
})

suite('siteops — clause 1 media threading (stored evidence reaches the agent, never dropped)', () => {
  // (voice) a voice note's already-stored audio path + mime ride through as ctx.audio — the exact drop that regressed.
  test('(voice) stored voice audio → dispatchAudio carries its path + mime', () => {
    const { audio, image } = deriveDispatchMedia(base({
      source_type: 'voice', text: 'slab cast on 2nd floor',
      attachments: [{ media_id: 'm1', mime: 'audio/ogg; codecs=opus', storage_path: 'rough-entry-media/a1.ogg' }],
    }))
    expect(audio).toEqual({ storagePath: 'rough-entry-media/a1.ogg', mime: 'audio/ogg; codecs=opus' })
    expect(image).toBe(undefined)                     // a voice note is not an image
  })

  // (voice-no-store) transcription-only voice (no stored path) → no audio payload (nothing to attach), never a crash.
  test('(voice-no-store) voice with no stored path → no audio', () => {
    const { audio } = deriveDispatchMedia(base({ source_type: 'voice', text: 'wall plastered', attachments: [{ media_id: 'm1', mime: 'audio/ogg' }] }))
    expect(audio).toBe(undefined)
  })

  // (image) a payment/site image carries its stored path so siteops attaches it without re-uploading.
  test('(image) image → dispatchImage carries base64 + storagePath', () => {
    const { image, audio } = deriveDispatchMedia(base({
      source_type: 'image', text: 'invoice', image: { base64: 'AAAA', mime: 'image/jpeg', caption: 'invoice' },
      attachments: [{ media_id: 'm1', mime: 'image/jpeg', storage_path: 'rough-entry-media/p1.jpg' }],
    }))
    expect(image).toEqual({ base64: 'AAAA', mime: 'image/jpeg', caption: 'invoice', storagePath: 'rough-entry-media/p1.jpg' })
    expect(audio).toBe(undefined)                     // an image is not a voice note — the two paths don't cross
  })

  // (text) a plain text message threads neither — no spurious media payloads.
  test('(text) plain text → neither image nor audio', () => {
    const { image, audio } = deriveDispatchMedia(base({ source_type: 'text', text: 'hello' }))
    expect(image).toBe(undefined)
    expect(audio).toBe(undefined)
  })
})
