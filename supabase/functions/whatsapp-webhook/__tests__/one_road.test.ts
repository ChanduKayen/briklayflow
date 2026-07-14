// ONE TURN, ONE ROAD — order of speaking is order of hearing (2026-07-13).
//
// The photo-ack bug (ack_order.test) was not a bug about photos. It was a bug about TRANSPORT: the ack went
// by `send()` (the outbox, drained by a pg_cron on a 10-second tick) while the ask went by `sendNowDurable()`
// (a direct POST). Said first, heard second. Fixing that one message left the FAULT in place — the SiteOps
// agent had 25 messages on the slow road and 7 on the fast one, and every pairing of the two is the same
// inversion waiting for its turn.
//
// The next one in line is this, and it is the tail of the very probe that started all of it:
//
//     "Couldn't update “Ceiling — false-ceiling frame — Ground” just now — saved it for review."   ← send()
//     …then the drain asks the NEXT question he still owes an answer to                            ← sendNowDurable()
//
// So he is asked question #2 before he is told that his answer to question #1 could not be saved. The apology
// arrives ten seconds later, by which time he has already answered something else. Every failure notice, every
// park, every confirm in this agent sits behind that same 10-second queue while the questions jump it.
//
// THE RULE: within a turn, everything the supervisor is meant to READ IN ORDER travels the SAME road. The
// outbox's FIFO guarantee (outbox_order.test) is worth exactly nothing to a message that skips the queue —
// so nothing in a turn skips it alone. sendNowDurable IS the durable path (it falls back to the outbox on any
// failure, and stamps wa_message_map just the same); it simply stops paying the queue's latency for a message
// a human is sitting in front of. That is what it was built for, and now the whole turn uses it.

import { readFileSync } from 'node:fs'
import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const DEAD = 'ceiling_frame@Ground#Ground-unit-dry'   // out of the VM — the guardrail must refuse the write

const seed = (): Seed => ({
  projects: [{
    project_id: 'P1', name: 'The Pride', org_id: ORG, status: 'Active', has_common_areas: false,
    construction_stack: { levels: [{ label: 'Ground', kind: 'residential', zones: [{ use: 'residential', units: 1 }] }] },
  }],
  site_tasks: {
    'dead-fcf': {
      task_id: 'dead-fcf', project_id: 'P1', name: 'Ceiling — false-ceiling frame', status: 'OPEN',
      floor_label: 'Ground', unit_label: null, trade: 'ceiling', phase: 'services',
      node_key: DEAD, source: 'generated', order_source: 'manual', seq_no: 41,   // hand-reordered → reconcile KEEPS it
    },
    'live-board': {
      task_id: 'live-board', project_id: 'P1', name: 'Ceiling — boarding', status: 'OPEN',
      floor_label: 'Ground', unit_label: null, trade: 'ceiling', phase: 'finishes',
      node_key: 'ceiling_board@Ground/unit', source: 'generated', order_source: 'auto', seq_no: 42,
    },
  },
  problems: {}, chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

const cand = (id: string, title: string) =>
  ({ id, kind: 'task' as const, orgId: ORG, projectId: 'P1', projectName: 'The Pride', title, cause: null })

// He is mid-drain: he has just answered the FIRST of two questions, and his answer names the dead row.
const slots = () => ({
  kind: 'siteops_batch_collision',
  candidates: [cand('dead-fcf', 'Ceiling — false-ceiling frame — Ground')],
  piece_text: 'false ceilings done on the ground floor',
  project_id: 'P1', project_name: 'The Pride', narration_id: 'narr-1',
  ask_body: '❓ Which work is this?',
  // …and one more question is still owed him — the drain will ask it the moment this one resolves.
  pending_item_asks: [{
    candidates: [cand('live-board', 'Ceiling — boarding — Ground')],
    pieceText: 'boarding started',
    projectId: 'P1', narrationId: 'narr-1', image: null, update: null, fork: false,
  }],
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (s: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: s })
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const })

// The two roads, exactly as ack_order models them: direct sends land in call order, the outbox drains after.
interface Roads { direct: string[]; queued: string[]; delivered: string[] }
async function answerTurn(): Promise<Roads> {
  const fake = fakeSupabase(seed())
  const direct: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = ((_u: string, init?: { body?: string }) => {
    let body = ''
    try {
      const p = JSON.parse(init?.body ?? '{}')
      body = p?.text?.body ?? p?.interactive?.body?.text ?? ''
    } catch { /* not a message POST */ }
    if (body) direct.push(body)
    return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: `wamid.o${direct.length}` }] }), { status: 200 }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  try {
    await answerSiteops(ctxFor(fake), '1', convoOf(slots()), { callModel: () => Promise.resolve('') })
  } finally {
    globalThis.fetch = realFetch
  }
  const queued = fake.outbox()
  return { direct, queued, delivered: [...direct, ...queued] }
}

const SORRY = /Couldn't update/i
const NEXT_ASK = /❓/
const idx = (b: string[], re: RegExp) => b.findIndex((x) => re.test(x))

suite('siteops — one turn, one road: nothing a human must read in order can be overtaken', () => {
  test('(T1) the "couldn\'t save it" notice reaches him BEFORE the next question', async () => {
    const { delivered } = await answerTurn()
    const sorry = idx(delivered, SORRY)
    const ask = idx(delivered, NEXT_ASK)
    expect(sorry >= 0).toBe(true)     // he was told (the guardrail refused the dead row)
    expect(ask >= 0).toBe(true)       // …and the drain asked the next question (otherwise this proves nothing)
    expect(sorry < ask).toBe(true)    // …in that order. Never "answer question 2" before "question 1 failed".
  })

  test('(T2) both took the fast road — neither is left in a queue for the other to jump', async () => {
    const { direct, queued } = await answerTurn()
    expect(idx(direct, SORRY) >= 0).toBe(true)
    expect(idx(direct, NEXT_ASK) >= 0).toBe(true)
    expect(queued.length).toBe(0)
  })

  // THE CODE FLOOR. The two tests above pin one pairing; this pins the RULE, so the next message added to the
  // agent cannot quietly re-open the fault. Every message SiteOps sends its sender inside a turn is a message
  // he is reading in sequence — there is no such thing, here, as one that may safely arrive ten seconds late.
  // (The outbox is not abandoned: sendNowDurable falls back to it. Nothing in this agent ENQUEUES ALONE.)
  test('(T3) not one message in the agent still takes the slow road on its own', () => {
    const src = readFileSync('supabase/functions/whatsapp-webhook/_agents/siteops.ts', 'utf8')
    expect(/\bsend\(ctx\.supabase/.test(src)).toBe(false)
    expect(/\bsend\(rctx\.supabase/.test(src)).toBe(false)
  })
})
