// ONE GEOMETRY DOOR — a project is described ONCE, by the row, for everyone (2026-07-13).
//
// A project's graph is derived from `projects` — the stack, the amenities, the suppressions. Five places
// derived it, and every one of them hand-assembled the option bag from the same columns:
//
//     ProjectSequence.tsx   buildProjectVM(… { hasCommonAreas, commonSystems, sitedLevels, suppressedTasks })
//     siteops-generate      buildProjectVM(… { hasCommonAreas, commonSystems, sitedLevels, suppressedTasks })
//     webhook (VM)          buildProjectVM(… { hasCommonAreas, commonSystems, sitedLevels, suppressedTasks })
//     webhook (persist)     stackToGeometry(… { hasCommonAreas, commonSystems, sitedLevels, suppressedTasks })
//     setupPlan.ts          stackToGeometry(… { hasCommonAreas, commonSystems, sitedLevels })   ← suppressedTasks
//
// Four readers agree. The fifth is the WIZARD — the one that actually WRITES the rows — and it forgets
// suppressions. So: suppress a task in the Sequence view (ProjectSequence writes projects.suppressed_tasks),
// then edit the construction config (ConstructionConfig re-runs setupPlan) and the suppressed rows are
// RESURRECTED — persisted by a generator building a graph nobody else builds. The next WhatsApp message
// reconciles them away again. A row that flickers in and out of existence depending on which screen you
// last touched.
//
// This is the same shape as the `hasExternalWorks` bug before it, which was wired to `has_common_areas` at
// every one of these sites — an amenity-less project silently had no façade and no site works. That one was
// fixed by pasting the same corrective COMMENT into all five places. A comment is not a mechanism.
//
// So: the option bag is built in ONE function, from the row, and nobody outside the engine names those
// columns again. The floor below (D3) is what keeps it that way — it is a grep, deliberately, because the
// failure mode is a SIXTH caller appearing next quarter and quietly disagreeing with the other five.

import { readFileSync } from 'node:fs'
import { suite, test, expect } from './harness'
import { instantiate } from '../instantiate'
import { geometryOf, geometryOptionsOf, type ProjectRow } from '../project'

const STACK = {
  levels: [
    { label: 'Stilt', kind: 'parking', zones: [{ use: 'parking', units: 1 }] },
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
  ],
}
const row = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  construction_stack: STACK, has_common_areas: false,
  common_systems: [], amenity_levels: {}, suppressed_tasks: [],
  ...over,
})
const typesOf = (r: ProjectRow): Set<string> => {
  const geo = geometryOf(r)
  if (!geo) throw new Error('no geometry')
  return new Set([...instantiate(geo).nodes.values()].map((n) => n.taskTypeId))
}

suite('one geometry door', () => {
  // THE LIVE OMISSION. The wizard's generator built its bag by hand and left this out, so the rows it wrote
  // disagreed with the rows every reader expected. Through the door, suppression is not something a caller
  // can forget — there is nothing to remember.
  test('(D1) the door carries SUPPRESSION — a suppressed task is not in the graph', () => {
    expect(typesOf(row()).has('floor_tile')).toBe(true)                            // …normally it is
    expect(typesOf(row({ suppressed_tasks: ['floor_tile'] })).has('floor_tile')).toBe(false)
    expect(geometryOptionsOf(row({ suppressed_tasks: ['floor_tile'] })).suppressedTasks).toEqual(['floor_tile'])
  })

  // THE BUG BEFORE THIS ONE, pinned so it cannot come back through the new door. hasExternalWorks defaults
  // TRUE and is NOT wired to has_common_areas: a project that ticks no amenities still has a façade, façade
  // paint and site development. (It is absent from the bag entirely — that is the point.)
  test('(D2) external works are NOT gated on amenities — no façade-less project', () => {
    const t = typesOf(row({ has_common_areas: false, common_systems: [] }))
    expect(t.has('facade_plaster')).toBe(true)
    expect(t.has('external_paint')).toBe(true)
    expect(t.has('site_development')).toBe(true)
    expect('hasExternalWorks' in geometryOptionsOf(row())).toBe(false)
  })

  // …and the amenity opt-in still works through the door (a system is off unless the row says so).
  test('(D3) an amenity system is instantiated only when the row opts into it', () => {
    expect(typesOf(row()).has('ca_lift_shaft')).toBe(false)
    expect(typesOf(row({ has_common_areas: true, common_systems: ['ca_lift'] })).has('ca_lift_shaft')).toBe(true)
  })

  // THE FLOOR. Nobody outside the engine may name the geometry columns again — the bag comes from the door
  // or it does not come at all. A sixth caller that hand-rolls one is exactly how the fifth got it wrong.
  test('(D4) no caller outside the engine hand-assembles the geometry options', () => {
    const CALLERS = [
      'src/lib/siteOps/setupPlan.ts',
      'src/components/siteOps/ProjectSequence.tsx',
      'supabase/functions/siteops-generate/index.ts',
      'supabase/functions/whatsapp-webhook/_agents/siteops.ts',
      'supabase/functions/whatsapp-webhook/_siteops_resolution_llm.ts',
    ]
    const offenders: string[] = []
    for (const f of CALLERS) {
      const src = readFileSync(f, 'utf8')
      // the tell-tale of a hand-rolled bag: naming the engine's option keys at a call site
      for (const key of ['hasCommonAreas:', 'commonSystems:', 'sitedLevels:', 'suppressedTasks:']) {
        if (src.includes(key)) offenders.push(`${f} → ${key}`)
      }
    }
    if (offenders.length) {
      throw new Error(
        `${offenders.length} hand-rolled geometry option(s) — build the bag with geometryOptionsOf(project):\n      ` +
        offenders.join('\n      '),
      )
    }
  })
})
