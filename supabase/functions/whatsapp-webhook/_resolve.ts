// Block A — THE single project-resolution point for site narration.
//
// R4 correction (load-bearing): the primary org runs 6 ACTIVE projects, so
// "exactly one active → auto-assume" essentially never fires. Resolution is, in
// order:
//   1. NAMED   — the narration names a project ("Lakshmi villa, 2F slab done").
//                We reuse the PROVEN matchProject from _match.ts (no new matcher);
//                an explicit nameHint is tried first, else we scan the raw text
//                (matchProject scores q.includes(name) → an embedded project name
//                lands as a high-confidence 'auto' match). Only band 'auto' counts
//                — a wrong project silently corrupts task state, so precision wins.
//   2. SELECTED — a platform caller's current/selected project (the multi-project
//                seam; WhatsApp has none, so this is null there for now).
//   3. AUTO    — new-org CONVENIENCE ONLY: exactly one active project.
//   4. PARK    — unresolved (project_id null), visible for human triage. NEVER
//                auto-assume into a wrong building.
//
// One function, one seam — do not scatter "grab the one project" through the pipeline.

import { scoreProjects } from './_match.ts'

export type ResolvedVia = 'named' | 'selected' | 'auto' | 'unresolved'
export type ProjectResolution = {
  projectId: string | null
  projectName: string | null
  via: ResolvedVia
  candidates: { id: string; name: string }[]   // active projects, for triage / "which project?"
  // When unresolved AND a name WAS given: nameTried is that name (so the follow-up can say
  // "couldn't find X" instead of a blank "which project?"), and matches are the loosely-
  // matched buildings when the name is genuinely AMBIGUOUS (two share the token) — show those.
  nameTried: string | null
  matches: { id: string; name: string }[]
}

export type ResolveOpts = {
  narration?: string                 // raw text to scan for an embedded project name
  nameHint?: string | null           // explicit project name (e.g. from the extractor) — tried first
  selectedProjectId?: string | null  // platform "current project" context (multi-project seam)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- service/browser supabase client
export async function resolveProject(supabase: any, orgId: string, opts: ResolveOpts = {}): Promise<ProjectResolution> {
  const { data } = await supabase
    .from('projects')
    .select('project_id, name')
    .eq('org_id', orgId)
    .eq('status', 'Active')
  const projects = ((data ?? []) as { project_id: string; name: string }[])
  const candidates = projects.map((p) => ({ id: p.project_id, name: p.name }))
  const base = { candidates, nameTried: null as string | null, matches: [] as { id: string; name: string }[] }

  // 1) NAMED — explicit hint first, then a scan of the raw narration. We score ALL projects
  //    (not just the best) so a name that hits exactly one auto-band project resolves, while a
  //    name that hits SEVERAL is disambiguated rather than silently bound to a guess.
  for (const cand of [opts.nameHint, opts.narration]) {
    if (!cand || !cand.trim()) continue
    const autos = scoreProjects(cand, projects).filter((s) => s.band === 'auto')
    if (autos.length === 1) {
      return { ...base, projectId: autos[0].id, projectName: autos[0].name, via: 'named' }
    }
    // An EXPLICIT name (not a raw-narration scan) that matches several buildings is a real
    // ambiguity — surface those matches and ask, rather than scanning on or parking blank.
    if (autos.length > 1 && cand === opts.nameHint) {
      return {
        ...base, projectId: null, projectName: null, via: 'unresolved',
        nameTried: cand.trim(), matches: autos.map((a) => ({ id: a.id, name: a.name })),
      }
    }
  }

  // 2) SELECTED — platform current-project context (the multi-project seam).
  if (opts.selectedProjectId) {
    const sel = projects.find((p) => p.project_id === opts.selectedProjectId)
    if (sel) return { ...base, projectId: sel.project_id, projectName: sel.name, via: 'selected' }
  }

  // 3) AUTO — new-org convenience ONLY: exactly one active project.
  if (projects.length === 1) {
    return { ...base, projectId: projects[0].project_id, projectName: projects[0].name, via: 'auto' }
  }

  // 4) PARK — unresolved; never misattribute. If a name WAS given but matched nothing, carry it
  //    so the follow-up says "couldn't find <name>" instead of a blank "which project?".
  const nameTried = opts.nameHint?.trim() || null
  return { ...base, projectId: null, projectName: null, via: 'unresolved', nameTried }
}

// ── MULTI-PROJECT: per-item resolution + grouping ────────────────────────────
// The transaction agent handles multi-project messages by carrying a project PER ITEM
// (each entry resolves its own project, with a shared site propagated to entries that
// don't name one). Site-ops mirrors that here: one narration can name two-plus sites, so
// each decomposed item resolves to its OWN project, and items group by their project.
//
// resolveHint is the per-item analogue of resolveProject's NAMED step — one hint string,
// reusing the SAME proven scoreProjects matcher (no new matching logic). planItemProjects
// then groups the items, applying the site-ops-specific rules the txn agent doesn't need:
//   • carry-forward — an item with no site of its own inherits the nearest PRECEDING item's
//     site (the "nearest-mentioned" project), never the first-named one blindly.
//   • a leading item with no site (none named before it) → PENDING (disambiguate, don't guess).
//   • an explicit hint that matches SEVERAL buildings → PENDING (ambiguous, don't guess).

export type ProjectRef = { id: string; name: string }

export type HintResolution =
  | { kind: 'one'; project: ProjectRef }
  | { kind: 'many'; matches: ProjectRef[] }
  | { kind: 'none' }

/** Resolve ONE project hint against the roster via the proven scoreProjects matcher. */
export function resolveHint(hint: string | null, projects: ProjectRef[]): HintResolution {
  if (!hint || !hint.trim()) return { kind: 'none' }
  const rows = projects.map((p) => ({ project_id: p.id, name: p.name }))
  const autos = scoreProjects(hint, rows).filter((s) => s.band === 'auto')
  if (autos.length === 1) return { kind: 'one', project: { id: autos[0].id, name: autos[0].name } }
  if (autos.length > 1) return { kind: 'many', matches: autos.map((a) => ({ id: a.id, name: a.name })) }
  return { kind: 'none' }
}

export type ItemPlan = {
  isMulti: boolean                       // 2+ distinct projects (or 1 + an ambiguous mention) named
  assignment: (string | null)[]          // per item → resolved project id, or null when PENDING
  projectsById: Map<string, ProjectRef>  // id → ref, for every assigned project (group ordering)
  pendingIdxs: number[]                   // items needing a project pick (ambiguous / leading-null)
}

/**
 * Plan which project each item belongs to, from its per-item hint. PURE — the agent uses this
 * ONLY in the multi-project branch; single-project narrations keep the existing resolveProject
 * path untouched (zero regression). Order of items is the narration order (carry-forward depends
 * on it). `hints` is each item's project_hint (null when the item named no site of its own).
 */
export function planItemProjects(hints: (string | null)[], projects: ProjectRef[]): ItemPlan {
  const resolved = hints.map((h) => resolveHint(h, projects))
  const distinct = new Set<string>()
  let anyMany = false
  for (const r of resolved) {
    if (r.kind === 'one') distinct.add(r.project.id)
    else if (r.kind === 'many') anyMany = true
  }
  // Multi when two-plus distinct sites are named, OR one site plus an ambiguous mention (which
  // must be disambiguated, not silently folded into the one resolved site → that would mis-file).
  const isMulti = distinct.size + (anyMany ? 1 : 0) >= 2

  const assignment: (string | null)[] = new Array(hints.length).fill(null)
  const projectsById = new Map<string, ProjectRef>()
  const pendingIdxs: number[] = []
  let lastProject: ProjectRef | null = null

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]
    if (r.kind === 'one') {
      assignment[i] = r.project.id
      projectsById.set(r.project.id, r.project)
      lastProject = r.project
    } else if (r.kind === 'many') {
      pendingIdxs.push(i)                         // ambiguous explicit hint — ask
    } else if (lastProject) {
      assignment[i] = lastProject.id              // carry-forward to the nearest preceding site
    } else {
      pendingIdxs.push(i)                          // leading item, no site yet — ask (never guess)
    }
  }
  return { isMulti, assignment, projectsById, pendingIdxs }
}
