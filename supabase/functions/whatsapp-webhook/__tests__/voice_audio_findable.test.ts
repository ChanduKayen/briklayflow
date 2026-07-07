// SPRINT 2 · T7 concern B — VOICE-AUDIO FINDABILITY (clause 1: evidence preserved UNCONDITIONALLY = stored
// AND findable, not just uploaded). The transcript flows and the audio is stored to the bucket
// (_normalize storeMedia), but no attachments row is written and the storage_path is dropped at
// index.ts:428 (threaded only for images) — so the audio is orphaned, unfindable. FIX: thread the audio
// path through the siteops ctx and write an attachments row parented to the SAME narration
// (parent_type='site_narration'). A missed voice note then has BOTH halves on one narration: the
// miss_verdict (concern A) and the audio row.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const AUDIO = 'wa_919900000000_voice.oga'
// a voice note carries its already-stored audio path on the ctx (mirroring ctx.image for photos).
const voiceCtx = (fake: ReturnType<typeof fakeSupabase>) =>
  ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const, audio: { storagePath: AUDIO, mime: 'audio/ogg' } })
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

suite('siteops T7 concern B — voice audio is findable (clause 1: stored AND recorded)', () => {
  // j3 (RED flip) — a missed voice note: the audio must land in an attachments row parented to the
  // capture-first narration, so it's findable; and it shares that narration with the miss verdict.
  test('(j3) missed voice note → attachments row (parent_type=site_narration, audio path), same narration as the verdict', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(voiceCtx(fake), 'asdfgh zxcvbn qwerty')   // contentless transcript → didn't-catch

    const att = fake.writesTo('attachments').filter((w) => w.payload?.parent_type === 'site_narration')
    expect(att.length).toBe(1)                                      // the audio is RECORDED, not just uploaded
    expect(att[0].payload?.object_path).toBe(AUDIO)                 // …at the path it was stored to
    expect(att[0].payload?.parent_id).toBe('narr-1')               // parented to the capture-first narration

    // BOTH halves live on the SAME narration: the miss verdict update targets that same id.
    const verdict = fake.writesTo('site_narrations').find((w) => w.op === 'update' && w.payload?.miss_verdict)
    expect(verdict?.filters?.some(([k, v]) => k === 'id' && v === 'narr-1')).toBe(true)
  })
})
