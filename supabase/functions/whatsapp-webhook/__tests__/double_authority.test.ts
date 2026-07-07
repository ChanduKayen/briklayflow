// SPRINT 1 · T3 — REMOVE judgeResolution's DOUBLE AUTHORITY (Hazard 4 / clause-4 sole-authority).
//
// THE HAZARD: a which_item ask opens a siteops_batch_collision; the supervisor confirms which item; the
// resume (siteops.ts:1763) applied the pick via applyBatchResolution with NO opts → for an ISSUE that
// re-invoked judgeResolution, an LLM that RE-JUDGED what the ladder had already ruled AND the human had
// just explicitly confirmed. Two authorities on one write.
//
// THE RULING (Q1): the confirm answers WHICH item, never WHETHER it is closed. So a confirmed match still
// needs closure_explicit to resolve; without it → ADDRESSING. The SOLE authority is the ladder. The fix
// threads the held AttachUpdate into the collision slots at ask-time, and the resume re-enters the ONE
// authority (executeResolution) with {...held, target_id: chosen.id, confidence:'high'} — the confirm
// upgrades match-confidence, never closure — then applies the ladder's verdict with `force` (judge skipped).
//
// RED-FIRST: j3 is the flip. Today the resume hardcodes status='still_open' and the only path to a resolve
// is the judge, which is dead in-harness (no key) → a legitimate confirmed resolve can NEVER land. j3
// asserts RESOLVED lands → RED today, GREEN once the ladder rules the confirm. j1/j2/j4 are the guards that
// lock the rest of the contract (addressing for a no-closure confirm; judge un-called; verdict-less floor).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ISS = 'iss-transformer'

const baseSeed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Lakshmi' }],
  problems: { [ISS]: { id: ISS, title: 'transformer humming', project_id: 'P1', status: 'OPEN' } },
  chase_batches: [{ id: 'batch-1', items: [{ kind: 'issue', id: ISS, orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'transformer humming', taskName: null, cause: 'other' }] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

// The slots the FIXED which_item opener writes (siteops.ts:551): the offered candidate PLUS the held
// AttachUpdate (the ladder's verdict-in-progress) threaded in as `update`. A verdict-less slot (no `update`)
// is the pre-T3 / fossil convo — j4's transition-window case.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collisionSlots = (update: any | null) => ({
  kind: 'siteops_batch_collision',
  status: 'still_open',
  piece_text: 'transformer సంగతి',
  candidates: [{ id: ISS, kind: 'issue', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'transformer humming', cause: 'other' }],
  project_id: 'P1',
  narration_id: 'narr-1',
  image: null,
  ...(update ? { update } : {}),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoWith = (slots: any) => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'confirm transformer', staged_entry_id: null, last_message_id: null, slots_so_far: slots }) as any

// A judge spy that WOULD resolve if consulted — so a regression that re-opens the judge's vote both bumps
// the injection-door count AND miswrites the status, making the double-authority visibly bite.
function judgeSpy() {
  let calls = 0
  const callModel = () => { calls++; return Promise.resolve(JSON.stringify({ resolved: true, reason: 'spy would close it' })) }
  return { callModel, calls: () => calls }
}

suite('siteops T3 — the ladder is the SOLE authority on a which_item confirm', () => {
  // j1 — LOW-match update, action:resolve but closure_explicit:FALSE. The confirm fixes WHICH item; it does
  // NOT supply closure. Ladder's HIGH rung (clear referent, vague closure) → ADDRESSING, never RESOLVE.
  // Assert the WRITTEN status.
  test('(j1) confirm a no-closure match → ADDRESSING written (not RESOLVED) — confirm answers WHICH, not WHETHER', async () => {
    const fake = fakeSupabase(baseSeed())
    const spy = judgeSpy()
    const update = { target_id: ISS, target_kind: 'issue', action: 'resolve', confidence: 'low', closure_explicit: false, reason: 'that transformer thing' }
    await answerSiteops(ctxFor(fake), '1', convoWith(collisionSlots(update)), { callModel: spy.callModel })

    const probUpd = fake.writesTo('problems').filter((w) => w.op === 'update')
    expect(probUpd.some((w) => w.payload?.status === 'ADDRESSING')).toBe(true)
    expect(probUpd.some((w) => w.payload?.status === 'RESOLVED')).toBe(false)
  })

  // j2 — the same resume path NEVER consults judgeResolution (injection-door count = 0). Same technique as
  // the fast-path's no-LLM assertion: inject the model door, assert it never fired. The ladder disposed the
  // confirm with `force`, so applyBatchResolution's judge branch is structurally unreachable.
  test('(j2) confirm resume → judgeResolution injection-door count = 0 (one authority, and it is the ladder)', async () => {
    const fake = fakeSupabase(baseSeed())
    const spy = judgeSpy()
    const update = { target_id: ISS, target_kind: 'issue', action: 'resolve', confidence: 'low', closure_explicit: false, reason: 'that transformer thing' }
    await answerSiteops(ctxFor(fake), '1', convoWith(collisionSlots(update)), { callModel: spy.callModel })

    expect(spy.calls()).toBe(0)
  })

  // j3 (THE FLIP) — LOW-MATCH-confidence but action:resolve AND closure_explicit:TRUE. The ambiguity the
  // ladder flagged was WHICH item, not WHETHER it closed — closure was already explicit. The confirm
  // resolves the WHICH; the ladder's HIGH rung (referent now certain + explicit closure) → RESOLVE lands.
  // Proves T3 removes the double-judge WITHOUT suppressing a legitimate confirmed resolve.
  // RED today: the resume can only reach a resolve through the (dead-in-harness) judge → never resolves.
  test('(j3) confirm a match whose closure was already explicit → RESOLVED lands (removal does not suppress a real resolve)', async () => {
    const fake = fakeSupabase(baseSeed())
    const spy = judgeSpy()
    const update = { target_id: ISS, target_kind: 'issue', action: 'resolve', confidence: 'low', closure_explicit: true, reason: 'transformer resolved' }
    await answerSiteops(ctxFor(fake), '1', convoWith(collisionSlots(update)), { callModel: spy.callModel })

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    expect(spy.calls()).toBe(0)   // and the resolve came from the LADDER, not the judge
  })

  // j4 (transition-window guard) — a verdict-less slot (stamped before T3 shipped, or a fossil) carries NO
  // held update. No stored closure_explicit = no proof of closure → FORCE ADDRESSING (the conservative,
  // ladder-consistent floor), and the judge is still never consulted. The chase re-asks; explicit closure
  // resolves it next cycle.
  test('(j4) verdict-less slot (pre-T3 stamp / fossil) → ADDRESSING forced, judge still un-called', async () => {
    const fake = fakeSupabase(baseSeed())
    const spy = judgeSpy()
    await answerSiteops(ctxFor(fake), '1', convoWith(collisionSlots(null)), { callModel: spy.callModel })

    const probUpd = fake.writesTo('problems').filter((w) => w.op === 'update')
    expect(probUpd.some((w) => w.payload?.status === 'ADDRESSING')).toBe(true)
    expect(probUpd.some((w) => w.payload?.status === 'RESOLVED')).toBe(false)
    expect(spy.calls()).toBe(0)
  })
})
