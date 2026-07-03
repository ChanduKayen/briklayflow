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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export interface Seed {
  chase_batches?: Row[]
  projects?: Row[]
  problems?: Record<string, Row>            // id → row (resolved from .eq('id', …))
  todos?: Record<string, Row>               // id → row (resolved from .eq('id', …))
  site_tasks?: Record<string, Row>          // task_id → row
  wa_registered_numbers?: Row[]
  user_profiles?: Row[]
  cause_taxonomy?: Row[]
  follow_up_rules?: Row[]
  site_narration_id?: string                // id returned by the capture-first insert().select('id').single()
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
    case 'user_profiles': {
      const id = eqVal(filters, 'id')
      const row = (seed.user_profiles ?? []).find((r) => r.id === id) ?? (seed.user_profiles ?? [])[0]
      return row ? [row] : []
    }
    case 'problems': {
      const id = eqVal(filters, 'id')
      const row = seed.problems?.[id as string]
      return row ? [row] : []
    }
    case 'todos': {
      const id = eqVal(filters, 'id')
      const row = seed.todos?.[id as string]
      return row ? [row] : []
    }
    case 'site_tasks': {
      const id = eqVal(filters, 'task_id')
      const row = seed.site_tasks?.[id as string]
      return row ? [row] : []
    }
    default:                      return []   // write-target / unseeded tables select empty
  }
}

function insertReturnFor(table: string, seed: Seed): Row {
  if (table === 'site_narrations') return { id: seed.site_narration_id ?? 'narr-1' }
  return { id: `${table}-1` }
}

export function fakeSupabase(seed: Seed = {}): FakeSupabase {
  const writes: Write[] = []

  function builder(table: string) {
    const filters: [string, unknown][] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: Row = null
    let single = false

    const resolve = (): { data: Row; error: null } => {
      if (op === 'select') {
        const rows = datasetFor(table, filters, seed)
        return { data: single ? (rows[0] ?? null) : rows, error: null }
      }
      writes.push({ table, op, payload, filters })
      // insert().select('…').single() returns a row (e.g. the new narration id); bare writes return null.
      return { data: single ? insertReturnFor(table, seed) : null, error: null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select: () => api,
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
