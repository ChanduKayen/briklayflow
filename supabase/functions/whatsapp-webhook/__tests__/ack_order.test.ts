// THE ANSWER ARRIVED BEFORE THE QUESTION (live probe, 2026-07-13, 17:19).
//
// One photo. The supervisor received, in this order:
//
//   17:19  📷 Got your photo — looking at it…  +  "This site has no floor First… Which of these is it about?"
//   17:20  📷 Got your photo — you said "…"  · "Here's what I can see in it: …"
//          "Checking it against the open work now — I'll confirm back."
//
// We promised to come back AFTER we had already come back. The photo confirmation — the whole point of
// which is to let him catch a misread BEFORE we act on it — landed a minute after we had acted on it.
//
// THE CAUSE IS THE TRANSPORT, NOT THE ORDERING. The turn says the ack first and the ask second; it always
// did. But the two words go by different roads:
//
//   • sendReceiptAck  → send()            → enqueued in `outbox`, drained by a pg_cron on a 10s tick
//   • askItemPick     → sendNowDurable()  → POSTed to Meta directly, in-turn
//
// So the ask, said second, was DELIVERED first — it took the fast road. outbox_order.test guards FIFO
// *within* the queue; that guarantee is worth nothing the moment a later message skips the queue entirely.
//
// THE RULE: a message a human is waiting on, that another message in the same turn must not overtake,
// takes the SAME road as that other message. Order of speaking = order of hearing.
//
// This test models both roads honestly: whatever is POSTed directly is delivered in call order, and the
// outbox drains AFTERWARDS (which is exactly what a 10-second cron does to a 4-second turn).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const CAPTION = 'The pride - 1st floor false ceilings ..unit a'
const DESCRIPTION = 'Installation of false ceilings on the first floor, Unit A.'

// The Pride, as it really is: a building with ONE floor (Ground) and its ceiling work on it. The caption
// names a FIRST floor, which does not exist — so the turn takes the no_such_floor road and ASKS which of
// the real rows he meant. That is the exact turn the probe recorded, and the ask is the message the ack
// must not be overtaken by.
// node_key is the engine's REAL key for this stack — an invented one is now filtered out of the candidate
// set before the model ever sees it (we never offer a row the guardrail would refuse), and the turn would
// have nothing to ask about.
const task = (id: string, name: string, key: string, floor: string, trade: string, phase: string) =>
  ({ task_id: id, name, project_id: 'P1', status: 'OPEN', floor_label: floor, unit_label: null, node_key: key, trade, phase, source: 'generated', order_source: 'auto' })
const seed = (): Seed => ({
  projects: [{
    project_id: 'P1', name: 'The Pride', org_id: ORG, status: 'Active', has_common_areas: false,
    construction_stack: { levels: [{ label: 'Ground', kind: 'residential', zones: [{ use: 'residential', units: 1 }] }] },
  }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'fcf-ground': task('fcf-ground', 'False-ceiling frame', 'ceiling_frame@Ground/unit', 'Ground', 'ceiling', 'services'),
    'cb-ground': task('cb-ground', 'Ceiling boarding', 'ceiling_board@Ground/unit', 'Ground', 'ceiling', 'finishes'),
  },
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const imgCtx = (fake: ReturnType<typeof fakeSupabase>) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
  image: { base64: 'x', mime: 'image/jpeg', caption: CAPTION, description: DESCRIPTION, storagePath: 'rough/x.jpg' },
})

const VISION = JSON.stringify({
  project_hint: 'The Pride',
  items: [{ type: 'progress', text: DESCRIPTION, confidence: 'high', task_hint: 'ceiling', structure: null, qc_statements: [] }],
})
// the live shape: the model names the frame and says the boarding fits just as well → a TIE → an ask.
const RESOLUTION = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: {
    found: true,
    updates: [{
      target_id: 'type:P1:false ceiling frame', target_kind: 'task', action: 'progress',
      confidence: 'med', closure_explicit: false, reason: 'false ceilings going in',
      alt_target_ids: ['type:P1:ceiling boarding'],
    }],
    nearest: [],
  },
})
const model = (system: string, user: string): Promise<string> => {
  if (user.startsWith('CANDIDATES:')) return Promise.resolve(RESOLUTION)
  if (user.includes('Decompose the image')) return Promise.resolve(VISION)
  return Promise.resolve('')
}

// ── the two roads ────────────────────────────────────────────────────────────────────────────────────────
// DIRECT: whatever sendNowDurable POSTs to Meta, in call order — delivered at once.
// QUEUED: whatever send() enqueues in `outbox` — delivered when the cron next ticks, i.e. AFTER the turn.
// The supervisor's phone shows: direct ++ queued.
interface Roads { direct: string[]; queued: string[]; delivered: string[] }
async function runTurn(): Promise<Roads> {
  const fake = fakeSupabase(seed())
  const direct: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = ((_url: string, init?: { body?: string }) => {
    // the WA Cloud API body — pull whatever human-readable text it carries (text / interactive / button)
    let body = ''
    try {
      const p = JSON.parse(init?.body ?? '{}')
      body = p?.text?.body ?? p?.interactive?.body?.text ?? ''
    } catch { /* not a message POST */ }
    if (body) direct.push(body)
    return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: `wamid.out${direct.length}` }] }), { status: 200 }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  try {
    await runSiteops(imgCtx(fake), `${CAPTION} -- ${DESCRIPTION}`, { callModel: model })
  } finally {
    globalThis.fetch = realFetch
  }
  const queued = fake.outbox()
  return { direct, queued, delivered: [...direct, ...queued] }
}

// The readback's shape IS its signature now: his words back, then ours. (Type 3.)
const ACK = /You said:|I see:/
const ASK = /❓/
const idx = (bodies: string[], re: RegExp) => bodies.findIndex((b) => re.test(b))

suite('siteops — the photo confirmation must not be overtaken by the question it precedes', () => {
  test('(A1) the photo ack is DELIVERED before the which_item ask', async () => {
    const { delivered } = await runTurn()
    const ack = idx(delivered, ACK)
    const ask = idx(delivered, ASK)
    expect(ack >= 0).toBe(true)   // it was sent at all
    expect(ask >= 0).toBe(true)   // …and the turn did ask (otherwise this test proves nothing)
    expect(ack < ask).toBe(true)  // …and he read it FIRST — "I'll confirm back" cannot follow the confirmation
  })

  test('(A2) it takes the SAME road as the ask — nothing a later message can overtake', async () => {
    const { direct, queued } = await runTurn()
    expect(idx(direct, ACK) >= 0).toBe(true)    // the fast road, like the ask
    expect(idx(queued, ACK) < 0).toBe(true)     // …and NOT left in the queue behind it
  })
})
