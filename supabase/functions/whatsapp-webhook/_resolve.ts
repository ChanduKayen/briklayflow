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
  // When unresolved AND a name WAS given: nameTried is that name so the follow-up can say
  // "couldn't find X" instead of a blank "which project?".
  nameTried: string | null
  // The roster ranked by match confidence against the hint (best first) — the pre-sorted "which
  // project?" ask list, so the likeliest site is row 1 for free. This is the transaction agent's
  // "suggest the nearest" behaviour expressed as an ORDERING, not a separate confirm band.
  suggestions: { id: string; name: string }[]
  matches: { id: string; name: string }[]       // retained (always []) for back-compat readers
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

  // 1) NAMED — mirror the transaction agent: score against the hint (then the raw narration as a
  //    safety net) and TAKE THE SINGLE BEST AUTO-band match. No ambiguous-auto ask — a tie takes
  //    the top of the ranking, exactly like matchProject in the txn agent. Below auto, we never
  //    substitute a guess: we keep the ranked list for the ask and fall through to PARK.
  let suggestions = candidates   // default (no usable hint) → roster order
  for (const cand of [opts.nameHint, opts.narration]) {
    if (!cand || !cand.trim()) continue
    const scored = scoreProjects(cand, projects)                 // sorted best-first, banded
    const ranked = scored.map((s) => ({ id: s.id, name: s.name }))
    if (scored[0]?.band === 'auto') {
      return { ...base, projectId: scored[0].id, projectName: scored[0].name, via: 'named', suggestions: ranked }
    }
    if (cand === opts.nameHint) suggestions = ranked            // keep the hint's ranking for the ask
  }

  // 2) SELECTED — platform current-project context (the multi-project seam).
  if (opts.selectedProjectId) {
    const sel = projects.find((p) => p.project_id === opts.selectedProjectId)
    if (sel) return { ...base, projectId: sel.project_id, projectName: sel.name, via: 'selected', suggestions }
  }

  // 3) AUTO — new-org convenience ONLY: exactly one active project.
  if (projects.length === 1) {
    return { ...base, projectId: projects[0].project_id, projectName: projects[0].name, via: 'auto', suggestions }
  }

  // 4) PARK — unresolved; never misattribute. Carry the tried name + the ranked suggestions.
  const nameTried = opts.nameHint?.trim() || null
  return { ...base, projectId: null, projectName: null, via: 'unresolved', nameTried, suggestions }
}

// ── MULTI-PROJECT: a narration can name two-plus sites. The grouping + Stage-2 loop lives in the
// agent now (resolveGroups in _agents/siteops.ts): each decomposed item resolves its OWN site via
// resolveProject (with carry-forward), items group by project, and the singular unit runs per group.
// ProjectRef is the shared roster shape the agent passes around.
export type ProjectRef = { id: string; name: string }
