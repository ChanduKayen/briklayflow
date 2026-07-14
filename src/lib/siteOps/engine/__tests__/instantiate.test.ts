// M2 golden tests — the instantiator builds a deterministic concrete graph and the topo sort
// fixes the old nonsensical ordering. The headline proof: columns→slab→blockwork→columns(next).
import { suite, test, expect } from './harness'
import { instantiate, stackToGeometry, buildAdjacency } from '../instantiate'
import type { ConcreteGraph, NodeId } from '../types'

// A G+3 (Ground..Third = 4 structural floors), 2-units-per-floor building.
const STACK = {
  levels: [
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'Second', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'Third', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
  ],
}
const GEO = stackToGeometry(STACK)
const G: ConcreteGraph = instantiate(GEO)

function seq(nodeId: NodeId): number {
  const n = G.nodes.get(nodeId)
  if (!n) throw new Error(`node not found: ${nodeId}`)
  return n.seqNo
}
const nodesOfType = (tid: string) => [...G.nodes.values()].filter((n) => n.taskTypeId === tid)

suite('M2 instantiate', () => {
  test('deterministic — same input yields identical node count + seq', () => {
    const G2 = instantiate(GEO)
    expect(G2.nodes.size).toBe(G.nodes.size)
    let drift = 0
    for (const [id, n] of G.nodes) if (G2.nodes.get(id)!.seqNo !== n.seqNo) drift++
    expect(drift).toBe(0)
  })

  // 6 per-floor structural types since the floor cycle was rebuilt (2026-07-11): columns, shuttering,
  // reinforcement, pour, de-propping, blockwork — `beams` + `slab` retired into the monolithic pour.
  // + `riser`, per_floor since 2026-07-13 (a riser is dropped and teed at every floor it passes).
  // 28 → 30 (2026-07-13): the building now has a TERRACE, and `Terrace — waterproofing` / `Terrace —
  // finishing` are `sited` on it. They were floorless singletons before — the terrace was named in the task
  // and existed nowhere in the model. This filter (zoneId null, floorLabel set) catches a sited node too,
  // which is exactly right: it stands on a level. The FRAME is still 7 × 4 — per_floor work does not climb
  // onto the roof, because the roof slab IS the top floor's pour.
  // …+1 (2026-07-13): `Site — grading` is `sited` on the LOWEST level now. It is cut and fill for the level
  // the stilt stands on, done once the substructure is out of the trench — not site preparation, which is
  // where a floorless task with only a 'clear the plot' gate had put it (third in the whole plan).
  test('per-floor nodes: 7 types × 4 floors = 28, + the sited terrace tasks and grading', () => {
    const perFloor = [...G.nodes.values()].filter((n) => n.zoneId === null && n.floorLabel !== null)
    expect(perFloor).toHaveLength(31)
    expect(perFloor.filter((n) => n.floorLabel === 'Terrace').map((n) => n.taskTypeId).sort())
      .toEqual(['terrace_finish', 'terrace_waterproof'])
    // no stilt in THIS stack, so the lowest level is Ground — grading stands there
    expect(perFloor.find((n) => n.taskTypeId === 'site_grade')!.floorLabel).toBe('Ground')
  })

  // No amenity is instantiated unless the project TICKED its system — and the gate now applies to every
  // instancing, not just `building`, or a lift landing door would appear in a project with no lift.
  test('no amenity without its opt-in; the façade, though, is not an amenity', () => {
    expect(nodesOfType('foundation')).toHaveLength(1)
    expect(nodesOfType('ca_lift_door')).toHaveLength(0)   // per_floor, but still gated
    expect(nodesOfType('ca_generator')).toHaveLength(0)
    // hasExternalWorks now DEFAULTS TRUE. It used to default false and be wired to has_common_areas at
    // every call site, so a project with no amenities silently had no façade and no site development.
    expect(nodesOfType('facade_plaster')).toHaveLength(1)
    expect(nodesOfType('site_development')).toHaveLength(1)
  })

  test('total node/edge/bundle counts are stable (snapshot)', () => {
    // locked from first observed run; a change here flags a deliberate library/geometry change.
    // G+3 × 2 units, full library — ONE zone per unit.
    // 397 → 489 (2026-07-11): the floor cycle replaced 2 per-floor types with 3 (+1 per floor), and 12
    // new task-types were authored in (the stages the legacy expander tracked and the engine did not).
    // 489 → 249 (2026-07-13): a zone is a UNIT, not a room. The old geometry split every flat into
    // dry+wet+balcony zones and instantiated each per_zone type up to 3× per flat — rows that were
    // identical on every surface that renders them. See __tests__/identity.test.ts.
    // 249 → 255 (2026-07-13, same day): +3 riser (now per_floor — it is teed at every floor it passes),
    // +4 façade & site work (hasExternalWorks now defaults TRUE; it used to default false AND be wired
    // to has_common_areas, so an amenity-less project silently had no façade), −1 stair_finish (now a
    // component of the ca_stair SYSTEM, so it is opt-in like the rest of the staircase).
    // No amenity is in this count: this stack ticks none.
    // edges 343 → 412 (2026-07-13): the EXISTENCE edges. 15 task types could start on bare ground — the
    // façade before the frame, waterproofing before the rooms, handover before the building — because the
    // author had written down the quality PREFERENCE ("tile onto plaster") and never the physical
    // requirement ("there must be a wall"). Prefs don't gate, by design. Nodes are unchanged: this adds no
    // work, it only says when the work can begin. See __tests__/plan_truth.test.ts.
    expect(G.nodes.size).toBe(255)
    // 412 -> 413: grading gained its second existence gate (the plinth must be cast before you can grade
    //             the earth around it — you cannot shape ground that is still an open trench).
    expect(G.edges.length).toBe(413)
    expect(G.bundles.length).toBe(24)  // 3 cohesion pairs per unit × 8 units (was 40 across split zones)
  })

  // ── (b) the structural frame ladder: columns→beams→slab, deck rule columns(F+1) after slab(F) ──
  test('frame races up: columns → shutter → rebar → pour per floor, pour(F) before columns(F+1)', () => {
    const floors = ['Ground', 'First', 'Second', 'Third']
    let prevPour = 0
    for (const f of floors) {
      const c = seq(`columns@${f}`), sh = seq(`floor_shutter@${f}`)
      const rb = seq(`floor_rebar@${f}`), po = seq(`floor_pour@${f}`)
      if (!(c < sh && sh < rb && rb < po))
        throw new Error(`frame ladder broke within ${f}: columns=${c} shutter=${sh} rebar=${rb} pour=${po}`)
      if (!(prevPour < c))
        throw new Error(`floor ${f} columns=${c} not after the deck below (prev pour=${prevPour})`)
      prevPour = po
    }
    expect(true).toBe(true)
  })

  // ── (b′) FLAG-1: blockwork@F is gated by deshutter@(F+1) — the slab ABOVE, never its own ──
  test('Flag-1: blockwork@F gated by the slab ABOVE being de-propped (deshutter@F+1)', () => {
    const { preds } = buildAdjacency(G)
    for (const [f, above] of [['Ground', 'First'], ['First', 'Second'], ['Second', 'Third']] as const) {
      const inc = preds.get(`blockwork@${f}`) ?? []
      const deshutterPreds = inc.filter((e) => G.nodes.get(e.from)!.taskTypeId === 'shuttering_removal')
      // exactly the floor ABOVE gates it — not its own floor
      expect(deshutterPreds.map((e) => e.from)).toEqual([`shuttering_removal@${above}`])
      // and the order reflects it: blockwork@F lands after deshutter@(F+1)
      if (!(seq(`blockwork@${f}`) > seq(`shuttering_removal@${above}`)))
        throw new Error(`blockwork@${f}=${seq(`blockwork@${f}`)} not after deshutter@${above}=${seq(`shuttering_removal@${above}`)}`)
    }
    expect(true).toBe(true)
  })

  // ── (c) top occupied floor: blockwork gated by terrace-or-nothing, NEVER its own deshutter ──
  test('top-floor blockwork has NO deshutter gate (terrace-or-nothing); +1 edge dropped', () => {
    const { preds, succs } = buildAdjacency(G)
    const topInc = preds.get('blockwork@Third') ?? []
    const deshutterPreds = topInc.filter((e) => G.nodes.get(e.from)!.taskTypeId === 'shuttering_removal')
    expect(deshutterPreds).toHaveLength(0) // no floor above Third → +1 edge drops
    // top-floor slab also feeds no columns-above (the deck cross-floor edge drops too)
    const toColumns = (succs.get('slab@Third') ?? []).filter((e) => G.nodes.get(e.to)!.taskTypeId === 'columns')
    expect(toColumns).toHaveLength(0)
  })

  // ── (d) wet-only tasks land once per UNIT (the flat has a wet room) and never on a parking deck ──
  // `appliesTo: ['wet']` still means something: it is matched against the kinds INSIDE a zone, so a flat
  // (dry+wet+balcony) gets waterproofing and the stilt deck (common) does not. What it no longer does is
  // split one flat into three identically-named tasks.
  test('wet-only tasks: exactly one per unit, never on a common/parking zone', () => {
    const g = instantiate(stackToGeometry({
      levels: [
        { label: 'Stilt', kind: 'parking', zones: [{ use: 'parking', units: 1 }] },
        { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
      ],
    }))
    const wp = [...g.nodes.values()].filter((n) => n.taskTypeId === 'waterproof')
    expect(wp).toHaveLength(2)                                   // two flats, two waterproofing tasks
    expect(wp.every((n) => n.floorLabel === 'Ground')).toBeTruthy() // none on the stilt deck
    expect(new Set(wp.map((n) => n.unitLabel)).size).toBe(2)     // one each, not doubled per room
    const sanitary = [...g.nodes.values()].filter((n) => n.taskTypeId === 'sanitary')
    expect(sanitary.every((n) => n.floorLabel === 'Ground')).toBeTruthy()
  })

  // ── Step-5 explicit Flag-1 proof on a clean G+2 (Ground, First, Second) ──
  test('Flag-1 G+2: blockwork@First gated by deshutter@Second; top floor gated by terrace-or-nothing', () => {
    const g2 = instantiate(stackToGeometry({
      levels: [
        { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
        { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
        { label: 'Second', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
      ],
    }))
    const { preds } = buildAdjacency(g2)
    const deshutterGate = (floor: string) =>
      (preds.get(`blockwork@${floor}`) ?? [])
        .filter((e) => g2.nodes.get(e.from)!.taskTypeId === 'shuttering_removal')
        .map((e) => e.from)
    // First-floor walls wait on the slab ABOVE (Second) being de-propped — NOT its own floor
    expect(deshutterGate('First')).toEqual(['shuttering_removal@Second'])
    expect(deshutterGate('Ground')).toEqual(['shuttering_removal@First'])
    // Second is the TOP occupied floor → no slab above → no own-floor deshutter gate (terrace-or-nothing)
    expect(deshutterGate('Second')).toHaveLength(0)
    // ordering follows: blockwork@First lands after deshutter@Second
    const sq = (k: string) => g2.nodes.get(k)!.seqNo
    if (!(sq('blockwork@First') > sq('shuttering_removal@Second')))
      throw new Error(`blockwork@First=${sq('blockwork@First')} not after deshutter@Second=${sq('shuttering_removal@Second')}`)
    expect(true).toBe(true)
  })

  // ── amenity systems: the components land where the work actually is ──
  test('a ticked lift yields a shaft + landing door on EVERY floor, and one mechanism + licence', () => {
    const g = instantiate(stackToGeometry(STACK, { commonSystems: ['ca_lift'] }))
    const of = (tt: string) => [...g.nodes.values()].filter((n) => n.taskTypeId === tt)
    expect(of('ca_lift_shaft')).toHaveLength(4)   // G+3
    expect(of('ca_lift_door')).toHaveLength(4)    // a door at every landing — the whole point
    expect(of('ca_lift_mech')).toHaveLength(1)
    expect(of('ca_lift')).toHaveLength(1)
    // every node carries its system, so the amenities view can group them without a second task tree
    expect(of('ca_lift_door').every((n) => n.system === 'ca_lift')).toBeTruthy()
    // and the landing door on the 3rd floor is addressable — which is what "report it" requires
    expect(of('ca_lift_door').some((n) => n.floorLabel === 'Third')).toBeTruthy()
  })

  test('commissioning waits for EVERY floor, not just its own', () => {
    const g = instantiate(stackToGeometry(STACK, { commonSystems: ['ca_lift'] }))
    const { preds } = buildAdjacency(g)
    const doorPreds = (preds.get('ca_lift') ?? []).filter((e) => g.nodes.get(e.from)!.taskTypeId === 'ca_lift_door')
    expect(doorPreds).toHaveLength(4)   // a building follower vs a per_floor pred used to yield ZERO edges
  })

  // THE TANK IS ON THE ROOF — and this test asserted it was on the top FLAT. `sitedDefault: 'top'` means
  // the topmost level, and until the building had a terrace the topmost level was somebody's living room.
  // The title was right all along; the model had nowhere to put it.
  test('a sited plant stands on a level — the DG on the lowest, the tank on the roof', () => {
    const g = instantiate(stackToGeometry({
      levels: [
        { label: 'Stilt', kind: 'parking', zones: [{ use: 'parking', units: 1 }] },
        { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
        { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
      ],
    }, { commonSystems: ['ca_generator', 'ca_oht'] }))
    const dg = [...g.nodes.values()].find((n) => n.taskTypeId === 'ca_generator')!
    const oht = [...g.nodes.values()].find((n) => n.taskTypeId === 'ca_oht')!
    expect(dg.floorLabel).toBe('Stilt')     // "the generator will be in stilt" — exactly
    expect(oht.floorLabel).toBe('Terrace')    // the roof-most level
    expect(dg.id).toBe('ca_generator@Stilt')
  })

  test('an explicit amenity level overrides the default', () => {
    const g = instantiate(stackToGeometry({
      levels: [
        { label: 'Stilt', kind: 'parking', zones: [{ use: 'parking', units: 1 }] },
        { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
      ],
    }, { commonSystems: ['ca_generator'], sitedLevels: { ca_generator: 'Ground' } }))
    const dg = [...g.nodes.values()].find((n) => n.taskTypeId === 'ca_generator')!
    expect(dg.floorLabel).toBe('Ground')
  })

  test('blockwork → conduit edge exists per unit (gateway fan-out)', () => {
    const { preds } = buildAdjacency(G)
    const conduitGround = [...G.nodes.values()].find(
      (n) => n.taskTypeId === 'conduit' && n.floorLabel === 'Ground' && n.zoneId !== null,
    )!
    const inc = preds.get(conduitGround.id) ?? []
    expect(inc.some((e) => G.nodes.get(e.from)!.taskTypeId === 'blockwork')).toBeTruthy()
  })
})

/**
 * A HUMAN DELETED ONE TASK — suppressedNodes (projects.suppressed_nodes).
 *
 * `suppressedTasks` removes a TYPE from the whole project: no blockwork anywhere. That is the wrong
 * grain for a delete on the desk, where he removed the blockwork on the FIRST floor and every other
 * floor's blockwork must survive untouched. So the key here is the node_key, and the deletion has to
 * do two things: take the node out, and take its EDGES with it — because a task that is not happening
 * cannot still be something other work is waiting for.
 */
suite('M2 — one deleted task (suppressedNodes)', () => {
  const blockworkFirst = [...G.nodes.values()]
    .find((n) => n.taskTypeId === 'blockwork' && n.floorLabel === 'First')!

  const g = instantiate(stackToGeometry(STACK, { suppressedNodes: [blockworkFirst.id] }))

  test('the deleted node is gone', () => {
    expect(g.nodes.has(blockworkFirst.id)).toBe(false)
  })

  test('...and ONLY that one — the same work on every other floor stands', () => {
    const kept = [...g.nodes.values()].filter((n) => n.taskTypeId === 'blockwork')
    expect(kept.length).toBe(nodesOfType('blockwork').length - 1)
    expect(kept.some((n) => n.floorLabel === 'First')).toBe(false)
    expect(kept.some((n) => n.floorLabel === 'Second')).toBeTruthy()
  })

  test('its edges go with it — nothing is left waiting on work that is not happening', () => {
    expect(g.edges.some((e) => e.from === blockworkFirst.id || e.to === blockworkFirst.id)).toBe(false)
  })

  test('a node_key that does not exist suppresses nothing — a stale key is not a crash', () => {
    const g2 = instantiate(stackToGeometry(STACK, { suppressedNodes: ['nonsense@Nowhere'] }))
    expect(g2.nodes.size).toBe(G.nodes.size)
  })
})
