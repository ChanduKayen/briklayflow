// MODULE 3 — THE EVALUATOR (pure; no I/O, no LLM).
//
// Given (concrete graph, completion state, optional policy), compute the live picture exactly as
// the Evaluation sheet specifies: status, why, freedom, priority, checkMove, cohesionSet. The
// library is the RULESET; this is the state evaluation. Freedom GROWS as blockers complete.
//
// Hard gate (availability + drag-forbid) = IMPOSSIBLE + DESTRUCTIVE + curing_time predecessors.
// Prefs (STRONG/WEAK) never gate availability — they only order priority and soften drags.

import {
  type Availability, type Blocker, type ConcreteEdge, type ConcreteGraph, type CompletionState,
  type ExecutionPolicy, type FreedomSpan, type Library, type MoveResult, type MoveVerdict,
  type Nature, type NodeId, type TaskStatus,
} from './types'
import { LIBRARY, isHardNature } from './library'
import { buildAdjacency } from './instantiate'

// severity rank — higher = more binding (used to surface the most severe blocker/binder first)
const NATURE_RANK: Record<Nature, number> = {
  IMPOSSIBLE: 4, DESTRUCTIVE: 3, STRONG_PREF: 2, WEAK_PREF: 1, INDIFFERENT: 0,
}

/** A reusable evaluation context (adjacency built once, reused across queries). */
export class Evaluator {
  readonly graph: ConcreteGraph
  state: CompletionState
  readonly lib: Library
  private preds: Map<NodeId, ConcreteEdge[]>
  private succs: Map<NodeId, ConcreteEdge[]>
  constructor(graph: ConcreteGraph, state: CompletionState = new Map(), lib: Library = LIBRARY) {
    this.graph = graph
    this.state = state
    this.lib = lib
    const adj = buildAdjacency(graph)
    this.preds = adj.preds
    this.succs = adj.succs
  }

  statusOf(node: NodeId): TaskStatus { return this.state.get(node) ?? 'not_started' }
  private isDone(node: NodeId): boolean { return this.statusOf(node) === 'done' }

  /** Incoming HARD edges (the ones that gate availability). */
  private hardPreds(node: NodeId): ConcreteEdge[] {
    return (this.preds.get(node) ?? []).filter((e) => isHardNature(e.nature, e.reason))
  }

  // ── status(node) → done | active | available | blocked ──────────────────────
  availability(node: NodeId): Availability {
    const s = this.statusOf(node)
    if (s === 'done') return 'done'
    if (s === 'active') return 'active'
    // available iff every hard predecessor is done (prefs don't gate)
    const blocked = this.hardPreds(node).some((e) => !this.isDone(e.from))
    return blocked ? 'blocked' : 'available'
  }

  // ── why(node) → binding predecessors, most severe first ─────────────────────
  why(node: NodeId): Blocker[] {
    const binders = this.hardPreds(node).filter((e) => !this.isDone(e.from))
    return binders
      .map((e): Blocker => ({
        node: e.from,
        taskTypeId: this.graph.nodes.get(e.from)!.taskTypeId,
        nature: e.nature, reason: e.reason, note: e.note,
      }))
      .sort((a, b) => NATURE_RANK[b.nature] - NATURE_RANK[a.nature])
  }

  /** A self-explaining one-liner for a blocked node ("after Conduiting — concealment"). */
  whyMessage(node: NodeId): string | null {
    const binders = this.why(node)
    if (!binders.length) return null
    const top = binders[0]
    const label = this.lib.taskTypes.get(top.taskTypeId)?.label ?? top.taskTypeId
    return `after ${label} — ${top.reason}`
  }

  // ── freedom(node) → [hard-earliest, hard-latest] span; grows as state advances ─
  freedom(node: NodeId): FreedomSpan {
    const tt = this.graph.nodes.get(node)!.taskTypeId
    const setId = this.lib.taskTypes.get(tt)?.freedomSet ?? null
    const earliestAfterDone = this.hardPreds(node).every((e) => this.isDone(e.from))
    // hard dependents (followers gated by me via a hard edge) cap the latest position
    const latestBefore = (this.succs.get(node) ?? [])
      .filter((e) => isHardNature(e.nature, e.reason))
      .map((e) => e.to)

    // fully free iff in a freedom set whose set-level anchors are met (earliest anchor done in scope)
    let fullyFree = false
    if (setId) {
      const set = this.lib.freedomSets.get(setId)
      const anchorDone = !set?.earliestAfter ? true : this.anchorSatisfied(node, set.earliestAfter)
      fullyFree = earliestAfterDone && anchorDone
    }
    return { fullyFree, earliestAfterDone, latestBefore, freedomSet: setId }
  }

  /** True if the freedom-set's earliest-anchor task is done in the node's locale. */
  private anchorSatisfied(node: NodeId, anchorType: string): boolean {
    // the anchor is whichever hard predecessor of `node` is of the anchor type, OR — if the
    // anchor isn't a direct predecessor — treat it as satisfied when no such pred exists in scope.
    const anchorPred = (this.preds.get(node) ?? []).find(
      (e) => this.graph.nodes.get(e.from)!.taskTypeId === anchorType,
    )
    return anchorPred ? this.isDone(anchorPred.from) : true
  }

  // ── priority(availableSet, policy) → advisory order; never blocks a free choice ─
  priority(available: NodeId[], policy: ExecutionPolicy = 'structure_first'): NodeId[] {
    const layerRank: Record<string, number> = { structure: 0, services: 1, finishes: 2 }
    const score = (id: NodeId): number[] => {
      const n = this.graph.nodes.get(id)!
      // 1. soft-pref pull: a node with many unmet STRONG-pref preds is gently deprioritized
      const softPending = (this.preds.get(id) ?? [])
        .filter((e) => e.nature === 'STRONG_PREF' && !this.isDone(e.from)).length
      // 2. policy axis
      let policyKey = 0
      const floor = n.floorIndex ?? 0
      switch (policy) {
        case 'structure_first': policyKey = layerRank[n.layer] ?? 9; break
        case 'floor_complete': policyKey = floor * 10 + (layerRank[n.layer] ?? 9); break
        case 'watertight_first': policyKey = n.zoneKind === 'wet' || n.zoneKind === 'external' ? 0 : 1; break
        case 'own_practice': policyKey = 0; break // user policy supplies its own order elsewhere
      }
      // tie-break: floor asc, layer, seq_no
      return [softPending, policyKey, floor, layerRank[n.layer] ?? 9, n.seqNo]
    }
    return [...available].sort((a, b) => {
      const sa = score(a), sb = score(b)
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]
      return a < b ? -1 : a > b ? 1 : 0
    })
  }

  /** All nodes currently `available` (hard preds done, not yet active/done). */
  availableSet(): NodeId[] {
    return [...this.graph.nodes.keys()].filter((id) => this.availability(id) === 'available')
  }

  // ── cohesionSet(node) → the bundle that relocates with it ───────────────────
  cohesionSet(node: NodeId): NodeId[] {
    const out = new Set<NodeId>([node])
    let grew = true
    while (grew) {
      grew = false
      for (const b of this.graph.bundles) {
        if (b.members.some((m) => out.has(m))) {
          for (const m of b.members) {
            // a completed member releases its binding — it doesn't drag along
            if (this.isDone(m)) continue
            if (!out.has(m)) { out.add(m); grew = true }
          }
        }
      }
    }
    return [...out]
  }

  // ── checkMove(node, targetSeqNo) → the drag verdict ─────────────────────────
  // Verdict from the most severe predecessor that would end up AFTER the target position.
  // Unknown (a hard pred we can't resolve) → WARN, never silent allow.
  checkMove(node: NodeId, targetSeqNo: number): MoveResult {
    const bundle = this.cohesionSet(node)
    let worst: { nature: Nature; reason: ConcreteEdge['reason']; note: string } | null = null

    for (const e of this.preds.get(node) ?? []) {
      const predNode = this.graph.nodes.get(e.from)
      // unknown predecessor position → caution
      if (!predNode) {
        if (!worst || NATURE_RANK[e.nature] >= NATURE_RANK[worst.nature])
          worst = { nature: e.nature, reason: e.reason, note: e.note }
        continue
      }
      // a predecessor that would sit AT/AFTER the target violates the precedence
      if (predNode.seqNo >= targetSeqNo) {
        if (!worst || NATURE_RANK[e.nature] > NATURE_RANK[worst.nature])
          worst = { nature: e.nature, reason: e.reason, note: e.note }
      }
    }

    if (!worst) {
      const span = this.freedom(node)
      const msg = span.fullyFree ? 'fully free — any order within its set' : 'allowed'
      return { verdict: 'allow', reason: null, nature: null, message: msg, movesBundle: bundle }
    }

    const verdict = verdictFor(worst.nature)
    return {
      verdict,
      reason: worst.reason,
      nature: worst.nature,
      message: messageFor(verdict, worst.reason, worst.note),
      movesBundle: bundle,
    }
  }
}

function verdictFor(nature: Nature): MoveVerdict {
  switch (nature) {
    case 'IMPOSSIBLE': return 'forbid'
    case 'DESTRUCTIVE': return 'allow_with_consequence'
    case 'STRONG_PREF': return 'warn'
    case 'WEAK_PREF': return 'suggest'
    case 'INDIFFERENT': return 'allow'
  }
}

function messageFor(verdict: MoveVerdict, reason: ConcreteEdge['reason'], note: string): string {
  switch (verdict) {
    case 'forbid': return `Not possible — ${reason}: ${note}`
    case 'allow_with_consequence': return `Allowed but destructive — ${reason}: ${note}`
    case 'warn': return `Not recommended — ${reason}: ${note}`
    case 'suggest': return `Mild preference — ${reason}: ${note}`
    case 'allow': return 'allowed'
  }
}

// ── functional conveniences (one-shot, no class) ─────────────────────────────
export function evaluate(graph: ConcreteGraph, state: CompletionState = new Map(), lib: Library = LIBRARY): Evaluator {
  return new Evaluator(graph, state, lib)
}

/** Build a CompletionState from a list of done/active node-ids (test + caller ergonomics). */
export function stateOf(opts: { done?: NodeId[]; active?: NodeId[] } = {}): CompletionState {
  const m: CompletionState = new Map()
  for (const id of opts.done ?? []) m.set(id, 'done')
  for (const id of opts.active ?? []) m.set(id, 'active')
  return m
}
