// M1 golden tests — the constraint library is internally consistent and the dozen spot-check
// edges from the build prompt are present with the authored nature/reason.
import { suite, test, expect } from './harness'
import { LIBRARY, validateLibrary, taskType, canonicalRank } from '../library'

function predEdge(followerId: string, predId: string) {
  return taskType(followerId).seq.find((e) => e.pred === predId)
}

suite('M1 library', () => {
  test('validates clean (no unknown refs, no authored cycle)', () => {
    const issues = validateLibrary()
    if (issues.length) throw new Error('issues:\n' + issues.map((i) => `   [${i.kind}] ${i.detail}`).join('\n'))
    expect(issues).toHaveLength(0)
  })

  test('snapshot counts are stable', () => {
    // 56 → 69: `beams` + `slab` retired for the real floor cycle (shutter → rebar → pour, +3), and the
    // 12 stages the legacy expander tracked and the engine did not (site_marking, plinth_slab, riser,
    // putty, window_grill, fixture, decorative, external_paint, terrace_waterproof, terrace_finish,
    // stair_finish, snagging) authored in. See library.ts "THE FLOOR CYCLE".
    expect(LIBRARY.taskTypes.size).toBe(69)
    expect(LIBRARY.freedomSets.size).toBe(5)
  })

  // ── the dozen spot-check edges ──
  test('floor_pour → blockwork is IMPOSSIBLE / structural', () => {
    const e = predEdge('blockwork', 'floor_pour')!
    expect(e.nature).toBe('IMPOSSIBLE'); expect(e.reason).toBe('structural')
  })
  test('conduit → plaster is DESTRUCTIVE / concealment', () => {
    const e = predEdge('plaster', 'conduit')!
    expect(e.nature).toBe('DESTRUCTIVE'); expect(e.reason).toBe('concealment')
  })
  test('conduit → door_frame is WEAK_PREF / logistics (the frames edge)', () => {
    const e = predEdge('door_frame', 'conduit')!
    expect(e.nature).toBe('WEAK_PREF'); expect(e.reason).toBe('logistics')
  })
  test('blockwork → conduit DESTRUCTIVE / concealment', () => {
    const e = predEdge('conduit', 'blockwork')!
    expect(e.nature).toBe('DESTRUCTIVE'); expect(e.reason).toBe('concealment')
  })
  // THE FLOOR CYCLE (2026-07-11) — beams and the slab are shuttered, reinforced and poured as ONE
  // monolithic operation. The chain is now columns → shutter → rebar → pour, every link IMPOSSIBLE.
  test('columns → shutter → rebar → pour IMPOSSIBLE / structural chain', () => {
    expect(predEdge('floor_shutter', 'columns')!.nature).toBe('IMPOSSIBLE')
    expect(predEdge('floor_rebar', 'floor_shutter')!.nature).toBe('IMPOSSIBLE')
    expect(predEdge('floor_pour', 'floor_rebar')!.nature).toBe('IMPOSSIBLE')
  })
  test('floor_pour → columns cross-floor (-1) IMPOSSIBLE', () => {
    const e = predEdge('columns', 'floor_pour')!
    expect(e.scope.kind).toBe('cross_floor')
    expect((e.scope as { delta: number }).delta).toBe(-1)
  })
  test('shuttering_removal → blockwork DESTRUCTIVE structural, cross-floor (+1) — Flag-1', () => {
    const e = predEdge('blockwork', 'shuttering_removal')!
    expect(e.nature).toBe('DESTRUCTIVE'); expect(e.reason).toBe('structural')
    // FLAG-1 (founder-ruled): blockwork@F waits on the slab ABOVE being de-propped → deshutter@(F+1)
    expect(e.scope.kind).toBe('cross_floor')
    expect((e.scope as { delta: number }).delta).toBe(1)
  })
  test('floor_pour → shuttering_removal is a curing-time wait', () => {
    const e = predEdge('shuttering_removal', 'floor_pour')!
    expect(e.reason).toBe('curing_time')
  })
  test('waterproof → screed DESTRUCTIVE / concealment', () => {
    expect(predEdge('screed', 'waterproof')!.nature).toBe('DESTRUCTIVE')
  })
  test('door_frame → door_shutter IMPOSSIBLE / logistics (hosting)', () => {
    const e = predEdge('door_shutter', 'door_frame')!
    expect(e.nature).toBe('IMPOSSIBLE'); expect(e.reason).toBe('logistics')
  })
  test('conduit → switchboard IMPOSSIBLE / logistics', () => {
    expect(predEdge('switchboard', 'conduit')!.nature).toBe('IMPOSSIBLE')
  })
  // ── Gap-1/2 corrections (engine-flagged, founder-ruled) ──
  test('Gap-2: blockwork → door_frame / window_frame promoted to IMPOSSIBLE', () => {
    expect(predEdge('door_frame', 'blockwork')!.nature).toBe('IMPOSSIBLE')
    expect(predEdge('window_frame', 'blockwork')!.nature).toBe('IMPOSSIBLE')
  })
  test('Gap-1: ceiling_frame gains floor_pour (IMPOSSIBLE/structural) + blockwork (DESTRUCTIVE) preds', () => {
    const slabE = predEdge('ceiling_frame', 'floor_pour')!
    expect(slabE.nature).toBe('IMPOSSIBLE'); expect(slabE.reason).toBe('structural')
    expect(predEdge('ceiling_frame', 'blockwork')!.nature).toBe('DESTRUCTIVE')
  })

  test('lift_mechanism is long-lead; blockwork is the gateway', () => {
    expect(taskType('lift_mechanism').longLead).toBeTruthy()
    expect(taskType('blockwork').isGateway).toBeTruthy()
  })

  // ── construction-semantic fields ──
  test('concealment semantics wired both directions', () => {
    expect(taskType('plaster').conceals).toContain('conduit')
    expect(taskType('conduit').concealedBy).toContain('plaster')
    expect(taskType('waterproof').concealedBy).toContain('screed')
    expect(taskType('floor_tile').conceals).toContain('screed')
  })
  test('hosting pairs wired', () => {
    expect(taskType('door_frame').hosts).toContain('door_shutter')
    expect(taskType('plumb_rough').hosts).toContain('sanitary')
    expect(taskType('conduit').hosts).toContain('wiring')
  })
  test('cohesion bundles authored', () => {
    expect(taskType('waterproof').cohesion?.[0].with).toBe('screed')
    expect(taskType('void_wiring').cohesion?.[0].with).toBe('pop_finish')
  })

  test('canonical display sequence covers every task-type and reads in construction order', () => {
    const rank = canonicalRank()
    expect(rank.size).toBe(LIBRARY.taskTypes.size) // every type placed
    const before = (a: string, b: string) => (rank.get(a) ?? 9) < (rank.get(b) ?? 9)
    expect(before('blockwork', 'conduit')).toBeTruthy()
    expect(before('conduit', 'plaster')).toBeTruthy()
    expect(before('plaster', 'paint')).toBeTruthy()
    expect(before('waterproof', 'floor_tile')).toBeTruthy()
    expect(before('plumb_rough', 'sanitary')).toBeTruthy()
  })

  // ── appliesTo honesty ──
  test('wet-only tasks marked wet-only', () => {
    expect(taskType('waterproof').appliesTo).toEqual(['wet', 'balcony'])
    expect(taskType('sanitary').appliesTo).toEqual(['wet'])
  })
})
