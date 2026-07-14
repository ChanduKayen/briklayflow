// SITE DESK — WHAT EACH TASK IS ACTUALLY WAITING FOR. Pure; no I/O.
//
// ══ THE BUG THIS FILE EXISTS TO KILL ═══════════════════════════════════════════════════════════
//
// The desk read a task's predecessors out of `site_tasks.binding` — a jsonb column written by the
// engine when persistGraph last ran. It is a SNAPSHOT, and the desk treated it as the truth.
//
// A snapshot goes stale. The floor cycle was rebuilt (`beams` and `slab` retired into one monolithic
// `floor_pour`), so a row persisted before that rebuild still carries `slab@First` in its binding —
// a node_key that names a task which no longer exists. The desk looked it up, found no row, and
// dropped the gate. A dropped gate reads as a SATISFIED one. So:
//
//     Wall — blockwork  →  "Ready — can start now"     ...over a slab that was never poured.
//
// On a healthy graph 195 of a G+3's 196 tasks have a hard gate — only ground clearance is free. A
// desk that calls the blockwork startable is not reading a permissive graph. It is reading NOTHING,
// and calling nothing permission.
//
// ══ THE FIX ════════════════════════════════════════════════════════════════════════════════════
//
// Ask the engine, not the snapshot. The desk already has the building (projects.construction_stack)
// and the library, so it can instantiate the real graph and read the real edges — the same door the
// elevation, the wizard and the WhatsApp resolver all go through (geometryOf → instantiate). The
// stored binding is then only a fallback, for rows the engine does not know about.
//
// This gets the deletion case right for free, and for the RIGHT reason: a deleted task is suppressed,
// so the engine does not instantiate it, so its edge is not in the graph, so nothing waits for it. We
// never have to ask "was this gate deleted or did we just lose it?" — the graph simply does not
// contain gates for work that is not happening.
//
// ══ AND THE FLOOR UNDER IT ═════════════════════════════════════════════════════════════════════
//
// If the graph names a predecessor and NO ROW for it exists, we do not know whether that work is
// done. UNKNOWN IS NOT PERMISSION. The task is held, and says so. This is the same rule the
// classifier already lives by ("unknown → loose + flagged, NEVER unknown → silently free") and the
// same one fromDb applies to a missing severity. The one place it was not applied is the one place
// it could put a man on a floor that is not there.

import type { TaskGate } from './types'
import {
  buildAdjacency, geometryOf, instantiate, isHardNature,
  type ProjectRow as EngineProjectRow,
} from '../siteOps/engine'

export interface GateRow {
  task_id: string
  ref: string | null
  node_key: string | null
  binding: unknown
}

/** What one task waits for, and what we could not account for. */
export interface Gates {
  /** Hard predecessors, resolved to rows on this project. */
  afters: TaskGate[]
  /** Predecessors the graph insists on that have NO row here. We cannot see whether they are done,
   *  so the task must not be called startable — these are what taskStatus refuses to ignore. */
  unresolved: string[]
}

const EMPTY: Gates = { afters: [], unresolved: [] }

/**
 * Every task's real gates, keyed by task_id.
 *
 * `project` is the row the geometry comes from (construction_stack + the amenity/suppression columns
 * — pass the whole thing; geometryOf owns which ones matter). A project with no stack yet cannot be
 * instantiated, and then the stored binding is all we have.
 */
export function gatesByTask(project: EngineProjectRow | null | undefined, rows: readonly GateRow[]): Map<string, Gates> {
  const out = new Map<string, Gates>()

  const refByNodeKey = new Map<string, string>()
  for (const r of rows) if (r.node_key && r.ref) refByNodeKey.set(r.node_key, r.ref)

  const geometry = safeGeometry(project)
  const graph = geometry ? safeInstantiate(geometry) : null
  const preds = graph ? buildAdjacency(graph).preds : null

  for (const r of rows) {
    // THE ENGINE'S ANSWER, when it has one: this row is a node in the live graph.
    if (graph && preds && r.node_key && graph.nodes.has(r.node_key)) {
      const hard = (preds.get(r.node_key) ?? []).filter((e) => isHardNature(e.nature, e.reason))
      const afters: TaskGate[] = []
      const unresolved: string[] = []
      for (const e of hard) {
        const ref = refByNodeKey.get(e.from)
        if (ref) afters.push({ ref, nature: e.nature, reason: e.reason, nodeKey: e.from })
        // The graph says this work must come first, and there is no row for it on this project. We
        // cannot see its status, so we cannot clear the task. Name it and hold.
        else unresolved.push(graph.nodes.get(e.from)?.label ?? e.from)
      }
      out.set(r.task_id, { afters, unresolved })
      continue
    }

    // NO ENGINE ANSWER. Either the project has no stack, or this row is not a node in the graph —
    // a task somebody typed in by hand, or a row the engine no longer recognises. Fall back to the
    // snapshot it was born with, and hold anything in it we cannot resolve.
    out.set(r.task_id, gatesFromBinding(r, refByNodeKey))
  }

  return out
}

/** The stored `binding` snapshot — the fallback, and the whole story only for rows with no node_key. */
export function gatesFromBinding(r: GateRow, refByNodeKey: Map<string, string>): Gates {
  const binding = Array.isArray(r.binding)
    ? (r.binding as Array<{ node_key?: string; nature?: string; reason?: string }>)
    : []
  if (!binding.length) return EMPTY

  const afters: TaskGate[] = []
  const unresolved: string[] = []
  for (const b of binding) {
    if (!b?.node_key) continue
    const ref = refByNodeKey.get(b.node_key)
    // Unknown severity degrades to the STRICTEST reading, never the loosest: a gate we cannot
    // interpret must not become a drag we silently wave through.
    if (ref) afters.push({ ref, nature: b.nature ?? 'IMPOSSIBLE', reason: b.reason ?? 'structural', nodeKey: b.node_key })
    else unresolved.push(b.node_key)
  }
  return { afters, unresolved }
}

/** A malformed stack must degrade the desk to "I don't know", never crash it off the screen. */
function safeGeometry(p: EngineProjectRow | null | undefined) {
  try { return geometryOf(p) } catch { return null }
}
function safeInstantiate(geometry: NonNullable<ReturnType<typeof geometryOf>>) {
  try { return instantiate(geometry) } catch { return null }   // a cycle in the library, say
}
