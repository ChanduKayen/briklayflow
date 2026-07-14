// TASK IDENTITY — the two invariants that make a persisted row USABLE, not merely correct.
//
// A row can have a perfectly unique node_key and still be a bug, twice over:
//
//   1. INDISTINGUISHABLE. Every human-facing surface names a task by (name, floor, unit) — the task
//      list renders whereLabel(floor_label, unit_label), the WhatsApp pick offers "Floor — tiling —
//      Ground". Nothing anywhere renders zone_id. So two rows that differ ONLY by zone are the same
//      row to every reader: three identical "Electrical — conduiting (1st fix)" lines in the list,
//      and a which_item ask offering the same label three times, which nobody can answer.
//
//   2. UNWRITEABLE. The VM folds per-zone nodes to ONE display task per (type, floor, unit) —
//      foldKeyOf() = `tid@Floor/unit`. The persisted node_key is `tid@Floor#zoneId`. Those key
//      schemes never intersect, so applyProgress's guardrail (node_key ∈ vmNodeKeys) REFUSES every
//      per-zone write: tiling, conduiting, plaster, paint, doors, windows can never be marked done
//      from WhatsApp. The refusal is correct — it's protecting against an invisible write — but the
//      row should never have been shaped so the UI can't see it.
//
// Both fall out of the same root: the zone fan-out is data the geometry doesn't actually have, and
// the VM folds it away again at display time. These tests pin the contract at the source, where a
// row is born, so it cannot drift back.
import { suite, test, expect } from './harness'
import { instantiate, stackToGeometry } from '../instantiate'
import { toPersistRows } from '../persist'
import { buildProjectVM } from '../viewModel'

// The real shape of the SOUNDHARYA site: a stilt parking level + three habitable floors, one unit each.
const STACK = {
  levels: [
    { label: 'Stilt', kind: 'parking', zones: [{ use: 'parking', units: 1 }] },
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
    { label: 'Second', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
  ],
}

// Every amenity system ticked — the worst case for both invariants, since amenities are the types that
// repeat per floor (lift shaft, landing door, stair flight, corridor, fire standpipe) and so are the
// likeliest to collide on a label or to render nowhere.
const ALL_SYSTEMS = [
  'ca_lift', 'ca_stair', 'ca_corridor', 'ca_oht', 'ca_ugt', 'ca_borewell', 'ca_stp',
  'ca_transformer', 'ca_generator', 'ca_solar', 'ca_fire', 'ca_parking', 'ca_compound', 'ca_landscaping',
]

const rowsFor = (stack: typeof STACK, commonSystems: string[] = []) =>
  toPersistRows(instantiate(stackToGeometry(stack, { commonSystems })), { project_id: 'p1', org_id: 'o1' })

/** How a human sees a row: everything the UI and the WhatsApp pick actually render. Zone is not in it. */
const humanKey = (r: { name: string; floor_label: string | null; unit_label: string | null }) =>
  `${r.name} | ${r.floor_label ?? '-'} | ${r.unit_label ?? '-'}`

suite('task identity', () => {
  test('no two persisted rows are indistinguishable to a human (name + floor + unit is unique)', () => {
    const rows = rowsFor(STACK)
    const seen = new Map<string, number>()
    for (const r of rows) seen.set(humanKey(r), (seen.get(humanKey(r)) ?? 0) + 1)

    const dupes = [...seen.entries()].filter(([, n]) => n > 1)
    const detail = dupes.map(([k, n]) => `${n}× ${k}`).join('\n      ')
    if (dupes.length) throw new Error(`${dupes.length} label(s) render more than once:\n      ${detail}`)
  })

  // EVERY row, with no allowlist. The VM's three synthetic stages (Foundation, Building-wide, Common
  // areas) are a partition of the floorless work, so a task type added to the library tomorrow lands in
  // one of them by construction. If this ever fails again, some row is unwriteable from WhatsApp — the
  // guardrail will refuse it and the supervisor's "it's done" will vanish.
  const vmKeysFor = (stack: typeof STACK, commonSystems: string[] = []): Set<string> => {
    const vm = buildProjectVM('p1', stack, new Map(), { dryRun: true, commonSystems })
    const keys = new Set<string>()
    for (const f of vm.floors) for (const b of f.blocks) for (const t of b.tasks) keys.add(t.nodeKey)
    return keys
  }

  const assertAllRenderable = (commonSystems: string[]) => {
    const rows = rowsFor(STACK, commonSystems)
    const vmKeys = vmKeysFor(STACK, commonSystems)
    const invisible = rows.filter((r) => !vmKeys.has(r.node_key))
    const detail = invisible.slice(0, 10).map((r) => `${r.node_key}  (${r.name})`).join('\n      ')
    if (invisible.length)
      throw new Error(
        `${invisible.length}/${rows.length} rows carry a node_key the VM never renders — ` +
        `every progress write to one is refused by the guardrail:\n      ${detail}`,
      )
  }

  test('every persisted node_key is renderable by the VM — the guardrail can always pass', () => {
    assertAllRenderable([])
  })

  test('…and that still holds with every amenity system ticked', () => {
    assertAllRenderable(ALL_SYSTEMS)
  })

  test('an amenity is unique per floor too — no two lift doors read alike', () => {
    const rows = rowsFor(STACK, ALL_SYSTEMS)
    const seen = new Map<string, number>()
    for (const r of rows) seen.set(humanKey(r), (seen.get(humanKey(r)) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1)
    if (dupes.length)
      throw new Error(`${dupes.length} label(s) render more than once:\n      ` +
        dupes.map(([k, n]) => `${n}× ${k}`).join('\n      '))
  })

  test('the amenities view indexes the SAME rows, never a second task tree', () => {
    const rows = rowsFor(STACK, ALL_SYSTEMS)
    const vm = buildProjectVM('p1', STACK, new Map(), { dryRun: true, commonSystems: ALL_SYSTEMS })
    const rowKeys = new Set(rows.map((r) => r.node_key))

    const lift = vm.amenities.find((a) => a.system === 'ca_lift')!
    expect(lift.label).toBe('Lift')
    // shaft ×4 + doors ×4 + mechanism + licence, on a G+3-over-stilt building
    expect(lift.tasks).toHaveLength(10)
    // every amenity task IS a persisted row — same node_key, so a status written from either surface
    // is the same status. A second tree would drift; this cannot.
    for (const a of vm.amenities)
      for (const t of a.tasks)
        if (!rowKeys.has(t.nodeKey)) throw new Error(`amenity task ${t.nodeKey} is not a persisted row`)
  })

  test('the terrace, the façade and handover are reachable — the work that had no floor', () => {
    const vmKeys = vmKeysFor(STACK)
    // the terrace's own work now STANDS on the terrace (a real floor since 2026-07-13), so its keys carry it
    for (const tt of ['terrace_waterproof@Terrace', 'terrace_finish@Terrace'])
      if (!vmKeys.has(tt)) throw new Error(`${tt} renders nowhere — it can never be marked done`)
    for (const tt of ['snagging', 'external_paint', 'site_development'])
      if (!vmKeys.has(tt)) throw new Error(`${tt} renders in no stage — it can never be marked done`)
    // the riser is no longer floorless: it is dropped at every floor, and each drop is its own row
    for (const f of ['Stilt', 'Ground', 'First', 'Second'])
      if (!vmKeys.has(`riser@${f}`)) throw new Error(`riser@${f} renders in no stage`)
  })

  // The trade pass is a PROPERTY, not part of the name. It comes out of the label so the list can chip
  // it — but it must survive as data, because the resolver re-attaches it (qualifiedName) and "second
  // fix is done" has to land on wire-pulling, not conduiting.
  test('the trade pass is split out of the name, and still carried', () => {
    const rows = rowsFor(STACK)
    const byType = (tt: string) => rows.find((r) => r.task_type_id === tt)!

    expect(byType('conduit').name).toBe('Electrical — conduiting')
    expect(byType('conduit').trade_phase).toBe('1st fix')
    expect(byType('wiring').name).toBe('Electrical — wire pulling')
    expect(byType('wiring').trade_phase).toBe('2nd fix')
    expect(byType('switchplate').trade_phase).toBe('final fix')
    expect(byType('sanitary').trade_phase).toBe('final fix')
    // work with no pass claims none, rather than inventing one
    expect(byType('blockwork').trade_phase).toBeNull()

    // no label smuggles the pass back in as a parenthetical
    for (const r of rows)
      if (/\((1st|2nd|final) fix\)/.test(r.name))
        throw new Error(`"${r.name}" still carries its trade pass in the name`)
  })

  test('splitting the pass out did not make two rows read alike', () => {
    // conduiting / wire pulling / switchplates differ by BASE name too, so the uniqueness invariant
    // holds without the parenthetical doing the work. If a future type leans on the suffix alone to
    // distinguish itself, this fails — which is exactly when someone should notice.
    const rows = rowsFor(STACK, ALL_SYSTEMS)
    const seen = new Map<string, number>()
    for (const r of rows) seen.set(humanKey(r), (seen.get(humanKey(r)) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1)
    if (dupes.length)
      throw new Error(`the pass was load-bearing for uniqueness:\n      ` +
        dupes.map(([k, n]) => `${n}× ${k}`).join('\n      '))
  })

  test('a wet-only task still exists once per unit (the collapse must not erase wet-room scope)', () => {
    const rows = rowsFor(STACK)
    const wet = rows.filter((r) => r.task_type_id === 'waterproof')
    // three habitable floors, one unit each → exactly one wet-area waterproofing per floor
    expect(wet).toHaveLength(3)
    expect(new Set(wet.map((r) => r.floor_label)).size).toBe(3)
  })
})
