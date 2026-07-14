// M3 truth-table tests — feed hand-built completion states and assert each query against the
// Evaluation sheet's semantics. Uses a small G+1, 1-unit building for tractable node-ids.
import { suite, test, expect } from './harness'
import { instantiate, stackToGeometry } from '../instantiate'
import { Evaluator, stateOf } from '../evaluate'
import type { ConcreteGraph, NodeId } from '../types'

const STACK = {
  levels: [
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
  ],
}
const GEO = stackToGeometry(STACK)
const G: ConcreteGraph = instantiate(GEO)

// A zone is a UNIT (a flat), not a room — so there is exactly one per-zone node per (type, floor, unit).
// These tests used to address a `dry` node and a `wet` node separately; the wet room lives INSIDE the
// unit now, so `unit('plaster')` is the whole flat's plastering and it conceals BOTH the conduit and the
// in-wall plumbing. That is the point: you don't plaster a flat over an untested pipe.
function unit(tid: string, floor = 'Ground'): NodeId {
  const n = [...G.nodes.values()].find((x) => x.taskTypeId === tid && x.floorLabel === floor && x.zoneId !== null)
  if (!n) throw new Error(`no ${tid}@${floor}`)
  return n.id
}

// the hard-pred chain leading to a Ground-floor zone's blockwork being done
const blockworkDoneGround = (): NodeId[] => [
  'foundation', 'columns@Ground', 'floor_shutter@Ground', 'floor_rebar@Ground', 'floor_pour@Ground', 'shuttering_removal@Ground', 'blockwork@Ground',
]

suite('M3 evaluate', () => {
  test('ground clearance is the entrypoint; foundation waits on the groundwork chain; columns wait on foundation', () => {
    const ev = new Evaluator(G, stateOf({}))
    expect(ev.availability('ground_clearance')).toBe('available') // the master start of the build
    expect(ev.availability('foundation')).toBe('blocked')         // now gated by the substructure chain
    expect(ev.availability('columns@Ground')).toBe('blocked')
    expect(ev.whyMessage('columns@Ground')).toBe('after Foundation — mass concrete — structural')
  })

  // Every line the flat's plaster buries. The unit contains a wet room, so the concealed plumbing and
  // its pressure test are in here too — plaster waits for ALL of them, not just the conduit.
  const concealedByPlaster = () => [unit('conduit'), unit('in_wall_plumbing'), unit('pressure_test')]

  test('plaster blocked AFTER every line it conceals; available once they are all done', () => {
    const plaster = unit('plaster')
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    expect(ev.availability(unit('conduit'))).toBe('available')
    expect(ev.availability(plaster)).toBe('blocked')
    expect(ev.why(plaster).some((b) => b.taskTypeId === 'conduit' && b.reason === 'concealment')).toBeTruthy()

    // conduit alone is NOT enough — the flat's in-wall plumbing is still open behind the plaster
    const ev1 = new Evaluator(G, stateOf({ done: [...blockworkDoneGround(), unit('conduit')] }))
    expect(ev1.availability(plaster)).toBe('blocked')
    expect(ev1.why(plaster).some((b) => b.taskTypeId === 'in_wall_plumbing')).toBeTruthy()

    const ev2 = new Evaluator(G, stateOf({ done: [...blockworkDoneGround(), ...concealedByPlaster()] }))
    expect(ev2.availability(plaster)).toBe('available')
  })

  test('door frames available IN PARALLEL with conduit (both now hard-need blockwork)', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    expect(ev.availability(unit('conduit'))).toBe('available')
    expect(ev.availability(unit('door_frame'))).toBe('available')
  })

  // ── Gap-1/2: frames + ceiling are BLOCKED until walls exist (no longer available on bare floors) ──
  test('Gap-2: door_frame BLOCKED before blockwork (only structure done up to slab)', () => {
    const upToSlab = ['foundation', 'columns@Ground', 'beams@Ground', 'slab@Ground', 'shuttering_removal@Ground']
    const ev = new Evaluator(G, stateOf({ done: upToSlab }))
    expect(ev.availability(unit('door_frame'))).toBe('blocked')
    expect(ev.why(unit('door_frame'))[0].taskTypeId).toBe('blockwork')
    expect(ev.why(unit('door_frame'))[0].nature).toBe('IMPOSSIBLE')
  })
  test('Gap-1: ceiling_frame BLOCKED on a bare floor; needs the pour + blockwork', () => {
    const ev0 = new Evaluator(G, stateOf({ done: ['foundation'] }))
    expect(ev0.availability(unit('ceiling_frame'))).toBe('blocked')
    // once blockwork (hence the pour) is done → available
    const ev1 = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    expect(ev1.availability(unit('ceiling_frame'))).toBe('available')
  })

  test('switchboards blocked until conduit done (IMPOSSIBLE / logistics)', () => {
    const conduit = unit('conduit'), sb = unit('switchboard')
    expect(new Evaluator(G, stateOf({ done: blockworkDoneGround() })).availability(sb)).toBe('blocked')
    expect(new Evaluator(G, stateOf({ done: blockworkDoneGround() })).why(sb)[0].nature).toBe('IMPOSSIBLE')
    expect(new Evaluator(G, stateOf({ done: [...blockworkDoneGround(), conduit] })).availability(sb)).toBe('available')
  })

  test('freedom GROWS as concealed lines finish', () => {
    const plaster = unit('plaster')
    expect(new Evaluator(G, stateOf({ done: blockworkDoneGround() })).freedom(plaster).earliestAfterDone).toBeFalsy()
    expect(new Evaluator(G, stateOf({ done: [...blockworkDoneGround(), ...concealedByPlaster()] })).freedom(plaster).earliestAfterDone).toBeTruthy()
  })

  test('conduit reports its freedom set (muscle_followers)', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    expect(ev.freedom(unit('conduit')).freedomSet).toBe('muscle_followers')
    expect(ev.freedom(unit('conduit')).fullyFree).toBeTruthy() // blockwork anchor done
  })

  test('cohesion: waterproof drags screed as one bundle', () => {
    const ev = new Evaluator(G, stateOf({}))
    const bundle = ev.cohesionSet(unit('waterproof'))
    expect(bundle).toContain(unit('waterproof'))
    expect(bundle).toContain(unit('screed'))
  })

  test('cohesion: a completed member releases its binding', () => {
    const ev = new Evaluator(G, stateOf({ done: [unit('screed')] }))
    const bundle = ev.cohesionSet(unit('waterproof'))
    expect(bundle).toContain(unit('waterproof'))
    expect(bundle.includes(unit('screed'))).toBeFalsy()
  })

  // ── checkMove drag verdicts (the truth table) ──
  test('checkMove: plaster before conduit → allow_with_consequence (DESTRUCTIVE concealment)', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    const res = ev.checkMove(unit('plaster'), G.nodes.get(unit('conduit'))!.seqNo)
    expect(res.verdict).toBe('allow_with_consequence')
    expect(res.reason).toBe('concealment')
  })

  test('checkMove: wiring before conduit → forbid (IMPOSSIBLE)', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    expect(ev.checkMove(unit('wiring'), G.nodes.get(unit('conduit'))!.seqNo).verdict).toBe('forbid')
  })

  test('checkMove: door_frame before blockwork → forbid (Gap-2: now IMPOSSIBLE)', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    const res = ev.checkMove(unit('door_frame'), G.nodes.get('blockwork@Ground')!.seqNo)
    expect(res.verdict).toBe('forbid')
  })

  test('checkMove: switchplate before plaster → warn (a remaining STRONG_PREF)', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    const res = ev.checkMove(unit('switchplate'), G.nodes.get(unit('plaster'))!.seqNo)
    expect(res.verdict).toBe('warn')
  })

  test('checkMove: no violated preds → allow', () => {
    const ev = new Evaluator(G, stateOf({}))
    expect(ev.checkMove('foundation', G.nodes.get('foundation')!.seqNo + 5).verdict).toBe('allow')
  })

  test('priority is advisory — structure_first orders structure ahead of finishes', () => {
    const ev = new Evaluator(G, stateOf({ done: blockworkDoneGround() }))
    const ordered = ev.priority(ev.availableSet(), 'structure_first')
    const firstFinish = ordered.findIndex((id) => G.nodes.get(id)!.layer === 'finishes')
    const firstStruct = ordered.findIndex((id) => G.nodes.get(id)!.layer === 'structure')
    if (firstStruct !== -1 && firstFinish !== -1) expect(firstStruct < firstFinish).toBeTruthy()
    else expect(true).toBe(true)
  })
})
