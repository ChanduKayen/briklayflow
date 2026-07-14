// WHERE DOES A TASK BELONG? ONE ANSWER (2026-07-13).
//
// Most work happens on a floor, and says so (floor_label). The rest — the substructure, the façade, the
// terrace, the site works, handover, the lift — happens to the BUILDING, and has no floor at all. The
// question "so where does it go?" was then answered independently, in two places, differently:
//
//   viewModel.ts   three synthetic stages: Foundation (substructure) / Building-wide / Common areas
//   desk/derive.ts one bin:  SITE_FLOOR = tasks.filter((t) => !t.floor)
//
// The desk's answer is the one a supervisor reads, and it put the façade, the terrace, external paint, site
// development, snagging & handover and the LIFT into a section called "Site & foundation" — on a project
// where the foundation had not been dug. Not a display quirk: the desk was told this is groundwork.
//
// A floorless task is not "leftover". It belongs somewhere specific, and physics says where:
//
//   the ground it stands on   → substructure + earthworks   (before anything)
//   the building itself       → façade, terrace, site works, handover  (after the frame)
//   the amenities             → the lift, the compound wall, the OHT…  (their own thing, opt-in)
//
// Three stages, one classifier, both readers. The VM and the desk now ask the same function and cannot
// disagree — which is the same fix, again, as the geometry door and the node-key identity before it.

import { suite, test, expect } from './harness'
import { stageOfFloorless, placeOf, STAGE_LABEL } from '../stages'

suite('where a task belongs', () => {
  // THE ROOF IS A PLACE. Everything that stands on it — the tank, the panels, the lift machine room, the
  // staircase headroom, the waterproofing that keeps the top flat dry — is sited on the Terrace floor now,
  // so none of it is floorless and none of it reaches the stage classifier at all.
  test('(S0) the terrace’s work stands on the terrace — it is a floor, not a stage', () => {
    expect(placeOf({ taskTypeId: 'terrace_waterproof', floorLabel: 'Terrace' })).toBe('Terrace')
    expect(placeOf({ taskTypeId: 'ca_oht', floorLabel: 'Terrace' })).toBe('Terrace')
    expect(placeOf({ taskTypeId: 'ca_lift_mech', floorLabel: 'Terrace' })).toBe('Terrace')
  })

  test('(S1) the ground it stands on — substructure AND the earthworks that go with it', () => {
    for (const t of ['ground_clearance', 'site_marking', 'excavation', 'pcc_bed', 'footing',
      'footing_column', 'backfill', 'plinth_beam', 'plinth_fill', 'plinth_slab', 'foundation'])
      expect(stageOfFloorless(t)).toBe('foundation')
  })

  // The ROOF is no longer in here: the terrace is a real floor now, and terrace_waterproof / terrace_finish
  // stand ON it (sited). What is genuinely left floorless is the building's SKIN, the ground around it, and
  // the final walk.
  test('(S2) the exterior — the skin, the ground around it, and the handover', () => {
    for (const t of ['external_structure', 'facade_plaster', 'external_paint', 'site_development', 'snagging'])
      expect(stageOfFloorless(t)).toBe('exterior')
  })

  // THE LIFT WAS IN THE FOUNDATION. An amenity is its own system — opted into, commissioned, licensed —
  // and it is not groundwork under any reading.
  test('(S3) an amenity belongs to the amenities — never to the ground', () => {
    for (const t of ['ca_lift_mech', 'ca_lift', 'ca_compound', 'ca_landscaping', 'ca_oht', 'ca_stp'])
      expect(stageOfFloorless(t)).toBe('amenities')
  })

  test('(S4) a task WITH a floor belongs to its floor — the stages are for the floorless only', () => {
    expect(placeOf({ taskTypeId: 'blockwork', floorLabel: 'Ground' })).toBe('Ground')
    expect(placeOf({ taskTypeId: 'ca_lift_door', floorLabel: 'First' })).toBe('First')   // the lift's landing door IS on a floor
    expect(placeOf({ taskTypeId: 'ground_clearance', floorLabel: null })).toBe(STAGE_LABEL.foundation)
    expect(placeOf({ taskTypeId: 'external_structure', floorLabel: null })).toBe(STAGE_LABEL.exterior)
    expect(placeOf({ taskTypeId: 'ca_lift_mech', floorLabel: null })).toBe(STAGE_LABEL.amenities)
  })

  // A hand-added one-off ("Parking deck & markings") has no task type at all. It is building-level work,
  // not groundwork — and it must never crash the classifier.
  test('(S5) a manual task with no type is building-level, not groundwork', () => {
    expect(stageOfFloorless(null)).toBe('exterior')
    expect(placeOf({ taskTypeId: null, floorLabel: null })).toBe(STAGE_LABEL.exterior)
  })
})
