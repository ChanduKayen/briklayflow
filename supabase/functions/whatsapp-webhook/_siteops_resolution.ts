// UNIFIED INBOUND RESOLUTION v2 — the ENFORCEMENT LAYER. "The LLM proposes, code disposes."
//
// One language-native LLM call (built + parsed in _siteops_resolution_llm — the caller, Phase 1b) answers
// TWO questions per inbound against the project's candidate set, and returns a ResolutionContract. This
// module is the code half: executeResolution() consumes that (advisory) contract and returns exactly
// one-or-more TERMINALS — the AUTHORITATIVE outcome. It re-derives every action from the LADDER regardless
// of what the model said (MED never resolves; an invented target can't touch state), and it ASSERTS that
// no found item is ever dropped. This is why the no-miss guarantee is code, not prompt: a prompt can
// promise; only `assertNoDrop` + a queryable terminal can enforce.
//
// PURE. No I/O, no model, no Deno. The caller applies the terminals' side effects (create/update/ask/
// evidence/park) and the LLM-failure park path; executeResolution only DECIDES, so the decision is
// provable offline against hand-authored contract fixtures (the enforcement calibration tier).

import { tradeGroups, tradeMismatch } from './_siteops_trades.ts'
import { G, type Home } from './_voice.ts'

// ── THE CONTRACT (what the model returns; advisory) ──────────────────────────
export type Confidence = 'high' | 'med' | 'low'

/** The reply language. The pure planner owns the readback strings, so it owns the language they are in. */
export type Lang = 'en' | 'te' | 'te-en' | 'hi'

// Axis 1 — OBSERVE. A new issue/snag the message reports. `project_hint` is the model's project pick
// (LOCKED: project resolution folds INTO the one call — no upstream scoreName heuristic); null when the
// site is genuinely unclear → the enforcement layer ASKS which site rather than mis-filing.
export interface ObserveItem {
  kind: 'issue' | 'snag'
  detail: string
  location: string | null
  project_hint: string | null
  confidence: Confidence
  // PLANNED WORK (#1) — a to-do / assignment ("tap issues to fix by Monday") is captured as a snag with
  // planned:true, never dropped as a miss. `due_date` is the deadline the message names (null = none); it
  // rides problems.deadline and drives the chase when confidence is high. Absent/false on a reported defect.
  planned?: boolean
  due_date?: string | null
  // NO-INFO-LOSS on create (mirrors decompose): the CAUSE the message states (a taxonomy key → drives the
  // follow-up cadence + impact) and the OWNER it assigns ("tell Ramesh"). Both null/absent when unstated; a
  // cause outside the taxonomy is clamped to 'other' by the bridge, never rejected (an honest 'other' beats
  // losing the finding).
  cause?: string | null
  owner?: string | null
}

// Axis 2 — ATTACH. A grounded match onto an EXISTING candidate. `target_id` MUST be a member of the
// candidate set the call was given; the model reads closure vs progress into `action`, but the ladder
// (code) gates whether that action is allowed to LAND.
//
// `confidence` and `closure_explicit` are INDEPENDENT judgments — the rubric's top rung is HIGH referent
// AND explicit closure language, ANDed because they fail independently: "that thing is sorted" against a
// lone chase is an unambiguous referent (HIGH) with VAGUE closure. Folding them would let that auto-
// resolve and silently kill the chase — the exact case the ladder exists to stop. So both ride the wire.
export interface AttachUpdate {
  target_id: string
  target_kind: 'task' | 'issue' | 'todo'
  // `blocked` is the NEGATIVE report — "tiles not yet laid", "ceilings still not done", "plumber didn't come".
  // LIVE LESSON (2026-07-09): with only progress|addressing|resolve on the wire, a supervisor reporting that
  // work had NOT happened had no truthful action available. The model answered `progress` with the reason
  // "indicating no progress on floor tiling" — the field contradicting its own justification — and a confirm
  // would have logged progress on a task that had not started. `blocked` never advances and never closes: it
  // records the blocker on the item's trail and pulls the next chase in. It is SAFE at med confidence for the
  // same reason (it changes no status), and still ASKS at low.
  action: 'progress' | 'addressing' | 'resolve' | 'blocked'
  confidence: Confidence
  closure_explicit: boolean   // did the reply use EXPLICIT closure language (not just a clear referent)?
  reason: string
  // THE SAME-MEANING TYPE TIE (2026-07-11). A site can track THREE genuinely different tiling scopes — "Tiling",
  // "Floor tiling", "Wall tiling / dado" — all `tiling · finishes`, all with a row on the named floor. "Tiles
  // done" fits every one and distinguishes none, and NO prompt, model or data cleanup can ever pick between
  // them: the only correct output is a QUESTION. With one target_id on the wire the model had nowhere to put
  // that answer, so it emitted found:false and the supervisor got "I couldn't tell which work you meant" — for
  // a message that named the work and the place exactly. `alt_target_ids` is that missing shape: the OTHER task
  // TYPE ids that fit just as well. CODE pins each one's row from the structure slot and asks over the
  // survivors — and when the slot leaves only ONE row standing, applies it without asking at all.
  // TASK targets only (an issue/todo tie has `nearest`); members of the candidate set only (an un-offered alt
  // is an invented referent and is dropped, exactly like an un-offered target_id).
  alt_target_ids?: string[]
  // NB (2026-07-11): a TASK `target_id` is now a TASK TYPE id (`type:<project>:<name>`), not a row id. The
  // model names WHAT the work is; WHERE it is comes from the narration's StructureSlot (ResolutionContext.
  // structure), and CODE pins the physical row. The old per-update floor/unit/collective/except fields are
  // GONE — a floor the model can't see is a floor it can't guess wrong. Location is one fact, extracted once
  // by decompose, not re-derived here.
}

// FIX A·ii — the RECALL FLOOR. On found:false the model still names its meaning-ranked best guess(es):
// the single closest EXISTING candidate(s) it can't confidently assert. A med/low nearest turns a would-be
// silent didn't-catch into a which_item ASK ("did you mean X?"); plausibility 'none' (or an empty list)
// is the honest "relates to nothing" that stays a didn't-catch. Carries action + closure_explicit so a
// confirm can RESOLVE (not merely address) when the message closed the item. NEVER auto-acts — always asks.
export interface NearestGuess {
  target_id: string
  target_kind: 'task' | 'issue' | 'todo'
  plausibility: 'med' | 'low' | 'none'
  action: 'progress' | 'addressing' | 'resolve' | 'blocked'
  closure_explicit: boolean
  reason: string
}

export interface ResolutionContract {
  issue_snag_found: { found: boolean; items: ObserveItem[] }
  update_found: { found: boolean; updates: AttachUpdate[]; nearest?: NearestGuess[] }
}

// WHERE the work is + HOW MUCH — decompose's per-narration structure slot (structurally identical to
// _siteops_extract's StructureSlot; defined here so the pure planner stays self-contained — no Deno import).
// `all` = an explicit all-quantifier ("entire apartment", "anni"); `except` = the carve-out from that all.
export interface StructureSlot {
  floor: string | null
  unit: string | null
  all: boolean
  except: { floors: string[]; units: string[] } | null
}

// One OPEN physical task row behind a TASK TYPE — code pins one of these from the slot. `title` is what a
// human is shown when the pin has to ASK. (Structurally identical to _siteops_resolution_llm's TaskRowRef.)
export interface TaskRowRef {
  id: string
  name: string
  floor: string | null
  unit: string | null
  title: string
}

// The building GEOMETRY — every VALID floor and unit, INCLUDING empty ones (from the engine's
// stackToGeometry). This is what lets the pin tell "the 5th floor doesn't exist" (no_structure — ASK over the
// rows that DO exist, saying which floors those are) from "the 5th floor exists but this task isn't tracked
// there" (acked_no_place — nothing anywhere to pick between). Absent → the pin can't make that distinction and
// falls back to the honest untracked-task terminal. Labels are CANONICALISED (canonFloor/canonUnit) on load.
export interface Geometry {
  floors: string[]                        // canonical floor labels that exist
  unitsByFloor: Map<string, string[]>     // canonFloor → canonical unit labels on it
}

// ── CONTEXT the code needs to DISPOSE (not the model's to decide) ────────────
export interface ResolutionContext {
  candidateIds: Set<string>   // the exact target_ids the call was given — an update targeting anything
                              // else is an INVENTED referent and may never touch state (→ ASK).
  isImage: boolean            // modality — a photo with nothing confident is queued as evidence, cautiously.
  nearCandidateIds?: string[] // lexical near-misses (caller-computed, candidate members) — a both-false
                              // IMAGE with near candidates ASKS placement (place_photo) before it parks.
  // THE TASK PIN (2026-07-11). A task update's `target_id` is a TASK TYPE id; these are the OPEN physical rows
  // that type stands for. Code filters them by `structure` (the narration's slot) to pin ONE row — 1 applies,
  // >1 asks, 0 checks `geometry` to tell a missing floor from an untracked task. Replaces the old per-update
  // floor/unit + taskStructure. Absent → a task update can't be pinned (asks over its rows).
  taskRowsByType?: Map<string, TaskRowRef[]>
  structure?: StructureSlot | null   // where the message says the work is (floor/unit/all/except)
  geometry?: Geometry | null         // the building's real floors/units — distinguishes no-floor from no-task
  // Does this project have a task list AT ALL? A progress report ("slab link done") against a project with
  // ZERO task rows has nothing to attach to and no terminal to land on — `issue_snag_found` creates only
  // issues/snags, `update_found` needs an existing target — so it fell out as both-false and the recall floor
  // turned it into a quiz about unrelated items. It deserves an honest answer instead.
  //   'none'     → no site_tasks rows exist for this project (we don't track its work yet)
  //   'all_done' → tasks exist, none open
  //   'open'     → the normal case (absent ⇒ 'open')
  taskCoverage?: 'none' | 'all_done' | 'open'
  // What decompose called this fragment. Only a PROGRESS report needs a task to land on — an issue or a to-do
  // creates its own row, and a bare ack ("sari", "hmmm") is not work at all. Without this gate, "I don't track
  // a task list for this site" would be our answer to a grunt. Absent ⇒ not-progress (conservative).
  itemType?: 'progress' | 'issue' | 'todo' | null
  // THE SITE IS ALREADY KNOWN (2026-07-11). The name of the project this item is being resolved AGAINST — the
  // Stage-2 group's site, whose candidate set is the only one the model was shown. The resolution model is a
  // per-item call and routinely omits `project_hint` even on a narration that named the site plainly; asking
  // "which project is this for?" then is a question we already know the answer to — and, live, it opened a
  // second conversation that ate the item pick. Present ⇒ a new item is CREATED here, never quizzed.
  // Absent (a genuinely site-less path — a photo with no caption) ⇒ ask, as before.
  sitedProject?: string | null
  // The inbound fragment itself — the sender's own words. Needed by the to-do floor, which captures an
  // ASSIGNED action the two axes have nothing to say about (the model found no issue and no update because
  // there is neither: the supervisor is giving an instruction). The row is titled with what he actually said.
  message?: string | null
}

// ── THE TERMINALS (the authoritative, auditable outcomes) ────────────────────
// EXACTLY one-or-more per input. Every terminal carries a `reason` → written to the trail → the input's
// destination is queryable after the fact. `acked_didnt_catch` carries the full contract so a MISS is
// auditable, never silent.
export type Terminal =
  | { kind: 'object_created'; item: ObserveItem; as: 'classified' | 'note'; upgradeOffer: boolean; reason: string }
  | { kind: 'object_updated'; update: AttachUpdate; applied: 'resolve' | 'addressing' | 'blocked'; undo: boolean; readback: string; reason: string; collectiveTargetIds?: string[] }
  // carries its SOURCE so the executor can open the right pick AND the resume validates against exactly the
  // offered set (which_item → the update being confirmed; which_project → the new item awaiting a site;
  // place_photo → an unplaced photo with lexically-near candidates, shortlistIds carrying the offer).
  // STEP 4 — `axis` distinguishes a MEANING which_item (what is it? task vs issue — the kind fork) from a
  // LOCATION which_item (which same-name floor/unit? the structural pin). The executor caps a PURE cross-kind
  // MEANING fork to 2 (+ new); a location component keeps the full list so no floor is truncated. Absent → meaning.
  // `preamble` — a fact the supervisor must know BEFORE he can answer, printed above the pick (the "this site
  // has no floor cellar" sentence). A question can carry a truth; only a dead end has to choose between them.
  | { kind: 'question_asked'; about: 'which_item' | 'which_project' | 'place_photo'; axis?: 'meaning' | 'location'; ref: string | null; update?: AttachUpdate; item?: ObserveItem; shortlistIds?: string[]; preamble?: string; reason: string }
  | { kind: 'queued_as_evidence'; reason: string }
  // The supervisor reported real work on a site whose tasks we do not track (or whose tasks are all closed).
  // Not a miss and not their fault — an honest statement of what we do and don't hold, plus what to do next.
  | { kind: 'acked_untracked_work'; coverage: 'none' | 'all_done'; contract: ResolutionContract; reason: string }
  // A TASK update named a floor/unit that EXISTS, on which this task type simply isn't tracked. There is
  // nothing to pick between (the row does not exist anywhere), so this is not ambiguity and cannot be a
  // question: it is an honest report — saved to notes; pass 2 will offer to add the task (a safe single
  // INSERT), never structure regeneration. Writes no state; auditable (carries the contract).
  //
  // The TWIN case — the floor/unit does NOT exist at all ("no cellar") — is NOT a terminal. The type is real
  // and its rows sit on floors that do, so it is AMBIGUITY, and ambiguity is a which_item ask carrying the
  // "this site has no floor cellar" sentence as its `preamble` (see planTaskUpdate). It used to end the turn
  // here: we told the truth and hung up, so "save it to stilt floor" — the answer to the question we had just
  // asked — arrived with no question open, named no referent, and was answered "I couldn't tell which work
  // you meant". The work and its photo were lost. A named floor we cannot place is a QUESTION.
  | { kind: 'acked_no_place'; typeName: string; floor: string | null; unit: string | null
      contract: ResolutionContract; reason: string }
  | { kind: 'acked_didnt_catch'; contract: ResolutionContract; reason: string }

// ── FLOOR/UNIT CANONICALISATION — a PURE twin of _siteops_route's floorFromHint/unitFromHint, inlined so
// this planner keeps its no-Deno invariant (route pulls _siteops_extract's module-scope Deno.env). Keep the
// ordinal map in sync with route's ORD. Both the model's hint and the structure's label pass through the
// SAME function, so "4th" (model) and "Fourth" (structure) compare equal, and floors outside the map fall
// back to their lowercased raw label (consistent on both sides). ──────────────────────────────────────────
const FLOOR_ORD: Record<string, string> = {
  ground: 'Ground', gf: 'Ground', g: 'Ground', stilt: 'Stilt', cellar: 'Cellar', basement: 'Cellar',
  first: 'First', '1st': 'First', '1f': 'First', second: 'Second', '2nd': 'Second', '2f': 'Second',
  third: 'Third', '3rd': 'Third', '3f': 'Third', fourth: 'Fourth', '4th': 'Fourth', '4f': 'Fourth',
  fifth: 'Fifth', '5th': 'Fifth', '5f': 'Fifth',
}
export function canonFloor(x: string | null | undefined): string | null {
  if (!x) return null
  const h = x.toLowerCase().trim()
  for (const k of Object.keys(FLOOR_ORD)) if (new RegExp(`\\b${k}\\b`).test(h)) return FLOOR_ORD[k]
  return h || null
}
export function canonUnit(x: string | null | undefined): string | null {
  if (!x) return null
  const h = x.toLowerCase().trim()
  const letter = h.match(/\bunit\s*([a-z])\b/)
  if (letter) return `Unit ${letter[1].toUpperCase()}`
  const num = h.match(/\bunit\s*(\d{1,2})\b/)
  if (num) { const n = parseInt(num[1], 10); if (n >= 1 && n <= 26) return `Unit ${String.fromCharCode(64 + n)}` }
  return h || null
}
function normName(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

// A `nearest` guess that HEDGES is not a guess we may ask about (see the veto at the recall floor). These are
// the model's own words about its own confidence — we read them, we do not second-guess its meaning.
const HEDGED = /\b(may|might|could|possibly|perhaps|maybe|unsure|probably|seems?)\b|\bnot sure\b/i

// THE TASK PIN (2026-07-11). The model named a task TYPE; here CODE turns that into a physical row using the
// narration's structure slot. The model is NEVER shown a floor, so it can never pick the wrong one — the pin
// is a deterministic filter, not a guess. FILTER the type's OPEN rows by the slot's floor/unit, then:
//   • all-quantifier    → SWEEP the filtered set, minus any `except`.
//   • exactly 1 row      → APPLY it.
//   • > 1                → ASK which_item over the residual (the supervisor taps the floor/unit).
//   • 0, a floor/unit named → check GEOMETRY: does that floor/unit even exist? no → no_structure (an ASK over
//                             the rows that DO exist, told what the real structure is); yes → no_task (the
//                             place is real, this type just isn't tracked there — nothing to pick between).
//   • 0, nothing named   → can't happen (a type has ≥1 row); ask over all rows as a safe floor.
type PinVerdict =
  | { kind: 'apply'; rowId: string }
  | { kind: 'apply_all'; ids: string[] }
  | { kind: 'ask'; shortlistIds: string[] }
  // `shortlistIds` — the rows the ask offers instead: every row of the type, narrowed to the VALID part of the
  // slot (a bad unit on a real floor still knows its floor, so it must not re-offer the whole building).
  | { kind: 'no_structure'; dimension: 'floor' | 'unit'; named: string; present: string[]; shortlistIds: string[] }
  | { kind: 'no_task'; typeName: string; floor: string | null; unit: string | null }
function pinTask(rows: TaskRowRef[], slot: StructureSlot | null, geometry: Geometry | null): PinVerdict {
  const wantFloor = canonFloor(slot?.floor)
  const wantUnit = canonUnit(slot?.unit)
  let cands = rows
  if (wantFloor) cands = cands.filter((r) => canonFloor(r.floor) === wantFloor)
  if (wantUnit) cands = cands.filter((r) => canonUnit(r.unit) === wantUnit)

  if (slot?.all) {
    // "…entire apartment EXCEPT the fifth floor" — the model named the exclusions, code SUBTRACTS them. With
    // no floor named, "all wiring" sweeps every row of the type; with a floor, it sweeps that floor's rows.
    const noFloor = new Set((slot.except?.floors ?? []).map((f) => canonFloor(f)).filter(Boolean) as string[])
    const noUnit = new Set((slot.except?.units ?? []).map((x) => canonUnit(x)).filter(Boolean) as string[])
    const base = cands.length ? cands : rows
    const kept = base.filter((r) => !noFloor.has(canonFloor(r.floor) ?? '') && !noUnit.has(canonUnit(r.unit) ?? ''))
    // "all done except all of them" is incoherent — ask, never sweep the rows they just carved out.
    if (!kept.length) return { kind: 'ask', shortlistIds: base.map((r) => r.id) }
    return { kind: 'apply_all', ids: kept.map((r) => r.id) }
  }

  if (cands.length === 1) return { kind: 'apply', rowId: cands[0].id }
  if (cands.length > 1) return { kind: 'ask', shortlistIds: cands.map((r) => r.id) }

  // 0 rows matched. If the message named a floor/unit, tell a MISSING FLOOR from an UNTRACKED TASK.
  if (wantFloor || wantUnit) {
    if (geometry) {
      if (wantFloor && !geometry.floors.includes(wantFloor)) {
        // The floor is fiction, so nothing about the LOCATION is trustworthy — offer every row of the type.
        return { kind: 'no_structure', dimension: 'floor', named: slot?.floor ?? wantFloor, present: geometry.floors, shortlistIds: rows.map((r) => r.id) }
      }
      if (wantUnit) {
        const units = wantFloor ? (geometry.unitsByFloor.get(wantFloor) ?? []) : [...new Set([...geometry.unitsByFloor.values()].flat())]
        if (!units.includes(wantUnit)) {
          // The FLOOR is real (checked above) — only the unit is wrong. Keep what we know: offer that floor's rows.
          const onFloor = wantFloor ? rows.filter((r) => canonFloor(r.floor) === wantFloor) : []
          const offer = onFloor.length ? onFloor : rows
          return { kind: 'no_structure', dimension: 'unit', named: slot?.unit ?? wantUnit, present: units, shortlistIds: offer.map((r) => r.id) }
        }
      }
    }
    // Floor/unit EXISTS (or geometry unknown) but no row of this type there → genuinely missing task.
    return { kind: 'no_task', typeName: rows[0]?.name ?? '', floor: wantFloor, unit: wantUnit }
  }
  // A type always has ≥1 row, so 0-with-no-slot is unreachable; ask over all rows as the safe floor.
  return { kind: 'ask', shortlistIds: rows.map((r) => r.id) }
}

// ── THE TASK UPDATE — pin, tie, then the ladder ──────────────────────────────
/**
 * A task update in three steps, in this order:
 *   1. TIE   — the model's `alt_target_ids`: other TYPES that fit the message just as well ("tiles done" →
 *              Floor tiling · Wall tiling · Tiling). Code pins EACH type's row from the structure slot; a type
 *              with no row at the named place drops out of the tie by itself. >1 survivor → ASK over the rows
 *              (the supervisor taps the work). Exactly 1 → the tie collapsed: APPLY, no needless question.
 *   2. PIN   — the ordinary single-type pin (filter the type's rows by the slot; geometry tells a missing floor
 *              from an untracked task).
 *   3. LADDER (landTask) — LOW asks (over the PINNED ROW, never the type handle); blocked/med/high land.
 */
function planTaskUpdate(u: AttachUpdate, ctx: ResolutionContext, contract: ResolutionContract): Terminal {
  const rowsOf = (id: string): TaskRowRef[] => ctx.taskRowsByType?.get(id) ?? []
  const rows = rowsOf(u.target_id)
  if (!rows.length) {
    // A task type in the candidate set should always carry rows; if it doesn't, we can't touch state — ask.
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, update: u, reason: `task type ${u.target_id} carries no rows — cannot pin, ask` }
  }
  const slot = ctx.structure ?? null
  const geo = ctx.geometry ?? null

  // 1) THE TIE. An alt outside the candidate set (or with no rows) is an invented referent — dropped, exactly
  //    like an un-offered target_id.
  //    KNOWN GAP — an ALL-QUANTIFIER tie ("all the tiling is done", three tiling types) is NOT expanded: a
  //    sweep answer has to re-run the pin on the CHOSEN type, and the ask's resume applies to one row, so
  //    expanding here would let a tap silently under-write the sweep. We keep today's behaviour (sweep the
  //    model's primary type) rather than invent a wrong one. Pass 2 should teach the resume to re-plan.
  const alts = slot?.all ? [] : [...new Set(u.alt_target_ids ?? [])]
    .filter((id) => id !== u.target_id && ctx.candidateIds.has(id) && rowsOf(id).length)
  if (alts.length) {
    const pinned = [u.target_id, ...alts].flatMap((id) => {
      const v = pinTask(rowsOf(id), slot, geo)
      return v.kind === 'apply' ? [v.rowId] : v.kind === 'ask' ? v.shortlistIds : v.kind === 'apply_all' ? v.ids : []
    })
    const ids = [...new Set(pinned)]
    if (ids.length > 1) {
      const names = [u.target_id, ...alts].map((id) => rowsOf(id)[0]?.name).filter(Boolean).join(' / ')
      return {
        kind: 'question_asked', about: 'which_item', axis: 'meaning', ref: u.target_id, update: u, shortlistIds: ids,
        reason: `${alts.length + 1} task types fit equally (${names}) — ${ids.length} rows at the named location, ask WHICH WORK (never pick between real, different scopes)`,
      }
    }
    // Exactly one survivor → the structure slot broke the tie by itself. Zero → no type is tracked at that
    // place; fall through to the primary's honest no-place report.
    if (ids.length === 1) return landTask({ ...u, target_id: ids[0] }, ctx, rows, [ids[0]])
  }

  // 2) THE PIN (single type)
  const v = pinTask(rows, slot, geo)
  if (v.kind === 'no_structure') {
    // The named floor/unit is not in the building — but the WORK is real and lives on places that are. That is
    // ambiguity, not a dead end: ASK, with the truth about the structure printed above the choices. (Ending the
    // turn here is what lost the live "cellar flooring" photo — see the acked_no_place comment.)
    return {
      kind: 'question_asked', about: 'which_item', axis: 'location', ref: u.target_id, update: u,
      shortlistIds: v.shortlistIds, preamble: noSuchStructure(v.dimension, v.named, v.present),
      reason: `${v.dimension} "${v.named}" not in the building — ask which of the ${v.shortlistIds.length} real "${rows[0].name}" row(s) they meant, never a wrong write`,
    }
  }
  if (v.kind === 'no_task') {
    return { kind: 'acked_no_place', typeName: v.typeName, floor: v.floor, unit: v.unit, contract, reason: `"${v.typeName}" not tracked at ${v.floor ?? v.unit ?? 'that location'} — saved to notes` }
  }
  if (v.kind === 'ask') {
    // The location pick — ROW ids, the full residual (never truncated: hiding the right floor is the bug).
    return { kind: 'question_asked', about: 'which_item', axis: 'location', ref: u.target_id, update: u, shortlistIds: v.shortlistIds, reason: `task "${rows[0].name}" not pinned to one row by the structure slot — ask which_item` }
  }
  if (v.kind === 'apply_all') return landTask({ ...u, target_id: v.ids[0] }, ctx, rows, v.ids, v.ids)
  return landTask({ ...u, target_id: v.rowId }, ctx, rows, [v.rowId])
}

/**
 * The tasks of the trade HE named, at the place HE named — the options an ask should actually offer.
 *
 * Built from the same two facts the pin uses: `taskRowsByType` (every open row of every offered type) and
 * `structure` (the floor/unit the message states). We keep the types whose trade overlaps the message's, and
 * from each we keep the rows that match the stated floor/unit. Rows only — the ask offers rows, because a row
 * is the only thing a human can read and a writer can write to.
 *
 * Returns [] when it can name nothing better, and the caller then offers what it offered before: this may
 * only ever ADD options, never take one away.
 */
function sameTradeAlternatives(ctx: ResolutionContext, chosenTypeId: string): string[] {
  const said = tradeGroups(ctx.message ?? null)
  if (!said.length || !ctx.taskRowsByType?.size) return []

  const slot = ctx.structure ?? null
  const floorWanted = slot?.floor ? canonFloor(slot.floor) : null
  const unitWanted = slot?.unit ? canonUnit(slot.unit) : null

  const out: string[] = []
  for (const [typeId, rows] of ctx.taskRowsByType) {
    if (typeId === chosenTypeId) continue                       // the model's own pick is added by the caller
    if (!rows.length) continue
    const task = tradeGroups(rows[0].name)
    if (!task.length || !said.some((g) => task.includes(g))) continue   // a different trade — not an option
    for (const r of rows) {
      if (floorWanted && canonFloor(r.floor ?? '') !== floorWanted) continue
      if (unitWanted && canonUnit(r.unit ?? '') !== unitWanted) continue
      out.push(r.id)
    }
  }
  return out
}

/** 3) THE LADDER for a PINNED task. `u.target_id` is a ROW id here; `pinned` is what an ask would offer;
 *  `collectiveIds` (all-quantifier only) is the swept set. LOW never touches state — it asks over the pinned
 *  row(s), so the confirm lands on something a writer can actually write to. */
function landTask(u: AttachUpdate, ctx: ResolutionContext, rows: TaskRowRef[], pinned: string[], collectiveIds?: string[]): Terminal {
  // ── THE TRADE GUARD (2026-07-13) ────────────────────────────────────────────────────────────────────
  // He said "electrical chases made for 2nd floor Unit B". The model picked "Plumbing — in-wall lines
  // (chases & sleeves)" — and SAID SO in its own reason: "…most closely matches the in-wall lines (chases
  // & sleeves) task, though it is labeled as plumbing". It matched on the word "chases", which appears in
  // exactly one label in the whole library, and that label is the wrong trade.
  //
  // That is not "low confidence about WHICH ROW". It is the wrong TASK, and the two must not be treated the
  // same, because they need different questions. A wrong-trade pick is a fact we can check in code: the
  // message names a trade, the task belongs to another, and the sets are disjoint.
  const wrongTrade = tradeMismatch(ctx.message ?? null, rows[0]?.name ?? null)

  if (u.confidence === 'low' || wrongTrade) {
    // ── AND THE ASK MUST OFFER SOMETHING HE CAN SAY YES TO ───────────────────────────────────────────
    // The shortlist used to be `pinned` — the rows of the model's OWN pick. So on a low-confidence guess we
    // offered him exactly the thing we were unsure about, and nothing else. Live, that was ONE option:
    // "Plumbing — in-wall lines … — Second · Unit B", and "it's new". He had no way to say "electrical".
    // Being unsure is precisely when the alternatives matter.
    //
    // So offer the SAME-TRADE tasks at the SAME place, with the model's pick alongside them. If we can name
    // no better alternative we fall back to `pinned` — never fewer options than before.
    const alts = sameTradeAlternatives(ctx, u.target_id)
    const shortlist = alts.length ? [...new Set([...alts, ...pinned])] : pinned
    return {
      kind: 'question_asked', about: 'which_item', axis: 'meaning', ref: u.target_id, update: u,
      shortlistIds: shortlist,
      reason: wrongTrade
        ? `WRONG TRADE: the message names a different trade from task "${rows[0].name}" — ask over the ${shortlist.length} same-trade option(s), never write across trades`
        : `low confidence on task "${rows[0].name}" — ask over ${shortlist.length} option(s) (pick-one w/ "it's new")`,
    }
  }
  // BLOCKED — the negative report, on the pinned row(s). Never advances, never closes.
  if (u.action === 'blocked') {
    return { kind: 'object_updated', update: u, applied: 'blocked', undo: false, readback: 'noted as still open — chasing sooner', reason: `blocked task — ${u.reason} — trail + earlier chase, status untouched`, ...(collectiveIds ? { collectiveTargetIds: collectiveIds } : {}) }
  }
  // A task RESOLVE lands ONLY at HIGH + explicit closure (a wrong resolve kills a task/chase). MED means the
  // model is only PROBABLY right about the type, so a med task ADVANCES (addressing), never closes — the same
  // "MED never resolves" invariant that guards issues. The pin removed the FLOOR ambiguity; type confidence remains.
  const applied = (u.confidence === 'high' && u.action === 'resolve' && u.closure_explicit) ? 'resolve' : 'addressing'
  return { kind: 'object_updated', update: u, applied, undo: applied === 'resolve', readback: applied === 'resolve' ? 'resolved — undo?' : 'updated', reason: applied === 'resolve' ? `high task + explicit closure — ${u.reason}` : `task advance (${u.confidence}${u.action === 'resolve' ? ', vague closure' : ''}) — ${u.reason}`, ...(collectiveIds ? { collectiveTargetIds: collectiveIds } : {}) }
}

// ── THE LADDER (per update) — gates the ACTION, never the trail ──────────────
// HIGH + resolve + closure_explicit → RESOLVE + undo. HIGH + resolve + !closure_explicit → ADDRESSING
// (clear referent, vague closure — advance, never close). HIGH + progress → ADDRESSING + re-time.
// MED → ADDRESSING, NEVER resolve (even with explicit closure — an uncertain referent may not be closed).
// LOW → ASK (uncertainty never touches state). Unknown target_id (invented/stale) → ASK: the model cannot
// resolve onto something we didn't offer.
function planUpdate(u: AttachUpdate, ctx: ResolutionContext, contract: ResolutionContract): Terminal {
  if (!ctx.candidateIds.has(u.target_id)) {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, update: u, reason: `target ${u.target_id} not in candidate set — cannot touch state on an un-offered referent` }
  }
  // TASK — the model named a TYPE; the pin runs FIRST, before the LOW gate. A low-confidence task used to ask
  // over the bare "type:…" handle, which is not a task_id: the confirm loaded no row and parked. The ask must
  // offer the PINNED ROW ("Floor tiling — First · Unit A") — the only thing a human can read and a writer can
  // write to. So the task path owns its own confidence gate (landTask), below the pin.
  if (u.target_kind === 'task') return planTaskUpdate(u, ctx, contract)

  if (u.confidence === 'low') {
    return { kind: 'question_asked', about: 'which_item', ref: u.target_id, update: u, reason: `low confidence on ${u.target_id} — ask (pick-one w/ "it's new")` }
  }

  // ── ISSUE / TODO PATH ──────────────────────────────────────────────────────
  // BLOCKED is SAFE at med (it advances nothing and closes nothing), so it must not be swallowed by the
  // med→addressing rung — "not yet laid" reported as ADDRESSING would say the opposite of the message.
  if (u.confidence === 'med' && u.action !== 'blocked') {
    return { kind: 'object_updated', update: u, applied: 'addressing', undo: false, readback: 'named the match — wrong item? tap', reason: `med confidence — ${u.reason} — ADDRESSING only, never resolve` }
  }
  if (u.action === 'blocked') {
    return { kind: 'object_updated', update: u, applied: 'blocked', undo: false, readback: 'noted as still open — chasing sooner', reason: `blocked — ${u.reason} — trail + earlier chase, status untouched` }
  }
  // HIGH — a resolve lands ONLY with explicit closure language (the rubric's AND). A clear referent with
  // vague closure ("that thing is sorted") ADVANCES, never closes — a wrong RESOLVE silently kills a chase.
  const applied = (u.action === 'resolve' && u.closure_explicit) ? 'resolve' : 'addressing'
  return {
    kind: 'object_updated', update: u, applied, undo: applied === 'resolve',
    readback: applied === 'resolve' ? 'resolved — undo?' : 'addressing',
    reason: applied === 'resolve' ? `high + explicit closure — ${u.reason}` : `high referent, vague/no closure — advance not close — ${u.reason}`,
  }
}

// ── THE LADDER (per new item) — never dropped: create, or ask-for-site ───────
// HIGH → create as classified. MED/LOW → create as a NOTE + an upgrade offer (captured, not corrupt).
// No site → ASK which project (better than mis-filing to the wrong building). Never a task from a photo is
// the caller's concern (the model won't emit a task in Axis 1); here we only create issue/snag notes.
// The project-disambiguation resume re-runs each fragment as "<Project>: <text>" so the site travels with it.
// A row created from that text must not be TITLED with the prefix ("ASM Elite: check the flooring").
function stripSitePrefix(message: string, site: string): string {
  const p = `${site}:`
  return message.toLowerCase().startsWith(p.toLowerCase()) ? message.slice(p.length).trim() || message : message
}

function planObserve(it: ObserveItem, ctx: ResolutionContext): Terminal {
  // The caller already sited this item (the Stage-2 group) → the model's silence about the project is noise,
  // not doubt. Carry the known site so the create lands there explicitly. Only a TRULY site-less item asks.
  const item = it.project_hint ? it : (ctx.sitedProject ? { ...it, project_hint: ctx.sitedProject } : it)
  if (!item.project_hint) {
    return { kind: 'question_asked', about: 'which_project', ref: it.detail, item, reason: `new ${it.kind} with no resolvable site — ask which project` }
  }
  const as = item.confidence === 'high' ? 'classified' : 'note'
  return { kind: 'object_created', item, as, upgradeOffer: as === 'note', reason: `${item.confidence} — create ${item.kind} as ${as}` }
}

/**
 * Consume the (advisory) contract, return the (authoritative) terminals. PURE. Enforces:
 *  - every found update lands per the ladder, or is asked (never silently dropped)
 *  - every found item is created, or asked-for-site (never silently dropped)
 *  - an invented target_id can't touch state
 *  - an image with nothing confident → queued as evidence (cautious)
 *  - both axes false, non-image → acked_didnt_catch is MANDATORY, carrying the contract for audit
 * and finally re-checks the no-drop invariant by assertion (defense in depth; tested to bite).
 */
export function executeResolution(c: ResolutionContract, ctx: ResolutionContext): Terminal[] {
  // One item = one update now: "all"/"except" live in the narration's structure slot (pinTask sweeps), not as
  // multiple collective updates, so the old dedupCollective pass is gone. `c` is planned and no-drop-checked as-is.
  const c2 = c
  const terminals: Terminal[] = []

  for (const u of c2.update_found.found ? c2.update_found.updates : []) terminals.push(planUpdate(u, ctx, c2))
  for (const it of c2.issue_snag_found.found ? c2.issue_snag_found.items : []) terminals.push(planObserve(it, ctx))

  if (terminals.length === 0) {
    // ── THE TO-DO FLOOR (2026-07-11) ────────────────────────────────────────────────────────────────────
    // A to-do is NEW WORK the supervisor is assigning ("check whether the epoxy went in after the dust was
    // cleaned", "tie gunny bags to the columns today"). It is not a claim about existing work, so the two
    // axes have nothing to find — and the recall floor below then quizzed him about the open items it looked
    // vaguely like. LIVE: "check whether epoxy was applied after cleaning dust" was answered with "which of
    // these is it about? 1. Epoxy should be applied only after cleaning dust…" — the snag its own sibling item
    // had created one second earlier. An instruction is captured, never bounced back as a question.
    if (ctx.itemType === 'todo' && ctx.sitedProject && ctx.message?.trim()) {
      const detail = stripSitePrefix(ctx.message.trim(), ctx.sitedProject)
      terminals.push({
        kind: 'object_created',
        item: { kind: 'snag', detail, location: null, project_hint: ctx.sitedProject, confidence: 'high', planned: true },
        as: 'classified', upgradeOffer: false,
        reason: 'a to-do is new work the sender is assigning — capture it, never quiz them about existing items',
      })
      return terminals
    }
    // THE RECALL FLOOR, given a floor (2026-07-09). It used to ask on ANY nearest the model named — med OR low
    // — unioned with a LEXICAL belt of raw token overlap. Both were wrong, and the live probe showed how:
    //
    //   "transformer arranged"  → asked "did you mean: Arrange for aggregate (kankara) and sand?"   (med, "may relate to")
    //   "…except fifth floor"   → asked over Fourth/First/Second + Ceiling void-wiring               (belt matched "wiring")
    //
    // The belt scored on SPELLING, so it offered every task containing the word and was blind to "fifth". The
    // model's `low` meant "a guess" and asked exactly as loudly as `med`. An ask that names unrelated work is
    // WORSE than a clean miss: it costs the supervisor four messages AND traps the thread (every reply while it
    // is open is force-matched, dropped, or interrupts it).
    //
    // Now: only a MED nearest asks. A LOW one falls through to the honest didn't-catch, which is no longer a
    // shrug — NOTHING_TO_UPDATE tells the supervisor exactly how to name the work. The lexical belt survives on
    // the IMAGE path only, where a caption may be empty or pure Telugu and place_photo still needs a shortlist.
    // TASK-side nearest is DELETED (2026-07-11): a task nearest would name a TYPE id, and the "did you mean this
    // work on… which floor?" question has no answer without the slot — that is the pin's job, not a recall guess.
    // Only ISSUE/TODO nearest survives (a meaning-level "did you mean the transformer issue?").
    // THE HEDGE VETO (2026-07-11) — the prompt's own rule, enforced. RESOLUTION_SYSTEM says: "If the reason you
    // would write contains 'may relate', 'might be', or 'possibly', the honest answer is []." The live probe
    // shipped, at plausibility MED (the one value that asks):
    //   "…tiles cleared in First floor Unit A, which MAY RELATE to progress on fixing the door issue in that unit"
    // — matched on the LOCATION, not the work, and asked the supervisor "did you mean: the doors have come off?"
    // A prompt can only ask; code enforces (the model-disobedience → code-floor lesson). A model that would BET
    // on a match does not hedge, so this cannot veto a real one — and a vetoed guess is not lost: it falls to
    // the honest didn't-catch, which TELLS the supervisor how to name the work.
    const nearestReal = (!c2.update_found.found ? (c2.update_found.nearest ?? []) : [])
      .filter((n) => n.plausibility === 'med' && n.target_kind !== 'task' && ctx.candidateIds.has(n.target_id))
      .filter((n) => {
        if (!HEDGED.test(n.reason ?? '')) return true
        console.log(`[siteops:nearest:vetoed] target=${n.target_id} hedged reason=${JSON.stringify(n.reason)} — a guess that hedges never asks`)
        return false
      })
    // ── THE ISSUE FLOOR (2026-07-11) ───────────────────────────────────────────────────────────────────
    // The twin of the to-do floor above, and the same lesson: a model's judgment needs a code floor under it.
    // The VISION tier classified this item as a DEFECT; the resolution model, re-deciding from scratch, found
    // neither an update nor a new issue. Without a floor the photo lands as a bare evidence park — no problem
    // row, no cause, no chase, and nobody ever told that a crack was seen. A defect we SAW is not a message we
    // failed to understand.
    //
    // WHERE IT SITS is the whole design:
    //   · AFTER the model's MED `nearest` — a re-report of a KNOWN problem is an update on that item, never a
    //     duplicate issue. The recall floor asks, and wins.
    //   · BEFORE the lexical belt — the image belt matches on raw token overlap, so "a crack in the beam
    //     soffit" nears the Beams TASK on the word "beam" and would be answered "which of these does this
    //     photo belong to?" A spelling coincidence must not outrank a defect.
    //
    // It cannot chase a guess: the vision tier DEMOTES a low-confidence issue to a plain progress note
    // upstream, so an `issue` itemType arriving here was called HIGH by the classifier that saw the pixels.
    if (!nearestReal.length && ctx.itemType === 'issue' && ctx.sitedProject && ctx.message?.trim()) {
      const detail = stripSitePrefix(ctx.message.trim(), ctx.sitedProject)
      terminals.push({
        kind: 'object_created',
        item: { kind: 'issue', detail, location: null, project_hint: ctx.sitedProject, confidence: 'high', planned: false },
        as: 'classified', upgradeOffer: false,
        reason: 'the classifier saw a DEFECT and the resolver found nothing — log the issue, never park a seen defect as "didn\'t catch"',
      })
      return terminals
    }
    const belt = ctx.isImage ? (ctx.nearCandidateIds ?? []).filter((id) => ctx.candidateIds.has(id)) : []
    const askIds = [...new Set([...nearestReal.map((n) => n.target_id), ...belt])]

    // ASK-BEFORE-EVIDENCE: a both-false image with near candidates asks placement first (evidence park is
    // the floor). The nearest floor unions into the image shortlist too.
    if (ctx.isImage) {
      terminals.push(askIds.length
        ? { kind: 'question_asked', about: 'place_photo', ref: null, shortlistIds: askIds, reason: 'image with nothing confident but near candidates — ask placement before parking' }
        : { kind: 'queued_as_evidence', reason: 'image with no confident update or creation — queue as evidence, decide later' })
    } else if (askIds.length) {
      // TEXT recall floor — a SINGLE model-nearest carries its verdict (action + closure_explicit) so a confirm
      // can RESOLVE, not merely address; a multi-way shortlist is verdict-less (the confirm forces addressing).
      const single = nearestReal.length === 1 && belt.length === 0 ? nearestReal[0] : null
      const update: AttachUpdate | undefined = single
        ? { target_id: single.target_id, target_kind: single.target_kind, action: single.action, confidence: 'low', closure_explicit: single.closure_explicit, reason: single.reason }
        : undefined
      terminals.push({ kind: 'question_asked', about: 'which_item', axis: 'meaning', ref: null, shortlistIds: askIds, ...(update ? { update } : {}), reason: nearestReal.length ? 'both-false but model named nearest by meaning — ask which item, never a silent miss' : 'both-false but lexically-near candidates — ask which item, never a silent miss' })
    } else if (ctx.itemType === 'progress' && (ctx.taskCoverage === 'none' || ctx.taskCoverage === 'all_done')) {
      // THE HONEST TERMINAL. The work is real; we simply have nowhere to put it. Saying "didn't catch" here
      // blames the supervisor for our missing task list — and it is what sent "slab link done" into a quiz
      // about "plan properly tomorrow for required item".
      terminals.push({
        kind: 'acked_untracked_work', coverage: ctx.taskCoverage, contract: c,
        reason: ctx.taskCoverage === 'none'
          ? 'project has no site_tasks at all — the work is real, we track no task list for it'
          : 'project has tasks but none open — nothing to attach a progress report to',
      })
    } else {
      terminals.push({ kind: 'acked_didnt_catch', contract: c, reason: 'no issue/snag found and no update found on a non-image input' })
    }
  }

  assertNoDrop(c2, terminals)
  return terminals
}

// ── THE COMBINED READBACK (one supervisor message → one reply) ───────────────
// A message that produced several terminals gets ONE reply, composed from what ACTUALLY terminated —
// per-terminal, not from what the planner intended. Two rules the single-terminal case doesn't need:
//   • PARTIAL-FAILURE HONEST — if the resolve landed but the create failed, the reply says BOTH truthfully
//     ("✓ X resolved · ⚠️ couldn't log Y — saved for review"), never an all-or-nothing claim that lies
//     about half the message. Each line reflects that terminal's real `status`.
//   • ORDERED BY CONSEQUENCE, not by axis — the RESOLVE first (the state change that stops a chase), then
//     the new item (the thing that starts one). "Resolved X · logged new Y" reads as a verifiable status.
// Questions are their own interactive message (sent by the executor), so they're excluded here.
export interface TerminalOutcome {
  terminal: Terminal
  // 'ok' effect landed · 'failed' effect errored (parked, read back as ⚠️ … saved for review) · 'held' the
  // executor UNDERSTOOD the update but can't act on it yet (a valid candidate outside this batch — the fresh
  // path owns it, unadopted). 'held' is NOT a failure — it reads back as understood-but-held, and its row is
  // parked distinguished (non_batch_target) for later replay.
  // 'duplicate' — the SAME row, the SAME action, already applied in this turn (an over-decomposed message
  // naming one work twice). The first one landed; this is the same FACT, so it must not be written again and
  // must not add a second readback line. It is recorded as an outcome (never dropped — assertAllApplied still
  // counts it) and is silent in the reply.
  status: 'ok' | 'failed' | 'held' | 'duplicate'
  label: string            // short human label of the object/finding, for the reply line
}

/**
 * What we say when a message reached SiteOps but named nothing we could act on.
 *
 * It used to read: "Didn't catch a site update in that — try again if you meant to send one." That tells the
 * supervisor we failed, blames their message, and gives them nothing to do differently. It was also what they
 * got for asking "what can you do?" while we were holding five open questions of our own.
 *
 * The rule the whole system now turns on is simple enough to teach in one line: WE ACT ON WHAT YOU NAME. So
 * say that, say plainly that nothing changed, and show the shape of a message that would work. Examples, never
 * a demand — no list to pick from, no question to answer, nothing left pending. The next message stands alone.
 */
// ── AND THEN IT BECAME A LECTURE (2026-07-13) ───────────────────────────────────────────────────────────
// All of the above is right, and the message it produced was still wrong. It ran to five lines, three worked
// examples and a postscript — and it fired EVERY time we failed to place a fragment, including inside a
// COMBINED readback where other things had landed perfectly well. Live, he got this:
//
//     Here's where everything landed 👇
//     Noted 👍 — nothing updated, since I couldn't tell which work you meant.
//     I only change something when you name it. Just say it plainly:
//     • "municipal water issue is resolved"     ← a tutorial
//     • "tiles laid on the fourth floor"        ← he has sent us forty of these
//     • "ceilings still pending"
//     A photo or a voice note works the same way.
//     Got it — logged new: "plumbing guards not removed"
//
// A man who has been using this for weeks does not need to be taught the format, in English, every time we
// fail to understand him — and teaching him in the same breath as reporting a success reads as noise, not
// help. The FACT is what he needs: nothing changed, and here is the part I could not place. Say it once, say
// it short, and say it in his language.
//
// (The examples were not useless — they were just in the wrong place. They belong in onboarding, once, not
// stapled to every miss forever.)
export function nothingToUpdate(lang: Lang = 'en'): string {
  if (lang === 'te' || lang === 'te-en') return `అర్థమైంది 👍 — కానీ ఏ పని గురించో తెలియక ఏమీ మార్చలేదు. పని పేరు చెప్తే మారుస్తాను.`
  if (lang === 'hi') return `समझ गया 👍 — पर कौन सा काम है पता न चलने से कुछ नहीं बदला। काम का नाम बताइए।`
  return `Noted 👍 — nothing updated, because I couldn't tell which work you meant. Name the work and I'll update it.`
}

/** The English form, kept as a constant for the identity check in _siteops_readback (see isMiss). */
export const NOTHING_TO_UPDATE = nothingToUpdate('en')

/** Is this readback body the "couldn't place it" message, in ANY language? The combined readback collapses it
 *  to a single clause, and it did so by comparing the body against the English constant — which would have
 *  silently stopped matching the moment the message was translated, letting the long form leak back into
 *  every multi-item reply. Identity by MEANING, not by one language's string. */
export function isNothingToUpdate(body: string): boolean {
  return body === nothingToUpdate('en') || body === nothingToUpdate('te') || body === nothingToUpdate('hi')
}

/**
 * DID WE TELL HIM WE COULDN'T PLACE IT — anywhere in this body, in any language, in either form?
 *
 * Two different questions live here and they must not be confused:
 *   · isNothingToUpdate  — "is this body EXACTLY that message?" — what the combined readback asks before it
 *     collapses the long form into one clause. Equality, or it would swallow a body that merely mentions it.
 *   · this one           — "did the supervisor get told?" — what a TEST asks. A readback body routinely gains
 *     a suffix ("· logged at *Soundharya* — wrong site?"), and a MULTI-item reply collapses the whole message
 *     into MISS_CLAUSE. Both still say the thing. Containment, and both forms count.
 */
export function mentionsNothingToUpdate(body: string): boolean {
  if (body.includes(MISS_CLAUSE)) return true                                    // the collapsed one-clause form
  return (['en', 'te', 'hi'] as const).some((l) => body.includes(nothingToUpdate(l)))
}

/** The same fact as NOTHING_TO_UPDATE, as ONE clause, for a combined readback that also has things to report. */
export const MISS_CLAUSE = `one part I couldn't place — nothing updated for it`

/**
 * OUR FAILURE, SAID AS OURS (2026-07-11). When the model that reads the message dies — a timeout on a long
 * voice note, a rate-limit — the supervisor said nothing wrong and has nothing to fix. NOTHING_TO_UPDATE
 * ("I couldn't tell which work you meant… say it plainly") would be a lie that hands him the blame and,
 * worse, implies the message is gone. It isn't: it is parked, in full, and it is in his review list.
 * Same shape as resolveInbound's own model-failure line — one voice for one class of failure.
 */
/**
 * THE SAME MESSAGE, AGAIN. A re-sent narration is one report, not two. Say what we already did with it, and
 * leave the door open — if something actually changed since, they can tell us what.
 */
export const ALREADY_LOGGED =
  `Got it — but this looks like the same message you already sent me a few minutes ago, so I've left ` +
  `everything as it is. 👍\n\n` +
  `Nothing new has been logged. If something has changed since, just tell me what's different.`

export const COULDNT_READ_THAT =
  `Couldn't read that just now — my end had a hiccup, not you. 🙏\n\n` +
  `I've kept your message in full and saved it for review, so nothing's lost. ` +
  `Send it again whenever you like and I'll have another go.`

/**
 * The supervisor reported real work on a site we hold no task list for. Never "didn't catch" — that blames
 * them for our gap. Say what we have, say what we did with their message, and say what they can do about it.
 */
export const NO_TASK_LIST =
  `Got it 👍 — I've saved that to this site's notes.\n\n` +
  `I don't track a task list for this site yet, so there's nothing for me to tick off. ` +
  `Everything you send is still recorded against the site and visible in the app.\n\n` +
  `If you'd like me to start tracking the work, set the site's task list up in the app and I'll keep it updated from here.`

/** Tasks exist, but every one is closed — so a progress report has nothing open to land on. */
export const ALL_TASKS_DONE =
  `Got it 👍 — I've saved that to this site's notes.\n\n` +
  `Every task I track on this site is already marked done, so there's nothing open for this to update. ` +
  `If one of them isn't actually finished, tell me which and I'll reopen it — for example "fifth floor wiring is not done".`

/** Combined-readback clause for the same fact (see MISS_CLAUSE). */
export const UNTRACKED_CLAUSE = `saved to the site's notes — no task list to tick off`

/**
 * THE MISSING-STRUCTURE PREAMBLE — the sentence a "no such floor" which_item ask is asked UNDER. It says the
 * two things the supervisor needs before he can answer: the floor he named isn't in this building, and these
 * are the ones that are. It used to be a whole reply that ENDED the turn (see the acked_no_place comment); now
 * the same truth introduces a question, so his next message ("save it to stilt floor") has something to land on.
 */
export function noSuchStructure(dimension: 'floor' | 'unit', named: string, present: string[]): string {
  /**
   * ══ THE TRUST FLIP — §1.3 ═══════════════════════════════════════════════════════════════════════
   *
   * It said: "This site has no floor 'First'. The floors it has: Ground. If that floor should exist,
   * add it in the app and I'll track work there."
   *
   * Two things wrong with that, and they compound:
   *
   *   1. IT TOLD A BUILDER HIS SITE WAS WRONG. He is standing on the first floor. He can see it. A tool
   *      that contradicts the man who is physically there has lost the argument before it started — and
   *      the gap is not in his building, it is in OUR MODEL of his building. So the system owns it:
   *      "I don't have a *1st floor* for this site — only Ground." The same fact, and now it is our
   *      problem to fix rather than his to be corrected about.
   *
   *   2. "ADD IT IN THE APP" IS A DEAD END. It is homework, handed to a man holding a phone in one hand
   *      and a site in the other. He will not do it — he will put the phone away, and the update is
   *      lost. The line is gone. (The premium fix — an "➕ Add 1st floor & file there" row, which
   *      believes him — is a WRITE, and this pass is copy. See escapeRows in siteops.ts.)
   */
  const list = present.length ? present.join(', ') : 'none set up yet'
  const what = named.trim()
  return present.length
    ? `I don't have a *${what}* ${dimension} for this site — only ${list}.`
    : `I don't have any ${dimension}s set up for this site yet, so I can't place *${what}*.`
}

/**
 * The LONE reply for a task update we couldn't place: the floor/unit is REAL, this task type just isn't tracked
 * there, so there is no row anywhere to pick between. Never a wrong write, never "didn't catch" — saved to
 * notes, set it up in the app (pass 2 will offer to add it directly, a safe single insert).
 */
export function noPlaceReply(t: Extract<Terminal, { kind: 'acked_no_place' }>): string {
  const where = t.floor ? `the ${t.floor} floor` : t.unit ? t.unit : 'that location'
  return `Got it 👍 — I've saved that to this site's notes.\n\n` +
    `I don't track a “${t.typeName}” task on ${where}, so there was nothing to tick off.\n\n` +
    `If it should be tracked, set it up in the app and I'll keep it updated from here.`
}

/** Combined-readback clause for a no-place (see MISS_CLAUSE). */
export const NO_PLACE_CLAUSE = `saved to the site's notes — couldn't place it on the structure`

// consequence rank: resolve (stops a chase) → addressing → created (starts one) → evidence → didnt-catch.
function consequenceRank(o: TerminalOutcome): number {
  const t = o.terminal
  if (t.kind === 'object_updated') return t.applied === 'resolve' ? 0 : 1
  if (t.kind === 'object_created') return 2
  if (t.kind === 'queued_as_evidence') return 3
  if (t.kind === 'acked_untracked_work') return 4
  if (t.kind === 'acked_no_place') return 4
  if (t.kind === 'acked_didnt_catch') return 5
  return 4   // question_asked — excluded below, ranked between for safety
}

// Labels are QUOTED in every line that names an item (probe C2): the reader must parse the label as the
// item's NAME, never as part of the sentence — an unquoted truncated title ("bathroom tiles not") followed
// by "resolved" read as its own negation. Label WIDTH is the caller's job (readbackLabel, length-capped).
function readbackLine(o: TerminalOutcome): string | null {
  const t = o.terminal
  const failed = o.status === 'failed'

  /**
   * ══ TYPE 5 · THE FAILURE LINE — ⏸, NOT ⚠️, AND NO DOUBLE REASSURANCE ══════════════════════════════
   *
   * Two things were wrong with it, and both are about a mark meaning one thing.
   *
   *   · THE GLYPH WAS A LIE. ⚠️ means THE SITE has a problem — a crack, a blocker, something a builder must
   *     act on. A write that failed on OUR side is not that. It is Babai's limbo, which is ⏸, and it has a
   *     named home (Review). Using ⚠️ for both put "the slab has cracked" and "my database call timed out"
   *     under the same mark, which is how a warning glyph stops being read at all.
   *
   *   · "— SAVED FOR REVIEW" WAS SAID TWICE. Every one of these lines carried its own reassurance, and the
   *     message now ends with `Recorded in *Review* · Briklay — nothing's lost`, which says it once, with a
   *     button on it. The spec's order is deliberate: reason, then destination, then reassurance — LAST. A
   *     reassurance that arrives before the reader has finished reading the bad news is the machine
   *     comforting itself.
   *
   * So the line states the failure and stops. The destination line (homesOf → Review) carries where it went,
   * and composeConfirmation carries the button that opens it.
   */
  const cantDo = (verb: string, label: string) => `${G.held} Couldn't ${verb} “${label}”`

  switch (t.kind) {
    case 'object_updated':
      // BLOCKED — the negative report. It must never borrow the progress vocabulary ("✓ … updated") or the
      // chase-speak of an advance ("on it"): the supervisor just told us the work has NOT happened. Read it
      // back as what it is, and say the consequence (we chase sooner) so the report visibly did something.
      if (t.applied === 'blocked') {
        if (failed) return cantDo('note the blocker on', o.label)
        const n = t.collectiveTargetIds?.length ?? 0
        return n ? `⏳ all ${n} “${o.label}” still open — noted, chasing sooner`
                 : `⏳ “${o.label}” still open — noted, chasing sooner`
      }
      // #2 — a COLLECTIVE sweep reads back as ONE line naming the whole set ("marked all 10 … done"), not one
      // line per task. o.label is the shared task name; the count is the swept set.
      if (t.collectiveTargetIds?.length) {
        const n = t.collectiveTargetIds.length
        return failed ? cantDo('update all', o.label) : `✓ marked all ${n} “${o.label}” ${t.applied === 'resolve' ? 'done' : 'updated'}`
      }
      // TASK targets speak progress, not chase-speak: "✓ … updated" (a task is work, not an issue to chase).
      if (t.update.target_kind === 'task') return failed ? cantDo('update', o.label) : `✓ “${o.label}” updated`
      if (t.applied === 'resolve') return failed ? cantDo('resolve', o.label) : `✓ “${o.label}” resolved`
      return failed ? cantDo('update', o.label) : `“${o.label}” — on it, will check back`
    case 'object_created':
      if (failed) return cantDo('log', o.label)
      // T6 note floor (clause 4): a low/med item is logged but NOT chased — surface the upgrade offer so the
      // human can promote it to a tracked issue. A high-confidence (classified) create reads back as usual.
      return t.upgradeOffer ? `logged as a possible issue: “${o.label}” — confirm to track` : `logged new: “${o.label}”`
    case 'queued_as_evidence':
      return failed ? `${G.held} Couldn't save the photo` : `photo saved as evidence`
    case 'acked_untracked_work':
      // Combined readback: one clause. The full explanation is the LONE-outcome reply (see below).
      return UNTRACKED_CLAUSE
    case 'acked_no_place':
      return NO_PLACE_CLAUSE
    case 'acked_didnt_catch':
      // COMBINED readback: one short, honest clause joined with the rest ("Got it — ✓ … · one part I couldn't
      // place"). The full guidance (NOTHING_TO_UPDATE) belongs only to the LONE case, where it IS the reply —
      // six lines of teaching wedged into a ' · ' list would bury the things that did land.
      return MISS_CLAUSE
    case 'question_asked':
      // A SENT question is its own interactive message (no readback line). An UN-SENT one (executor
      // couldn't open the pick) was parked — say so, never silence (the T3 silent-drop fix). An un-sent
      // place_photo fell back to the evidence park, which IS the honest terminal — never a failure notice
      // over a photo that was in fact saved.
      if (o.status === 'ok') return null
      if (t.about === 'place_photo') return `photo saved as evidence`
      return cantDo('place', o.label)
  }
}

// UNDERSTOOD-BUT-HELD clause for one held update: "resolve tiles not arrived" / "update the transformer".
// Multiple held updates share ONE "couldn't … yet — saved for review" wrapper (see composeReadback) — the
// message is "I heard you, both true, holding them" — a categorically different thing than "⚠️ … failed".
function heldClause(o: TerminalOutcome): string {
  const t = o.terminal
  const verb = t.kind === 'object_updated' && t.applied === 'resolve' ? 'resolve' : 'update'
  return `${verb} “${o.label}”`
}

/** Compose the single reply from the terminals' REAL outcomes (consequence-ordered, partial-failure-honest).
 *  PURE. Held updates (understood but not applicable yet) group into ONE "couldn't … yet — saved for review"
 *  clause, distinct from a ⚠️ failure. A lone didn't-catch returns its bare sentence; else "Got it — <…>". */
export function composeReadback(outcomes: TerminalOutcome[], lang: Lang = 'en'): string {
  const ordered = outcomes
    .filter((o) => o.status !== 'duplicate')                                    // the same fact, already on a line above
    .filter((o) => o.terminal.kind !== 'question_asked' || o.status !== 'ok')   // sent questions are their own message; un-sent ones must be told
    .map((o, i) => ({ o, i }))
    .sort((a, b) => consequenceRank(a.o) - consequenceRank(b.o) || a.i - b.i)
    .map((x) => x.o)
  const held = ordered.filter((o) => o.status === 'held')
  const lines = ordered.filter((o) => o.status !== 'held').map(readbackLine).filter((l): l is string => !!l)
  if (held.length) lines.push(`couldn't ${held.map(heldClause).join(' or ')} yet — saved for review`)
  if (!lines.length) return 'Got it'
  // A LONE ack IS the whole reply — say the supportive thing, in full, unwrapped. Wedged into a ' · ' list it
  // would bury whatever else landed, so the combined path uses the one-clause forms above.
  if (lines.length === 1 && ordered.length === 1) {
    const only = ordered[0].terminal
    if (only.kind === 'acked_didnt_catch') return nothingToUpdate(lang)
    if (only.kind === 'acked_untracked_work') return only.coverage === 'none' ? NO_TASK_LIST : ALL_TASKS_DONE
    if (only.kind === 'acked_no_place') return noPlaceReply(only)
  }
  return `Got it — ${lines.join(' · ')}`
}

/**
 * ══ TYPE 5 · WHERE IT LANDED — read off the WRITES, never off the prose ══════════════════════════════
 *
 * The destination line ("Recorded in *Tasks* · Briklay") is the only proof he has that a WhatsApp message
 * became a row in his app. Which makes it the one line that must never be decorative: if it appears under
 * a message that wrote nothing, it is the system claiming a write it did not make, and the day he checks
 * and finds nothing there is the day the line stops meaning anything at all.
 *
 * So it is computed from the OUTCOMES — the same objects composeReadback reads — and not sniffed out of
 * the composed sentence. A didn't-catch, an untracked-work ack, an all-tasks-done ack: these wrote NO row,
 * and they return no home, and so they carry no destination line.
 *
 *   task update         → Tasks
 *   issue/todo update   → Problems
 *   a new issue/snag    → Problems
 *   failed · held · parked · un-sent question · photo-as-evidence → Review
 *
 * REVIEW IS A REAL HOME, not an apology. Something we could not place still WENT somewhere, it is visible,
 * and the line says so — which is the whole difference between "saved for review" as a fact and as a
 * platitude.
 */
export function homesOf(outcomes: TerminalOutcome[]): Home[] {
  const homes = new Set<Home>()
  for (const o of outcomes) {
    if (o.status === 'duplicate') continue                  // the same fact, already counted on a line above
    if (o.status === 'failed' || o.status === 'held') { homes.add('Review'); continue }

    const t = o.terminal
    switch (t.kind) {
      case 'object_updated':
        homes.add(t.update.target_kind === 'task' ? 'Tasks' : 'Problems')
        break
      case 'object_created':
        homes.add('Problems')
        break
      case 'queued_as_evidence':
        homes.add('Review')
        break
      case 'question_asked':
        // A SENT question wrote nothing yet — it is still a question, and it carries no destination line.
        // An UN-SENT one was parked, and the park IS a write, into Review.
        if (o.status !== 'ok') homes.add('Review')
        break
      case 'acked_no_place':
        homes.add('Review')
        break
      case 'acked_didnt_catch':
      case 'acked_untracked_work':
        break                                               // NOTHING was written. Say nothing about where.
    }
  }
  // A stable order, so the same two homes never render two different ways: Tasks, Problems, then Review.
  const order: Home[] = ['Day Book', 'Tasks', 'Problems', 'Review']
  return order.filter((h) => homes.has(h))
}

/** Executor-level no-drop — EVERY terminal must produce exactly one outcome (ok or failed); a missing one
 *  is a dropped effect. Throws (tested to bite): the effect-side twin of assertNoDrop's planner-side check. */
export function assertAllApplied(terminals: Terminal[], outcomes: TerminalOutcome[]): void {
  if (outcomes.length !== terminals.length) {
    throw new Error(`executor invariant violated: ${terminals.length} terminals but ${outcomes.length} outcomes — an effect was DROPPED`)
  }
}

// ── THE ASSERTION — "no code path may drop a found item", made real ──────────
// Verifies the planner accounted for every found input. A found update must yield an object_updated OR a
// question_asked; a found item an object_created OR a question_asked; both-false must yield exactly one
// terminal (evidence for images, else didnt-catch). Throwing here is the backstop that makes the no-miss
// guarantee structural — tested to BITE on a deliberately-dropping (contract, terminals) pair.
export function assertNoDrop(c: ResolutionContract, terminals: Terminal[]): void {
  const foundUpdates = c.update_found.found ? c.update_found.updates.length : 0
  const foundItems = c.issue_snag_found.found ? c.issue_snag_found.items.length : 0

  const updated = terminals.filter((t) => t.kind === 'object_updated').length
  const created = terminals.filter((t) => t.kind === 'object_created').length
  const askedItem = terminals.filter((t) => t.kind === 'question_asked' && t.about === 'which_item').length
  const askedProject = terminals.filter((t) => t.kind === 'question_asked' && t.about === 'which_project').length
  // acked_no_place is a LEGITIMATE, non-dropping disposition of a found TASK update (no such floor / task not
  // tracked there) — the update was accounted for, honestly, without a wrong write.
  const noPlace = terminals.filter((t) => t.kind === 'acked_no_place').length

  if (updated + askedItem + noPlace < foundUpdates) {
    throw new Error(`resolution invariant violated: ${foundUpdates} updates found but only ${updated + askedItem + noPlace} landed/asked/no-placed — an update was DROPPED`)
  }
  if (created + askedProject < foundItems) {
    throw new Error(`resolution invariant violated: ${foundItems} items found but only ${created + askedProject} created/asked — an item was DROPPED`)
  }
  if (foundUpdates === 0 && foundItems === 0 && terminals.length !== 1) {
    throw new Error(`resolution invariant violated: nothing found but ${terminals.length} terminals — a non-update produced ${terminals.length} outcomes (expected exactly one ack/evidence)`)
  }
}
