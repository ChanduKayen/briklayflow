// STEP C2a — the 2-MINUTE HELD-FLUSH. A batch that HELD its resolved summary behind a which_item ask, then
// got no reply, must not wait the 24h abandon sweep to hear "your other items landed". A short cron flushes
// any held summary idle > ~2 min: send what's SURE + NAME the pending as saved-for-review, park the pending
// item, abandon the convo. NO SILENT DROP. A LONE ask (no held summary) is left alone — it keeps the 24h TTL.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { flushAbandonedHeldReadbacks } from '../_siteops_sweep.ts'
import type { ConvoRow } from '../_conversation.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const NOW = new Date('2026-07-09T12:00:00Z')
const STALE = '2026-07-09T11:55:00.000Z'   // 5 min old — past the 2-min idle
const FRESH = '2026-07-09T11:59:30.000Z'   // 30s old — a fast typer still answering

const held = { entries: [{ project: 'ASM Elite', body: 'logged new: “slab crack”' }], resolvedRefs: [] }
const convo = (over: Partial<ConvoRow> & { slots_so_far?: Record<string, unknown> } = {}): ConvoRow => ({
  id: 'cv-1', org_id: ORG, sender_number: SENDER, owning_agent: 'SITEOPS', status: 'OPEN',
  pending_question: 'which item?', slots_so_far: {}, staged_entry_id: null,
  last_action_summary: null, opened_at: STALE, closed_at: null, purge_at: null, last_message_id: 'wamid.in1',
  ...over,
} as ConvoRow)
const heldCollisionSlots = { kind: 'siteops_batch_collision', status: 'still_open', piece_text: 'wiring done', candidates: [{ id: 'iss-w', kind: 'issue', title: 'wiring broke' }], project_id: 'P1', narration_id: 'narr-1', image: null, held_readback: held }

type Sent = { to: string; body: string; org: string }
const spy = () => { const sent: Sent[] = []; return { send: (to: string, body: string, org: string) => { sent.push({ to, body, org }); return Promise.resolve() }, sent } }
const parks = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('siteops_unplaced').filter((w) => w.op === 'insert')
const abandons = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('wa_conversations').filter((w) => w.op === 'update' && w.payload?.status === 'ABANDONED')

suite('siteops — Step C2a: 2-min held-flush (deliver the sure summary, name the parked)', () => {
  test('a STALE held ask → flush the sure summary + name the pending, park it, abandon the convo', async () => {
    const fake = fakeSupabase({ wa_conversations: [convo({ slots_so_far: heldCollisionSlots })] } as Seed)
    const s = spy()
    const res = await flushAbandonedHeldReadbacks(fake, s.send, { now: NOW, idleMinutes: 2 })
    expect(res.flushed).toBe(1)
    expect(s.sent.length).toBe(1)
    expect(/slab crack/i.test(s.sent[0].body)).toBe(true)                 // the SURE item delivered
    expect(/wiring done/i.test(s.sent[0].body)).toBe(true)                // the pending NAMED
    expect(/saved|review/i.test(s.sent[0].body)).toBe(true)              // …as saved-for-review (no silent drop)
    expect(parks(fake).length).toBe(1)                                    // pending parked, replayable
    expect(abandons(fake).length).toBe(1)                                 // convo abandoned (interception dies)
  })

  test('a FRESH held ask (<2min) is NOT flushed — the typer may still answer', async () => {
    const fake = fakeSupabase({ wa_conversations: [convo({ opened_at: FRESH, slots_so_far: heldCollisionSlots })] } as Seed)
    const s = spy()
    const res = await flushAbandonedHeldReadbacks(fake, s.send, { now: NOW, idleMinutes: 2 })
    expect(res.flushed).toBe(0)
    expect(s.sent.length).toBe(0)
  })

  test('a LONE ask with NO held summary is left alone (keeps the 24h TTL, not force-flushed at 2min)', async () => {
    const fake = fakeSupabase({ wa_conversations: [convo({ slots_so_far: { kind: 'siteops_batch_collision', piece_text: 'wiring done', candidates: [], project_id: 'P1' } })] } as Seed)
    const s = spy()
    const res = await flushAbandonedHeldReadbacks(fake, s.send, { now: NOW, idleMinutes: 2 })
    expect(res.flushed).toBe(0)
    expect(parks(fake).length).toBe(0)      // untouched — the 24h sweep owns a lone abandoned ask
  })
})
