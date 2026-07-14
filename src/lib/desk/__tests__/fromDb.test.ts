// DB rows → the UI model. The state derivation is the thing the whole Problems tab hangs off,
// so it is pinned hard, against a FIXED clock (these functions take `now`, they never read one).

import { suite, test, expect } from './harness'
import {
  deriveState, trailFacts, statusLine, chaseWhen, toDeskProblem, toDeskTask, blockersByTask,
  toQcChecks, qcAlarm, qcAlarmIsLoud, buildTaskStory, narrationIdsOf, statusShort, outcomeWord, outcomeKey, ago,
} from '../fromDb'
import type { EventRow, ProblemRow, QcRow, ResolutionRow, TaskRow } from '../fromDb'

const NOW = Date.parse('2026-07-12T09:00:00Z')
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString()

const P = (o: Partial<ProblemRow>): ProblemRow => ({
  id: 'p1', ref: 'DSR-21', kind: 'issue', title: 'Water not arranged', status: 'OPEN',
  cause: 'material', confidence: 'high', project_id: 'PRJ', task_id: null, owner_id: 'u1',
  floor_label: null, unit_label: null, area_label: null,
  next_followup_at: null, deadline: null, created_at: daysAgo(6), updated_at: daysAgo(1), ...o,
})
const E = (type: string, at: string, body = ''): EventRow =>
  ({ id: Math.random().toString(), problem_id: 'p1', type, body, actor_kind: 'system', created_at: at })

const ctx = (o: Partial<Parameters<typeof toDeskProblem>[1]> = {}) => ({
  events: [], photos: [], resolution: null,
  siteName: 'Dr Sonudharya Residence', siteCode: 'DSR',
  nameOf: (id: string | null) => (id ? 'Jaggu' : ''),
  phoneOf: () => '+91 98765 40012',
  now: NOW, ...o,
})

suite('deriveState — who has the ball', () => {
  test('RESOLVED → resolved', () => {
    expect(deriveState(P({ status: 'RESOLVED' }), trailFacts([]))).toBe('resolved')
  })
  test('DISMISSED (retracted) also reads as resolved — it leaves the open list', () => {
    expect(deriveState(P({ status: 'DISMISSED' }), trailFacts([]))).toBe('resolved')
  })
  test('ESCALATED outranks everything — nobody left to chase means it is HIS', () => {
    const t = trailFacts([E('escalated', daysAgo(1))])
    expect(deriveState(P({ status: 'ADDRESSING', next_followup_at: inDays(1) }), t)).toBe('you')
  })
  test('ADDRESSING → moving: someone accepted it and is acting', () => {
    expect(deriveState(P({ status: 'ADDRESSING' }), trailFacts([]))).toBe('moving')
  })
  test('OPEN with a chase clock → chasing: Babai has it', () => {
    expect(deriveState(P({ next_followup_at: inDays(1) }), trailFacts([]))).toBe('chasing')
  })
  test('THE DEFAULT IS `you` — an open item nobody is chasing is not "fine", and must not hide in grey', () => {
    expect(deriveState(P({ next_followup_at: null }), trailFacts([]))).toBe('you')
  })
})

suite('trailFacts', () => {
  test('counts chases, finds the last of each, spots an escalation', () => {
    const t = trailFacts([
      E('chase_sent', daysAgo(5)), E('reply_received', daysAgo(4)), E('chase_sent', daysAgo(3)),
      E('escalated', daysAgo(1)), E('comment', daysAgo(1)),
    ])
    expect(t.chases).toBe(2)
    expect(t.lastChaseAt).toBe(daysAgo(3))
    expect(t.lastReplyAt).toBe(daysAgo(4))
    expect(t.escalated).toBe(true)
  })
})

suite('chaseWhen — the cron is DAILY at 09:00 IST, so we never say "6 pm"', () => {
  test('due today', () => { expect(chaseWhen(inDays(0), NOW)).toBe('today') })
  test('due tomorrow reads as "tomorrow morning" — which is when it actually runs', () => {
    expect(chaseWhen(inDays(1), NOW)).toBe('tomorrow morning')
  })
  test('further out gets a date, not a fake time', () => {
    expect(chaseWhen(inDays(5), NOW)).toContain('on ')
  })
  test('no clock set → no claim made', () => { expect(chaseWhen(null, NOW)).toBe(null) })
})

suite('statusLine — one line, and TRUE', () => {
  const t0 = trailFacts([])

  test('escalated says so plainly', () => {
    const t = trailFacts([E('escalated', daysAgo(1))])
    expect(statusLine(P({}), 'you', t, null, 'Jaggu', false, NOW))
      .toBe('Waiting on you — escalated, no one above to chase')
  })

  test('unowned says nobody is assigned — rather than pretending someone is on it', () => {
    expect(statusLine(P({ owner_id: null }), 'you', t0, null, '', false, NOW))
      .toBe('Waiting on you — nobody assigned yet')
  })

  test('silence names the person, the days and the chases — and gets the singular right', () => {
    const t = trailFacts([E('chase_sent', daysAgo(4))])
    expect(statusLine(P({}), 'you', t, null, 'Jaggu', false, NOW))
      .toBe('Waiting on you — Jaggu silent 4 days, one chase done')
  })

  test('two chases pluralise', () => {
    const t = trailFacts([E('chase_sent', daysAgo(5)), E('chase_sent', daysAgo(1))])
    expect(statusLine(P({}), 'you', t, null, 'Jaggu', false, NOW))
      .toBe('Waiting on you — Jaggu silent 1 day, 2 chases done')
  })

  test('chasing quotes the REAL next-chase time', () => {
    expect(statusLine(P({ next_followup_at: inDays(1) }), 'chasing', t0, null, 'Jaggu', false, NOW))
      .toBe('Babai chases again tomorrow morning')
  })

  test('moving with a fix photo offers the close', () => {
    expect(statusLine(P({ status: 'ADDRESSING' }), 'moving', t0, null, 'Ramesh', true, NOW))
      .toBe('Fixed · photo received — confirm to close')
  })

  test('a closed item names its outcome and who closed it', () => {
    const r: ResolutionRow = {
      problem_id: 'p1', outcome: 'fixed', note: 'n', duplicate_of: null,
      closed_by: 'u1', auto_closed: false, closed_at: daysAgo(1), reopened_at: null,
    }
    expect(statusLine(P({ status: 'RESOLVED' }), 'resolved', t0, r, 'Jaggu', false, NOW))
      .toBe('Fixed · closed by you')
  })

  test('an AUTO-close is attributed to Babai — he did not do it, and must not be told he did', () => {
    const r: ResolutionRow = {
      problem_id: 'p1', outcome: 'fixed', note: 'n', duplicate_of: null,
      closed_by: null, auto_closed: true, closed_at: daysAgo(1), reopened_at: null,
    }
    expect(statusLine(P({ status: 'RESOLVED' }), 'resolved', t0, r, 'Jaggu', false, NOW))
      .toBe('Fixed · closed by Babai')
  })
})

suite('statusShort — the row does not repeat the medallion', () => {
  test('THE DOT ALREADY SAYS "waiting on you" — the row spends its width on what you do NOT know', () => {
    expect(statusShort('Waiting on you — Jaggu silent 4 days, 2 chases done', 'you'))
      .toBe('Jaggu silent 4 days, 2 chases done')
  })

  test('the same for an unowned item', () => {
    expect(statusShort('Waiting on you — nobody assigned yet', 'you')).toBe('Nobody assigned yet')
  })

  test('"Babai" is the dot too — a breathing medallion IS Babai having it', () => {
    expect(statusShort('Babai chases again tomorrow morning', 'chasing')).toBe('Chases again tomorrow morning')
  })

  test('a sentence with nothing to strip survives whole', () => {
    expect(statusShort('Fixed · photo received — confirm to close', 'moving'))
      .toBe('Fixed · photo received — confirm to close')
    expect(statusShort('Fixed · closed by you', 'resolved')).toBe('Fixed · closed by you')
  })

  test('stripping never leaves an empty row — if there is nothing left, the whole sentence stays', () => {
    expect(statusShort('Waiting on you', 'you')).toBe('Waiting on you')
  })
})

suite('outcome keys survive the round trip', () => {
  test('word → key → word', () => {
    for (const w of ['Fixed', 'Client said ok', 'Not a problem', 'Same as another'] as const) {
      expect(outcomeWord(outcomeKey(w))).toBe(w)
    }
  })
})

suite('toDeskProblem', () => {
  test('a snag builds its location from floor · unit · area', () => {
    const d = toDeskProblem(P({ kind: 'snag', floor_label: '1st floor', unit_label: null, area_label: 'bedroom 2' }), ctx())
    expect(d.loc).toBe('1st floor · bedroom 2')
    expect(d.tag).toBe(null)
  })

  test('a snag with no place says Project-wide, never an empty slot', () => {
    expect(toDeskProblem(P({ kind: 'snag' }), ctx()).loc).toBe('Project-wide')
  })

  test('an issue carries its cause as the category, capitalised', () => {
    expect(toDeskProblem(P({ kind: 'issue', cause: 'labour' }), ctx()).tag).toBe('Labour')
  })

  test('a snag being chased for evidence shows "photo pending"', () => {
    const d = toDeskProblem(P({ kind: 'snag', next_followup_at: inDays(1) }), ctx())
    expect(d.photoPending).toBe(true)
  })

  test('...but NOT once the photo is in', () => {
    const d = toDeskProblem(P({ kind: 'snag', next_followup_at: inDays(1) }),
      ctx({ photos: [{ parent_id: 'p1', role: 'creation', caption: 'the crack', url: 'u' }] }))
    expect(d.photoPending).toBe(false)
    expect(d.photos?.[0].l).toBe('the crack')
  })

  test('an answer photo on a moving item offers the pre-filled close', () => {
    const d = toDeskProblem(P({ status: 'ADDRESSING' }),
      ctx({ photos: [{ parent_id: 'p1', role: 'answer', caption: null, url: 'u' }] }))
    expect(d.verify).toBe(true)
    expect(d.prefillNote).toBe('Verified from the fix photo')
  })

  test('an inbound reply becomes a WhatsApp bubble in the story; a comment becomes a private note', () => {
    const d = toDeskProblem(P({}), ctx({
      events: [E('reply_received', daysAgo(2), 'Tanker strike sir'), E('comment', daysAgo(1), 'called him')],
    }))
    expect(d.story[0]).toEqual({ t: 'msg', from: 'Jaggu', text: 'Tanker strike sir', w: '2 days ago' })
    expect(d.story[1]).toEqual({ t: 'note', text: 'called him', w: 'yesterday' })
  })

  test('a row with no ref yet degrades to a dash — it never renders "null"', () => {
    expect(toDeskProblem(P({ ref: null }), ctx()).ref).toBe('—')
  })
})

suite('blockersByTask — DERIVED from problems.task_id, never stored', () => {
  test('an open issue on a task blocks it', () => {
    const m = blockersByTask([P({ id: 'p1', ref: 'DSR-19', task_id: 't1', status: 'OPEN' })])
    expect(m.get('t1')).toBe('DSR-19')
  })

  test('THE BLOCK EVAPORATES WHEN THE PROBLEM CLOSES — there is no stale flag to clean up', () => {
    expect(blockersByTask([P({ id: 'p1', ref: 'DSR-19', task_id: 't1', status: 'RESOLVED' })]).size).toBe(0)
    expect(blockersByTask([P({ id: 'p1', ref: 'DSR-19', task_id: 't1', status: 'DISMISSED' })]).size).toBe(0)
  })

  test('a SNAG does not block — it is rework on work already done, not a thing stopping work', () => {
    expect(blockersByTask([P({ kind: 'snag', task_id: 't1', status: 'OPEN' })]).size).toBe(0)
  })

  test('with two open issues on one task, the OLDEST is named — it has held the work up longest', () => {
    const m = blockersByTask([
      P({ id: 'a', ref: 'DSR-30', task_id: 't1', created_at: daysAgo(1) }),
      P({ id: 'b', ref: 'DSR-19', task_id: 't1', created_at: daysAgo(6) }),
    ])
    expect(m.get('t1')).toBe('DSR-19')
  })

  test('a project-level issue (no task) blocks nothing', () => {
    expect(blockersByTask([P({ task_id: null })]).size).toBe(0)
  })
})

suite('toDeskTask', () => {
  const T = (o: Partial<TaskRow>): TaskRow => ({
    task_id: 't1', ref: 'DSR-30', name: 'Columns', phase: 'structure', trade: 'civil',
    status: 'todo', floor_label: 'Ground', unit_label: null, seq_no: 3, duration_days: 4,
    started_at: null, owner_id: 'u1', node_key: 'columns@Ground', binding: [],
    updated_at: daysAgo(1), ...o,
  })
  const tctx = {
    refByNodeKey: new Map([['floor_rebar@Ground', 'DSR-29']]),
    blockerByTaskId: new Map([['t1', 'DSR-19']]),
    nameOf: () => 'Ravi',
    now: NOW,
  }

  test('`afters` comes from the ENGINE\'s binding, mapped node_key → ref — the UI never invents a dependency', () => {
    const d = toDeskTask(T({ binding: [{ node_key: 'floor_rebar@Ground', nature: 'IMPOSSIBLE', reason: 'structural' }] }), tctx)
    expect(d.afters).toEqual([{ ref: 'DSR-29', nature: 'IMPOSSIBLE', reason: 'structural', nodeKey: 'floor_rebar@Ground' }])
  })

  /**
   * THE SEVERITY RIDES ALONG, because a DRAG has to be judged and judged truthfully. You cannot wire
   * a slab that was never poured (IMPOSSIBLE → refuse); you CAN chase a plastered wall (DESTRUCTIVE →
   * allow, and say what it costs). Flattening both into "a dependency" would make the desk lie about
   * the building in one direction or the other.
   */
  test('the nature and reason survive the trip — the drag referee needs them (see checkMove)', () => {
    const d = toDeskTask(T({ binding: [{ node_key: 'floor_rebar@Ground', nature: 'DESTRUCTIVE', reason: 'concealment' }] }), tctx)
    expect(d.afters[0].nature).toBe('DESTRUCTIVE')
    expect(d.afters[0].reason).toBe('concealment')
  })

  test('a binding with no severity degrades to the STRICTEST reading, never the loosest', () => {
    // A gate we cannot interpret must not become a drag we silently wave through.
    const d = toDeskTask(T({ binding: [{ node_key: 'floor_rebar@Ground' }] }), tctx)
    expect(d.afters[0].nature).toBe('IMPOSSIBLE')
  })

  /**
   * EVERY HARD PREDECESSOR, NOT THE FIRST ONE.
   *
   * `binding` is written by persist.ts already FILTERED to isHardNature() — every entry in it is a
   * hard gate, and the engine's own availability rule (evaluate.ts) is "available ⟺ ALL of them are
   * done". The desk kept `binding.find(...)` — the FIRST hard pred — and threw the rest away. A task
   * waiting on three things therefore reported itself startable the moment ONE of them finished, and
   * "Up next" pointed the site at work that could not begin.
   */
  test('ALL hard predecessors survive — not just binding[0]', () => {
    const ctx = { ...tctx, refByNodeKey: new Map([['floor_rebar@Ground', 'DSR-29'], ['shuttering@Ground', 'DSR-28']]) }
    const d = toDeskTask(T({ binding: [{ node_key: 'floor_rebar@Ground' }, { node_key: 'shuttering@Ground' }] }), ctx)
    expect(d.afters.map((g) => g.ref)).toEqual(['DSR-29', 'DSR-28'])
  })

  test('a predecessor with no row in this project is dropped, not carried as a dangling ref', () => {
    const d = toDeskTask(T({ binding: [{ node_key: 'floor_rebar@Ground' }, { node_key: 'gone@Ground' }] }), tctx)
    expect(d.afters.map((g) => g.ref)).toEqual(['DSR-29'])
  })

  test('no binding → no predecessors', () => {
    expect(toDeskTask(T({ binding: [] }), tctx).afters).toEqual([])
  })

  test('a blocking problem becomes its ref', () => {
    expect(toDeskTask(T({ task_id: 't1' }), tctx).blockedBy).toBe('DSR-19')
  })

  test('a task nothing points at is not blocked', () => {
    expect(toDeskTask(T({ task_id: 't9' }), tctx).blockedBy).toBe(null)
  })

  test('an active task counts the day it is on', () => {
    expect(toDeskTask(T({ status: 'active', started_at: daysAgo(2), duration_days: 4 }), tctx).started).toBe(3)
  })

  test('AN OVERRUN IS NOT ROUNDED AWAY. This used to cap at the duration, so a task on day 9 of a 4-day job reported "day 4 of 4" — the app quietly telling him it was on schedule.', () => {
    expect(toDeskTask(T({ status: 'active', started_at: daysAgo(8), duration_days: 4 }), tctx).started).toBe(9)
  })

  test('not_started maps to the UI\'s todo', () => {
    expect(toDeskTask(T({}), tctx).state).toBe('todo')
  })

  test('an unowned task says Unassigned rather than rendering an empty name', () => {
    expect(toDeskTask(T({ owner_id: null }), { ...tctx, nameOf: () => '' }).assignee).toBe('Unassigned')
  })
})

suite('quality checks', () => {
  const Q = (o: Partial<QcRow>): QcRow => ({
    id: 'q1', task_id: 't1', question: 'cover blocks?', is_critical: false, seq: 1,
    answer: null, qc_status: 'pending', ...o,
  })

  test('the CRITICAL check leads — it is the one that costs money', () => {
    const out = toQcChecks([Q({ id: 'a', seq: 1 }), Q({ id: 'b', seq: 2, is_critical: true })])
    expect(out[0].id).toBe('b')
    expect(out[0].critical).toBe(true)
  })

  test('an unknown status degrades to pending, never to "fine"', () => {
    expect(toQcChecks([Q({ qc_status: 'banana' })])[0].status).toBe('pending')
  })

  test('A FAILED CHECK IS AN ALARM — the work is wrong and will need redoing', () => {
    expect(qcAlarm({ state: 'todo', qc: toQcChecks([Q({ qc_status: 'failed' })]) })).toBe('failed')
  })

  test('a pending CRITICAL check on work happening NOW is the last chance to look', () => {
    const qc = toQcChecks([Q({ is_critical: true, qc_status: 'pending' })])
    expect(qcAlarm({ state: 'active', qc })).toBe('last_chance')
  })

  test('THE SAME CHECK ON FINISHED WORK IS "UNVERIFIED", NOT AN ALARM — the moment has passed, and shouting it on every done task drowns the real failures', () => {
    const qc = toQcChecks([Q({ is_critical: true, qc_status: 'pending' })])
    expect(qcAlarm({ state: 'done', qc })).toBe('unverified')
    expect(qcAlarmIsLoud(qcAlarm({ state: 'done', qc }))).toBe(false)   // never reaches the row
    expect(qcAlarmIsLoud(qcAlarm({ state: 'active', qc }))).toBe(true)
  })

  test('...but the same check on work that has not STARTED is not an alarm — there is nothing to look at yet', () => {
    expect(qcAlarm({ state: 'todo', qc: toQcChecks([Q({ is_critical: true })]) })).toBe(null)
  })

  test('a failed check outranks a pending critical one — the worse truth wins', () => {
    const qc = toQcChecks([Q({ id: 'a', is_critical: true, qc_status: 'pending' }), Q({ id: 'b', qc_status: 'failed' })])
    expect(qcAlarm({ state: 'active', qc })).toBe('failed')
  })

  test('all confirmed → quiet. A check that has done its job says nothing.', () => {
    expect(qcAlarm({ state: 'done', qc: toQcChecks([Q({ is_critical: true, qc_status: 'confirmed' })]) })).toBe(null)
  })

  test('a task with no checks raises nothing', () => {
    expect(qcAlarm({ state: 'done' })).toBe(null)
  })
})

suite('buildTaskStory — the WhatsApp update that vanished', () => {
  const story = (
    hist: unknown,
    comments: Parameters<typeof buildTaskStory>[1] = [],
    narrations: Parameters<typeof buildTaskStory>[2] = [],
    photos: Parameters<typeof buildTaskStory>[3] = [],
  ) => buildTaskStory(hist, comments, narrations, photos, NOW)

  test('a site comment becomes a BUBBLE — it is somebody\'s words', () => {
    const s = story([], [
      { id: 'c1', task_id: 't1', author_name: 'Ravi', body: 'Slab poured, curing started', created_at: daysAgo(1) },
    ])
    expect(s[0]).toEqual({ t: 'msg', from: 'Ravi', text: 'Slab poured, curing started', w: 'yesterday' })
  })

  test('a status change becomes an event, named in plain words', () => {
    const s = story([{ status: 'done', at: daysAgo(2), by: 'Ravi' }])
    expect(s[0]).toEqual({ t: 'event', l: 'Marked done by Ravi', w: '2 days ago' })
  })

  test('A NARRATION THAT MOVED NOTHING IS STILL AN EVENT — "I told Babai and nothing happened" starts here', () => {
    const s = story([{ at: daysAgo(1), by: 'Ravi', source: 'narration' }])
    expect(s[0]).toEqual({ t: 'event', l: 'Update from Ravi', w: 'yesterday' })
  })

  test('comments and status changes interleave in time order — one story, not two lists', () => {
    const s = story(
      [{ status: 'active', at: daysAgo(3), by: 'Ravi' }, { status: 'done', at: daysAgo(1), by: 'Ravi' }],
      [{ id: 'c1', task_id: 't1', author_name: 'Ravi', body: 'halfway', created_at: daysAgo(2) }],
    )
    expect(s.map((x) => x.t)).toEqual(['event', 'msg', 'event'])
  })

  test('junk in status_history is skipped, never rendered as a blank line', () => {
    expect(story([{ nonsense: true }, null, 'x'])).toEqual([])
    expect(story(null)).toEqual([])
  })

  // ── THE WORDS. A resolver writes only the narration's ID onto the task; the message itself lives
  //    in site_narrations. The desk rendered the event and never went and got the words.
  test("HIS ACTUAL MESSAGE, not just 'Marked in progress by +9183…'", () => {
    const at = daysAgo(1)
    const s = story(
      [{ status: 'active', at, by: '+918330972705', source: 'narration', narration_id: 'n1' }],
      [],
      [{ id: 'n1', raw_text: 'Slab poured, curing started', created_at: at, sender_name: 'Ravi' }],
    )
    // BOTH: the status moved, AND here is what he said. Two different facts — folding them into one
    // line loses whichever the reader came for.
    expect(s.map((x) => x.t)).toEqual(['event', 'msg'])
    expect(s[0]).toEqual({ t: 'event', l: 'Marked in progress by +918330972705', w: 'yesterday' })
    expect(s[1]).toEqual({ t: 'msg', from: 'Ravi', text: 'Slab poured, curing started', w: 'yesterday' })
  })

  test('one message that touched the task twice is still said once', () => {
    const at = daysAgo(2)
    const s = story(
      [{ status: 'active', at, by: 'Ravi', narration_id: 'n1' }, { at, by: 'Ravi', narration_id: 'n1' }],
      [],
      [{ id: 'n1', raw_text: 'started', created_at: at, sender_name: 'Ravi' }],
    )
    expect(s.filter((x) => x.t === 'msg').length).toBe(1)
  })

  /**
   * ══ WE DO NOT PUT WORDS IN HIS MOUTH ═══════════════════════════════════════════════════════════
   *
   * A photo message is stored as ONE composite string carrying TWO voices — his caption, and our read
   * of the pixels:
   *
   *     <caption>Ceiling work in pride site 4th floor</caption>
   *     <photo>Ceiling installation framework visible at the construction site on the 4th floor</photo>
   *
   * The desk printed the whole thing, markers and all, in a speech bubble with his NAME on it. So a
   * sentence a machine wrote was shown to his boss as a sentence the supervisor had said. He never
   * said it. We did. (The webhook was bitten by exactly this and fixed it — humanizeInbound; the desk
   * was never told.)
   *
   * The bubble carries his caption and nothing else. Our read goes on the PHOTO, where it is ours.
   */
  test('OUR read of a photo is never spoken in HIS voice', () => {
    const at = daysAgo(1)
    const s = story(
      [{ status: 'done', at, by: 'Ravi', narration_id: 'n1' }],
      [],
      [{
        id: 'n1', created_at: at, sender_name: 'Ravi',
        raw_text: '<caption>Ceiling work 4th floor</caption>\n<photo>Ceiling framework visible on the 4th floor</photo>',
      }],
      [{ parent_id: 't1', role: 'creation', caption: 'Ceiling work 4th floor', created_at: at, url: 'https://signed/x.jpg' }],
    )
    const msg = s.find((x) => x.t === 'msg') as { text: string }
    expect(msg.text).toBe('Ceiling work 4th floor')          // his words. ONLY his words.

    const photo = s.find((x) => x.t === 'photo') as { seen: string | null }
    expect(photo.seen).toBe('Ceiling framework visible on the 4th floor')   // ours, and owned by us
  })

  test('a photo he sent WITHOUT a caption says nothing in his voice at all', () => {
    const at = daysAgo(1)
    const s = story(
      [{ status: 'done', at, by: 'Ravi', narration_id: 'n1' }],
      [],
      [{ id: 'n1', created_at: at, sender_name: 'Ravi', raw_text: '<photo>A poured slab, still wet</photo>' }],
      [{ parent_id: 't1', role: 'creation', caption: null, created_at: at, url: 'https://signed/x.jpg' }],
    )
    expect(s.some((x) => x.t === 'msg')).toBe(false)         // he typed nothing, so he says nothing
    expect((s.find((x) => x.t === 'photo') as { seen: string | null }).seen).toBe('A poured slab, still wet')
  })

  test('a plain text message has no markers and passes through untouched', () => {
    const at = daysAgo(1)
    const s = story(
      [{ status: 'done', at, by: 'Ravi', narration_id: 'n1' }],
      [],
      [{ id: 'n1', created_at: at, sender_name: 'Ravi', raw_text: 'slab poured, curing started' }],
      [],
    )
    expect((s.find((x) => x.t === 'msg') as { text: string }).text).toBe('slab poured, curing started')
  })

  test('a bare photo message has no words — the photo carries it, and no empty bubble appears', () => {
    const at = daysAgo(1)
    const s = story(
      [{ status: 'done', at, by: 'Ravi', narration_id: 'n1' }],
      [],
      [{ id: 'n1', raw_text: '   ', created_at: at, sender_name: 'Ravi' }],
      [{ parent_id: 't1', role: 'creation', caption: 'poured', created_at: at, url: 'https://signed/x.jpg' }],
    )
    expect(s.map((x) => x.t)).toEqual(['event', 'photo'])
    expect(s[1]).toEqual({ t: 'photo', url: 'https://signed/x.jpg', caption: 'poured', seen: null, w: 'yesterday' })
  })

  // ── THE PHOTOS. The webhook attaches them to the TASK (parent_type='site_task'); the desk fetched
  //    only the problem ones, so a photo of the poured slab reached the database and no screen.
  test('a site photo joins the story, in time order with everything else', () => {
    const s = story(
      [{ status: 'active', at: daysAgo(3), by: 'Ravi' }],
      [{ id: 'c1', task_id: 't1', author_name: 'Ravi', body: 'halfway', created_at: daysAgo(1) }],
      [],
      [{ parent_id: 't1', role: 'creation', caption: null, created_at: daysAgo(2), url: 'https://signed/x.jpg' }],
    )
    expect(s.map((x) => x.t)).toEqual(['event', 'photo', 'msg'])
  })

  test('a photo whose signed url failed still appears — silence would read as "he never sent one"', () => {
    const s = story([], [], [], [
      { parent_id: 't1', role: 'creation', caption: null, created_at: daysAgo(1), url: null },
    ])
    expect(s[0]).toEqual({ t: 'photo', url: null, caption: null, seen: null, w: 'yesterday' })
  })
})

suite('narrationIdsOf — the only link from a task back to the words', () => {
  test('collects the ids, dedupes them, and never trips on two years of jsonb', () => {
    expect(narrationIdsOf([
      { at: 'x', narration_id: 'n1' },
      { at: 'y', narration_id: 'n1' },   // the same message, twice
      { at: 'z', narration_id: 'n2' },
      { at: 'w' },                        // a hand-made status change — no message behind it
      null, 'junk', { narration_id: 42 },
    ])).toEqual(['n1', 'n2'])
    expect(narrationIdsOf(null)).toEqual([])
  })
})

suite('ago', () => {
  test('reads like a person', () => {
    expect(ago(new Date(NOW - 30 * 60_000).toISOString(), NOW)).toBe('just now')
    expect(ago(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 hours ago')
    expect(ago(daysAgo(1), NOW)).toBe('yesterday')
    expect(ago(daysAgo(4), NOW)).toBe('4 days ago')
  })
})
