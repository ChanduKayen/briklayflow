# Site Desk UI (v30) — Parity Report

**Pass:** UI implementation, mock-backed. **Zero backend contract changes**, as briefed.
**Date:** 2026-07-12
**Gates:** typecheck clean · eslint clean · `test:desk` 39/39 · `test:engine` 72/72 · `test:auth` 75/75 · `test:extract` 521/521 · production build ✓

---

## 1. What shipped

| Area | Files |
|---|---|
| Derivation floor (pure, tested) | `src/lib/desk/derive.ts` + `__tests__/derive.test.ts` (39 tests, new `npm run test:desk`) |
| Types / mock / adapter | `src/lib/desk/{types,mock,api,flag}.ts` |
| Tokens + stylesheet | `src/styles/desk.css` (scoped to `.desk-root` / `.desk-portal`) |
| Components | `src/components/desk/{Chrome,Detail,Problems,Plan,useDesk}.tsx` |
| Page + routes | `src/pages/SiteDeskV2.tsx`, routes in `src/App.tsx`, rail entry in `BriklayRail.tsx` |

**Component build list — all present:** ScopePicker · BigTabs (red count badge) · ProblemList/ProblemRow (ref rail, name chip, aging, camera glyph, swipe wrapper) · PendingView + PlacementCard · DetailSheet + DetailPanel (shared content, pinned bar) · StoryTimeline · PhotoStrip (incl. "photo pending — Babai asking") · ResolveForm (outcome chips + note + prefill) · Composer (owner-voice, `[REF]`-stamped) · UndoToast · FloorTimeline · UnitStrip (chips + Common, % bar, live dot, red corner badge → deep-links) · TaskGroups (muted-done inline, future-fold, rollup sentence, drag) · SettingsGear.

**Feature flag.** None existed in the portal (the only `import.meta.env` usage in `src/` was the two Supabase vars). Added `src/lib/desk/flag.ts`: `VITE_SITE_DESK=1` on, `=0` off, unset → **on in dev, off in production**. With it off, the `/desk/*` routes are not registered and no nav entry renders — the portal is byte-identical to before, and the old pages remain the only way in.

---

## 2. Feature Parity Ledger — checked row by row against the live pages

| Current feature | New home | Status |
|---|---|---|
| "To place" queue (QUESTION INTERRUPTED chips, source number, Dismiss) | **Pending** segment — `PendingView` + `PlacementCard`, list-head "Caught from WhatsApp — waiting for a home.", count on the label when >0, Place / Dismiss. Severity sort + kind filter hidden (chronological only). | ✅ |
| Escalated badge + "Nd ago waiting" | `you` state; the status sentence carries it. **No badge exists in the code.** | ✅ |
| "project-wide" tag | Location meta slot — a snag with no `loc` renders **"Project-wide"** where floor/unit would go (`Problems.tsx`, `Detail.tsx`). | ✅ |
| Per-site chips with counts | ScopePicker menu rows (`{n} need you` / `{n} open, with Babai` / `all clear` · plan %). | ✅ |
| Header stats (19 open · 5 overdue · 11 snags · 31 to place) | Problems tab red badge (needs-you count) + Pending segment count. **Aggregate stat band does not return.** | ✅ |
| Dry Run badge | **Removed entirely.** No gating logic was attached to it in the code, so nothing became invisible. See §5 flag 3. | ✅ |
| Assign lead | ⚠️ **Not built this pass** — see §5 flag 1. |
| Building visualization / stage focus | FloorTimeline (dot nodes, filled wires) + UnitStrip. Illustration does not return. | ✅ |
| Task detail (states, assignee, location, trade, duration, updates) | `TaskDetailContent` — derived status line, Not started/In progress/Done segmented, kv rows, duration stepper, note input. **"Blocked" is never hand-set** — it is derived from a live problem link and evaporates when that problem closes (pinned by test). | ✅ |
| Follow-up Rules page | Top-bar gear → `/desk/settings/chasing`, mounting the **existing page unchanged**. | ✅ |

---

## 3. Conflicts found, and how they were resolved

Per the brief's precedence (prototype wins on visuals · ledger wins on features · ask only where precedence doesn't settle).

**Settled by the prototype:**
- **The snag model.** `docs/SITE_DESK_INTEGRATION_MAP.md` §2 flagged a blocking contradiction: the pipeline writes snags as `problems.kind='snag'`, while the portal calls the `todos` table "snags". The prototype settles it — its snags carry `loc`, photos, an owner, a chase clock and a close-requires-photo floor, none of which `todos` has or ever will. **`problems.kind ∈ (issue, snag)` is canonical**; the portal's "snags = todos" labelling is what's wrong. Migration path stays additive.
- **Green is not "resolved only".** The prototype's own CSS comment says so, but its CSS uses green for the live dot, done floors, `Up next` and unit bars. The CSS won.
- **`--paper` does not exist** (fidelity rule 1 lists it). The real tokens are `--bg` / `--surface`.
- **The prototype's brand + "CK" avatar** duplicate the app's chrome — dropped. Site Desk contributes the scope picker, tabs and gear; the app keeps its own topbar.

**Answered by you (2026-07-12):**
1. **Refs cover tasks too, from ONE shared per-site counter.** The prototype's own data proves it: DSR problems are 18/19/21/22 and DSR tasks are 28–38 — one number space, no collisions across any of the four sites. The integration map had only planned refs for `problems`; that was a miss. `next_site_ref(project)` must serve both, and `site_tasks.ref` joins `problems.ref`.
2. **Motion: no new dependency.** The brief said "AnimatePresence/`layout`, not timeouts". framer-motion would add ~50KB and a second motion idiom for no gain — the prototype's beauty is its curves, which copy exactly into CSS. The *intent* ("don't guess with magic numbers") is honoured by keying off real `animationend` events (`useRowClose`), which is stricter than a timeout. Timings are the prototype's to the millisecond: close 260ms, open 300ms, flash 1s, live-ring 2.4s, sheet 280ms, toast 4.5s/2.2s.
3. **Chase copy is honest.** The cron is `30 3 * * *` — **daily, 09:00 IST**. "Babai chases again at 6 pm" would state something the backend does not do. Three strings changed, each marked `HONEST-COPY` in `mock.ts`: `"…at 6 pm"` → `"…tomorrow morning"`, and DSR-22's `"If no photo by evening"` → `"If no photo, Babai asks again tomorrow"`. When the cadence goes sub-daily the copy upgrades for free.
4. **Gear placement.** Left-of-scope on desktop (as specified); **right-of-avatar below 600px**, where a long project name ("Dr Sonudharya Residence") would collide with it. This was the pre-authorized flag in your brief; taking your fallback.

---

## 4. Deviations from the prototype (with reason)

| # | Deviation | Reason |
|---|---|---|
| 1 | `"1 tasks · starts later"` → **`"1 task"`** | The prototype hard-codes `${n} tasks`. A plural bug is a defect, not a design decision. |
| 2 | Opening an item **keeps the current scope** | The prototype's `gotoRef` is only used for cross-links. Building it as "navigate to the item's site" made reading DSR-21 from "All projects" silently narrow the list to DSR. Caught on the live screen; the detail URL now preserves scope. An explicit cross-link (badge tap, `Blocked by {REF}`) still switches site — that is its job. |
| 3 | The open item is **the URL**, not state | The prototype keeps `openId` in a variable. Deriving it from `/desk/:site/problems/:ref` means a deep link, the back button and a row click cannot disagree with the address bar. |
| 4 | Task detail's floor | The prototype hard-codes `· Ground floor` in the task eyebrow (line 1426) regardless of the task. Uses the real floor, blank when unknown. |
| 5 | Story/guide markup | The prototype builds HTML strings. Here `{REF}` markers are parsed into real React link nodes (`splitRefs`) — no `innerHTML` for anything ref-bearing. `guide` is still `dangerouslySetInnerHTML` (it carries authored `<b>`); when it becomes a server read-model (map X4) it should return structured parts instead. |
| 6 | Swipe uses **pointer** events | The prototype uses touch events. Pointer events cover stylus/trackpad, and `touch-action: pan-y` (which the brief asked for and the prototype lacked) keeps vertical scrolling from being stolen. Behaviour is identical: partial reveal, cap 110px with resistance, hold at 96px past 72px, click suppressed after movement. |

---

## 5. Open flags

1. **"Assign lead" was not built.** The brief puts it in the "Plan header overflow menu", but the prototype has no plan-header overflow menu to put it in, and no visual for one. I did not invent a menu. Needs a decision: add an overflow menu to the plan head, or fold it into the task sheet's assignee row.
2. **Mobile acceptance is UNVERIFIED at 380px.** I drove the real UI at 1280px (screenshots taken, master-detail panel, floor timeline, flat strip and rollup all confirmed). The browser window would not yield a true mobile viewport (`innerWidth` stayed 1536 through repeated resizes), so **I did not verify the bottom sheet, the swipe gesture, or the gear reposition on a real small screen.** The CSS rules are present and correct by inspection (`.panel{display:none}` <920, `.gear-mobile{display:flex}` <600, `touch-action:pan-y` confirmed live on the row), but that is not the same as seeing it. **Please resize your own browser to 380px and check those three things**, or tell me and I'll drive it another way.
3. **Dry Run badge — nothing was gated on it.** Removing it left no state invisible, so no compensating UI was added.
4. **Auth blocks in-app verification.** `/desk/*` sits behind the login gate, so the screens above were driven through a temporary preview harness mounting the same components with the same mock (deleted after — `desk-preview.html`, `src/desk-preview.tsx` are gone; `git status` is clean of them). The components are identical; only the auth wrapper differed.

---

## 6. Mock → live swap list

Every call below lives behind `DeskApi` (`src/lib/desk/api.ts`). Replacing `useDeskApi`'s body with a live adapter changes **no component**.

| DeskApi call | Becomes | Map section |
|---|---|---|
| `sites` | `projects` (+ derived plan % / focus) | §3 S3, W1 |
| `problems` | `problems` where `kind IN (issue,snag)` + `problems.ref` | §3 P1, P2 |
| `problems[].status` | the X4 read-model status sentence | §3 X4 |
| `problems[].loc` | `problems.floor_label` / `unit_label` (**new columns**) | §4 migration 2 |
| `problems[].story` | `followup_events` + inbound `reply_received` | §3 P5, X2 |
| `problems[].photos` | `attachments` (`role: creation \| answer`), signed at read | §3 P5, P8 |
| `pending` | `siteops_unplaced` | §3 (Pending segment) |
| `planFor()` | the engine VM (`buildProjectVM`) via `siteops-generate` | §3 W1, W2 |
| `close()` / `undo()` / `reopen()` | `problem_resolutions` (**new table**) + `followup_events.reopened` | §4 migration 3 |
| `say()` | `POST /siteops-say` — ref-stamped, 24h-window aware | §6 |
| `nudge()` | `POST /siteops-nudge` | §6 |
| `approve()` | approval-kind notify | §5 step 10 |
| `place()` / `dismissPending()` | `siteops_unplaced` placement | §3 |
| `patchTask()` | `site_tasks` update | §5 step 9 |
| `reorder()` | `POST /siteops-reorder` (real `Evaluator.checkMove`) | §6, W5 |

**The one that must not be fudged:** `canClose()` in `derive.ts` enforces the snag photo floor in the UI. When the backend lands, the **same floor must be enforced server-side and in the WhatsApp auto-close ladder** — a floor enforced in one door is not a floor. Map §5 step 6, §7.

---

## 7. Invariants pinned (red-first, `npm run test:desk`)

- Waiting-on-owner outranks **any** age of a Babai-managed item; category bump (seepage/electrical/safety) lifts within a state; age is only the tiebreak; severity is deterministic (no clock, no model).
- Age turns red only at 3+ days **and only when it needs him**.
- Task status is derived: `Blocked by {ref}` comes from a live link and **evaporates when that problem closes**; a done predecessor unlocks; a block outranks a dependency.
- Groups fold only when nothing in them can start.
- The across-flats rollup counts only flats that **have** the activity (`Tiling 1/3`, not `1/4`).
- **Snag close requires a fix photo** for outcome `Fixed` — and only for a verified fix (`Not a problem` closes without one). An issue never needs one.
- **Undo restores the exact prior state** (status, story length, resolution).
- **Reopen keeps the resolution on file** — closing is a fact, not an eraser.
- Refs split into real link nodes, never innerHTML.
