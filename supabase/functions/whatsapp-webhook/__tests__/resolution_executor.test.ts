// UNIFIED INBOUND RESOLUTION v2 — EXECUTOR Layer 2a gate (effectful, wiring → journey-tested). Drives the
// real applyTerminals over the fake supabase. The seams the single-terminal case can't cover: a FAILED
// effect must be PARKED (honest-reply AND actually-preserved — never an eat wearing an apology), the
// combined readback must tell the truth about a partial failure, and assertAllApplied must treat a
// failed-but-parked terminal as ACCOUNTED (a valid outcome), only throwing when an effect VANISHES.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyTerminals, answerSiteops, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal, AttachUpdate } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const execCtx = (itemsById: Map<string, BatchItem> = new Map(), labelById: Map<string, string> = new Map()): ExecCtx => ({ itemsById, labelById, cadenceMap: new Map(), actorId: null, now: new Date('2026-07-03T00:00:00Z'), narrationId: 'narr-1' })

const waterItem: BatchItem = { kind: 'issue', id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const upd = (o: Partial<AttachUpdate> & { target_id: string }): AttachUpdate => ({ target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'done', ...o })
const tUpdateResolve = (target_id: string): Terminal => ({ kind: 'object_updated', update: upd({ target_id }), applied: 'resolve', undo: true, readback: '', reason: '' })
const tCreate = (detail: string, project_hint: string | null): Terminal => ({ kind: 'object_created', item: { kind: 'issue', detail, location: null, project_hint, confidence: 'high' }, as: 'classified', upgradeOffer: false, reason: '' })

suite('siteops resolution v2 — executor applyTerminals (effects, honest readback, failed-parks)', () => {
  // object_updated resolve → the issue is RESOLVED (via force — NO re-judge) and the reply confirms it.
  test('(E1) object_updated resolve → problems RESOLVED + "✓ … resolved" readback', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    await applyTerminals(ctxFor(fake), [tUpdateResolve('iss-water')], execCtx(new Map([['iss-water', waterItem]])))

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    expect(fake.outbox().some((b) => /resolved/i.test(b))).toBe(true)
  })

  // A FAILED object_created (project unresolvable) must PARK to siteops_unplaced AND read back honestly —
  // "saved for review" is true because the observation actually survives.
  test('(E2) object_created fails → parked to siteops_unplaced + honest "couldn\'t log … saved for review"', async () => {
    const fake = fakeSupabase({ projects: [] })   // no projects → resolveProject null → create throws → park
    await applyTerminals(ctxFor(fake), [tCreate('tiles broke', 'ASM Elite')], execCtx())

    const park = fake.writesTo('siteops_unplaced')
    expect(park.length).toBe(1)
    expect(park[0].payload?.reason).toBe('v2_effect_failed')
    expect(park[0].payload?.observation).toBe('tiles broke')                 // preserved, not dropped
    expect(fake.outbox().some((b) => /couldn't log tiles broke — saved for review/i.test(b))).toBe(true)
  })

  // PARTIAL FAILURE in one message: resolve lands, create fails. The ONE reply tells the truth about BOTH,
  // resolve first (consequence order), and the failed half is parked.
  test('(E3) both-axes partial (resolve ok + create fails) → truthful combined readback + park', async () => {
    const fake = fakeSupabase({ projects: [] })   // create will fail; resolve still applies
    const outcomes = await applyTerminals(ctxFor(fake), [tUpdateResolve('iss-water'), tCreate('tiles broke', 'ASM Elite')], execCtx(new Map([['iss-water', waterItem]])))

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    expect(fake.writesTo('siteops_unplaced').length).toBe(1)                  // the failed half parked
    const reply = fake.outbox().find((b) => /Got it/i.test(b)) ?? ''
    expect(/✓ waterlogging in basement resolved/.test(reply)).toBe(true)      // resolve first
    expect(/⚠️ couldn't log tiles broke — saved for review/.test(reply)).toBe(true)
    // assertAllApplied did NOT throw: a failed-but-parked terminal is ACCOUNTED, not vanished.
    expect(outcomes.length).toBe(2)
    expect(outcomes.filter((o) => o.status === 'failed').length).toBe(1)
  })

  // 2b-OUTBOUND LINKAGE — the seam that arms undo, pinned as CONNECTED (tested separately, they'd both
  // pass while undo is dead in prod). After a resolve terminal: (a) the issue is stamped with a resolve
  // event, AND (b) the outbound is a BUTTONS message with the "Not resolved" button whose capture object_refs
  // carry the SAME event id. Event-set AND button-carries-it, or the round-trip can't complete.
  test('(OB-linkage) resolve → active_resolve_event stamped AND undo button carries the SAME event', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    await applyTerminals(ctxFor(fake), [tUpdateResolve('iss-water')], execCtx(new Map([['iss-water', waterItem]])))

    // (a) the issue carries a resolve-event stamp
    const stamped = fake.writesTo('problems').find((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')?.payload?.active_resolve_event
    expect(typeof stamped === 'string' && stamped.length > 0).toBe(true)
    // (b) the outbound is a buttons message with the undo button, capturing the SAME event
    const ob = fake.writesTo('outbox')[0]
    expect(ob.payload?.payload?.kind).toBe('buttons')
    expect((ob.payload?.payload?.buttons ?? []).some((b: { id: string }) => b.id === 'siteops_undo')).toBe(true)
    const refs = (ob.payload?.capture_ref?.object_refs ?? []) as { kind: string; id: string; event?: string }[]
    expect(refs.some((r) => r.kind === 'issue' && r.id === 'iss-water' && r.event === stamped)).toBe(true)   // LINKAGE
  })
})

suite('siteops resolution v2 — executor 2c (question_asked wiring + evidence structural park)', () => {
  const tQItem = (target_id: string): Terminal => ({ kind: 'question_asked', about: 'which_item', ref: target_id, update: upd({ target_id, confidence: 'low' }), reason: '' })
  const tQProject = (detail: string): Terminal => ({ kind: 'question_asked', about: 'which_project', ref: detail, item: { kind: 'issue', detail, location: null, project_hint: null, confidence: 'high' }, reason: '' })
  const tEvidence = (): Terminal => ({ kind: 'queued_as_evidence', reason: '' })

  // A LOW update → a confirm-or-new pick, wired through the PROVEN siteops_batch_collision resume: the
  // conversation stores exactly the offered candidate, and the prompt carries the ladder's consequence.
  test('(Q-item) question_asked(which_item) → opens siteops_batch_collision w/ the offered target + "it\'s new"', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    await applyTerminals(ctxFor(fake), [tQItem('iss-water')], execCtx(new Map([['iss-water', waterItem]])))

    const convo = fake.writesTo('wa_conversations')[0]
    expect(convo.payload?.slots_so_far?.kind).toBe('siteops_batch_collision')
    expect((convo.payload?.slots_so_far?.candidates ?? []).some((c: { id: string }) => c.id === 'iss-water')).toBe(true)
    const list = fake.writesTo('outbox').find((w) => w.payload?.payload?.kind === 'list')
    expect((list?.payload?.payload?.rows ?? []).some((r: { title: string }) => /it's new/i.test(r.title))).toBe(true)
    expect(/confirming marks it addressed/i.test(list?.payload?.payload?.body ?? '')).toBe(true)   // ladder context
  })

  // A new item with no resolvable site → which_project, wired through the proven siteops_project resume,
  // holding the observe item so the pick routes it fresh.
  test('(Q-project) question_asked(which_project) → opens siteops_project holding the item', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Lakshmi' }] })
    await applyTerminals(ctxFor(fake), [tQProject('crack in slab')], execCtx())

    const convo = fake.writesTo('wa_conversations')[0]
    expect(convo.payload?.slots_so_far?.kind).toBe('siteops_project')
    expect((convo.payload?.slots_so_far?.items ?? []).length).toBe(1)
  })

  // queued_as_evidence → the honest STRUCTURAL park (five-part: durable row + a DISTINCT parked_reason so
  // Step 6 can tell image-awaiting-placement from text-unsited; near-miss populated in Phase 3). Not a fail.
  test('(EV-park) queued_as_evidence → siteops_unplaced(evidence_await_placement) + honest evidence reply', async () => {
    const fake = fakeSupabase({})
    await applyTerminals(ctxFor(fake), [tEvidence()], execCtx())

    const park = fake.writesTo('siteops_unplaced')
    expect(park.length).toBe(1)
    expect(park[0].payload?.reason).toBe('evidence_await_placement')      // distinct from text_unsited
    expect(fake.outbox().some((b) => /photo saved as evidence/i.test(b))).toBe(true)
  })

  // AUDIT #7 — the evidence park must carry THE EVIDENCE. queued_as_evidence exists to hold a photo that
  // couldn't be placed; a park row without bucket/object_path is the eat wearing a receipt — the row says
  // "photo saved" while the photo is unfindable. When the inbound carried an image, the park carries it.
  test('(EV-evidence) queued_as_evidence park carries bucket + object_path — the photo is FINDABLE', async () => {
    const fake = fakeSupabase({})
    const ctx = { ...ctxFor(fake), image: { base64: 'zz', mime: 'image/jpeg', caption: 'store room', storagePath: 'wa_x_1.jpg' } }
    await applyTerminals(ctx, [tEvidence()], execCtx())

    const park = fake.writesTo('siteops_unplaced')[0]
    expect(park?.payload?.bucket).toBe('rough-entry-media')
    expect(park?.payload?.object_path).toBe('wa_x_1.jpg')
    expect(park?.payload?.caption).toBe('store room')
  })

  // SLOTS-STALENESS pin — the conversation-level twin of the candidate-membership guard. The resume must
  // validate a pick against the OFFERED set (slots.candidates), not a freshly-loaded set that shifted
  // between question and answer. Cheap documentation that the proven resume already does slots-not-reload.
  test('(Q-stale) answer validates against the OFFERED slots, not a re-load', async () => {
    const fake = fakeSupabase({ problems: { 'iss-offered': { status: 'OPEN' } } })
    const convo = {
      id: 'c1', org_id: ORG, sender_number: '919900000000', status: 'OPEN', owning_agent: 'SITEOPS',
      pending_question: 'which item', staged_entry_id: null, last_message_id: null,
      slots_so_far: { kind: 'siteops_batch_collision', status: 'still_open', piece_text: 'that thing', project_id: 'P1', candidates: [{ id: 'iss-offered', kind: 'issue', orgId: ORG, projectName: 'ASM Elite', title: 'waterlogging', cause: null }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    await answerSiteops(ctxFor(fake), '1', convo)   // pick #1 → the OFFERED candidate, from slots

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-offered'))).toBe(true)
  })
})

// DEFECT 2 + the NON-BATCH-TARGET distinguished park. The live probe: the model correctly matched a valid
// candidate OUTSIDE the open batch (itemsById miss). The old code threw → generic catch → 'v2_effect_failed'
// park + a readback that surfaced the raw target uuid ("⚠️ couldn't resolve 70b8c0c7-… — saved for review").
// Two fixes pinned here: (1) a terminal outcome may NEVER surface a raw id to a human — the label resolves
// from the candidate-title snapshot, else a generic phrase, never the uuid; (2) a non-batch target is not a
// FAILURE — it's UNDERSTOOD-BUT-HELD, parked DISTINGUISHED ('non_batch_target') with a replayable payload so
// Phase 3's fresh path can re-apply it, and read back as "couldn't … yet", not "⚠️ … failed".
suite('siteops resolution v2 — DEFECT 2 + non-batch-target held park', () => {
  const UUID = '70b8c0c7-c4ab-43de-b441-796ca9e830c8'
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

  // The live-probe shape: a resolve on a candidate that isn't in the open batch → held, parked distinguished,
  // and the readback names the item from the label map — NEVER the target uuid — and says HELD, not failed.
  test('(D2-label) non-batch resolve → understood-but-held readback names the item, not the uuid', async () => {
    const fake = fakeSupabase({})
    // itemsById is EMPTY (target is outside the batch → the non_batch_target path); labelById carries the
    // candidate title, exactly as handleBatchReply now builds it from res.candidates.
    await applyTerminals(ctxFor(fake), [tUpdateResolve(UUID)], execCtx(new Map(), new Map([[UUID, 'tiles not arrived']])))

    const reply = fake.outbox().find((b) => /saved for review/i.test(b)) ?? ''
    expect(/couldn't resolve tiles not arrived yet — saved for review/i.test(reply)).toBe(true)
    expect(/⚠️/.test(reply)).toBe(false)                        // HELD, not a ⚠️ failure
    expect(UUID_RE.test(reply)).toBe(false)
  })

  // The distinguished, REPLAYABLE park: reason 'non_batch_target' (not the generic 'v2_effect_failed'), and
  // the update payload + label ride in `candidates` so Phase 3 can mechanically re-apply the row.
  test('(D2-park) non-batch resolve → siteops_unplaced(non_batch_target) carrying the replay payload', async () => {
    const fake = fakeSupabase({})
    await applyTerminals(ctxFor(fake), [tUpdateResolve(UUID)], execCtx(new Map(), new Map([[UUID, 'tiles not arrived']])))

    const park = fake.writesTo('siteops_unplaced')
    expect(park.length).toBe(1)
    expect(park[0].payload?.reason).toBe('non_batch_target')
    expect(park[0].payload?.candidates?.target_id).toBe(UUID)     // replayable: the target
    expect(park[0].payload?.candidates?.update?.action).toBe('resolve')   // replayable: the update payload
    expect(park[0].payload?.candidates?.label).toBe('tiles not arrived')  // human label, not the uuid
  })

  // AUDIT #4 — executor parks must carry THE project when the unit resolved one (ExecCtx.projectId).
  // A park with project_id null when the site was KNOWN makes the replay re-ask what we already knew —
  // the same context-drop as the pending_stage2 landmine, one layer down.
  test('(D2-project) executor park stamps the known project onto the row', async () => {
    const fake = fakeSupabase({})
    await applyTerminals(ctxFor(fake), [tUpdateResolve(UUID)], { ...execCtx(new Map(), new Map([[UUID, 'tiles not arrived']])), projectId: 'P1' })

    const park = fake.writesTo('siteops_unplaced')[0]
    expect(park?.payload?.reason).toBe('non_batch_target')
    expect(park?.payload?.project_id).toBe('P1')
  })

  // The invariant, pinned to BITE: even with NO label available for the target, a raw uuid may never appear in
  // ANY readback line. Regex guard over the entire outbox; the label falls back to a generic phrase.
  test('(D2-nouuid) label unavailable → falls back to "that item", zero uuids across all readbacks', async () => {
    const fake = fakeSupabase({})
    await applyTerminals(ctxFor(fake), [tUpdateResolve(UUID)], execCtx(new Map(), new Map()))

    const reply = fake.outbox().find((b) => /saved for review/i.test(b)) ?? ''
    expect(/couldn't resolve that item yet — saved for review/i.test(reply)).toBe(true)
    expect(fake.outbox().every((b) => !UUID_RE.test(b))).toBe(true)
  })

  // The compound live-probe message: TWO valid non-batch targets (tiles resolve + transformer update) → ONE
  // combined understood-but-held readback grouping both under a single "saved for review", both parked, both
  // named, no uuid. This is the exact trace shape (two `no candidate` targets).
  test('(D2-compound) two non-batch targets → one grouped held readback, both parked, no uuid', async () => {
    const XFMR = 'f9f1660e-4384-418e-b3fe-1c330bd9fc57'
    const fake = fakeSupabase({})
    const labels = new Map([[UUID, 'tiles not arrived'], [XFMR, 'transformer not working']])
    await applyTerminals(
      ctxFor(fake),
      [tUpdateResolve(UUID), { kind: 'object_updated', update: upd({ target_id: XFMR, action: 'addressing' }), applied: 'addressing', undo: false, readback: '', reason: '' }],
      execCtx(new Map(), labels),
    )

    const reply = fake.outbox().find((b) => /saved for review/i.test(b)) ?? ''
    expect(/couldn't resolve tiles not arrived or update transformer not working yet — saved for review/i.test(reply)).toBe(true)
    expect(fake.writesTo('siteops_unplaced').length).toBe(2)   // both parked, neither dropped
    expect(fake.outbox().every((b) => !UUID_RE.test(b))).toBe(true)
  })
})
