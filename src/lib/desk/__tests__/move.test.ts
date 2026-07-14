// MOVING A TASK — refereed by the engine's rule, not by a UI guess.
//
// A drag on this desk is a claim about BUILDABILITY, and the plan is a dependency graph, so the drop
// has to be judged against it. The judge is not new: the engine already rules on exactly this
// (Evaluator.checkMove, verdict: forbid | allow_with_consequence | warn | suggest | allow), and the
// rows carry what it needs — `binding` records every hard predecessor WITH the nature and the reason
// the library gave it. So this is the same ladder, run over the rows:
//
//   IMPOSSIBLE   → forbid                   you cannot wire a slab that has not been poured
//   DESTRUCTIVE  → allow_with_consequence   you CAN, and it will destroy work already done
//   STRONG_PREF  → warn                     (reaches the rows only via curing_time)
//   WEAK_PREF    → suggest
//
// The whole point of refusing a drop is that the reason must be TRUE. So the message is built from
// the edge that actually broke — the predecessor, and why it is one — never from a generic string.

import { suite, test, expect } from './harness'
import { checkMove } from '../edit'
import type { DeskTask } from '../types'

const gate = (ref: string, nature = 'IMPOSSIBLE', reason = 'structural') => ({ ref, nature, reason })
const T = (o: Partial<DeskTask>): DeskTask => ({
  ref: 'DSR-30', title: 'Task', group: 'Structure', trade: 'Civil', state: 'todo',
  afters: [], assignee: 'Ravi', dur: '2d', manual: false, ...o,
})

// pour ← blockwork ← conduit : the real chain, in the real order
const pour = T({ ref: 'DSR-30', title: 'Slab pour' })
const block = T({ ref: 'DSR-31', title: 'Blockwork', afters: [gate('DSR-30')] })
const conduit = T({ ref: 'DSR-32', title: 'Conduiting', afters: [gate('DSR-31')] })
const paint = T({ ref: 'DSR-33', title: 'Painting', afters: [] })
const ORDER = [pour, block, conduit, paint]

suite('checkMove — the engine referees the drag', () => {
  test('a move that keeps every predecessor in front of its follower is allowed', () => {
    // painting has no gates at all: it can go anywhere
    const r = checkMove(paint, 'DSR-30', ORDER)
    expect(r.verdict).toBe('allow')
  })

  test('DRAGGING WORK ABOVE THE THING IT PHYSICALLY NEEDS IS REFUSED', () => {
    // conduit, dropped above the pour it depends on (through blockwork)
    const r = checkMove(conduit, 'DSR-31', ORDER)
    expect(r.verdict).toBe('forbid')
    expect(r.ok).toBe(false)
  })

  /**
   * SAY IT THE WAY A SITE SAYS IT.
   *
   * "Not possible — structural: hard predecessor violated" is the engine talking to itself. The man
   * reading this is holding a phone on the fourth floor. He gets a sentence about the WORK: which job
   * has to be finished, before which other job can start. No verdict names, no reason codes, no
   * "the sequence still builds".
   */
  test('...and the refusal is a sentence about the WORK — not about the engine', () => {
    const r = checkMove(conduit, 'DSR-31', ORDER)
    expect(r.message).toBe('Blockwork has to be finished before Conduiting can start')
  })

  test('pushing a task DOWN past something that depends on it is refused too — the break is symmetric', () => {
    // the pour dragged below blockwork: blockwork now precedes the thing it waits for
    const r = checkMove(pour, 'DSR-32', ORDER)
    expect(r.verdict).toBe('forbid')
  })

  /**
   * DESTRUCTIVE IS NOT IMPOSSIBLE, AND THE DIFFERENCE IS THE WHOLE POINT OF THE LADDER.
   *
   * You CAN chase a wall you have already plastered. It is allowed, and it destroys the plaster. The
   * engine says so, and a desk that flattened this into "no" would be lying about the building — a
   * supervisor who has decided to eat the rework is making a legitimate call.
   */
  test('DESTRUCTIVE work is allowed through — with the damage stated, not hidden', () => {
    const plaster = T({ ref: 'DSR-40', title: 'Plaster' })
    const chase = T({ ref: 'DSR-41', title: 'Wall chasing', afters: [gate('DSR-40', 'DESTRUCTIVE', 'concealment')] })
    const r = checkMove(chase, 'DSR-40', [plaster, chase])
    expect(r.verdict).toBe('allow_with_consequence')
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Wall chasing here will damage the plaster — it will have to be redone')
  })

  test('a curing gate warns rather than forbids — it is time, not physics, and it says so', () => {
    const cast = T({ ref: 'DSR-50', title: 'Column casting' })
    const strip = T({ ref: 'DSR-51', title: 'De-propping', afters: [gate('DSR-50', 'STRONG_PREF', 'curing_time')] })
    const r = checkMove(strip, 'DSR-50', [cast, strip])
    expect(r.verdict).toBe('warn')
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Column casting needs time to set before De-propping')
  })

  test('THE WORST BREAK WINS. One forbidden edge is not softened by an allowed one.', () => {
    const a = T({ ref: 'DSR-60', title: 'Pour' })
    const b = T({ ref: 'DSR-61', title: 'Plaster' })
    const c = T({
      ref: 'DSR-62',
      title: 'Wiring',
      afters: [gate('DSR-61', 'DESTRUCTIVE', 'concealment'), gate('DSR-60', 'IMPOSSIBLE', 'structural')],
    })
    expect(checkMove(c, 'DSR-60', [a, b, c]).verdict).toBe('forbid')
  })

  test('the resulting order is returned, so the caller persists exactly what was judged', () => {
    const r = checkMove(paint, 'DSR-31', ORDER)
    expect(r.order.map((t) => t.ref)).toEqual(['DSR-30', 'DSR-33', 'DSR-31', 'DSR-32'])
  })

  test('a gate pointing at a task that is not in this plan cannot forbid anything', () => {
    const orphan = T({ ref: 'DSR-70', title: 'Orphan', afters: [gate('DSR-99')] })
    expect(checkMove(orphan, 'DSR-30', [...ORDER, orphan]).verdict).toBe('allow')
  })

  test('dropping a task on itself is a no-op, not a move', () => {
    expect(checkMove(block, 'DSR-31', ORDER).ok).toBe(false)
  })

  /**
   * ══ THE WARNING THAT WAS THE SAME EVERY TIME ═══════════════════════════════════════════════════
   *
   * Reported from the screen: dragging "Decorative installations" produced
   *
   *     "Frame — slab & beam pour has to be finished before External — façade structure can start"
   *
   * — naming two tasks the user had never touched, and saying it on EVERY drag, anywhere on the page.
   *
   * The check was scanning the whole list for the worst backwards edge in it. On a real project the
   * stored seq_no is NOT a valid build order (a hand drag, an old generation, a rebuilt library), so
   * there is almost always some pre-existing backwards edge somewhere — and it won, every time,
   * because it was the most severe one in the list. The drag was being blamed for a fault that was
   * there before it started.
   *
   * A move is a splice, and a splice preserves the relative order of every other pair. So the ONLY
   * edges a move can break are the ones touching the row in his hand. Nothing else is this drag's
   * business, and the desk must not pretend otherwise.
   */
  test('A PRE-EXISTING BREAK IS NOT THIS DRAG\'S FAULT — and is never reported as if it were', () => {
    // the plan is ALREADY out of order: the façade sits in front of the pour it depends on
    const facade = T({ ref: 'DSR-80', title: 'External — façade structure', afters: [gate('DSR-81')] })
    const pourB = T({ ref: 'DSR-81', title: 'Frame — slab & beam pour' })
    // ...and quite separately, he drags a finishing task that depends on nothing at all
    const deco = T({ ref: 'DSR-82', title: 'Decorative installations' })
    const ceil = T({ ref: 'DSR-83', title: 'Ceiling — boarding' })

    const r = checkMove(deco, 'DSR-83', [facade, pourB, deco, ceil])
    expect(r.verdict).toBe('allow')
    expect(r.message).toBe('Move it here')
  })

  /**
   * THE ONE THAT SURVIVED THE FIRST FIX. A task can be sitting in front of its own predecessor before
   * anybody drags anything — the stored seq_no is not a valid build order on a real project. Reporting
   * that means EVERY drag of that task is refused, for a fault that was there before he touched it and
   * that he cannot fix by dragging, because we refuse the drag. He is locked out of his own plan.
   *
   * The question is not "is this order broken near him". It is "what did this move make WORSE".
   */
  test('A TASK ALREADY OUT OF ORDER CAN STILL BE DRAGGED — we report what the move breaks, not what it fails to fix', () => {
    // wiring already sits ABOVE the pour it needs — broken before he starts
    const wiring = T({ ref: 'DSR-90', title: 'Wiring', afters: [gate('DSR-91')] })
    const pourC = T({ ref: 'DSR-91', title: 'Slab pour' })
    const tiling = T({ ref: 'DSR-92', title: 'Tiling' })
    const list = [wiring, pourC, tiling]

    // he nudges the wiring down one. Still above the pour — no better, but no WORSE either.
    const r = checkMove(wiring, 'DSR-92', list)
    expect(r.ok).toBe(true)
    expect(r.verdict).toBe('allow')
  })

  test('...but a move that makes an ALREADY-broken order worse is still caught', () => {
    const pourD = T({ ref: 'DSR-91', title: 'Slab pour' })
    const wiring = T({ ref: 'DSR-90', title: 'Wiring', afters: [gate('DSR-91'), gate('DSR-93')] })
    const rebar = T({ ref: 'DSR-93', title: 'Reinforcement' })
    // wiring is above the pour already (broken), but still below the rebar (fine)
    const list = [rebar, wiring, pourD]

    // now he drags the wiring ABOVE the rebar too — a NEW break, and it is named
    const r = checkMove(wiring, 'DSR-93', list)
    expect(r.verdict).toBe('forbid')
    expect(r.message).toBe('Reinforcement has to be finished before Wiring can start')
  })

  test('...and the move that DOES break something still names the right two tasks', () => {
    // a SOUND order to begin with: the pour, then the façade that waits for it
    const pourB = T({ ref: 'DSR-81', title: 'Frame — slab & beam pour' })
    const facade = T({ ref: 'DSR-80', title: 'External — façade structure', afters: [gate('DSR-81')] })
    const deco = T({ ref: 'DSR-82', title: 'Decorative installations' })
    // he drags the pour down BELOW the façade that waits for it — his doing, and it is named
    const r = checkMove(pourB, 'DSR-82', [pourB, facade, deco])
    expect(r.verdict).toBe('forbid')
    expect(r.message).toBe('Frame — slab & beam pour has to be finished before External — façade structure can start')
  })
})
