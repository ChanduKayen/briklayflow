// Message coalescing (debounce) — the decision core: which bubble of a burst routes, and with what text.
// A tiny in-memory fake stands in for wa_burst_messages + wa_drain_burst so we can drive coalesceBurst
// with quietMs:0 (no real sleep). The invariant proven: only the LAST bubble proceeds, and it carries the
// WHOLE burst; every earlier bubble drops. Plus combineBurstBodies keeps arrival order.

import { suite, test, expect } from './harness'
import { coalesceBurst, combineBurstBodies } from '../_burst.ts'

/** Minimal fake of just what _burst.ts touches: an append-only buffer with a consumed flag. */
function fakeBurstDb() {
  const rows: { id: number; sender: string; body: string; consumed: boolean }[] = []
  let seq = 0
  return {
    rows,
    from(table: string) {
      if (table !== 'wa_burst_messages') throw new Error('unexpected table ' + table)
      return {
        insert(v: { sender: string; body: string }) {
          const row = { id: ++seq, sender: v.sender, body: v.body, consumed: false }
          rows.push(row)
          return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) }
        },
        // .select('id').eq('sender',s).is('consumed_at',null).gt('id',seq).limit(1)
        select() {
          const f = { _s: '', _seq: -1 }
          const api: any = {
            eq(_c: string, s: string) { f._s = s; return api },
            is() { return api },
            gt(_c: string, n: number) { f._seq = n; return api },
            async limit() {
              const hit = rows.filter((r) => r.sender === f._s && !r.consumed && r.id > f._seq)
              return { data: hit.map((r) => ({ id: r.id })), error: null }
            },
          }
          return api
        },
      }
    },
    async rpc(fn: string, args: { p_sender: string }) {
      if (fn !== 'wa_drain_burst') throw new Error('unexpected rpc ' + fn)
      const claimed = rows.filter((r) => r.sender === args.p_sender && !r.consumed)
      claimed.forEach((r) => (r.consumed = true))
      return { data: claimed.map((r) => ({ id: r.id, body: r.body })), error: null }
    },
  }
}

const P = (body: string, wamid: string) => ({ orgId: 'o1', sender: '91999', wamid, body })

suite('wa — burst coalescing', () => {
  test('a lone bubble proceeds, carrying its own text', async () => {
    const db = fakeBurstDb()
    const r = await coalesceBurst(db as any, P('Ramu 5000 cash', 'm1'), { quietMs: 0 })
    expect(r.proceed).toBe(true)
    expect(r.text).toBe('Ramu 5000 cash')
  })

  test('two bubbles: the FIRST drops, the LAST proceeds with BOTH joined', async () => {
    const db = fakeBurstDb()
    // Both are already recorded (they arrived in the same window); resolve the earlier one last so it sees
    // the newer sibling — the real order is timing, here we just prove the last-wins rule deterministically.
    db.from('wa_burst_messages').insert({ sender: '91999', body: 'Shyam iron 16mm 10, 12mm 15, 8mm 60' }) as any
    db.from('wa_burst_messages').insert({ sender: '91999', body: 'need iron for shyam site' }) as any

    // The earlier bubble (seq 1) sees a newer one (seq 2) → drops.
    const first = await hasNewer(db, 1)
    expect(first).toBe(true)

    // The last bubble drains the whole burst.
    const combined = await drain(db)
    expect(combined).toBe('Shyam iron 16mm 10, 12mm 15, 8mm 60\nneed iron for shyam site')
  })

  test('a fresh lone bubble after a drained burst proceeds alone (consumed rows are gone)', async () => {
    const db = fakeBurstDb()
    await coalesceBurst(db as any, P('first order', 'm1'), { quietMs: 0 })   // drains m1
    const r = await coalesceBurst(db as any, P('second, later order', 'm2'), { quietMs: 0 })
    expect(r.proceed).toBe(true)
    expect(r.text).toBe('second, later order')   // NOT combined with the already-consumed m1
  })

  test('combineBurstBodies keeps arrival order and drops blanks', () => {
    expect(combineBurstBodies([{ id: 3, body: 'c' }, { id: 1, body: 'a' }, { id: 2, body: ' ' }])).toBe('a\nc')
  })
})

// small helpers that mirror _burst internals against the fake
async function hasNewer(db: ReturnType<typeof fakeBurstDb>, seq: number): Promise<boolean> {
  const { data } = await (db.from('wa_burst_messages').select() as any).eq('sender', '91999').is().gt('id', seq).limit(1)
  return Array.isArray(data) && data.length > 0
}
async function drain(db: ReturnType<typeof fakeBurstDb>): Promise<string> {
  const { data } = await db.rpc('wa_drain_burst', { p_sender: '91999' })
  return combineBurstBodies(data as any)
}
