// TYPE 5 · THE SINGLE-PAYMENT CARD — the one that actually fires.
//
// There were TWO money composers: mBatch (2+ payments) and mComplete (one payment — which is to say, almost
// always). The Type 5 pass unified six hand-rolled confirmation composers in SiteOps, fixed mBatch, and MISSED
// this one. So the new grammar shipped to the rare case and the old copy stayed live on the common one, and a
// real voice note came back reading:
//
//     ✓ Added to your Day Book
//     *₹25,000* to Nukaraju
//     Dr Soundharya Residence
//
// Line 1 is what a push preview shows — and it contains no amount, no payee, no site. A preamble to a fact,
// delivered instead of the fact.
//
// Neither money composer had a single test. That is why both were wrong. These are the pins.

import { suite, test, expect } from './harness'
import { mComplete, mAbandoned, mWriteFailed, EDIT_LINK } from '../_messages.ts'

const bodyOf = (m: ReturnType<typeof mComplete>) => ('body' in m ? m.body : '')
const ctaOf = (m: ReturnType<typeof mComplete>) => (m.kind === 'cta' ? m.cta : null)
const clean = (o: Partial<Parameters<typeof mComplete>[1]> = {}) => mComplete('en', {
  payee: 'Nukaraju', payeeMatched: true, amount: 25000,
  projectName: 'Dr Soundharya Residence', projectRaw: null,
  note: "Weekly payment for Dr Soundharya's site", ...o,
})

suite('Type 5 — the single-payment card', () => {
  // LINE 1 IS THE NOTIFICATION. It is the whole of what he sees on a lock screen.
  test('line 1 IS the money fact — not a preamble to it', () => {
    const first = bodyOf(clean()).split('\n')[0]
    expect(first).toBe('✓ *₹25,000 → Nukaraju* — Dr Soundharya Residence')
    expect(/^✓ Added to your Day Book/.test(bodyOf(clean()))).toBe(false)   // the live bug
  })

  // → is money direction and NOTHING else. Money out goes ₹ → payee.
  test('the arrow points from the money to the payee; direction "in" reverses it', () => {
    expect(/₹25,000 → Nukaraju/.test(bodyOf(clean()))).toBe(true)
    expect(/Nukaraju → ₹25,000/.test(bodyOf(clean({ direction: 'in' })))).toBe(true)
  })

  test('a write says WHERE it landed, and the button lands on the entry', () => {
    const m = clean()
    expect(/Recorded in \*Day Book\* · Briklay/.test(bodyOf(m))).toBe(true)
    expect(ctaOf(m)?.text).toBe('View entry')
    expect(ctaOf(m)?.url).toBe(EDIT_LINK)      // the staging RPC substitutes the real entry link
  })

  // His words stay in his voice, raw, never summarised.
  test('the note is his, verbatim and italic', () => {
    expect(bodyOf(clean()).includes("_Weekly payment for Dr Soundharya's site_")).toBe(true)
  })

  // TYPE 7 — every unknown gets the same shape: NAME the gap, OFFER the one fix, MAKE IGNORING SAFE. A bare
  // "X isn't in your contacts yet" is an orphan line — the machine thinking out loud.
  test('an unknown payee is a gap WITH A HANDLE, and ignoring it is safe', () => {
    const m = clean({ payeeMatched: false })
    const b = bodyOf(m)
    expect(b.includes('*Nukaraju* is new to me')).toBe(true)
    expect(/tap below to add them/.test(b)).toBe(true)          // the one fix
    expect(/ignore and I'll keep this as a one-off/.test(b)).toBe(true)   // …and doing nothing is safe
    expect(/isn't in your contacts yet/.test(b)).toBe(false)    // the old orphan line
    expect(ctaOf(m)?.text).toBe('Add contact')
  })

  test('an unknown site is the same shape, and the button sets it', () => {
    const m = clean({ projectName: null, projectRaw: 'Sonudharya' })
    expect(bodyOf(m).includes("I don't have a site called *Sonudharya*")).toBe(true)
    expect(ctaOf(m)?.text).toBe('Set the site')
  })

  // "I don't have…", never "you don't have…" (the voice card).
  test('the system owns its gaps — never "you don\'t have"', () => {
    const b = bodyOf(clean({ payeeMatched: false, projectName: null, projectRaw: 'Sonudharya' }))
    expect(/you don't have|your contacts yet/i.test(b)).toBe(false)
  })
})

// The OTHER two money composers that were still on the old copy. Between them and mComplete/mBatch, every
// card the Transaction agent can send is now pinned — which is the only reason to believe the next one won't
// quietly drift too.
suite('Type 5 — the incomplete entry, and the failed write', () => {
  const bodyA = (m: ReturnType<typeof mAbandoned>) => ('body' in m ? m.body : '')

  // A row WAS written. It owes a destination line like any other write.
  test('an incomplete entry leads with what we DID capture, and says where it went', () => {
    const b = bodyA(mAbandoned('en', { payee: null, amount: 25000, missing: 'payee' }))
    expect(b.split('\n')[0]).toBe('✓ *₹25,000*')
    expect(/Recorded in \*Day Book\* · Briklay/.test(b)).toBe(true)
    expect(/^Saved /.test(b)).toBe(false)                                  // the old, home-less copy
  })

  test('…and the gap has a handle, with ignoring made safe', () => {
    const b = bodyA(mAbandoned('en', { payee: 'Nukaraju', amount: null, missing: 'amount' }))
    expect(b.includes("I don't have the amount yet")).toBe(true)           // "I don't have", never "you don't"
    expect(/leave it and I'll keep the entry as it is/.test(b)).toBe(true)
  })

  // A write that failed on OUR side is ⏸ (Babai's limbo), not ⚠️ (a hazard on his site).
  test('a failed write is ⏸, names the fact, and promises nothing half-landed', () => {
    const m = mWriteFailed('en', { payee: 'Kumar', amount: 12000, project: 'ASM Elite', replayId: 'r1' })
    const b = bodyA(m)
    expect(b.includes("⏸ *Couldn't save ₹12,000 → Kumar* — ASM Elite")).toBe(true)
    expect(/⚠️/.test(b)).toBe(false)
    expect(/Recorded in/.test(b)).toBe(false)      // NOTHING was written — so it claims no home
    expect(b.trim().endsWith('tap to try again.')).toBe(true)   // reassurance LAST
    expect(m.kind === 'buttons' && m.buttons[0].id).toBe('retry_r1')
  })
})
