// M4 classifier tests — the LLM is MOCKED with fixed JSON so the validator + honesty-valve +
// bound-holding are proven WITHOUT a live model. The headline is "malicious output rejected":
// that test is the proof the bound holds and the engine stays trustworthy.
import { suite, test, expect } from './harness'
import { classifyUserTask, validateClassification, slugifyTaskId } from '../classify'
import type { ClassifierLLM, ClassifierLLMOutput, ClassifyContext } from '../classify'
import { instantiate, stackToGeometry } from '../instantiate'

const ctx = (taskText: string, zoneKind: ClassifyContext['zoneKind'] = 'dry'): ClassifyContext => ({
  taskText, floorLabel: 'First', zoneKind,
})
const mock = (out: ClassifierLLMOutput): ClassifierLLM => async () => out

suite('M4 classify', () => {
  test('false ceiling → services/finishes, anchored after conduit, before pop, clean placement', async () => {
    const out: ClassifierLLMOutput = {
      layer: 'services', trade: 'false ceiling', appliesTo: ['dry', 'common'],
      placement: [
        { pred: 'conduit', nature: 'STRONG_PREF', reason: 'logistics', scope: { kind: 'same_zone' } },
        { pred: 'pop_finish', nature: 'WEAK_PREF', reason: 'quality', scope: { kind: 'same_zone' } },
      ],
      hosts: [], hostedBy: ['ceiling_frame'], freedomSet: 'overhead_void',
      confidence: 0.82, rationale: 'ceiling void work after conduit, before POP',
    }
    const r = await classifyUserTask(ctx('false ceiling in living room'), mock(out))
    expect(r.taskType.id).toBe('user_false_ceiling_in_living_room')
    expect(r.taskType.layer).toBe('services')
    expect(r.taskType.seq.some((e) => e.pred === 'conduit')).toBeTruthy()
    expect(r.needsReview).toBeFalsy()
    expect(r.looselyAttached).toBeFalsy()
    expect(r.taskType.freedomSet).toBe('overhead_void')
  })

  test('marble cladding in lobby → finishes, after plaster, no hard edges invented', async () => {
    const out: ClassifierLLMOutput = {
      layer: 'finishes', trade: 'stone cladding', appliesTo: ['common'],
      placement: [{ pred: 'plaster', nature: 'STRONG_PREF', reason: 'quality', scope: { kind: 'same_zone' } }],
      freedomSet: 'NEW_FREE', confidence: 0.78, rationale: 'cladding over plastered surface',
    }
    const r = await classifyUserTask(ctx('Italian marble cladding in lobby', 'common'), mock(out))
    expect(r.taskType.layer).toBe('finishes')
    expect(r.taskType.seq[0].pred).toBe('plaster')
    // NEW_FREE resolves to no named set (freely interchangeable, not in a library set)
    expect(r.taskType.freedomSet).toBe(undefined)
    expect(r.needsReview).toBeFalsy()
    // no IMPOSSIBLE was fabricated
    expect(r.taskType.seq.every((e) => e.nature !== 'IMPOSSIBLE')).toBeTruthy()
  })

  test('ambiguous "site improvements" → low confidence → honesty valve, loose, needs_review, NO hard edge', async () => {
    const out: ClassifierLLMOutput = {
      layer: 'finishes', trade: 'misc', appliesTo: [],
      placement: [], freedomSet: null, confidence: 0.2, rationale: 'unclear what this is',
    }
    const r = await classifyUserTask(ctx('site improvements'), mock(out))
    expect(r.needsReview).toBeTruthy()
    expect(r.looselyAttached).toBeTruthy()
    // loosely attached: exactly one STRONG_PREF gateway edge, never a hard block
    expect(r.taskType.seq.every((e) => e.nature === 'STRONG_PREF')).toBeTruthy()
    expect(r.taskType.seq.every((e) => e.nature !== 'IMPOSSIBLE' && e.nature !== 'DESTRUCTIVE')).toBeTruthy()
  })

  // ⟵ THE PROOF THE BOUND HOLDS
  test('MALICIOUS output (cladding hosts columns, IMPOSSIBLE before paint) → rejected, safe fallback', async () => {
    const out: ClassifierLLMOutput = {
      layer: 'finishes', trade: 'cladding', appliesTo: ['common'],
      // cladding claims to come AFTER paint AND to HOST columns — i.e. columns must follow cladding.
      // But columns precedes paint in the real graph → inserting this closes a cycle.
      placement: [{ pred: 'paint', nature: 'IMPOSSIBLE', reason: 'structural', scope: { kind: 'same_zone' } }],
      hosts: ['columns'],
      freedomSet: null, confidence: 0.95, rationale: 'malicious: tries to reorder structure behind a finish',
    }
    const r = await classifyUserTask(ctx('marble cladding', 'common'), mock(out))
    // the cycle-creating edges were rejected...
    expect(r.droppedEdges.some((d) => d.why.includes('cycle'))).toBeTruthy()
    expect(r.taskType.hosts).toEqual([])
    // ...and NO IMPOSSIBLE survived to hard-block real work; it fell back to a loose, reviewable attach
    expect(r.taskType.seq.every((e) => e.nature !== 'IMPOSSIBLE')).toBeTruthy()
    expect(r.needsReview).toBeTruthy()
    // and crucially: weaving the sanitized task into the graph still topo-sorts (no cycle thrown)
    const G = instantiate(
      stackToGeometry({ levels: [{ label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] }] }),
      undefined,
      [r.taskType],
    )
    expect(G.nodes.size).toBeGreaterThan(0)
  })

  test('validator drops unknown preds + coerces unknown enums to the safe default', () => {
    const out: ClassifierLLMOutput = {
      layer: 'banana', trade: 'x', appliesTo: ['nonsense', 'wet'],
      placement: [
        { pred: 'not_a_real_task', nature: 'IMPOSSIBLE', reason: 'structural', scope: { kind: 'same_zone' } },
        { pred: 'plaster', nature: 'SUPER_HARD', reason: 'vibes', scope: { kind: 'banana' } as never },
      ],
      freedomSet: 'no_such_set', confidence: 0.9, rationale: 'mixed garbage',
    }
    const r = validateClassification(out, ctx('weird task', 'wet'))
    expect(r.taskType.layer).toBe('services')           // 'banana' → safe default services
    expect(r.taskType.appliesTo).toContain('wet')       // 'nonsense' filtered out
    expect(r.droppedEdges.some((d) => d.pred === 'not_a_real_task')).toBeTruthy()
    const plasterEdge = r.taskType.seq.find((e) => e.pred === 'plaster')!
    expect(plasterEdge.nature).toBe('STRONG_PREF')      // 'SUPER_HARD' → safe default
    expect(plasterEdge.scope.kind).toBe('same_zone')    // 'banana' scope → safe default
    expect(r.taskType.freedomSet).toBe(undefined)       // unknown set → null
  })

  test('severity ceiling: low confidence demotes a proposed DESTRUCTIVE to STRONG_PREF', () => {
    const out: ClassifierLLMOutput = {
      layer: 'finishes', trade: 'x', appliesTo: ['dry'],
      placement: [{ pred: 'plaster', nature: 'DESTRUCTIVE', reason: 'concealment', scope: { kind: 'same_zone' } }],
      freedomSet: null, confidence: 0.3, rationale: 'low-confidence guess',
    }
    const r = validateClassification(out, ctx('uncertain finish'))
    expect(r.demoted).toBeTruthy()
    expect(r.taskType.seq.find((e) => e.pred === 'plaster')!.nature).toBe('STRONG_PREF')
    expect(r.needsReview).toBeTruthy()
  })

  test('slugify is stable + safe', () => {
    expect(slugifyTaskId('Italian Marble Cladding!!')).toBe('user_italian_marble_cladding')
    expect(slugifyTaskId('   ')).toBe('user_task')
  })
})
