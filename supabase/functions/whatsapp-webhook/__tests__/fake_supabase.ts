// JOURNEY-TEST HARNESS — a fake supabase client good enough to drive a real webhook agent
// (runSiteops et al.) end-to-end, so a test can pin that a decision is not just CORRECT in isolation
// but REACHED by the wiring above it. Born from the empty-decompose regression: a pure gate can be
// green while the integration is broken (the terse-ack shortcut passed purely yet never fired in prod).
//
// It is deliberately minimal — a chainable query builder that (a) returns SEEDED rows for selects and
// (b) RECORDS every insert/update/upsert for assertions. No real filtering engine: seed exactly the
// rows each table should yield; problems/todos are keyed by id and resolved from the .eq('id', …) /
// .eq('task_id', …) filter. Unknown tables degrade to empty selects / recorded writes so an agent can
// traverse an unanticipated call without crashing (capture-first: never fail the journey on a stray read).
//
// Reused across journeys — extend datasetFor/insertReturnFor here rather than per-test.
//
// CHECK ENFORCEMENT (Phase 0 go-order step 2, a GATE): every write is judged against the database's enum
// CHECK constraints, PARSED FROM THE MIGRATION FILES (check_constraints.ts — never hand-copied). A write
// that violates a CHECK returns { error: { code: '23514' } } and is NOT recorded — prod truth, not
// recorder truth. Both landmines (v2 park reasons, bare_ack) were prod-CHECK-rejected while this fake
// recorded them green; that class is now structurally impossible to miss offline.
//
// COLUMN ENFORCEMENT (2026-07-09, the todos.title landmine): every select() is judged against the columns
// the table actually HAS, parsed from the same migrations (table_columns.ts). Naming a column the database
// does not have returns { error: { code: '42703' } } and NO rows — exactly as PostgREST does. Before this,
// the fake ignored the select() column list entirely and simply handed back the seeded rows, so
// buildCandidateSet's `todos.title` (the column is `text`) read as "this org has no to-dos" in prod while
// 332 tests stayed green — the fixtures had been seeded in the BUG's shape. A double that answers a question
// the database would refuse is not a test double; it is a second implementation with its own schema.

import { loadEnumChecks, checkViolation, type TableChecks } from './check_constraints'
import { loadTableColumns, unknownColumns, type TableColumns } from './table_columns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export interface Seed {
  chase_batches?: Row[]
  projects?: Row[]
  problems?: Record<string, Row>            // id → row (resolved from .eq('id', …))
  todos?: Record<string, Row>               // id → row (resolved from .eq('id', …))
  site_tasks?: Record<string, Row>          // task_id → row
  site_task_qc?: Row[]                      // the authored QC checks fanned onto a task (matchQc reads these)
  wa_registered_numbers?: Row[]
  user_profiles?: Row[]
  cause_taxonomy?: Row[]
  follow_up_rules?: Row[]
  wa_message_map?: Row[]                     // outbound_wamid → object_refs (4a spine; undo resolves via this)
  wa_conversations?: Row[]                   // T1 sweeper journeys: OPEN convos the sweep selects
  wa_message_log?: Row[]                     // the conversation history the router reads (newest-first, as the real query returns)
  site_narration_id?: string                // id returned by the capture-first insert().select('id').single()
  site_narrations?: Row[]                    // narrations ALREADY captured (the duplicate-narration guard reads these)
}

export interface Write { table: string; op: 'insert' | 'update' | 'upsert'; payload: Row; filters: [string, unknown][] }

export interface FakeSupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
  writes: Write[]
  /** every outbound message body enqueued via send() (outbox.payload = the OutMessage). */
  outbox: () => string[]
  /** followup_events (chase trail) rows written, for "did the batch handler touch this item?" asserts. */
  trail: () => Row[]
  /** writes to a given table. */
  writesTo: (table: string) => Write[]
}

function eqVal(filters: [string, unknown][], key: string): unknown {
  const f = filters.find(([k]) => k === key)
  return f ? f[1] : undefined
}

function datasetFor(table: string, filters: [string, unknown][], seed: Seed): Row[] {
  switch (table) {
    case 'chase_batches':         return seed.chase_batches ?? []
    case 'projects':              return seed.projects ?? []
    case 'cause_taxonomy':        return seed.cause_taxonomy ?? []
    case 'follow_up_rules':       return seed.follow_up_rules ?? []
    case 'wa_registered_numbers': return seed.wa_registered_numbers ?? []
    case 'wa_message_map': {
      const w = eqVal(filters, 'outbound_wamid')
      const c = eqVal(filters, 'convo_id')
      return (seed.wa_message_map ?? [])
        .filter((r) => w === undefined || r.outbound_wamid === w)
        .filter((r) => c === undefined || r.convo_id === c)
    }
    // T1 sweeper: ALL eq filters applied generically — the sweep's owning_agent/status selection and the
    // close/abandon helpers' org+sender+status lookups must discriminate (j2/j3 depend on it).
    case 'wa_conversations': {
      let rows = seed.wa_conversations ?? []
      for (const [k, v] of filters) rows = rows.filter((r) => r[k] === v)
      return rows
    }
    // history: eq filters applied; .gte/.order/.limit are no-ops here, so seed rows in the order the real
    // query returns them (created_at DESC). loadHistory's own JS filtering + reversal is what's under test.
    case 'wa_message_log': {
      let rows = seed.wa_message_log ?? []
      for (const [k, v] of filters) rows = rows.filter((r) => r[k] === v)
      return rows
    }
    // the duplicate-narration guard reads the org's recent narrations (eq org_id; .order/.limit are no-ops
    // here, and the 30-minute window + text comparison are done in JS by the guard itself — which is exactly
    // what this dataset must let it do).
    case 'site_narrations': {
      let rows = seed.site_narrations ?? []
      for (const [k, v] of filters) rows = rows.filter((r) => r[k] === v)
      return rows
    }
    case 'user_profiles': {
      const id = eqVal(filters, 'id')
      const row = (seed.user_profiles ?? []).find((r) => r.id === id) ?? (seed.user_profiles ?? [])[0]
      return row ? [row] : []
    }
    // problems/todos/site_tasks: keyed by id when filtered (.eq('id'|'task_id')); else the whole
    // collection (a list select — buildCandidateSet loads by org/project, no id filter).
    case 'problems': {
      const id = eqVal(filters, 'id')
      if (id !== undefined) { const row = seed.problems?.[id as string]; return row ? [row] : [] }
      return Object.values(seed.problems ?? {})
    }
    case 'todos': {
      const id = eqVal(filters, 'id')
      if (id !== undefined) { const row = seed.todos?.[id as string]; return row ? [row] : [] }
      return Object.values(seed.todos ?? {})
    }
    case 'site_tasks': {
      const id = eqVal(filters, 'task_id')
      if (id !== undefined) { const row = seed.site_tasks?.[id as string]; return row ? [row] : [] }
      return Object.values(seed.site_tasks ?? {})
    }
    case 'site_task_qc': {
      const t = eqVal(filters, 'task_id')
      return (seed.site_task_qc ?? []).filter((r) => t === undefined || r.task_id === t)
    }
    default:                      return []   // write-target / unseeded tables select empty
  }
}

function insertReturnFor(table: string, seed: Seed): Row {
  if (table === 'site_narrations') return { id: seed.site_narration_id ?? 'narr-1' }
  return { id: `${table}-1` }
}

// Parsed once per process (the migrations don't change under a running gate).
let DEFAULT_CHECKS: TableChecks | null = null
const defaultChecks = (): TableChecks => (DEFAULT_CHECKS ??= loadEnumChecks())
let DEFAULT_COLUMNS: TableColumns | null = null
const defaultColumns = (): TableColumns => (DEFAULT_COLUMNS ??= loadTableColumns())

export interface FakeOpts {
  /** Override the enum-CHECK set (default: parsed from ALL migrations). Tests pin a HISTORICAL constraint
   *  via loadEnumChecks({ before: '<stamp>' }) to prove a landmine was real — the pre-fix insert must FAIL
   *  in the fake exactly as it failed in prod. */
  checks?: TableChecks
  /** Override the column set (default: parsed from ALL migrations). Same historical-pinning trick via
   *  loadTableColumns({ before: '<stamp>' }). */
  columns?: TableColumns
}

export function fakeSupabase(seed: Seed = {}, opts: FakeOpts = {}): FakeSupabase {
  const writes: Write[] = []
  const checks = opts.checks ?? defaultChecks()
  const columns = opts.columns ?? defaultColumns()

  function builder(table: string) {
    const filters: [string, unknown][] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row = null
    let single = false
    let selectArg: string | undefined

    const resolve = (): { data: Row; error: { code: string; message: string } | null } => {
      // COLUMN enforcement — a select() naming a column the table does not have is 42703 in postgres and
      // yields NO rows. It must do so here too, whatever the seed holds (the todos.title landmine).
      const missing = unknownColumns(columns, table, selectArg)
      if (missing.length) {
        return { data: null, error: { code: '42703', message: `column ${table}.${missing[0]} does not exist` } }
      }
      if (op === 'select') {
        const rows = datasetFor(table, filters, seed)
        return { data: single ? (rows[0] ?? null) : rows, error: null }
      }
      // CHECK enforcement — a violating row is REJECTED (error returned, write not recorded), like postgres.
      for (const row of Array.isArray(payload) ? payload : [payload]) {
        const v = row && checkViolation(checks, table, row)
        if (v) return { data: null, error: { code: '23514', message: `new row for relation "${table}" violates check constraint "${v.name}"` } }
      }
      writes.push({ table, op, payload, filters })
      // insert().select('…').single() returns a row (e.g. the new narration id); bare writes return null.
      return { data: single ? insertReturnFor(table, seed) : null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: (cols?: string) => { selectArg = cols; return api },
      insert: (p: Row) => { op = 'insert'; payload = p; return api },
      update: (p: Row) => { op = 'update'; payload = p; return api },
      upsert: (p: Row) => { op = 'upsert'; payload = p; return api },
      delete: () => { op = 'update'; payload = null; return api },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return api },
      neq: () => api,
      in: () => api,
      is: () => api,
      not: () => api,
      gte: () => api,
      lte: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      maybeSingle: () => { single = true; return api },
      single: () => { single = true; return api },
      // thenable — `await supabase.from(t).select().eq(...)` resolves here, as does the .single() form.
      then: (res: (v: { data: Row; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(res, rej),
    }
    return api
  }

  return {
    from: builder,
    writes,
    outbox: () => writes.filter((w) => w.table === 'outbox').map((w) => w.payload?.payload?.body ?? ''),
    trail: () => writes.filter((w) => w.table === 'followup_events').map((w) => w.payload),
    writesTo: (table: string) => writes.filter((w) => w.table === table),
  }
}
