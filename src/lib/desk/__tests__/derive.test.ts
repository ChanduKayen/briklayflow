// The Site Desk derivation floor, pinned. These are the invariants the UI is allowed to assume.

import { suite, test, expect } from './harness'
import {
  sevScore, isOldAge, firstName, taskStatus, groupIsFoldable, pctDone, openBlockers,
  acrossFlats, splitRefs, siteCodeOf, canClose, closeItem, snapshot, applyUndo, reopenItem,
  setTaskState, bumpDuration, sliceFloor, planFloors, SITE_FLOOR, BUILDING_FLOOR, AMENITY_FLOOR, floorName,
  upNextRefs,
} from '../derive'
import { problemTone, taskTone } from '../medTone'
import type { DeskProblem, DeskTask } from '../types'

const P = (o: Partial<DeskProblem>): DeskProblem => ({
  id: 'x', ref: 'DSR-1', kind: 'issue', state: 'chasing', title: 't', site: 'S', siteCode: 'DSR',
  days: 0, last: 0, person: { name: 'Jaggu', phone: '' }, status: '', story: [], ...o,
})
/** A hard predecessor. Severity is irrelevant to STATUS — a gate is a gate, and none of these tests
 *  is about the drag ladder (that is move.test.ts) — so they all take the strictest one. */
const gate = (ref: string) => ({ ref, nature: 'IMPOSSIBLE', reason: 'structural' })
const T = (o: Partial<DeskTask>): DeskTask => ({
  ref: 'DSR-30', title: 'Columns', group: 'Structure', trade: 'Civil', state: 'todo',
  afters: [], assignee: 'Ravi', dur: '4d', ...o,
})
const byRef = (ts: DeskTask[]) => (r: string) => ts.find((t) => t.ref === r)

suite('severity — what he sees first', () => {
  test('waiting-on-owner outranks ANY age of a Briklay-managed item', () => {
    const mine = P({ state: 'you', days: 0 })
    const babais = P({ state: 'chasing', days: 90 })
    expect(sevScore(mine) > sevScore(babais)).toBe(true)
  })

  test('the category bump lifts seepage above a plain older item, within the same state', () => {
    const seepage = P({ state: 'chasing', title: 'Seepage mark — bedroom ceiling', days: 0 })
    const plain = P({ state: 'chasing', title: 'Tiles not arrived', days: 40 })
    expect(sevScore(seepage) > sevScore(plain)).toBe(true)
  })

  test('age is the tiebreak, not the driver', () => {
    expect(sevScore(P({ state: 'you', days: 6 })) - sevScore(P({ state: 'you', days: 2 }))).toBe(4)
  })

  test('resolved items score zero-state — they never crowd the open list', () => {
    expect(sevScore(P({ state: 'resolved', days: 0 }))).toBe(0)
  })

  test('deterministic — same input, same score, no clock read', () => {
    const i = P({ state: 'you', title: 'Electrical', days: 3 })
    expect(sevScore(i)).toBe(sevScore(i))
    expect(sevScore(i)).toBe(253)   // 200 (you) + 50 (electrical) + 3 (days)
  })

  test('age turns red only when it has needed HIM for 3+ days', () => {
    expect(isOldAge(P({ state: 'you', days: 3 }))).toBe(true)
    expect(isOldAge(P({ state: 'you', days: 2 }))).toBe(false)
    expect(isOldAge(P({ state: 'chasing', days: 30 }))).toBe(false)
  })
})

suite('names — words beat initials', () => {
  test('strips role prefixes', () => {
    expect(firstName('Supervisor Ravi')).toBe('Ravi')
    expect(firstName('Client — Aiswarya')).toBe('Aiswarya')
  })
  test('takes the first word — a vendor company reads by its first word, as the prototype does', () => {
    expect(firstName('Sri Balaji Ceramics')).toBe('Sri')
  })
  test('truncates a long name rather than overflowing the chip', () => {
    expect(firstName('Venkateshwarlu')).toBe('Venkates…')
  })
  test('an unknown person yields no chip at all', () => {
    expect(firstName('—')).toBe('')
    expect(firstName(null)).toBe('')
  })
})

suite('task status — derived, never hand-set', () => {
  test('done reads as a record, with its date', () => {
    expect(taskStatus(T({ state: 'done', doneW: '12 Jun' }), [], byRef([]))).toEqual({ cls: 'done', text: 'Done ✓ · 12 Jun' })
  })

  test('BLOCKED comes from a live link — never from a stored flag', () => {
    const problems = [P({ ref: 'DSR-19', title: 'Tiles not arrived from vendor', state: 'you' })]
    const t = T({ blockedBy: 'DSR-19' })
    const st = taskStatus(t, problems, byRef([]))
    expect(st.cls).toBe('blocked')
    expect((st as { ref: string }).ref).toBe('DSR-19')
  })

  test('...and it EVAPORATES the moment that problem closes — no stale block survives', () => {
    const problems = [P({ ref: 'DSR-19', state: 'resolved' })]
    const t = T({ blockedBy: 'DSR-19' })
    expect(taskStatus(t, problems, byRef([])).cls).toBe('ready')
  })

  test('in progress carries day X of Y', () => {
    const st = taskStatus(T({ state: 'active', started: 3, dur: '4d' }), [], byRef([]))
    expect(st.text).toBe('In progress — Ravi on it · day 3 of 4')
  })

  test('an unfinished predecessor reads "After {task}"', () => {
    const dep = T({ ref: 'DSR-29', title: 'Plinth beams', state: 'todo' })
    expect(taskStatus(T({ afters: [gate('DSR-29')] }), [], byRef([dep])).text).toBe('After Plinth beams')
  })

  test('a DONE predecessor unlocks it — the task becomes startable', () => {
    const dep = T({ ref: 'DSR-29', state: 'done' })
    expect(taskStatus(T({ afters: [gate('DSR-29')] }), [], byRef([dep])).cls).toBe('ready')
  })

  /**
   * READY MEANS *EVERY* PREDECESSOR IS DONE.
   *
   * The desk carried ONE predecessor (binding[0]) and called the task ready the moment that one
   * finished — while two other hard gates were still open. Every entry in `binding` is a hard gate
   * (persist.ts filters it through isHardNature), so this is the engine's own availability rule,
   * and anything less makes "Up next" name work that cannot start.
   */
  test('ONE done predecessor does not unlock a task that waits on two', () => {
    const done = T({ ref: 'DSR-28', title: 'Footings', state: 'done' })
    const open = T({ ref: 'DSR-29', title: 'Plinth beams', state: 'todo' })
    const st = taskStatus(T({ afters: [gate('DSR-28'), gate('DSR-29')] }), [], byRef([done, open]))
    expect(st.cls).toBe('after')
    expect(st.text).toBe('After Plinth beams')          // names the one still OPEN, not binding[0]
  })

  test('the last predecessor closing is what makes it ready', () => {
    const a = T({ ref: 'DSR-28', state: 'done' })
    const b = T({ ref: 'DSR-29', state: 'done' })
    expect(taskStatus(T({ afters: [gate('DSR-28'), gate('DSR-29')] }), [], byRef([a, b])).cls).toBe('ready')
  })

  test('every open predecessor is reachable, so the sheet can say what it is really waiting on', () => {
    const a = T({ ref: 'DSR-28', title: 'Footings', state: 'todo' })
    const b = T({ ref: 'DSR-29', title: 'Plinth beams', state: 'done' })
    const c = T({ ref: 'DSR-31', title: 'Beams', state: 'todo' })
    const st = taskStatus(T({ afters: [gate('DSR-28'), gate('DSR-29'), gate('DSR-31')] }), [], byRef([a, b, c]))
    expect(st.cls).toBe('after')
    expect((st as { waiting: string[] }).waiting).toEqual(['DSR-28', 'DSR-31'])
  })

  /**
   * ══ THE WALL ON THE UNPOURED SLAB ══════════════════════════════════════════════════════════
   *
   * This suite used to contain the exact opposite of the test below. It said: "a predecessor that is
   * not in this plan cannot hold the work up forever" — a ref that resolves to nothing is not an open
   * gate — and it called the task READY.
   *
   * That was written for the deletion case, and for deletion it is right. But it fires on a second,
   * completely different situation that it silently swallowed: a predecessor the plan INSISTS on that
   * has no row here, because the task list has drifted from the building (a row persisted before the
   * floor cycle was rebuilt still names `slab@First`, which is not a task any more).
   *
   * In that case we do not know whether the slab is poured. And the desk said: "Ready — can start now".
   * That is a man sent to raise a wall on a deck that does not exist.
   *
   * Deletion is now handled where it belongs — upstream, in the engine: a deleted task is suppressed,
   * never instantiated, and produces no edge, so nothing reaches here by being deleted (gates.ts).
   * Which leaves exactly one meaning for an unresolvable gate, and it is not "go".
   */
  test('AN UNRESOLVABLE GATE IS NOT AN OPEN ONE — the desk will not call a task ready over work it cannot see', () => {
    const t = T({ title: 'Wall — blockwork', unresolved: ['Frame — slab & beam pour'] })
    const st = taskStatus(t, [], byRef([]))
    expect(st.cls).toBe('unknown')
  })

  test('...and it says WHICH job it cannot account for, so the plan can be fixed', () => {
    const st = taskStatus(T({ unresolved: ['Frame — slab & beam pour'] }), [], byRef([]))
    expect(st.text).toBe('Can’t confirm — Frame — slab & beam pour isn’t in this project’s task list')
  })

  test('work already finished is not re-opened by a gate we cannot see — done is done', () => {
    expect(taskStatus(T({ state: 'done', unresolved: ['Slab'] }), [], byRef([])).cls).toBe('done')
  })

  test('nothing unresolved, nothing waiting → ready, and only then', () => {
    expect(taskStatus(T({}), [], byRef([])).cls).toBe('ready')
  })
})

/**
 * UP NEXT — WHAT THE CREW PICKS UP WHEN THEY PUT THIS DOWN.
 *
 * It used to mean STARTABLE — the first task in the section with every hard gate open. On a real
 * floor that means whole sections carry no chip at all: in Finishes every job waits on the one before
 * it, so nothing qualifies and the section says nothing about what happens next. Reported from the
 * screen, and rightly.
 *
 * It is POSITIONAL now — the next job in the run, per section. It does not claim the work can start;
 * the row already says that for itself. It says where you are in the sequence.
 */
suite('up next — the next job in the run', () => {
  /**
   * ONE FLOOR, ONE NEXT JOB. The sections are bands within a single run — not three parallel queues —
   * so chipping the head of each of them was three answers to a question that has one.
   */
  test('the floor has ONE next job by default, whatever section it falls in', () => {
    const tasks = [
      T({ ref: 'DSR-30', group: 'Structure', state: 'done' }),
      T({ ref: 'DSR-31', group: 'Structure' }),                       // the floor's next job
      T({ ref: 'DSR-32', group: 'Structure' }),
      T({ ref: 'DSR-40', group: 'Services' }),                        // NOT chipped — Structure is first
    ]
    expect(upNextRefs(tasks, [])).toEqual(new Set(['DSR-31']))
  })

  /**
   * THE LIST THAT SAID NOTHING. Every job in Finishes waits on the job before it, so under the old
   * "must be startable" rule NOT ONE of them could be next, and the floor rendered without a single
   * mark on it. But of course something is next — the first one. That is what next means.
   */
  test('a plan where everything waits on something still has a next job — the first one', () => {
    const tasks = [
      T({ ref: 'DSR-50', group: 'Finishes', state: 'done' }),
      T({ ref: 'DSR-51', group: 'Finishes', afters: [gate('DSR-50')] }),   // waits — and is still next
      T({ ref: 'DSR-52', group: 'Finishes', afters: [gate('DSR-51')] }),
    ]
    expect(upNextRefs(tasks, [])).toEqual(new Set(['DSR-51']))
  })

  test('a blocked job is stepped over — "next up: the thing that is broken" is not a plan', () => {
    const tasks = [
      T({ ref: 'DSR-30', group: 'Structure', blockedBy: 'DSR-19' }),  // an open problem stopped it
      T({ ref: 'DSR-31', group: 'Structure' }),
    ]
    expect(upNextRefs(tasks, [P({ ref: 'DSR-19' })])).toEqual(new Set(['DSR-31']))
  })

  test('work already running does not take the chip — "up next" is what FOLLOWS it', () => {
    const tasks = [
      T({ ref: 'DSR-30', group: 'Structure', state: 'active' }),     // running: it is the "now"
      T({ ref: 'DSR-31', group: 'Structure' }),                      // it is the "next"
    ]
    expect(upNextRefs(tasks, [])).toEqual(new Set(['DSR-31']))
  })

  /**
   * TWO CREWS ARE TWO NEXT JOBS. A section with a mason and an electrician both working has two
   * handovers coming, and naming only one of them is naming the wrong one half the time.
   */
  test('several jobs running → the job after EACH of them is next, across sections', () => {
    const tasks = [
      T({ ref: 'DSR-30', group: 'Structure', state: 'active' }),     // crew 1 is on this
      T({ ref: 'DSR-31', group: 'Structure' }),                      // ...so this is next
      T({ ref: 'DSR-32', group: 'Services', state: 'active' }),      // crew 2 is on this
      T({ ref: 'DSR-33', group: 'Services' }),                       // ...so this is next too
      T({ ref: 'DSR-34', group: 'Finishes' }),                       // and this one waits its turn
    ]
    expect(upNextRefs(tasks, [])).toEqual(new Set(['DSR-31', 'DSR-33']))
  })

  test('finished work behind a running job is skipped — the next job is the next JOB', () => {
    const tasks = [
      T({ ref: 'DSR-30', group: 'Structure', state: 'active' }),
      T({ ref: 'DSR-31', group: 'Structure', state: 'done' }),       // already done out of order
      T({ ref: 'DSR-32', group: 'Structure' }),                      // this is the real next
    ]
    expect(upNextRefs(tasks, [])).toEqual(new Set(['DSR-32']))
  })

  test('a section with nothing left after the running job chips nothing — it does not invent one', () => {
    const tasks = [
      T({ ref: 'DSR-30', group: 'Structure', state: 'done' }),
      T({ ref: 'DSR-31', group: 'Structure', state: 'active' }),
    ]
    expect(upNextRefs(tasks, [])).toEqual(new Set())
  })

  test('a finished section chips nothing', () => {
    expect(upNextRefs([T({ ref: 'DSR-30', group: 'Structure', state: 'done' })], [])).toEqual(new Set())
  })

  test('a block outranks a dependency — the worse truth wins the line', () => {
    const problems = [P({ ref: 'DSR-19', state: 'you' })]
    const dep = T({ ref: 'DSR-29', state: 'todo' })
    expect(taskStatus(T({ afters: [gate('DSR-29')], blockedBy: 'DSR-19' }), problems, byRef([dep])).cls).toBe('blocked')
  })
})

suite('groups fold when nothing can start', () => {
  test('a group where every task waits on something else folds', () => {
    const a = T({ ref: 'A', afters: [gate('Z')] }), z = T({ ref: 'Z', state: 'todo' })
    expect(groupIsFoldable([a], [], byRef([a, z]))).toBe(true)
  })
  test('a group with one startable task never folds', () => {
    expect(groupIsFoldable([T({ ref: 'A' })], [], byRef([]))).toBe(false)
  })
  test('a group with live work never folds', () => {
    expect(groupIsFoldable([T({ state: 'active' })], [], byRef([]))).toBe(false)
  })
  test('an all-done group is not "foldable" — it is finished, and shows as the record', () => {
    expect(groupIsFoldable([T({ state: 'done' })], [], byRef([]))).toBe(false)
  })
})

suite('plan rollups', () => {
  test('% is done ÷ total, derived', () => {
    expect(pctDone([T({ state: 'done' }), T({ state: 'done' }), T({}), T({})])).toBe(50)
    expect(pctDone([])).toBe(0)
  })

  test('a unit badge counts DISTINCT open problems blocking work there', () => {
    const problems = [P({ ref: 'ASM-15', state: 'chasing' }), P({ ref: 'ASM-14', state: 'you' })]
    const tasks = [T({ blockedBy: 'ASM-15' }), T({ blockedBy: 'ASM-15' }), T({ blockedBy: 'ASM-14' })]
    expect(openBlockers(tasks, problems)).toEqual(['ASM-15', 'ASM-14'])
  })

  test('a closed problem leaves no badge behind', () => {
    expect(openBlockers([T({ blockedBy: 'ASM-15' })], [P({ ref: 'ASM-15', state: 'resolved' })])).toEqual([])
  })

  test('the across-flats rollup counts only flats that HAVE the activity', () => {
    const roll = acrossFlats([
      { u: '101', tasks: [T({ title: 'Tiling', state: 'done' }), T({ title: 'Doors' })] },
      { u: '102', tasks: [T({ title: 'Tiling' })] },                       // no Doors task at all
    ])
    expect(roll).toBe('Tiling 1/2 · Doors 0/1')                            // Doors is /1, not /2
  })
})

suite('sliceFloor — a floor is a place you can GO', () => {
  const tasks = [
    T({ ref: 'A', floor: 'First', unit: null }),
    T({ ref: 'B', floor: 'First', unit: '101' }),
    T({ ref: 'C', floor: 'First', unit: '102' }),
    T({ ref: 'D', floor: 'Second', unit: null }),
    // Floorless GROUNDWORK. These carry their real task types now: a floorless task is no longer 'the
    // leftover bin' - it is classified (engine/stages.ts), and only the ground goes to 'Site & foundation'.
    T({ ref: 'E', floor: null, unit: null, taskTypeId: 'ground_clearance', state: 'done' }),
    T({ ref: 'F', floor: null, unit: null, taskTypeId: 'plinth_slab' }),
  ]

  test('a floor shows its own non-unit work — and ONLY its own', () => {
    expect(sliceFloor(tasks, 'First').common.map((t) => t.ref)).toEqual(['A'])
  })

  test('BUILDING-LEVEL WORK DOES NOT RIDE ALONG — ground clearance is not listed under every floor', () => {
    expect(sliceFloor(tasks, 'Second').common.map((t) => t.ref)).toEqual(['D'])
  })

  test('...it lives on a floor of its own, where it actually happens', () => {
    expect(sliceFloor(tasks, SITE_FLOOR).common.map((t) => t.ref)).toEqual(['E', 'F'])
    expect(sliceFloor(tasks, SITE_FLOOR).units).toBe(null)
  })

  test('the flats on that floor, and only those', () => {
    const u = sliceFloor(tasks, 'First').units
    expect(u?.list.map((x) => x.u)).toEqual(['101', '102'])
    expect(u?.list[0].tasks.map((t) => t.ref)).toEqual(['B'])
  })

  test('a floor with no flats renders no strip at all', () => {
    expect(sliceFloor(tasks, 'Second').units).toBe(null)
  })

  test('AN EMPTY/UNSTARTED FLOOR STILL OPENS — that is exactly the floor you want to look at', () => {
    const s = sliceFloor(tasks, 'Terrace')
    expect(s.units).toBe(null)
    expect(s.common).toEqual([])
  })
})

suite('floorName — the rail SPEAKS the label, it does not print the key', () => {
  test('a bare ordinal gets the noun a person would say', () => {
    expect(floorName('Fourth')).toBe('Fourth floor')
    expect(floorName('Stilt')).toBe('Stilt floor')
    expect(floorName('Ground')).toBe('Ground floor')
  })

  test('a label that already carries its own noun is left exactly as the engine wrote it', () => {
    expect(floorName(SITE_FLOOR)).toBe(SITE_FLOOR)
    // A STAGE IS NOT A FLOOR. The rail was reading "Amenities floor" and "Exterior & handover floor" —
    // amenities are not a storey of the building, they are just the amenities.
    expect(floorName(AMENITY_FLOOR)).toBe('Amenities')
    expect(floorName(BUILDING_FLOOR)).toBe('Exterior & handover')
    expect(floorName('Terrace')).toBe('Terrace')
    expect(floorName('Basement 1')).toBe('Basement 1')
    expect(floorName('Second floor')).toBe('Second floor')     // never "Second floor floor"
  })
})

suite('planFloors — the ground the building stands on comes first', () => {
  const tasks = [
    T({ ref: 'E', floor: null, taskTypeId: 'ground_clearance', state: 'done' }),
    T({ ref: 'F', floor: null, taskTypeId: 'plinth_slab', state: 'done' }),
    T({ ref: 'A', floor: 'Stilt', state: 'todo' }),
    T({ ref: 'B', floor: 'Ground', state: 'done' }),
  ]

  test('the building-level work is a floor, at the bottom, in build order', () => {
    expect(planFloors(tasks).map((f) => f.n)).toEqual([SITE_FLOOR, 'Stilt', 'Ground'])
  })

  test('AND IT COUNTS — finished groundwork reads 100%, not 0%', () => {
    expect(planFloors(tasks)[0].pct).toBe(100)
  })

  test('a real floor counts only its own tasks', () => {
    const f = planFloors(tasks)
    expect(f.find((x) => x.n === 'Stilt')?.pct).toBe(0)
    expect(f.find((x) => x.n === 'Ground')?.pct).toBe(100)
  })

  test('a plan with no building-level work has no synthetic floor', () => {
    expect(planFloors([T({ ref: 'A', floor: 'Ground' })]).map((f) => f.n)).toEqual(['Ground'])
  })
})

suite('the medallion — the left column can never disagree with the row', () => {
  test('a problem that needs him is the only terracotta on the left edge', () => {
    expect(problemTone('you')).toBe('you')
  })
  test('with Briklay → the breathing dot; accepted and moving → its own tone', () => {
    expect(problemTone('chasing')).toBe('chasing')
    expect(problemTone('moving')).toBe('moving')
  })
  test('closed → the only filled green', () => {
    expect(problemTone('resolved')).toBe('done')
  })

  test('BLOCKED OUTRANKS NOT-STARTED — a task that cannot move must not read as merely idle', () => {
    expect(taskTone('todo', true)).toBe('blocked')
    expect(taskTone('todo', false)).toBe('idle')
  })
  test('...but DONE outranks blocked: finished work is finished, whatever was in its way', () => {
    expect(taskTone('done', true)).toBe('done')
  })
  test('work in progress breathes, exactly like a chased problem', () => {
    expect(taskTone('active', false)).toBe('chasing')
  })
})

suite('refs — one per-site space, problems and tasks alike', () => {
  test('a status line splits into real link parts, never innerHTML', () => {
    expect(splitRefs('Blocked by {DSR-19} — tiles')).toEqual([
      { text: 'Blocked by ' }, { ref: 'DSR-19' }, { text: ' — tiles' },
    ])
  })
  test('plain text passes through untouched', () => {
    expect(splitRefs('Ready — can start now')).toEqual([{ text: 'Ready — can start now' }])
  })
  test('a ref names its site', () => {
    expect(siteCodeOf('DSR-21')).toBe('DSR')
    expect(siteCodeOf('ASM-14')).toBe('ASM')
  })
})

suite('the close contract', () => {
  test('SNAG FLOOR — a snag cannot be closed as Fixed with no fix photo', () => {
    const r = canClose({ kind: 'snag', photos: [] }, 'Fixed')
    expect(r.ok).toBe(false)
    expect((r as { why: string }).why).toContain('fix photo')
  })

  test('...but the same snag closes fine once the photo is in', () => {
    expect(canClose({ kind: 'snag', photos: [{ e: '✅', l: 'After' }] }, 'Fixed').ok).toBe(true)
  })

  test('...and a snag that was never a problem closes without one — the floor is about VERIFYING a fix', () => {
    expect(canClose({ kind: 'snag', photos: [] }, 'Not a problem').ok).toBe(true)
  })

  test('an ISSUE never needs a photo', () => {
    expect(canClose({ kind: 'issue', photos: [] }, 'Fixed').ok).toBe(true)
  })

  test('closing records the outcome, and an empty note falls back to the outcome word', () => {
    expect(closeItem('Fixed', '  ').resolution).toEqual({ outcome: 'Fixed', note: 'Fixed', by: 'You', when: 'just now' })
  })

  test('an auto-close is attributed to Briklay, not to him', () => {
    expect(closeItem('Fixed', 'Verified from fix photo', 'Briklay — auto-closed').resolution.by).toBe('Briklay — auto-closed')
  })
})

suite('undo + reopen preserve the audit trail', () => {
  const base = P({ id: '9', state: 'moving', status: 'Fixed · photo received', story: [{ t: 'event', l: 'Snag logged' }] })

  test('undo restores the EXACT prior state — status, story length and all', () => {
    const snap = snapshot(base)
    const closed: DeskProblem = {
      ...base, ...closeItem('Fixed', 'done'),
      story: [...base.story, { t: 'resolve', l: 'Closed — Fixed', w: 'just now' }],
    }
    const back = applyUndo(closed, snap)
    expect(back.state).toBe('moving')
    expect(back.status).toBe('Fixed · photo received')
    expect(back.story.length).toBe(1)
    expect(back.resolution).toBe(null)
  })

  test('REOPEN KEEPS THE RESOLUTION ON FILE — closing is a fact, not an eraser', () => {
    const closed: DeskProblem = { ...base, ...closeItem('Fixed', 'Latch replaced') }
    const back = reopenItem(closed)
    expect(back.state).toBe('you')
    expect(back.resolution?.note).toBe('Latch replaced')          // ← the audit floor
    expect(back.story.at(-1)).toEqual({ t: 'event', l: 'Reopened', w: 'just now' })
  })
})

suite('task edits', () => {
  test('starting a task begins day 1', () => {
    expect(setTaskState(T({}), 'active').started).toBe(1)
  })
  test('sending it back to not-started clears the day counter', () => {
    expect(setTaskState(T({ state: 'active', started: 3 }), 'todo').started).toBe(undefined)
  })
  test('duration never drops below one day', () => {
    expect(bumpDuration(T({ dur: '1d' }), -1).dur).toBe('1d')
    expect(bumpDuration(T({ dur: '4d' }), 1).dur).toBe('5d')
  })
})

// ── THE LIFT WAS IN THE FOUNDATION (live, 2026-07-13) ────────────────────────────────────────────────────
// A brand-new project. The supervisor opened "Site & foundation" and found, under it:
//
//     External — façade structure · External — façade plaster · External — façade paint
//     Site — development · Terrace — waterproofing · Terrace — finishing
//     Snagging & handover · Compound wall & gate · Lift — mechanism & car · Lift — commissioning & licence
//
// …on a plot where the footings had not been dug. Because SITE_FLOOR was never a stage — it was
// `tasks.filter((t) => !t.floor)`, a bin for everything that happens to the BUILDING rather than to a floor.
// The engine had already answered this properly (three stages); the desk had answered it with one filter.
// Now both ask the same classifier (engine/stages.ts): the ground, the building, the amenities.
suite('the floorless work goes where it belongs, not into a bin', () => {
  const tasks = [
    T({ ref: 'G1', floor: null, taskTypeId: 'ground_clearance', state: 'done' }),
    T({ ref: 'G2', floor: null, taskTypeId: 'plinth_slab' }),
    // Neither of these is floorless any more, and that is the point: grading STANDS on the stilt (cut and
    // fill for the level the stilt sits on), and the terrace's work stands on the terrace. A task with a
    // place belongs to its place — it never reaches the stage classifier at all.
    T({ ref: 'S1', floor: 'Stilt', taskTypeId: 'site_grade' }),
    T({ ref: 'T1', floor: 'Terrace', taskTypeId: 'terrace_waterproof' }),
    T({ ref: 'B1', floor: null, taskTypeId: 'external_structure' }),
    T({ ref: 'B2', floor: null, taskTypeId: 'snagging' }),
    T({ ref: 'A1', floor: null, taskTypeId: 'ca_lift_mech' }),
    T({ ref: 'A2', floor: null, taskTypeId: 'ca_compound' }),
    T({ ref: 'F1', floor: 'Ground', taskTypeId: 'blockwork' }),
  ]

  test('(W1) "Site & foundation" holds the GROUND — and nothing that needs a building', () => {
    const refs = sliceFloor(tasks, SITE_FLOOR).common.map((t) => t.ref)
    expect(refs).toEqual(['G1', 'G2'])   // grading is NOT groundwork — it stands on the stilt
  })

  test('(W2) the façade and the handover are the EXTERIOR — the terrace is a floor, not a stage', () => {
    expect(sliceFloor(tasks, BUILDING_FLOOR).common.map((t) => t.ref)).toEqual(['B1', 'B2'])
    expect(sliceFloor(tasks, 'Terrace').common.map((t) => t.ref)).toEqual(['T1'])
    expect(sliceFloor(tasks, 'Stilt').common.map((t) => t.ref)).toEqual(['S1'])
  })

  test('(W3) the lift and the compound wall are AMENITIES — they were being called groundwork', () => {
    expect(sliceFloor(tasks, AMENITY_FLOOR).common.map((t) => t.ref)).toEqual(['A1', 'A2'])
  })

  test('(W4) the stages read in build order: the ground, the floors, the building, its amenities', () => {
    expect(planFloors(tasks).map((f) => f.n)).toEqual([SITE_FLOOR, 'Stilt', 'Terrace', 'Ground', BUILDING_FLOOR, AMENITY_FLOOR])
  })

  // ONLY IF NECESSARY. A project with no amenities must not grow an empty Amenities section, and one with
  // no building-wide work must not grow an empty one of those either. A stage exists because work is in it.
  test('(W5) a stage with no work in it does not appear at all', () => {
    const groundworkOnly = [T({ ref: 'G1', floor: null, taskTypeId: 'ground_clearance' }), T({ ref: 'F1', floor: 'Ground', taskTypeId: 'blockwork' })]
    expect(planFloors(groundworkOnly).map((f) => f.n)).toEqual([SITE_FLOOR, 'Ground'])
  })
})
