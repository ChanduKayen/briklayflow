// THE PICK, AS A WHATSAPP LIST (2026-07-11). The item pick has always been a NUMBERED TEXT message, and the
// comment above it explains why: "interactive LIST rows are capped at 24 chars by Meta — which is exactly why
// picks are not sent as lists". That rule was written after a 3-word cut rendered "bathroom tiles not fixed
// correctly" + resolved as "✓ bathroom tiles not resolved" — a TRUTH INVERSION. Never truncate what a human
// reads to decide.
//
// The decision missed the row DESCRIPTION (72 chars). Title + description = 96 visible characters, and the
// BODY still carries the full untruncated lines — so the list becomes an INPUT METHOD, not the place where
// meaning lives. Nothing can be lost to a cut. The rules this file pins:
//
//   • the BODY keeps the full numbered lines (the source of truth) — a list row is never the only place a
//     fact appears;
//   • the row TITLE carries the DIFFERENTIATOR (what tells these rows apart — the work for a meaning tie, the
//     floor · unit for a location pick); the DESCRIPTION carries the full label, so the task name AND the
//     floor · unit are on every row;
//   • Meta allows 10 rows and two are spoken for ("something else" / "none of these") → at most 8 candidates.
//     A pick with more than 8 falls back to the TEXT list rather than silently dropping a row inside the cap;
//   • a TAP resolves by the row's ID (positional — display order IS stored order), never by re-parsing its
//     title text. A title is for humans; a truncated one must never be a resolution key.

import { suite, test, expect } from './harness'
import { fakeSupabase } from './fake_supabase'
import { applyTerminals, answerSiteops, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>, interactiveId: string | null = null) =>
  ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const, interactiveId })

// the three tiling ROWS the pin produced at First · Unit A (the live ASM Elite tie)
const TILING_ROWS = [
  { id: 'ft-1a', title: 'Floor tiling — First · Unit A' },
  { id: 'wt-1a', title: 'Wall tiling / dado — First · Unit A' },
  { id: 'pt-1a', title: 'Tiling — First · Unit A' },
]
// the same task name on four floors (the LOCATION axis)
const FLOOR_ROWS = [
  { id: 'w-1', title: 'Wiring (wire pulling) — First · Unit A' },
  { id: 'w-2', title: 'Wiring (wire pulling) — Second · Unit A' },
  { id: 'w-3', title: 'Wiring (wire pulling) — Third · Unit A' },
  { id: 'w-4', title: 'Wiring (wire pulling) — Fourth · Unit A' },
]

const seedOf = (rows: { id: string; title: string }[]) => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  site_tasks: Object.fromEntries(rows.map((r) => [r.id, {
    task_id: r.id, project_id: 'P1', org_id: ORG, name: r.title.split(' — ')[0], status: 'OPEN',
    floor_label: (r.title.split(' — ')[1] ?? '').split(' · ')[0] || null,
    unit_label: r.title.split(' · ')[1] ?? null,
  }])),
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
})

const askTerminal = (ids: string[], axis: 'meaning' | 'location'): Terminal => ({
  kind: 'question_asked', about: 'which_item', axis, ref: ids[0], shortlistIds: ids, reason: '',
})
const execFor = (rows: { id: string; title: string }[]): ExecCtx => ({
  itemsById: new Map(),
  labelById: new Map(rows.map((r) => [r.id, r.title])),
  candById: new Map(rows.map((r) => [r.id, { kind: 'task' as const, title: r.title, projectId: 'P1' as string | null, projectName: 'ASM Elite' as string | null }])),
  cadenceMap: new Map(), actorId: 'u1', now: new Date('2026-07-11T09:00:00Z'),
  narrationId: 'narr-1', projectId: 'P1', message: 'tiles done first floor unit A',
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listOf = (fake: ReturnType<typeof fakeSupabase>): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake.writesTo('outbox').map((w: any) => w.payload?.payload).find((p: any) => p?.kind === 'list')
const textPick = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.outbox().find((b) => /which of these is it about/i.test(b)) ?? ''

suite('siteops — the item pick as a WhatsApp LIST', () => {
  test('(UI1) a 3-way tie → an interactive LIST: 3 rows + 2 escapes, each row naming the WORK and the floor · unit', async () => {
    const fake = fakeSupabase(seedOf(TILING_ROWS))
    await applyTerminals(ctxFor(fake), [askTerminal(['ft-1a', 'wt-1a', 'pt-1a'], 'meaning')], execFor(TILING_ROWS))

    const list = listOf(fake)
    expect(!!list).toBe(true)
    expect((list.rows ?? []).length).toBe(5)                       // 3 candidates + "something else" + "none of these"
    // the DIFFERENTIATOR is the work (all three share First · Unit A) → it goes in the title…
    expect(list.rows[0].title).toBe('Floor tiling')
    expect(list.rows[2].title).toBe('Tiling')
    // …and the FULL label (floor · unit included) rides the description, on EVERY row
    expect(list.rows[0].description).toBe('Floor tiling — First · Unit A')
    expect(list.rows[1].description).toBe('Wall tiling / dado — First · Unit A')
    // Meta's hard caps, honoured
    for (const r of list.rows) {
      expect(r.title.length <= 24).toBe(true)
      expect((r.description ?? '').length <= 72).toBe(true)
    }
    // ids are positional — display order IS resolution order
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual(['pick:1', 'pick:2', 'pick:3', 'pick:4', 'pick:5'])
    // THE BODY IS STILL THE TRUTH: the full, untruncated lines survive above the list
    expect(/Wall tiling \/ dado — First · Unit A/.test(list.body)).toBe(true)
  })

  test('(UI2) a LOCATION pick (one task, four floors) → the floor · unit is the row title, the work the description', async () => {
    const fake = fakeSupabase(seedOf(FLOOR_ROWS))
    await applyTerminals(ctxFor(fake), [askTerminal(FLOOR_ROWS.map((r) => r.id), 'location')], execFor(FLOOR_ROWS))

    const list = listOf(fake)
    expect(list.rows[0].title).toBe('First · Unit A')             // what tells them apart
    expect(list.rows[3].title).toBe('Fourth · Unit A')
    expect(list.rows[0].description).toBe('Wiring (wire pulling) — First · Unit A')
  })

  test('(UI3) more than 8 candidates → TEXT pick (never a silently dropped row inside a 10-row cap)', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `t-${i}`, title: `Painting — Floor ${i} · Unit A` }))
    const fake = fakeSupabase(seedOf(many))
    await applyTerminals(ctxFor(fake), [askTerminal(many.map((r) => r.id), 'location')], execFor(many))

    expect(listOf(fake)).toBe(undefined)                                  // no interactive list
    expect(/Painting — Floor 8 · Unit A/.test(textPick(fake))).toBe(true) // the text pick, in full
  })

  // "Tiling" is a SUBSTRING of both "Floor tiling" and "Wall tiling / dado" — so a title can never be the
  // resolution key for a tie like this one. WhatsApp delivers the tapped row's TITLE as the message text and
  // its ID separately (see _normalize); the id must win.
  test('(UI4) TAPPING a row resolves by its ID, not by re-parsing the title text', async () => {
    const fake = fakeSupabase(seedOf(TILING_ROWS))
    const convo = {
      slots_so_far: {
        kind: 'siteops_batch_collision', status: 'still_open', piece_text: 'tiles done first floor unit A',
        project_id: 'P1', narration_id: 'narr-1', image: null,
        candidates: TILING_ROWS.map((r) => ({ id: r.id, kind: 'task', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: r.title, cause: null })),
      },
    }
    // Row 3's title is the bare word "Tiling" — a substring of BOTH other rows, so resolving by text is
    // ambiguous by construction and re-prompts (that is resolveTypedPick working correctly: never mis-resolve).
    // The tap must still land, because the row carried its id.
    await answerSiteops(ctxFor(fake, 'pick:3') as never, 'Tiling', convo as never)

    const touched = fake.writesTo('site_tasks').flatMap((w) => w.filters.filter(([k]) => k === 'task_id').map(([, v]) => v))
    expect(touched.includes('pt-1a')).toBe(true)                  // row 3 — the plain-tiling row, by id
    expect(touched.includes('ft-1a')).toBe(false)
    expect(touched.includes('wt-1a')).toBe(false)
  })
})
