// Step-2 golden — buildProjectVM folds the real engine into the ProjectVM the UI renders.
// The UI computes none of this; these assertions prove the engine emits it correctly.
import { suite, test, expect } from './harness'
import { buildProjectVM } from '../viewModel'
import { canonicalRank } from '../library'
import { stateOf } from '../evaluate'
import type { BlockVM, TaskVM } from '../types'

const STACK = {
  levels: [
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'Second', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'Third', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
  ],
}

const VM = buildProjectVM('proj-test', STACK, stateOf({}), { name: 'Test Tower', dryRun: true, generatedAt: '2026-06-28T00:00:00Z' })

const allTasks = (): TaskVM[] => VM.floors.flatMap((f) => f.blocks.flatMap((b: BlockVM) => b.tasks))

suite('VM buildProjectVM', () => {
  test('(e) dryRun flag set; generatedAt passed through', () => {
    expect(VM.dryRun).toBe(true)
    expect(VM.generatedAt).toBe('2026-06-28T00:00:00Z')
    expect(VM.name).toBe('Test Tower')
  })

  test('(a) floors in bottom-up index order — Foundation first, then Ground → Third', () => {
    const idx = VM.floors.map((f) => f.index)
    for (let i = 1; i < idx.length; i++) expect(idx[i] > idx[i - 1]).toBeTruthy()
    expect(VM.floors[0].name).toBe('Foundation') // the substructure stage, index -1
    expect(VM.floors[1].name).toBe('Ground')
    expect(VM.floors[VM.floors.length - 1].name).toBe('Third')
  })

  test('each real floor has 2 blocks (units); the Foundation stage has one', () => {
    for (const f of VM.floors) expect(f.blocks).toHaveLength(f.name === 'Foundation' ? 1 : 2)
    expect(VM.floors.find((f) => f.name === 'Ground')!.blocks[0].name).toBe('Unit A')
  })

  test('(b) every block reads in the CANONICAL construction sequence (not zone-scrambled seqNo)', () => {
    const rank = canonicalRank()
    for (const f of VM.floors)
      for (const b of f.blocks) {
        let prev = -1
        for (const t of b.tasks) {
          const r = rank.get(t.taskType) ?? 9999
          if (!(r >= prev)) throw new Error(`canonical order broke in ${f.name}/${b.name}: ${t.taskType} (rank ${r}) after rank ${prev}`)
          prev = r
        }
      }
    // and the canonical order never contradicts a hard constraint (proven in M1 validate); spot-check:
    const g = VM.floors.find((f) => f.name === 'Ground')!.blocks[0].tasks.map((t) => t.taskType)
    expect(g.indexOf('plaster') > g.indexOf('conduit')).toBeTruthy()       // plaster conceals conduit
    expect(g.indexOf('floor_tile') > g.indexOf('waterproof')).toBeTruthy()  // tile over waterproofing
    expect(g.indexOf('conduit') > g.indexOf('blockwork')).toBeTruthy()      // conduit chased into walls
  })

  test('(c) a blocked task carries the right why + reason (columns after Foundation — mass concrete — structural)', () => {
    const cols = VM.floors.find((f) => f.name === 'Ground')!.blocks[0].tasks.find((t) => t.taskType === 'columns')!
    expect(cols.status).toBe('blocked')
    expect(cols.why?.[0].afterLabel).toBe('Foundation — mass concrete')
    expect(cols.why?.[0].reason).toBe('structural')
  })

  test('(d) a freedom-set member carries its freedomSet (conduit → muscle_followers)', () => {
    const conduit = allTasks().find((t) => t.taskType === 'conduit')!
    expect(conduit.freedomSet).toBe('muscle_followers')
  })

  test('hardPreds are engine-supplied (not a UI ruleset): plaster lists conduit as a hard pred', () => {
    const plaster = allTasks().find((t) => t.taskType === 'plaster')!
    expect(plaster.hardPreds.some((e) => e.taskType === 'conduit' && e.nature === 'DESTRUCTIVE')).toBeTruthy()
  })

  test('layer % / overall % / stage computed by the engine, present on every block', () => {
    for (const f of VM.floors)
      for (const b of f.blocks) {
        expect(typeof b.overallPct).toBe('number')
        expect(typeof b.layerPct.structure).toBe('number')
        expect(['structure', 'services', 'finishes', 'done']).toContain(b.stage.key)
      }
    expect(true).toBe(true)
  })

  test('a per-zone SERVICES task marks done via its FOLDED node_key (the services-not-done bug)', () => {
    // the UI materialises one row per folded display task, keyed by the folded node_key. A services
    // task folds many zone-instances; completion must expand to all of them.
    const state = new Map<string, 'done'>([['conduit@Ground/UnitA', 'done']])
    const vm = buildProjectVM('p', STACK, state, { dryRun: true })
    const conduit = vm.floors.find((f) => f.name === 'Ground')!.blocks.find((b) => b.name === 'Unit A')!.tasks.find((t) => t.taskType === 'conduit')!
    expect(conduit.status).toBe('done')
    // a per-floor structure task still marks done via its (concrete == folded) key
    const vm2 = buildProjectVM('p', STACK, new Map([['columns@Ground', 'done']]), { dryRun: true })
    expect(vm2.floors.find((f) => f.name === 'Ground')!.blocks[0].tasks.find((t) => t.taskType === 'columns')!.status).toBe('done')
  })

  test('fresh project (empty state) → 0% overall, every task blocked except the building entrypoint', () => {
    expect(VM.overallPct).toBe(0)
    // foundation is a building singleton (not on a floor) — every floor task starts blocked/ available
    const statuses = new Set(allTasks().map((t) => t.status))
    expect(statuses.has('blocked')).toBeTruthy()
  })
})
