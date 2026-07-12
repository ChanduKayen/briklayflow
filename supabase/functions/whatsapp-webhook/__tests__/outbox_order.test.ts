// OUTBOX DELIVERY ORDER (2026-07-11). A turn's messages must arrive in the order we said them.
//
// Live, one turn enqueued: receipt-ack, promise-to-return, reply, re-surfaced-question — and the supervisor
// received ack, question, promise, reply. The re-surfaced question overtook the reply it was supposed to
// follow, and the promise to come back arrived after we had come back.
//
// The dispatcher's ordering was right; DELIVERY was not. outbox_claim ordered by next_attempt_at (every
// message in a turn shares the same default, so they all tie) and returned rows through UPDATE … RETURNING,
// which has no guaranteed order in Postgres — the ORDER BY inside picks WHICH rows are claimed, not the
// order they come back in.
//
// The SQL cannot run in this harness, so this guards its two load-bearing properties (and the drainer's
// belt) against a silent regression.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { suite, test, expect } from './harness'
import { loadTableColumns } from './table_columns'

const file = (...p: string[]) => readFileSync(join(process.cwd(), 'supabase', ...p), 'utf8')
// the SQL that RUNS — the header comment quotes the old, broken `ORDER BY next_attempt_at` on purpose
const claim = file('migrations', '20260711000001_outbox_stable_order.sql')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const drainer = file('functions', 'wa-outbox-drainer', 'index.ts')

suite('outbox — the queue is a queue (stable FIFO claim)', () => {
  test('(O1) outbox has a monotonic seq — created_at ties and the id is a random uuid', () => {
    const cols = loadTableColumns().get('outbox')
    expect(cols?.has('seq')).toBe(true)
  })

  test('(O2) the claim ORDERS BY seq — and does so OUTSIDE the UPDATE, where the order survives', () => {
    // the RETURNING is wrapped in a CTE and ordered on the way out; that final ORDER BY is what makes it FIFO
    expect(/WITH claimed AS \(/i.test(claim)).toBe(true)
    expect(/SELECT \* FROM claimed\s+ORDER BY seq/i.test(claim)).toBe(true)
    // …and the working set is picked oldest-first, not by the tied next_attempt_at
    expect(/ORDER BY p\.seq/i.test(claim)).toBe(true)
    expect(/ORDER BY next_attempt_at/i.test(claim)).toBe(false)
  })

  test('(O3) HEAD OF LINE per recipient — a retrying or in-flight message is never overtaken', () => {
    expect(/NOT EXISTS/i.test(claim)).toBe(true)
    expect(/q\.target = p\.target/i.test(claim)).toBe(true)
    expect(/q\.seq < p\.seq/i.test(claim)).toBe(true)
    expect(/q\.status = 'SENDING'/i.test(claim)).toBe(true)
    expect(/q\.next_attempt_at > now\(\)/i.test(claim)).toBe(true)     // …still backing off after a failure
  })

  test('(O4) two overlapping drainer ticks cannot interleave one recipient\'s messages', () => {
    expect(/pg_advisory_xact_lock/i.test(claim)).toBe(true)
  })

  test('(O5) the drainer POSTs in seq order (the belt) and one at a time', () => {
    expect(/\.sort\(\(a, b\) =>/.test(drainer)).toBe(true)
    expect(/Number\(a\.seq/.test(drainer)).toBe(true)
    expect(/for \(const row of ordered\)/.test(drainer)).toBe(true)    // sequential — never Promise.all
  })
})
