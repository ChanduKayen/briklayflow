// THE CARD THAT LOOKED LIKE ARITHMETIC AND WASN'T.
//
// Live, 2026-07-17. Pattabhi Traders:
//
//     Paid        ₹1,28,015          ← every rupee ever paid to them
//     ─────────────────────          ← says: these subtract
//     Balance        ₹8,375          ← built from ₹12,000 of PO-tagged allocations
//
// Two numbers with different denominators, joined by a rule promising they shared one. The true position
// was ₹96,640 IN CREDIT — they had billed ₹33,375 and been paid ₹1,30,015. The card had the sign wrong,
// the magnitude wrong, and looked like maths.
//
// ── HOW ₹8,375 WAS BUILT (all three faults in one number) ────────────────────────────────────────────────
// v_vendor_balance: owed = GREATEST(0, ordered − po_tagged − advance), grouped by PROJECT.
//
//   DR.SITE00068    ordered ₹0        (order_value 0, total_value 0 — but vendor_bill_amount ₹15,000!)
//   PO-2026-0006    ordered ₹18,375   paid against it: ₹0
//   Soundharya:     18,375 − 10,000 = ₹8,375
//                             ^^^^^^ a payment tagged to DR.SITE00068, cancelling a DIFFERENT PO's order
//
//   1. NETTED ACROSS POs. Grouping by project let any payment cancel any order. PO-2026-0006 has been paid
//      nothing; a payment on an unrelated PO made it look ₹10,000 settled.
//   2. MEASURED ORDERS, NOT BILLS. COALESCE(total_value, order_value, 0) skips NULL, not zero — so
//      DR.SITE00068's real ₹15,000 bill counted as ₹0 while its payment still subtracted.
//   3. CLAMPED THE SIGN AWAY. GREATEST(0,…) turned a ₹96,640 credit into a debt.
//
// ── THE RULE NOW ────────────────────────────────────────────────────────────────────────────────────────
//   Balance = billed − paid. Signed. Unclamped. Nothing else.
//   Ordered is a COMMITMENT and never subtracts. Advance is already INSIDE paid and never subtracts again.
//   Unallocated is hygiene, not an input — every rupee paid a party is against their account, tagged or not.
//
// The fixtures below are Chandu's real production rows, because a number this wrong deserves to be pinned
// with the data that produced it.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runReporting, __readAskForTests, type Ask } from '../_agents/reporting.ts'

const ORG = 'org-1'
const SENDER = '919900000000'

const ask = (p: { party: string; site?: string; siteId?: string }): Ask => ({
  kind: 'payment_status', party: p.party,
  siteNamed: p.site ?? null, siteId: p.siteId ?? null, siteOptions: [],
})
const base = (role: string, extra: Partial<Seed>): Seed => ({
  projects: [{ project_id: 'BRK-SOUNDHARYA', name: 'Soundharya', org_id: ORG },
             { project_id: 'The Pride', name: 'The Pride', org_id: ORG }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true, org_id: ORG }],
  user_profiles: [{ id: 'u1', name: 'Chandu', role }],
  ...extra,
}) as Seed
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) =>
  ({ supabase: fake, from: SENDER, senderName: 'Chandu', orgId: ORG, wamid: 'w-1', lang: 'en' as const, interactiveId: null })
const out = (fake: ReturnType<typeof fakeSupabase>) => fake.outbox()

/** Pattabhi Traders, from production: ordered ₹43,375 · billed ₹33,375 · paid ₹1,30,015, of which only
 *  ₹12,000 carries a PO tag. */
const PATTABHI = (): Partial<Seed> => ({
  stakeholders: [{ stakeholder_id: 'S1', name: 'Pattabhi Traders', org_id: ORG, type: 'Vendor' }],
  v_party_orders: [
    { org_id: ORG, stakeholder_id: 'S1', project_id: 'BRK-SOUNDHARYA', party_kind: 'Vendor', ordered: 18375, billed: 33375 },
    { org_id: ORG, stakeholder_id: 'S1', project_id: 'PRJ-SUNEE-VILLA', party_kind: 'Vendor', ordered: 25000, billed: 0 },
  ],
  transactions: [
    { txn_id: 'T1', stakeholder_id: 'S1', org_id: ORG, total_amount: 18375, status: 'Active' },
    { txn_id: 'T2', stakeholder_id: 'S1', org_id: ORG, total_amount: 41300, status: 'Active' },
    { txn_id: 'T3', stakeholder_id: 'S1', org_id: ORG, total_amount: 3020, status: 'Active' },
    { txn_id: 'T4', stakeholder_id: 'S1', org_id: ORG, total_amount: 5319.96, status: 'Active' },
    { txn_id: 'T5', stakeholder_id: 'S1', org_id: ORG, total_amount: 10000, status: 'Active' },
    { txn_id: 'T6', stakeholder_id: 'S1', org_id: ORG, total_amount: 50000, status: 'Active' },
    { txn_id: 'T7', stakeholder_id: 'S1', org_id: ORG, total_amount: 2000, status: 'Active' },
  ],
  txn_allocations: [
    { txn_id: 'T2', project_id: 'The Pride', allocated_amount: 41300, order_type: null },      // a site, but no PO
    { txn_id: 'T5', project_id: 'BRK-SOUNDHARYA', allocated_amount: 10000, order_type: 'PO' },
    { txn_id: 'T7', project_id: 'PRJ-SUNEE-VILLA', allocated_amount: 2000, order_type: 'PO' },
  ],
})

// ── The bug, and its replacement ─────────────────────────────────────────────────────────────────────────
suite('party account — the credit that was reported as a debt', () => {
  test('Pattabhi reads IN CREDIT ₹96,640 — never "Balance ₹8,375"', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi traders balance?', {})
    const body = out(fake)[0]
    expect(/In credit\s+₹96,640/.test(body)).toBe(true)
    expect(/8,375/.test(body)).toBe(false)          // the netted, clamped, order-based ghost
    expect(/Balance/.test(body)).toBe(false)        // it is not a balance owed; it is a credit
  })

  test('the block holds ONLY what subtracts — billed, paid, result', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    const block = out(fake)[0].split('```')[1]
    expect(/Billed\s+₹33,375/.test(block)).toBe(true)
    expect(/Paid\s+₹1,30,015/.test(block)).toBe(true)
    expect(/In credit\s+₹96,640/.test(block)).toBe(true)
    // THE WHOLE POINT. Ordered is a commitment; inside the column, someone subtracts it — which is exactly
    // what the old view did. It belongs in words, outside the arithmetic.
    expect(/Ordered/.test(block)).toBe(false)
    expect(/Unallocated/.test(block)).toBe(false)
  })

  test('Billed and Paid share a denominator — Paid is every rupee, tagged or not', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    // 18,375 + 41,300 + 3,020 + 5,319.96 + 10,000 + 50,000 + 2,000 = 1,30,014.96 → all 7, not the 12k tagged
    expect(/Paid\s+₹1,30,015/.test(out(fake)[0])).toBe(true)
    expect(/₹12,000/.test(out(fake)[0])).toBe(false)
  })

  test('the sign is spelled in words, not left as a minus to decode', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    const body = out(fake)[0]
    expect(/-₹96,640|−₹96,640/.test(body)).toBe(false)
    expect(/paid ₹96,640 more than they've billed us/i.test(body)).toBe(true)
  })
})

// ── Ordered vs Billed, explained in the card itself ─────────────────────────────────────────────────────
suite('party account — Ordered is a commitment, Billed is the liability', () => {
  test('Ordered is named outside the block, as context', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    const body = out(fake)[0]
    expect(/₹43,375 is committed, not yet billed/.test(body)).toBe(true)   // 18,375 + 25,000
  })

  test('…and the card says which of the two we owe against', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    expect(/what they've invoiced — that's what we owe against/i.test(out(fake)[0])).toBe(true)
  })

  test('the untagged money is named — hygiene, not arithmetic', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    // 1,30,015 − 12,000 tagged = 1,18,015. Includes T2's ₹41,300 (on a site, but against no PO).
    expect(/₹1,18,015 of what we paid isn't tied to any bill/.test(out(fake)[0])).toBe(true)
  })

  // The two gaps are NESTED (no site ⊂ no bill), so they are one sentence. Printed as two bare numbers
  // they read as separate pools and the natural thing to do with two numbers is add them.
  test('the site gap is stated as a SUBSET of the bill gap, not a second pool', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    // 1,30,015 paid − 53,300 placed on sites = 76,715 on no site at all.
    expect(/₹76,715 of that isn't on a site at all/.test(out(fake)[0])).toBe(true)
  })
})

// ── THE RECONCILIATION ──────────────────────────────────────────────────────────────────────────────────
// Ask about everything: "In credit ₹96,640". Ask about Soundharya: "Balance ₹23,375 owed". Opposite signs,
// same vendor, same second — and BOTH correctly scoped. The gap is exact and explainable:
//
//     Σ per-site balances  −  unplaced  =  overall
//     (23,375 − 2,000 − 41,300)  −  76,715  =  −96,640
//
// Paid has two denominators and must: overall counts every transaction; a site counts only allocations on
// it. ₹76,715 of Pattabhi's payments carry no allocation row, so they live in the total and on no site.
// Neither card can be "fixed" — the contradiction is only closable by SAYING SO on both.
suite('party account — per-site and overall cannot sum, and both say why', () => {
  test('the OVERALL card names the money that is on no site', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    expect(/₹76,715/.test(out(fake)[0])).toBe(true)
  })

  // THE DANGEROUS CARD. Soundharya's own hygiene is spotless — every rupee allocated to it is PO-tagged,
  // so its `unallocated` is a true ₹0 and it shows no warning of its own. Meanwhile TXN-2026-027668 sits
  // unplaced at ₹18,375 — EXACTLY PO-2026-0006's bill, a Soundharya PO. If that payment was for that bill,
  // this card is wrong by ₹18,375. It cannot know. It must not sound certain.
  test('a SITE card carries the unplaced pool too — a clean-looking balance still owns its doubt', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders', site: 'Soundharya', siteId: 'BRK-SOUNDHARYA' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi soundharya lo?', {})
    const body = out(fake)[0]
    expect(/Balance\s+₹23,375/.test(body)).toBe(true)        // 33,375 billed − 10,000 tagged here
    expect(/₹76,715 paid to them isn't assigned to any site/.test(body)).toBe(true)
    expect(/some of it may belong here/.test(body)).toBe(true)
  })

  test('a site card does NOT claim the party-wide bill gap as its own', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders', site: 'Soundharya', siteId: 'BRK-SOUNDHARYA' }))
    const fake = fakeSupabase(base('management', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi soundharya lo?', {})
    // Soundharya's OWN untagged money is ₹0 — 1,18,015 is the party's, and belongs on the overall card.
    expect(/₹1,18,015/.test(out(fake)[0])).toBe(false)
  })

  // With every rupee placed, the parts DO sum — and neither card should nag about a gap that isn't there.
  test('a fully-placed ledger says nothing about unplaced money', async () => {
    __readAskForTests(ask({ party: 'Clean Vendor', site: 'Soundharya', siteId: 'BRK-SOUNDHARYA' }))
    const fake = fakeSupabase(base('management', {
      stakeholders: [{ stakeholder_id: 'S2', name: 'Clean Vendor', org_id: ORG, type: 'Vendor' }],
      v_party_orders: [{ org_id: ORG, stakeholder_id: 'S2', project_id: 'BRK-SOUNDHARYA', party_kind: 'Vendor', ordered: 50000, billed: 50000 }],
      transactions: [{ txn_id: 'X1', stakeholder_id: 'S2', org_id: ORG, total_amount: 30000, status: 'Active' }],
      txn_allocations: [{ txn_id: 'X1', project_id: 'BRK-SOUNDHARYA', allocated_amount: 30000, order_type: 'PO' }],
    }))
    await runReporting(ctxFor(fake), 'clean vendor soundharya?', {})
    expect(/isn't assigned to any site/.test(out(fake)[0])).toBe(false)
  })
})

// ── A real debt still reads as a debt ───────────────────────────────────────────────────────────────────
suite('party account — the ordinary case still works', () => {
  const owing = (): Partial<Seed> => ({
    stakeholders: [{ stakeholder_id: 'S2', name: 'Clean Vendor', org_id: ORG, type: 'Vendor' }],
    v_party_orders: [{ org_id: ORG, stakeholder_id: 'S2', project_id: 'BRK-SOUNDHARYA', party_kind: 'Vendor', ordered: 50000, billed: 50000 }],
    transactions: [{ txn_id: 'X1', stakeholder_id: 'S2', org_id: ORG, total_amount: 30000, status: 'Active' }],
    txn_allocations: [{ txn_id: 'X1', project_id: 'BRK-SOUNDHARYA', allocated_amount: 30000, order_type: 'PO' }],
  })

  test('billed 50k, paid 30k → Balance ₹20,000 owed', async () => {
    __readAskForTests(ask({ party: 'Clean Vendor' }))
    const fake = fakeSupabase(base('management', owing()))
    await runReporting(ctxFor(fake), 'clean vendor balance?', {})
    const body = out(fake)[0]
    expect(/Balance\s+₹20,000/.test(body)).toBe(true)
    expect(/In credit/.test(body)).toBe(false)
  })

  test('a fully-tagged ledger says nothing about untagged money', async () => {
    __readAskForTests(ask({ party: 'Clean Vendor' }))
    const fake = fakeSupabase(base('management', owing()))
    await runReporting(ctxFor(fake), 'clean vendor?', {})
    expect(/isn't tied to any bill/.test(out(fake)[0])).toBe(false)
  })

  test('billed == paid → Settled, and no number to misread', async () => {
    __readAskForTests(ask({ party: 'Clean Vendor' }))
    const fake = fakeSupabase(base('management', {
      ...owing(),
      transactions: [{ txn_id: 'X1', stakeholder_id: 'S2', org_id: ORG, total_amount: 50000, status: 'Active' }],
      txn_allocations: [{ txn_id: 'X1', project_id: 'BRK-SOUNDHARYA', allocated_amount: 50000, order_type: 'PO' }],
    }))
    await runReporting(ctxFor(fake), 'clean vendor?', {})
    expect(/Settled/.test(out(fake)[0])).toBe(true)
  })
})

// ── A worker has no bill, so he gets no balance ─────────────────────────────────────────────────────────
suite('party account — a work order carries no bill', () => {
  const srinu = (extra: Partial<Seed> = {}): Partial<Seed> => ({
    stakeholders: [{ stakeholder_id: 'W1', name: 'Srinu', org_id: ORG, type: 'Worker' }],
    v_party_orders: [{ org_id: ORG, stakeholder_id: 'W1', project_id: 'BRK-SOUNDHARYA', party_kind: 'Worker', ordered: 85000, billed: 0 }],
    transactions: [{ txn_id: 'W-T1', stakeholder_id: 'W1', org_id: ORG, total_amount: 30000, status: 'Active' }],
    txn_allocations: [{ txn_id: 'W-T1', project_id: 'BRK-SOUNDHARYA', allocated_amount: 30000, order_type: 'WO' }],
    ...extra,
  })

  test('a worker gets Paid and Ordered — and NO balance, from a billed:0 we never read', async () => {
    __readAskForTests(ask({ party: 'Srinu' }))
    const fake = fakeSupabase(base('management', srinu()))
    await runReporting(ctxFor(fake), 'srinu?', {})
    const body = out(fake)[0]
    expect(/Paid\s+₹30,000/.test(body)).toBe(true)
    expect(/Ordered\s+₹85,000/.test(body)).toBe(true)
    expect(/Balance|In credit|Settled/.test(body)).toBe(false)
    expect(/Billed/.test(body)).toBe(false)
  })

  test('…and it says WHY there is no balance, rather than just omitting one', async () => {
    __readAskForTests(ask({ party: 'Srinu' }))
    const fake = fakeSupabase(base('management', srinu()))
    await runReporting(ctxFor(fake), 'srinu balance?', {})
    expect(/work order carries no bill/i.test(out(fake)[0])).toBe(true)
  })

  test('a worker\'s untagged money is still named', async () => {
    __readAskForTests(ask({ party: 'Srinu' }))
    const fake = fakeSupabase(base('management', srinu({
      transactions: [{ txn_id: 'W-T1', stakeholder_id: 'W1', org_id: ORG, total_amount: 30000, status: 'Active' },
                     { txn_id: 'W-T2', stakeholder_id: 'W1', org_id: ORG, total_amount: 5000, status: 'Active' }],
    })))
    await runReporting(ctxFor(fake), 'srinu?', {})
    expect(/₹5,000 of what we paid isn't tied to any bill/.test(out(fake)[0])).toBe(true)
  })
})

// ── No orders → no card ─────────────────────────────────────────────────────────────────────────────────
suite('party account — the card follows the contract, not the type', () => {
  // The ad-hoc labourer, and the vendor nobody has ordered from. A card of zeros would tell them LESS than
  // the paid-to-date answer (count + per-site split + unallocated-to-a-site gap) while implying we knew more.
  test('no rows in v_party_orders → the plain paid-to-date answer, not a card of zeros', async () => {
    __readAskForTests(ask({ party: 'Srinu' }))
    const fake = fakeSupabase(base('management', {
      stakeholders: [{ stakeholder_id: 'W9', name: 'Srinu', org_id: ORG, type: 'Worker' }],
      v_party_orders: [],
      transactions: [{ txn_id: 'A', stakeholder_id: 'W9', org_id: ORG, total_amount: 100000, status: 'Active' },
                     { txn_id: 'B', stakeholder_id: 'W9', org_id: ORG, total_amount: 40000, status: 'Active' }],
      txn_allocations: [{ txn_id: 'A', project_id: 'BRK-SOUNDHARYA', allocated_amount: 100000 },
                        { txn_id: 'B', project_id: 'The Pride', allocated_amount: 40000 }],
    }))
    await runReporting(ctxFor(fake), 'srinu?', {})
    const body = out(fake)[0]
    expect(/₹1,40,000/.test(body)).toBe(true)
    expect(/2 payments/.test(body)).toBe(true)                 // the richer answer survives
    expect(/Ordered|Billed|In credit/.test(body)).toBe(false)
  })
})

// ── The boundaries that must not move ───────────────────────────────────────────────────────────────────
suite('party account — org scoping and the role gate hold', () => {
  test('another org\'s orders are never summed in', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const p = PATTABHI()
    const fake = fakeSupabase(base('management', {
      ...p,
      v_party_orders: [...(p.v_party_orders as Seed['v_party_orders'])!,
        { org_id: 'org-OTHER', stakeholder_id: 'S1', project_id: 'X', party_kind: 'Vendor', ordered: 900000, billed: 900000 }],
    }))
    await runReporting(ctxFor(fake), 'pattabhi?', {})
    expect(/In credit\s+₹96,640/.test(out(fake)[0])).toBe(true)
    expect(/9,00,000|9,33,375/.test(out(fake)[0])).toBe(false)
  })

  test('a supervisor gets no account card at all', async () => {
    __readAskForTests(ask({ party: 'Pattabhi Traders' }))
    const fake = fakeSupabase(base('Supervisor', PATTABHI()))
    await runReporting(ctxFor(fake), 'pattabhi balance?', {})
    expect(/96,640|33,375|1,30,015/.test(out(fake)[0])).toBe(false)
  })
})
