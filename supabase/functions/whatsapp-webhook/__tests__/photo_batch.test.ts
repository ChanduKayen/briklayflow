// Photo batch (debounce a burst of images) — the decision core:
//   · recordPhoto / hasEarlierPhoto  — only the FIRST photo of a burst acks ("Got your photo…" once, not ×3).
//   · hasNewerPhoto                  — only the LAST photo finalizes (no newer unconsumed sibling).
//   · setPhotoPr / finalizePhotoBatch — one confirmation per DISTINCT request; a non-proc photo (null pr) drops
//                                       out of the cards; a second finalize is empty (rows already claimed).
// A tiny in-memory fake stands in for wa_photo_batch so we can drive the pure logic without a DB.

import { suite, test, expect } from './harness'
import { recordPhoto, hasEarlierPhoto, hasNewerPhoto, setPhotoPr, finalizePhotoBatch } from '../_burst.ts'

type Row = { id: number; sender: string; wamid: string; pr_id: string | null; consumed: boolean }

function fakePhotoDb() {
  const rows: Row[] = []
  let seq = 0
  function selectQuery() {
    const f: { sender: string | null; consumedNull: boolean; ltId: number | null; gtId: number | null } =
      { sender: null, consumedNull: false, ltId: null, gtId: null }
    const api: any = {
      eq(c: string, v: string) { if (c === 'sender') f.sender = v; return api },
      is() { f.consumedNull = true; return api },
      lt(_c: string, n: number) { f.ltId = n; return api },
      gt(_c: string, n: number) { f.gtId = n; return api },
      gte() { return api },   // created_at window — the fake treats every row as recent
      async limit() {
        const hit = rows.filter((r) =>
          r.sender === f.sender && (!f.consumedNull || !r.consumed) &&
          (f.ltId == null || r.id < f.ltId) && (f.gtId == null || r.id > f.gtId))
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      },
    }
    return api
  }
  return {
    rows,
    from(table: string) {
      if (table !== 'wa_photo_batch') throw new Error('unexpected table ' + table)
      return {
        insert(v: { sender: string; wamid: string }) {
          const row: Row = { id: ++seq, sender: v.sender, wamid: v.wamid, pr_id: null, consumed: false }
          rows.push(row)
          return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) }
        },
        select() { return selectQuery() },
        update(vals: { pr_id?: string; consumed_at?: string }) {
          const f: { sender: string | null; wamid: string | null; consumedNull: boolean } =
            { sender: null, wamid: null, consumedNull: false }
          const apply = () => {
            const hit = rows.filter((r) =>
              (f.sender == null || r.sender === f.sender) &&
              (f.wamid == null || r.wamid === f.wamid) &&
              (!f.consumedNull || !r.consumed))
            hit.forEach((r) => {
              if ('pr_id' in vals) r.pr_id = vals.pr_id!
              if ('consumed_at' in vals) r.consumed = true
            })
            return hit
          }
          const api: any = {
            eq(c: string, v: string) { if (c === 'sender') f.sender = v; if (c === 'wamid') f.wamid = v; return api },
            is() { f.consumedNull = true; return api },
            gte() { return api },
            select() { const hit = apply(); return Promise.resolve({ data: hit.map((r) => ({ id: r.id, pr_id: r.pr_id })), error: null }) },
            then(res: (v: { error: null }) => unknown) { apply(); return Promise.resolve({ error: null }).then(res) },
          }
          return api
        },
      }
    },
  }
}

const S = '91999'

suite('wa — photo batch', () => {
  test('only the FIRST photo of a burst acks; only the LAST finalizes', async () => {
    const db = fakePhotoDb()
    const s1 = await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'p1' })
    const s2 = await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'p2' })
    const s3 = await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'p3' })

    // Ack gate: p1 is first (no earlier), p2/p3 are not.
    expect(await hasEarlierPhoto(db as any, S, s1!)).toBe(false)
    expect(await hasEarlierPhoto(db as any, S, s2!)).toBe(true)
    expect(await hasEarlierPhoto(db as any, S, s3!)).toBe(true)

    // Finalize gate: p1/p2 see a newer sibling, p3 does not → p3 speaks.
    expect(await hasNewerPhoto(db as any, S, s1!)).toBe(true)
    expect(await hasNewerPhoto(db as any, S, s2!)).toBe(true)
    expect(await hasNewerPhoto(db as any, S, s3!)).toBe(false)
  })

  test('one list across three photos → ONE confirmation (one distinct request)', async () => {
    const db = fakePhotoDb()
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'p1' })
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'p2' })
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'p3' })
    // All three folded into the same request PR1.
    await setPhotoPr(db as any, 'p1', 'PR1')
    await setPhotoPr(db as any, 'p2', 'PR1')
    await setPhotoPr(db as any, 'p3', 'PR1')

    const prIds = await finalizePhotoBatch(db as any, S)
    expect(prIds).toEqual(['PR1'])                       // one card, not three fragments
    expect(await finalizePhotoBatch(db as any, S)).toEqual([])   // rows consumed → a second finalize is silent
  })

  test('a two-vendor batch still gets a card each (distinct requests, arrival order)', async () => {
    const db = fakePhotoDb()
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'a1' })
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'a2' })
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'b1' })
    await setPhotoPr(db as any, 'a1', 'PR_A')
    await setPhotoPr(db as any, 'a2', 'PR_A')
    await setPhotoPr(db as any, 'b1', 'PR_B')

    expect(await finalizePhotoBatch(db as any, S)).toEqual(['PR_A', 'PR_B'])
  })

  test('a non-procurement photo (no request tagged) drops out of the cards but still lets the burst finalize', async () => {
    const db = fakePhotoDb()
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'proof' })  // a payment proof — never tagged
    await recordPhoto(db as any, { orgId: 'o1', sender: S, wamid: 'list' })
    await setPhotoPr(db as any, 'list', 'PR1')

    expect(await finalizePhotoBatch(db as any, S)).toEqual(['PR1'])   // only the tagged request is confirmed
  })
})
