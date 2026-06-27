# Site Ops — Block A (decompose → resolve → route)

WhatsApp/UI site narration: decompose a supervisor's note into atomic typed items, resolve
the project, route each item to task progress / problem / todo, and confirm. This note covers
the hardening pass (looser project matching + decompose edge rules).

## Apply / deploy
1. SQL editor, in order: `20260626000000_siteops_tasks_realtime.sql`,
   `20260626000001_site_task_comments.sql`, `20260626000002_site_tasks_duration.sql`,
   `20260626000003_siteops_block_a.sql`, `20260626000004_siteops_ownership.sql`.
2. Redeploy `whatsapp-webhook`, `siteops-enrich`, `siteops-narrate`.
3. Keys: `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) must be set for decompose / QC match.
4. Optional tuning: `WA_SITEOPS_MODEL`, `WA_SITEOPS_MODEL_ANTHROPIC`,
   `TXN_PROJECT_AUTO_THRESHOLD` (project auto-match floor, default 0.82).

## Verify
- **Live project-resolution round-trip (do this first):** with ≥2 active projects, send a
  narration that NAMES a project and confirm it resolves WITHOUT a "which project?" prompt
  across all four name forms:
  - exact stored name,
  - partial / distinctive token only (e.g. "Lakshmi" → "Sri Lakshmi Residence"),
  - name with filler words ("Lakshmi villa" → "Lakshmi Villa Project"),
  - different case / punctuation ("LAKSHMI-001").
  Then the two negative paths:
  - an unmatchable name → asks **"I couldn't find a project called 'X'…"** (not a blank
    "which project?"), and the picked project routes the stored items.
  - a name shared by two buildings → asks **"You said 'X' — a few projects match. Which one?"**
    listing only the matches; the numeric reply maps to the shown row.
- **Decompose edges:** "2nd floor slab not done yet, ground floor plastering finished" →
  ONE progress item (no false "slab done"); "2nd and 3rd floor slabs done" → TWO progress
  items; a no-content message → empty extraction → the soft "didn't catch a site update,
  try again if you meant to send one" reply (raw narration still captured, nothing routed).
