// TYPE 5 · THE MONEY CONFIRMATION — and the arrow that was pointing the wrong way.
//
// This card had NO test. That is how it shipped, on every payment, reading:
//
//     Rajeev Sharma → ₹3,25,000 · The Pride
//
// In the one grammar this system has, `→` means MONEY DIRECTION and nothing else. So that line said,
// precisely, that Rajeev paid US three lakh twenty-five thousand — the exact inverse of what happened. It is
// the worst sentence the system can produce about money, and it survived because the separator's meaning was
// written down in the voice card but never pinned by anything that could fail.
//
// These tests are that pin.

import { suite, test, expect } from './harness'
import { mBatch } from '../_messages.ts'

const e = (payee: string, amount: number, project: string | null, committed = true, entryId: string | null = 'ent-1') =>
  ({ payee, amount, project, committed, entryId })

const bodyOf = (m: ReturnType<typeof mBatch>) => ('body' in m ? m.body : '')
const ctaOf = (m: ReturnType<typeof mBatch>) => (m.kind === 'cta' ? m.cta : null)

suite('Type 5 — the money card', () => {
  // THE ONE THAT MATTERS. Money leaves the builder and goes TO the payee: ₹342 → Raju.
  test('the arrow points from the MONEY to the PAYEE — never the reverse', () => {
    const b = bodyOf(mBatch('en', { entries: [e('Rajeev Sharma', 325000, 'The Pride')], retryButtonId: null }))
    expect(/₹3,25,000 → Rajeev Sharma/.test(b)).toBe(true)
    expect(/Rajeev Sharma → ₹/.test(b)).toBe(false)      // the live bug: "Rajeev paid us 3.25 lakh"
  })

  // Amount, direction and party are ONE fact. Two bold runs and the eye has to pick which is the news.
  test('a single payment: the whole fact is ONE bold run, the project rides after the dash', () => {
    const b = bodyOf(mBatch('en', { entries: [e('Raju', 342, 'The Pride')], retryButtonId: null }))
    expect(b.includes('✓ *₹342 → Raju — The Pride*')).toBe(true)
  })

  test('a write says WHERE it landed, and the button lands on THE ENTRY', () => {
    const m = mBatch('en', { entries: [e('Raju', 342, 'The Pride', true, 'ent-9')], retryButtonId: null })
    expect(/Recorded in \*Day Book\* · Briklay/.test(bodyOf(m))).toBe(true)
    expect(ctaOf(m)?.text).toBe('View entry')
    expect(ctaOf(m)?.url.includes('entry=ent-9')).toBe(true)
  })

  // Several payments: the COUNT and the TOTAL are the headline (that is the whole story on a lock screen),
  // and the one button opens the book — it cannot point at three entries at once.
  test('several payments → count + total headline, and the button opens the Day Book', () => {
    const m = mBatch('en', {
      entries: [e('Raju', 342, 'The Pride'), e('Apparao', 658, 'ASM Elite')],
      retryButtonId: null,
    })
    expect(/^✓ \*2 payments filed\* — ₹1,000$/m.test(bodyOf(m))).toBe(true)
    expect(ctaOf(m)?.text).toBe('Open Day Book')
  })

  // A write that failed on OUR side is ⏸ (Babai's limbo), not ⚠️ (a hazard on his site) — and the retry
  // outranks the deep link, because the most useful thing he can do is save the one that didn't save.
  test('a partial batch: ⏸ for what failed, the retry keeps the button slot, reassurance LAST', () => {
    const m = mBatch('en', {
      entries: [e('Raju', 342, 'The Pride'), e('Apparao', 658, null, false, null)],
      retryButtonId: 'retry_r1',
    })
    const b = bodyOf(m)
    expect(b.includes("✓ *1 filed* · ⏸ 1 couldn't save")).toBe(true)
    expect(/⏸ ₹658 → Apparao/.test(b)).toBe(true)
    expect(/⚠️/.test(b)).toBe(false)
    expect(m.kind).toBe('buttons')                                          // the retry, not a link
    expect(m.kind === 'buttons' && m.buttons[0].id).toBe('retry_r1')
    // the reassurance is the LAST thing he reads, not the first
    expect(b.trim().endsWith('tap to try again.')).toBe(true)
  })
})
