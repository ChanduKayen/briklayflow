// T1 — SITEOPS OPEN-CONVO SWEEPER JOURNEYS (j1–j5). Landed RED-FIRST in their own commit.
//
// Constitution clause 2: "Unanswered → park reason='project' with FULL payload." Today that park fires
// only when a NEXT message interrupts the open pick; a question nobody answers is a permanent OPEN convo
// intercepting that sender forever (the TRANSACTION abandon sweep is agent-gated, 20260613000015:81).
//
// Rulings locked (sprint log T1):
//   · TS sweep; the SQL TRANSACTION function untouched (j3 pins byte-identical = the TS sweep never
//     touches a TRANSACTION row).
//   · ONE park-insert site: the core extracted from commitInterruptedSiteops; the sweeper and the
//     interrupt path call the SAME core (j5 proves the extraction fixed the LIVE interrupt path too).
//   · TTL 24h on opened_at (SITEOPS_CONVO_TTL_HOURS); j2 pins that a slow human reply survives.
//   · PAYLOAD FIXES pinned here because they are LIVE floor violations, not sweeper niceties:
//     batch_collision parks NOTHING without a photo (piece_text eaten on interrupt — j4a/j5);
//     unit siteops_project drops the raw `text` the unit-resume requires (j4b).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { sweepStaleSiteopsConvos } from '../_siteops_sweep.ts'
import { commitInterruptedSiteops, type SiteopsCtx } from '../_agents/siteops.ts'
import type { ConvoRow } from '../_conversation.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const NOW = new Date('2026-07-06T12:00:00Z')
const STALE = '2026-07-05T00:00:00.000Z'   // 36h old — past the 24h TTL
const FRESH = '2026-07-06T10:00:00.000Z'   // 2h old — a slow human reply must survive (j2)

const convo = (over: Partial<ConvoRow> & { slots_so_far?: Record<string, unknown> } = {}): ConvoRow => ({
  id: 'cv-1', org_id: ORG, sender_number: SENDER, owning_agent: 'SITEOPS', status: 'OPEN',
  pending_question: 'which one?', slots_so_far: {}, staged_entry_id: null,
  last_action_summary: null, opened_at: STALE, closed_at: null, purge_at: null, last_message_id: 'wamid.in1',
  ...over,
} as ConvoRow)

const COLLISION_SLOTS = {
  kind: 'siteops_batch_collision', status: 'still_open',
  piece_text: 'columns pour done on stilt',
  candidates: [{ id: 'tk-col', kind: 'task', title: 'Columns — Stilt' }],
  project_id: 'P1', narration_id: 'narr-2', image: null,
}

const parks = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.writesTo('siteops_unplaced').filter((w) => w.op === 'insert')

suite('T1 — siteops open-convo sweeper (abandon→park @TTL)', () => {
  test('j1: SITEOPS OPEN >TTL → ABANDONED + five-part park (reason, payload, project_id, question_wamid); interception dies', async () => {
    const fake = fakeSupabase({
      wa_conversations: [convo({
        slots_so_far: {
          kind: 'siteops_typed_pick', project_id: 'P1', project_name: 'ASM Elite',
          item: { type: 'issue', text: 'crack near lift wall', task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: null },
          shortlist: [{ kind: 'issue', id: 'iss-1', label: 'crack near lift' }],
          narration_id: 'narr-9', image: { storagePath: 'wa_919_1.jpeg', caption: 'crack' },
        },
      })],
      wa_message_map: [{ outbound_wamid: 'wamid.q1', convo_id: 'cv-1' }],
    } as Seed)

    await sweepStaleSiteopsConvos(fake, { now: NOW })

    // five-part park: durable row + reason per kind-map + payload + project_id-when-known + question_wamid
    const ins = parks(fake)
    expect(ins.length).toBe(1)
    const p = ins[0].payload
    expect(p.reason).toBe('typed_pick')
    expect(p.project_id).toBe('P1')                                   // NOT null — the audit's two-site drop stays two
    expect((p.observation as { text?: string })?.text).toBe('crack near lift wall')
    expect(p.object_path).toBe('wa_919_1.jpeg')
    expect(p.narration_id).toBe('narr-9')
    const stamp = fake.writesTo('siteops_unplaced').find((w) => w.op === 'update')
    expect(stamp?.payload?.question_wamid).toBe('wamid.q1')
    // the interception dies with the convo: the OPEN row is flipped to ABANDONED
    const ab = fake.writesTo('wa_conversations').filter((w) => w.op === 'update' && w.payload?.status === 'ABANDONED')
    expect(ab.length).toBe(1)
    expect(ab[0].filters.some(([k, v]) => k === 'status' && v === 'OPEN')).toBe(true)
    expect(ab[0].filters.some(([k, v]) => k === 'sender_number' && v === SENDER)).toBe(true)
  })

  test('j2: SITEOPS OPEN <TTL → untouched (the 22-min lesson cuts both ways: a slow human reply survives)', async () => {
    const fake = fakeSupabase({
      wa_conversations: [convo({ opened_at: FRESH, slots_so_far: COLLISION_SLOTS })],
    } as Seed)
    await sweepStaleSiteopsConvos(fake, { now: NOW })
    expect(parks(fake).length).toBe(0)
    expect(fake.writesTo('wa_conversations').length).toBe(0)
  })

  test('j3: TRANSACTION >TTL → byte-identical (the TS sweep never touches the sibling agent)', async () => {
    const fake = fakeSupabase({
      wa_conversations: [convo({ owning_agent: 'TRANSACTION', slots_so_far: { payee: 'ramu', amount: '5000' } })],
    } as Seed)
    await sweepStaleSiteopsConvos(fake, { now: NOW })
    expect(parks(fake).length).toBe(0)
    expect(fake.writesTo('wa_conversations').length).toBe(0)
  })

  test('j4a: batch_collision >TTL parks {piece_text, candidates} — NOT nothing (the live eat, sweep caller)', async () => {
    const fake = fakeSupabase({ wa_conversations: [convo({ slots_so_far: COLLISION_SLOTS })] } as Seed)
    await sweepStaleSiteopsConvos(fake, { now: NOW })
    const ins = parks(fake)
    expect(ins.length).toBe(1)
    expect(ins[0].payload.reason).toBe('batch_collision')
    expect(ins[0].payload.project_id).toBe('P1')
    expect(ins[0].payload.observation).toEqual({
      piece_text: 'columns pour done on stilt',
      candidates: [{ id: 'tk-col', kind: 'task', title: 'Columns — Stilt' }],
    })
  })

  test('j4b: unit siteops_project >TTL parks {items, text} — the raw text the unit-resume requires; project_id null is honest', async () => {
    const fake = fakeSupabase({
      wa_conversations: [convo({
        slots_so_far: {
          kind: 'siteops_project',
          items: [{ type: 'progress', text: 'gate installation finished', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }],
          text: 'శ్యామ్ సైట్ లో గేట్ ఇన్స్టలేషన్ చేసేసాం',
          candidates: [{ id: 'P1', name: 'Shyam' }, { id: 'P2', name: 'ASM Elite' }],
          narration_id: 'narr-3', image: null,
        },
      })],
    } as Seed)
    await sweepStaleSiteopsConvos(fake, { now: NOW })
    const ins = parks(fake)
    expect(ins.length).toBe(1)
    const p = ins[0].payload
    expect(p.reason).toBe('project')
    expect(p.project_id ?? null).toBeNull()                            // the project IS the open question
    const obs = p.observation as { items?: unknown[]; text?: string }
    expect(obs?.items?.length).toBe(1)
    expect(obs?.text).toBe('శ్యామ్ సైట్ లో గేట్ ఇన్స్టలేషన్ చేసేసాం')
  })

  test('j5: interrupt-time collision (commitInterruptedSiteops) parks the SAME {piece_text, candidates} — the extraction fixes the LIVE path', async () => {
    const row = convo({ slots_so_far: COLLISION_SLOTS })
    const fake = fakeSupabase({ wa_conversations: [row] } as Seed)
    const ctx = { supabase: fake, from: SENDER, orgId: ORG, wamid: 'wamid.next', lang: 'en' } as SiteopsCtx
    await commitInterruptedSiteops(ctx, row)
    const ins = parks(fake)
    expect(ins.length).toBe(1)
    expect(ins[0].payload.observation).toEqual({
      piece_text: 'columns pour done on stilt',
      candidates: [{ id: 'tk-col', kind: 'task', title: 'Columns — Stilt' }],
    })
    // interrupt keeps its CLOSED-clean close (the sweeper's ABANDONED is the sweeper's own)
    const closed = fake.writesTo('wa_conversations').filter((w) => w.op === 'update' && w.payload?.status === 'CLOSED')
    expect(closed.length).toBe(1)
  })
})
