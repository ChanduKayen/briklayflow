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

  // 6 per-floor types since the floor cycle was rebuilt (2026-07-11): columns, shuttering, reinforcement,
  // pour, de-propping, blockwork — `beams` + `slab` retired into the monolithic pour.
  test('per-floor structural nodes: 6 types × 4 floors = 24', () => {
    const perFloor = [...G.nodes.values()].filter((n) => n.zoneId === null && n.floorLabel !== null)
    expect(perFloor).toHaveLength(24)
  })

  test('exactly one foundation singleton; no lift/façade by default', () => {
    expect(nodesOfType('foundation')).toHaveLength(1)
    expect(nodesOfType('lift_mechanism')).toHaveLength(0)
    expect(nodesOfType('facade_plaster')).toHaveLength(0)
  })

  test('total node/edge/bundle counts are stable (snapshot)', () => {
    // locked from first observed run; a change here flags a deliberate library/geometry change.
    // G+3 × 2 units × (dry+wet+balcony) zones, full library.
    // 397 → 489 (2026-07-11): the floor cycle replaced 2 per-floor types with 3 (+1 per floor), and 12
    // new task-types were authored in (the stages the legacy expander tracked and the engine did not).
    expect(G.nodes.size).toBe(489)
    expect(G.edges.length).toBe(658)   // 514 + the new types' edges + the extra floor-cycle links
    expect(G.bundles.length).toBe(40)
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

  // ── (d) wet-only tasks exist only in wet/balcony zones ──
  test('waterproofing instantiated only in wet/balcony zones; sanitary wet-only', () => {
    const wp = nodesOfType('waterproof')
    expect(wp.length).toBeGreaterThan(0)
    for (const n of wp)
      if (n.zoneKind !== 'wet' && n.zoneKind !== 'balcony')
        throw new Error(`waterproof in non-wet zone: ${n.id} (${n.zoneKind})`)
    for (const n of nodesOfType('sanitary'))
      if (n.zoneKind !== 'wet') throw new Error(`sanitary in non-wet zone: ${n.id}`)
    expect(true).toBe(true)
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

  test('blockwork → conduit edge exists per dry zone (gateway fan-out)', () => {
    const { preds } = buildAdjacency(G)
    const conduitGroundDry = [...G.nodes.values()].find(
      (n) => n.taskTypeId === 'conduit' && n.floorLabel === 'Ground' && n.zoneKind === 'dry',
    )!
    const inc = preds.get(conduitGroundDry.id) ?? []
    expect(inc.some((e) => G.nodes.get(e.from)!.taskTypeId === 'blockwork')).toBeTruthy()
  })
})
