// THE PHOTO ACK IS A CONFIRMATION, NOT A RECEIPT.
//
// A photo used to be acknowledged the same way a typed note is: "✅ Got your message — I've picked out
// *3 updates*." That tells the sender we received bytes. It does not tell him WHAT WE SAW — and a photo is
// the one modality where our reading of it can be flatly wrong (a floor number misread off a lift panel, a
// cured slab read as a fresh pour) while the sender has no way to know until the wrong row is already
// written. He was standing there; he is the only one who can catch it.
//
// So the ack for an image reads back the GROUNDED observation — every item the vision pass extracted, in its
// own words, alongside his caption — BEFORE the resolve loop writes anything. What he sees quoted back is
// exactly what is about to be acted on.
//
// FULL observation, deliberately: items we will NOT act on (a low-confidence read demoted to a plain note)
// are shown too. The sender seeing "also: exposed wiring at the left wall" and replying "that's a snag" is
// the cheapest possible correction. Hiding it because we didn't act on it is how a miss stays silent.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import { composePhotoAck } from '../_siteops_readback.ts'
import type { SiteItem, StructureSlot } from '../_siteops_extract.ts'

const slot = (floor: string | null, unit: string | null = null): StructureSlot => ({ floor, unit, all: false, except: null })
const it = (text: string, structure: StructureSlot | null = null): SiteItem => ({
  type: 'progress', text, structure, task_hint: null, qc_statements: [],
  cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
})

suite('siteops — the photo ack reads the observation back', () => {
  test('(A1) the caption and EVERY observation come back, before anything is written', () => {
    const body = composePhotoAck(
      [it('Floor tiles laid across the room, grouting still open at the edges'),
       it('Exposed wiring at the left wall, no cover plate')],
      'tiles cleared 3rd floor',
    )!
    expect(body.includes('tiles cleared 3rd floor')).toBe(true)                       // his words, quoted
    expect(body.includes('Floor tiles laid across the room, grouting still open at the edges')).toBe(true)
    expect(body.includes('Exposed wiring at the left wall, no cover plate')).toBe(true)  // the one we may NOT act on
    expect(/picked out/i.test(body)).toBe(false)                                      // never the bare count
  })

  test('(A2) the place we pinned is stated — it is the misread that costs the most', () => {
    const body = composePhotoAck([it('tiles laid', slot('Third')), it('grouting open', slot('Third'))], 'tiles done')!
    expect(body.includes('Third floor')).toBe(true)
    // ONE place line, not repeated per observation — one photo is one place (the inheritance rule).
    expect(body.split('Third floor').length - 1).toBe(1)
  })

  test('(A3) observations in DIFFERENT places each carry their own', () => {
    const body = composePhotoAck([it('tiles laid', slot('Third')), it('slab crack', slot('Fourth', 'A'))], null)!
    expect(body.includes('Third floor')).toBe(true)
    expect(body.includes('Fourth floor')).toBe(true)
    expect(body.includes('Unit A')).toBe(true)
  })

  test('(A4) no caption → we never invent one, and still say what we saw', () => {
    const body = composePhotoAck([it('slab poured, surface still wet')], null)!
    expect(body.includes('slab poured, surface still wet')).toBe(true)
    expect(/you said/i.test(body)).toBe(false)
  })

  test('(A5) NOTHING seen → no ack at all (the caller keeps its honest receipt); never a fake observation', () => {
    expect(composePhotoAck([], 'here you go')).toBe(null)
  })

  test('(A6) a long observation is never truncated — a cut-off readback cannot be checked', () => {
    const long = 'Floor tiles laid across the full room with the skirting course started along the north wall, ' +
      'grouting still open at every edge joint, and cut tiles stacked by the balcony door awaiting the wet cut'
    const body = composePhotoAck([it(long)], null)!
    expect(body.includes(long)).toBe(true)
    expect(body.includes('…')).toBe(false)
  })
})

// ── the journey: a real image through runSiteops emits the observation ack as its FIRST message ──────────
const ORG = 'org-1'
const SENDER = '919900000000'
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {},
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const VISION = JSON.stringify({
  project_hint: 'ASM Elite',
  items: [
    { type: 'progress', text: 'Floor tiles laid across the room, grouting still open', confidence: 'high', task_hint: 'tiling', structure: { floor: '3rd', unit: null, all: false, except: null } },
    { type: 'progress', text: 'Exposed wiring at the left wall, no cover plate', confidence: 'low', task_hint: null, structure: { floor: '3rd', unit: null, all: false, except: null } },
  ],
})
const R_NONE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
const model = (_s: string, user: string): Promise<string> =>
  Promise.resolve(/Decompose the image/.test(user) ? VISION : R_NONE)

suite('siteops — the photo ack, end to end', () => {
  test('(A7) the FIRST thing the sender gets back is what we saw in his photo', async () => {
    const fake = fakeSupabase(seed())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runSiteops({ supabase: fake as any, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en',
      image: { base64: 'AAAA', mime: 'image/jpeg', caption: 'tiles cleared 3rd floor', description: 'tiled floor' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any, 'tiles cleared 3rd floor -- tiled floor', { callModel: model } as any)

    const first = fake.outbox()[0] ?? ''
    expect(first.includes('Floor tiles laid across the room, grouting still open')).toBe(true)
    expect(first.includes('Exposed wiring at the left wall, no cover plate')).toBe(true)
    expect(first.includes('tiles cleared 3rd floor')).toBe(true)
    expect(first.includes('Third floor')).toBe(true)          // the code floor's pin, shown for checking
    expect(/picked out/i.test(first)).toBe(false)
  })
})
