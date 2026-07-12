// M5 persistence tests — re-instantiation preserves a manual task AND a manual reorder.
// The reconcile planner is pure; we also exercise persistGraph against a tiny fake client.
import { suite, test, expect } from './harness'
import { reconcile, toPersistRows, persistGraph } from '../persist'
import type { ExistingRow, PersistRow } from '../persist'
import { instantiate, stackToGeometry } from '../instantiate'

const row = (over: Partial<PersistRow>): PersistRow => ({
  project_id: 'p1', org_id: 'o1', node_key: 'k', task_type_id: 'tt', phase: 'structure',
  trade: 'civil', floor_label: 'Ground', unit_label: null, zone_id: null, name: 'n', seq_no: 1,
  source: 'generated', placement_source: 'authored', order_source: 'auto', needs_review: false, binding: [],
  ...over,
})
const existing = (over: Partial<ExistingRow>): ExistingRow => ({
  task_id: 't', node_key: 'k', source: 'generated', order_source: 'auto', seq_no: 1, ...over,
})

suite('M5 persist', () => {
  test('toPersistRows carries node_key, placement_source, binding, and sorts by seq_no', () => {
    const G = instantiate(stackToGeometry({ levels: [{ label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] }] }))
    const rows = toPersistRows(G, { project_id: 'p1', org_id: 'o1' })
    expect(rows.length).toBe(G.nodes.size)
    expect(rows[0].seq_no).toBe(1)
    expect(rows.every((r) => typeof r.node_key === 'string')).toBeTruthy()
    const conduit = rows.find((r) => r.task_type_id === 'conduit')!
    expect(conduit.placement_source).toBe('authored')
    expect(conduit.binding.some((b) => b.task_type_id === 'blockwork')).toBeTruthy()
  })

  test('a manual task is never deleted, even when absent from the fresh graph', () => {
    const ex = [
      existing({ task_id: 'auto1', node_key: 'k_auto', source: 'generated', order_source: 'auto', seq_no: 5 }),
      existing({ task_id: 'man1', node_key: 'user_solar', source: 'manual', order_source: 'auto', seq_no: 99 }),
    ]
    const fresh = [row({ node_key: 'k_auto', seq_no: 1 })] // manual not in fresh
    const plan = reconcile(ex, fresh)
    expect(plan.toDeleteIds.includes('man1')).toBeFalsy()
    expect(plan.keptManual).toBe(1)
  })

  test('a human-reordered (order_source=manual) row keeps its seq_no — engine does NOT re-default', () => {
    const ex = [existing({ task_id: 'b', node_key: 'k_b', order_source: 'manual', seq_no: 3 })]
    const fresh = [row({ node_key: 'k_b', seq_no: 17 })] // topo wants 17, but human pinned 3
    const plan = reconcile(ex, fresh)
    expect(plan.toUpdateSeq.find((u) => u.task_id === 'b')).toBe(undefined)
    expect(plan.keptManualOrder).toBe(1)
  })

  test('an auto row whose seq the topo changed is updated', () => {
    const ex = [existing({ task_id: 'a', node_key: 'k_a', order_source: 'auto', seq_no: 5 })]
    const fresh = [row({ node_key: 'k_a', seq_no: 1 })]
    const plan = reconcile(ex, fresh)
    expect(plan.toUpdateSeq).toEqual([{ task_id: 'a', seq_no: 1 }])
  })

  test('a brand-new graph node is inserted', () => {
    const plan = reconcile([], [row({ node_key: 'k_new', seq_no: 2 })])
    expect(plan.toInsert).toHaveLength(1)
    expect(plan.toInsert[0].node_key).toBe('k_new')
  })

  test('an obsolete authored-auto row (geometry shrank) is deleted', () => {
    const ex = [existing({ task_id: 'gone', node_key: 'k_gone', source: 'generated', order_source: 'auto' })]
    const plan = reconcile(ex, []) // nothing fresh
    expect(plan.toDeleteIds).toEqual(['gone'])
  })

  test('combined stickiness: manual task + manual reorder both survive a full re-instantiation', () => {
    const ex = [
      existing({ task_id: 'auto', node_key: 'columns@Ground', order_source: 'auto', seq_no: 9 }),
      existing({ task_id: 'dragged', node_key: 'beams@Ground', order_source: 'manual', seq_no: 2 }),
      existing({ task_id: 'usertask', node_key: 'user_solar_terrace', source: 'manual', order_source: 'auto', seq_no: 500 }),
    ]
    const fresh = [
      row({ node_key: 'columns@Ground', seq_no: 1 }),
      row({ node_key: 'beams@Ground', seq_no: 2 }),
      // user_solar_terrace deliberately NOT in fresh (it's a manual user task outside the library)
    ]
    const plan = reconcile(ex, fresh)
    // manual user task preserved
    expect(plan.toDeleteIds.includes('usertask')).toBeFalsy()
    expect(plan.keptManual).toBe(1)
    // human drag preserved (no seq update for 'dragged')
    expect(plan.toUpdateSeq.some((u) => u.task_id === 'dragged')).toBeFalsy()
    expect(plan.keptManualOrder).toBe(1)
    // the untouched auto row gets re-defaulted
    expect(plan.toUpdateSeq).toEqual([{ task_id: 'auto', seq_no: 1 }])
  })

  test('persistGraph drives a fake client with the right calls', async () => {
    const calls: string[] = []
    // the fan-out re-reads site_tasks (task_id, task_type_id) after the insert, so the fake serves the
    // tasks it was just given; site_task_qc starts empty.
    const inserted: Record<string, unknown>[] = []
    const fake = {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                // 1st call: existing rows (none). Post-insert: the tasks we just wrote.
                const data = table === 'site_tasks' ? inserted.map((r, i) => ({ task_id: `t${i}`, task_type_id: r.task_type_id, node_key: r.node_key, source: r.source, order_source: r.order_source, seq_no: r.seq_no, site_task_qc: [] })) : []
                return Promise.resolve({ data, error: null })
              },
            }
          },
          insert(rows: unknown[]) {
            calls.push(`insert:${table}:${(rows as unknown[]).length}`)
            if (table === 'site_tasks') inserted.push(...(rows as Record<string, unknown>[]))
            return Promise.resolve({ error: null })
          },
          delete() { return { in() { calls.push('delete'); return Promise.resolve({ error: null }) } } },
          update() { return { eq() { calls.push('update'); return Promise.resolve({ error: null }) } } },
        }
      },
    }
    const G = instantiate(stackToGeometry({ levels: [{ label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] }] }))
    const res = await persistGraph(fake, { project_id: 'p1', org_id: 'o1' }, G)
    expect(res.deleted).toBe(0)
    expect(calls.some((c) => c.startsWith('insert:site_tasks:'))).toBeTruthy()
    // THE FAN-OUT: every task written got its type's 3 authored checks, at the same door.
    expect(res.qcInserted).toBe(res.inserted * 3)
    expect(calls.some((c) => c.startsWith('insert:site_task_qc:'))).toBeTruthy()
  })
})
