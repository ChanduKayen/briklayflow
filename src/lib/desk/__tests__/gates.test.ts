// WHAT A TASK IS WAITING FOR — against the REAL library, the REAL building, the REAL graph.
//
// This suite exists because of one production report: "blockwork and door frames show as allowed even
// though the structure isn't finished." They did. Here is the whole of why, and the guarantee that it
// cannot come back.
//
// THE CHAIN THAT BROKE
//   library      blockwork ← floor_pour   (IMPOSSIBLE / structural)   — walls need the deck
//   instantiate  the edge exists in the concrete graph, per floor      ✓
//   persist      it is written to site_tasks.binding as a SNAPSHOT     ✓
//   the desk     read that snapshot ... and the snapshot had gone stale ✗
//
// The floor cycle was rebuilt: `beams` and `slab` were retired into one `floor_pour`. Any row persisted
// before that still carries `slab@First` in its binding — a node_key that names nothing. The desk looked
// it up, found no row, DROPPED THE GATE, and a dropped gate read as a satisfied one.
//
// So the fix is not a patch on the lookup. It is that the desk must not read a snapshot at all: it has
// the building and it has the library, so it asks the engine (gates.ts). And under that, a floor: a gate
// that cannot be resolved is UNKNOWN, and unknown is never permission.

import { suite, test, expect } from './harness'
import { gatesByTask, type GateRow } from '../gates'
import { taskStatus } from '../derive'
import { toDeskTask, type TaskRow } from '../fromDb'
import { instantiate, stackToGeometry, toPersistRows } from '../../siteOps/engine'
import type { DeskTask } from '../types'

// A real G+2, two flats a floor — the same shape a small site actually is.
const STACK = {
  levels: [
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
    { label: 'Second', kind: 'habitable', zones: [{ use: 'habitable', units: 2 }] },
  ],
}
const PROJECT = { construction_stack: STACK }

/** The rows the database would hold for this building — the engine's own output, as persisted. */
function realRows(): Array<TaskRow & { project_id: string }> {
  const graph = instantiate(stackToGeometry(STACK))
  return toPersistRows(graph, { project_id: 'P', org_id: 'O' }).map((r, i) => ({
    task_id: `t${i}`, ref: `DSR-${i + 1}`, project_id: 'P',
    name: r.name, phase: r.phase, trade: r.trade, status: 'not_started' as const,
    floor_label: r.floor_label, unit_label: r.unit_label, seq_no: r.seq_no,
    duration_days: 2, started_at: null, owner_id: null,
    node_key: r.node_key, task_type_id: r.task_type_id, binding: r.binding,
    status_history: [], updated_at: '2026-07-01T00:00:00Z', source: 'generated' as const,
  }))
}

function desk(rows: Array<TaskRow & { project_id: string }>, project: unknown = PROJECT): DeskTask[] {
  const refByNodeKey = new Map(rows.filter((r) => r.node_key && r.ref).map((r) => [r.node_key as string, r.ref as string]))
  const gates = gatesByTask(project as never, rows as unknown as GateRow[])
  return rows.map((r) => toDeskTask(r, { refByNodeKey, gates, blockerByTaskId: new Map(), nameOf: () => 'Ravi', now: Date.parse('2026-07-10') }))
}
const find = (ts: DeskTask[], type: string, floor: string) =>
  ts.find((t) => t.taskTypeId === type && t.floor === floor)!
const statusOf = (ts: DeskTask[], t: DeskTask) => taskStatus(t, [], (r) => ts.find((x) => x.ref === r))

suite('gates — nothing starts before the building can carry it', () => {
  test('ON DAY ONE, THE ONLY THING A SITE CAN DO IS CLEAR THE GROUND', () => {
    const ts = desk(realRows())
    const startable = ts.filter((t) => statusOf(ts, t).cls === 'ready')
    expect(startable.map((t) => t.taskTypeId)).toEqual(['ground_clearance'])
  })

  test('the wall waits for the deck — blockwork is NOT startable while the pour is open', () => {
    const ts = desk(realRows())
    const st = statusOf(ts, find(ts, 'blockwork', 'First'))
    expect(st.cls).toBe('after')
  })

  test('the door frame waits for the wall — it seats into the masonry opening', () => {
    const ts = desk(realRows())
    const frame = ts.find((t) => t.taskTypeId === 'door_frame' && t.floor === 'First')!
    expect(statusOf(ts, frame).cls).toBe('after')
  })

  test('...and the wall becomes startable the moment the deck IS poured, not before', () => {
    const rows = realRows()
    // pour the First floor deck, and de-prop the one above it (the two hard gates on blockwork@First)
    for (const r of rows) {
      if (r.node_key === 'floor_pour@First' || r.node_key === 'shuttering_removal@Second') r.status = 'done'
    }
    const ts = desk(rows)
    expect(statusOf(ts, find(ts, 'blockwork', 'First')).cls).toBe('ready')
  })

  /**
   * THE REGRESSION ITSELF. A row that still carries the pre-rebuild `slab@First` in its binding — the
   * exact state of a project generated before the floor cycle was rewritten.
   *
   * The OLD desk read that snapshot, could not resolve `slab@First`, dropped the gate and said READY.
   * The desk now ignores the snapshot entirely for a row the engine knows, and asks the graph — which
   * says, correctly, that blockwork waits for floor_pour. The stale binding cannot lie to it, because
   * it is not listened to.
   */
  test('A STALE BINDING CANNOT UNLOCK A WALL. The graph is asked; the snapshot is not.', () => {
    const rows = realRows()
    const wall = rows.find((r) => r.node_key === 'blockwork@First')!
    wall.binding = [{ node_key: 'slab@First', nature: 'IMPOSSIBLE', reason: 'structural' }]  // retired key
    const ts = desk(rows)
    const st = statusOf(ts, find(ts, 'blockwork', 'First'))
    expect(st.cls).toBe('after')
  })

  /**
   * THE FLOOR UNDER THE FIX. With no building on the project row the engine cannot instantiate, so
   * there IS no graph to ask, and all we have is the row's own stale snapshot. It must not resolve to
   * "ready" — it must resolve to "I cannot tell", which is the truth.
   */
  test('with no graph to ask, an unresolvable gate reads UNKNOWN — never ready', () => {
    const rows = realRows()
    const wall = rows.find((r) => r.node_key === 'blockwork@First')!
    wall.binding = [{ node_key: 'slab@First', nature: 'IMPOSSIBLE', reason: 'structural' }]
    const ts = desk(rows, { construction_stack: null })     // the engine has nothing to work with
    const st = statusOf(ts, find(ts, 'blockwork', 'First'))
    expect(st.cls).toBe('unknown')
  })

  test('a hand-typed task with no engine identity is genuinely free — it was nobody\'s dependency', () => {
    const rows = realRows()
    rows.push({
      ...rows[0], task_id: 'manual1', ref: 'DSR-999', name: 'Temporary site hoarding',
      node_key: null, task_type_id: null, binding: [], source: 'manual' as const,
    })
    const ts = desk(rows)
    const hoarding = ts.find((t) => t.ref === 'DSR-999')!
    expect(statusOf(ts, hoarding).cls).toBe('ready')
  })

  /**
   * DELETION STILL UNBLOCKS — and now for the right reason. A deleted task is suppressed, so the
   * engine never instantiates it, so no edge to it is ever produced. The desk does not have to decide
   * whether a missing gate was "deleted" or "lost": the graph simply contains no gates for work that
   * is not happening, and only the LOST ones are left to hold the line.
   */
  test('deleting the pour DOES free the wall — the engine never emits the edge', () => {
    const rows = realRows().filter((r) => r.node_key !== 'floor_pour@First')
    const ts = desk(rows, { construction_stack: STACK, suppressed_nodes: ['floor_pour@First'] })
    const st = statusOf(ts, find(ts, 'blockwork', 'First'))
    // its OTHER gate (de-prop of the slab above) is still open, so it is not ready — but the pour is
    // gone from what it waits for, and nothing is left dangling.
    expect(find(ts, 'blockwork', 'First').unresolved).toBe(undefined)
    expect(st.cls).toBe('after')
  })
})
