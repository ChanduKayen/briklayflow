// NEVER OFFER A ROW THE GUARDRAIL WOULD REFUSE (live probe, 2026-07-13, 17:19).
//
// The guardrail is the last line: a write onto a row the UI cannot render (node_key ∉ VM) is REFUSED, so a
// dead row can never read back as "✓ logged". It did its job. The supervisor still lost his update — because
// by the time it fired, we had already ASKED him to pick that row, and he had picked it:
//
//     1. Ceiling — false-ceiling frame — Ground        ← node_key ceiling_frame@Ground#Ground-unit-dry
//     …
//     "Couldn't update “Ceiling — false-ceiling frame — Ground” just now — saved it for review."
//
// A guardrail that only speaks at the write can only ever produce that sentence. The candidate builder's own
// comment already states the rule — "the model can only mis-target what we offer" — and then offers every
// engine row in the table, VM or no VM. So the rule has to hold at the OFFER, which is the only place it can
// still be kind: what we show him is what exists.
//
// Reconcile-before-read (the sibling fix) makes the DB true, and would have been enough HERE. It is not
// enough in general: reconcile deliberately KEEPS an obsolete row a human has re-ordered by hand
// (`order_source='manual'` — persist.ts), and such a row is out of the VM forever. Offered forever, refused
// forever. The filter is the durable rule; the reconcile is what makes the right row exist to offer instead.
//
// THE SETUP is the live one, exactly: the SAME ceiling task, twice — once under the key the old zone-split
// library generated, once under the key the current one does. Both rows sit in site_tasks (the fake's reads
// return the seed, so the reconcile cannot hide the dead one — which is precisely the point: this is the
// filter under test, not the reconcile). One of them is real. He must never be shown the other.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import { buildCandidateSet } from '../_siteops_resolution_llm.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const CAPTION = 'The pride - 1st floor false ceilings ..unit a'
const DESCRIPTION = 'Installation of false ceilings on the first floor, Unit A.'

const DEAD = 'ceiling_frame@Ground#Ground-unit-dry'   // the old zone-split key, verbatim from the probe
const LIVE = 'ceiling_frame@Ground/unit'              // what the current library actually generates

// The Pride: one floor (Ground), and the ceiling-frame task present TWICE — the row the engine builds today,
// and the fossil of the library that came before it. Same name, same floor, indistinguishable in a list.
const seed = (): Seed => ({
  projects: [{
    project_id: 'P1', name: 'The Pride', org_id: ORG, status: 'Active', has_common_areas: false,
    construction_stack: { levels: [{ label: 'Ground', kind: 'residential', zones: [{ use: 'residential', units: 1 }] }] },
  }],
  site_tasks: {
    'live-fcf': {
      task_id: 'live-fcf', project_id: 'P1', name: 'Ceiling — false-ceiling frame', status: 'OPEN',
      floor_label: 'Ground', unit_label: null, trade: 'ceiling', phase: 'services',
      node_key: LIVE, source: 'generated', order_source: 'auto', seq_no: 40,
    },
    'dead-fcf': {
      task_id: 'dead-fcf', project_id: 'P1', name: 'Ceiling — false-ceiling frame', status: 'OPEN',
      floor_label: 'Ground', unit_label: null, trade: 'ceiling', phase: 'services',
      node_key: DEAD, source: 'generated', order_source: 'auto', seq_no: 41,
    },
  },
  problems: {}, chase_batches: [],
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
const RESOLUTION = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: {
    found: true,
    updates: [{
      target_id: 'type:P1:ceiling false ceiling frame', target_kind: 'task', action: 'progress',
      confidence: 'high', closure_explicit: false, reason: 'false ceilings going in', alt_target_ids: [],
    }],
    nearest: [],
  },
})
const model = (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? RESOLUTION : user.includes('Decompose the image') ? VISION : '')

// the ids frozen into the pick's slots at ask-time — literally the list he is shown
const offered = (fake: ReturnType<typeof fakeSupabase>): string[] => {
  const convo = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
  return ((convo?.payload?.slots_so_far?.candidates ?? []) as { id: string }[]).map((c) => c.id)
}

suite('siteops — what we OFFER is what EXISTS (no pick onto a row the guardrail must refuse)', () => {
  test('(V1) the pick offers the live row and NOT the fossil the library no longer generates', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- ${DESCRIPTION}`, { callModel: model })
    const ids = offered(fake)
    expect(ids.length > 0).toBe(true)          // he WAS asked (the caption names a floor this site hasn't got)
    expect(ids.includes('live-fcf')).toBe(true)
    expect(ids.includes('dead-fcf')).toBe(false)   // …and never shown the row that cannot be written to
  })

  test('(V2) buildCandidateSet drops the out-of-VM row from the type it carries — the pin can never reach it', async () => {
    const fake = fakeSupabase(seed())
    const vm = { keys: new Set([LIVE]), names: new Set(['ceiling false ceiling frame']) }
    const cands = await buildCandidateSet(fake, ORG, null, 'P1', vm)
    const ceiling = cands.find((c) => c.kind === 'task' && /false-ceiling frame/i.test(c.title ?? ''))
    expect(!!ceiling).toBe(true)
    const rowIds = (ceiling!.rows ?? []).map((r) => r.id)
    expect(rowIds.includes('live-fcf')).toBe(true)
    expect(rowIds.includes('dead-fcf')).toBe(false)
  })

  test('(V3) no VM to judge against → the set is UNCHANGED (absent is not a licence to hide real work)', async () => {
    const fake = fakeSupabase(seed())
    const cands = await buildCandidateSet(fake, ORG, null, 'P1')
    const ceiling = cands.find((c) => c.kind === 'task' && /false-ceiling frame/i.test(c.title ?? ''))
    const rowIds = (ceiling?.rows ?? []).map((r) => r.id)
    expect(rowIds.includes('live-fcf')).toBe(true)
    expect(rowIds.includes('dead-fcf')).toBe(true)
  })
})
