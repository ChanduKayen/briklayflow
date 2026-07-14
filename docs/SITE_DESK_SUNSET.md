# Site Desk — live wiring, and what still blocks the sunset

**Date:** 2026-07-12
**State:** Site Desk reads and writes **real data**. It is **not yet a replacement** for Site Management. This document says exactly what is wired, what is not, and what must be true before `/tasks`, `/site-desk` and `/follow-up-rules` can be removed.

---

## 0. DO THIS FIRST — two migrations, by hand, in order

Nothing below works until these are applied (you run migrations in the Supabase SQL editor):

1. `supabase/migrations/20260712000000_site_desk_refs.sql`
2. `supabase/migrations/20260712000001_site_desk_fields.sql`

Until then the desk shows an honest banner ("Site Desk needs its two migrations applied first") rather than a blank screen.

**What #1 does — and why the trigger matters.** It creates a per-site counter, an atomic allocator (`next_site_ref`), a `ref` column on **both** `problems` and `site_tasks` sharing **one number space per site** (DSR-21 is an issue, DSR-30 a task, never a collision), a backfill in creation order, and a **BEFORE INSERT trigger on both tables**. The trigger is the important part: the WhatsApp pipeline creates problems from six different call sites, and a trigger means **every one of them keeps working with zero edge-function changes**, and no future call site can forget to ask for a number.

**Backfill safety.** It only touches rows where `ref IS NULL`, so running it twice changes nothing and can never renumber. Refs are forever — that rule is enforced here or nowhere.

⚠️ **Pre-flight:** the allocator raises if a project has no `project_code`. Per the integration map, the `NOT NULL`/`UNIQUE` constraints on `projects.project_code` (step "1f" of `20260518000005`) **may never have been applied in production**. Check that every project has a code before running #1, or the backfill will skip those projects and their items will have no ref.

---

## 1. What is now LIVE (real rows, real writes)

| Feature | Source |
|---|---|
| Problems list (issue + snag, one list, one ref space) | `problems` where `project_id` is set, joined to `projects.project_code` |
| **The item's state** (`you` / `chasing` / `moving` / `resolved`) | **Derived** in `fromDb.ts` from `status` + the `followup_events` trail. Not stored, not guessed, not a model's opinion. See §2. |
| The status sentence | Composed in code from facts (`statusLine`). Names the person, the silence, the chase count, the real next-chase time. |
| Severity sort, age reddening | `derive.ts`, unchanged — now fed by real data |
| Story timeline (events, chases, **inbound WhatsApp replies as bubbles**, private notes) | `followup_events` → `buildStory` |
| Photo strip, real images | `attachments` (`parent_type='problem'`), **signed at read time** — the bucket is private and no durable URL is ever stored |
| "photo pending — Babai asking" | a snag with no attachment that has a live chase clock |
| Auto-close proposal ("Confirm & close" + prefilled note) | an `answer`-role attachment on a moving item |
| Sorted view + resolution record | new `problem_resolutions` table |
| **Close / Undo / Reopen** | real writes. **Reopen stamps `reopened_at` and KEEPS the row** — closing is a fact, not an eraser. **Undo deletes the resolution it just wrote** (an undo means the close never should have happened; a reopen means it did). |
| Add note | `followup_events` (`type='comment'`) |
| Pending queue | `siteops_unplaced` (status `unplaced`); Dismiss is wired |
| Work Plan (floors, %, flats, task groups, rollup) | `site_tasks` — floors from `floor_label` in `seq_no` order, focus = lowest unfinished floor, units from `unit_label` |
| `After {task}` | the **engine's own `binding`** (node_key → ref). The UI never invents a dependency. |
| Task edits (Not started / In progress / Done, duration) | real writes, incl. `started_at` for "day 3 of 4" |
| "Ask again now" | **truthful**: moves `next_followup_at` to now. The cron is daily, so the toast says "Babai chases on the next run" — it does **not** claim a message just went out. |

**The honesty rule, enforced in code.** Three actions have no endpoint yet (owner-voice composer, approve-notifies-owner, placing a pending capture). They throw `DeskUnsupported` and the UI shows the reason. **They never toast a success they did not achieve.** A "Sent on WhatsApp" when nothing was sent is the one unforgivable lie in this product.

---

## 2. The state derivation (the most consequential line of code here)

```
RESOLVED / DISMISSED   → resolved
escalated (any trail)  → you          ← ran out of people to chase
ADDRESSING             → moving
next_followup_at set   → chasing
otherwise              → you          ← THE DEFAULT
```

**The default is `you`, deliberately.** An open item that nobody is chasing is not "fine" — it is a thing no one is doing anything about, and colouring it grey would hide exactly what the founder opened the app to find. Pinned by test.

---

## 3. What BLOCKS the sunset

### 3a. ~~Two columns with nothing writing to them~~ — DONE (2026-07-12)

**Location — now persisted.** `createProblem` writes `floor_label` / `unit_label` from the structure slot the capture already computed (decompose and the vision pass both emit one; it was the task pin's only input and simply never travelled as far as the row). When an item names no place but is attached to a task, it **inherits the task's** floor/unit — an issue found on "Wiring — Fourth floor" is on the fourth floor, and "Project-wide" would be a worse answer than the truth. Beyond that, **no guess**: null, and the portal asks. Pinned by `__tests__/problem_place.test.ts` (3 tests, red-first).

**Blocked-by — derived, and the column is GONE.** The first draft of migration #2 added `site_tasks.blocked_by_problem_id`. That was wrong. `problems.task_id` **already is** the blocked task — the timing engine tempers the chase clock against "the blocked task's schedule" (`computeBlockedTaskEnd`). So a task is blocked by exactly the OPEN issues pointing at it, and `blockersByTask()` is that reverse index (oldest issue named; a snag never blocks — it is rework on work already done).

Deriving it buys three things a stored edge cannot: no write path that can be forgotten, no flag that can go stale, and **the block ceases to exist the moment the problem closes** — because there was never anything to clean up. Pinned by test.

Migration #2 now ships a partial index (`problems_blocking_task_idx`) instead of a redundant column.

### 3b. Site Management does things Site Desk cannot do at all

| Old page | What it does that Site Desk lacks |
|---|---|
| `/tasks` → `ConstructionConfig` | **Creates the plan.** Captures the building (stack, floors, units) and runs the engine to generate the tasks. Site Desk *reads* a plan; it cannot bring one into existence. **This alone blocks the sunset.** |
| `/tasks` → task detail | **QC checks** (`site_task_qc`, 3 per task, the critical-check gate) and **task comments** (`site_task_comments`). Site Desk's task sheet has neither. |
| `/tasks` | **Assign lead / owner** (`UserPicker`). Site Desk shows the assignee read-only. (This is also the un-homed "Assign lead" from the UI brief.) |
| `/site-desk` (old) → `UnplacedQueue` | **Placing** a captured item (choosing its home). Site Desk's Pending segment can Dismiss but not Place. |
| `/projects/:id/issues` `?view=todos` | **To-dos have no home in Site Desk.** Under the ruling that `problems.kind` is canonical, `todos` is a third kind (lightweight action items) and needs either a segment or a decision to drop it. |
| `/follow-up-rules` | ✅ Already covered — mounted unchanged behind the gear. |

### 3c. Still unwired (map §6)

- `POST /siteops-say` — the owner-voice composer (the desktop primary action).
- `POST /siteops-nudge` — a real immediate chase (today's nudge only moves the clock).
- `POST /siteops-reorder` — server-validated drag (`Evaluator.checkMove` exists and is pure; only the transport is missing).
- Approve-notifies-owner.

---

## 4. Suggested order to actually reach the sunset

1. **Apply the two migrations.** Check `project_code` first. ← **the only thing standing between you and a working desk**
2. ~~Persist the structure slot~~ **DONE** — snag locations and unit badges are live.
3. ~~Link blockers~~ **DONE** — derived; "Blocked by {ref}" is live.
4. **Move `ConstructionConfig` into Site Desk** (or give Site Desk a "set up this building" entry point). Without it, `/tasks` cannot be removed.
5. **QC checks + comments + owner assignment** into the task sheet.
6. **Placement UI** for the Pending segment.
7. `/siteops-say`, `/siteops-nudge`, `/siteops-reorder`.
8. Decide what happens to **to-dos**.
9. Only then: remove the old routes and nav entries.

Steps 1–3 are what make the *data* honest. Steps 4–6 are what make the old pages *redundant*. They are different problems, and only the second one is a sunset.
