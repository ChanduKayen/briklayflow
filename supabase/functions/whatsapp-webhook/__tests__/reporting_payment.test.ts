// REPORTING case 1 — a party's payment total. The first thing this agent actually answers.
//
// The three branches of the case, and the gate in front of them:
//   • the name resolves confidently        -> fetch and answer
//   • the name is ambiguous                -> pick, offering the nearest matches
//   • the name + a site                    -> resolve the NAME first, then that site's number alone
//   • the asker isn't management/accountant/principal -> "coming soon", and the money is never read
//
// TWO LIMITS OF THIS GATE, STATED SO THEY ARE NOT MISTAKEN FOR COVERAGE:
//
//  1. `readAsk` IS STUBBED. It calls a model, so these tests inject the Ask directly (`__readAskForTests`).
//     What is proven here is everything DOWNSTREAM of understanding — the bands, the SQL, the sums, the
//     gate. Whether the model reads "ramu ki entha icham?" as payment_status is a question only the live
//     model can answer, and Chandu is testing that on WhatsApp.
//
//  2. NO COLUMN ENFORCEMENT ON THE MONEY TABLES. `transactions` / `txn_allocations` have no CREATE TABLE in
//     supabase/migrations (they predate the folder), so table_columns.ts has no entry and a typo'd column
//     passes green here and 42703s in prod. Their shape is read off the write RPC (20260513600000) and
//     src/lib/vendorTrackingApi.ts — live code, but not a schema check. Treat prod as the arbiter of names.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runReporting, answerReporting, __readAskForTests, type Ask } from '../_agents/reporting.ts'

const ORG = 'org-1'
const SENDER = '919900000000'

const ctxFor = (fake: ReturnType<typeof fakeSupabase>, interactiveId: string | null = null) =>
  ({ supabase: fake, from: SENDER, senderName: 'Chandu', orgId: ORG, wamid: 'w-1', lang: 'en' as const, interactiveId })

/** role is the AUTHORITATIVE user_profiles.role, reached via wa_registered_numbers.user_id. */
const seed = (role: string, extra: Partial<Seed> = {}): Seed => ({
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Chandu', role }],
  projects: [
    { project_id: 'P1', name: 'The Pride', org_id: ORG },
    { project_id: 'P2', name: 'ASM Elite', org_id: ORG },
  ],
  stakeholders: [
    { stakeholder_id: 'S1', name: 'Ramesh Kumar', org_id: ORG },
    { stakeholder_id: 'S2', name: 'Ramesh Babu', org_id: ORG },
    { stakeholder_id: 'S3', name: 'Suresh Tiles', org_id: ORG },
  ],
  ...extra,
})

/** Two payments to Ramesh Kumar (₹100k + ₹40k), split across two sites; one VOIDED payment that must vanish. */
const money = (): Partial<Seed> => ({
  transactions: [
    { txn_id: 'T1', stakeholder_id: 'S1', org_id: ORG, total_amount: 100000, status: 'Posted' },
    { txn_id: 'T2', stakeholder_id: 'S1', org_id: ORG, total_amount: 40000, status: 'Posted' },
    { txn_id: 'T3', stakeholder_id: 'S1', org_id: ORG, total_amount: 999999, status: 'Voided' },
  ],
  txn_allocations: [
    { txn_id: 'T1', project_id: 'P1', allocated_amount: 60000 },
    { txn_id: 'T1', project_id: 'P2', allocated_amount: 40000 },
    { txn_id: 'T2', project_id: 'P1', allocated_amount: 40000 },
    { txn_id: 'T3', project_id: 'P1', allocated_amount: 999999 },   // voided — must never be counted
  ],
})

// The model answers the site in IDS now, so the stub does too. `site` here is a test convenience: pass a
// PROJECT ID for "he named this one", or use siteNamed/siteOptions directly for the unknown/ambiguous shapes.
const ask = (a: Partial<Ask> & { site?: string }): Ask => {
  const { site, ...rest } = a
  const byName: Record<string, string> = { 'The Pride': 'P1', 'ASM Elite': 'P2' }
  return {
    kind: 'payment_status', party: null, siteNamed: site ?? null,
    siteId: site ? (byName[site] ?? null) : null, siteOptions: [], ...rest,
  }
}
const out = (fake: ReturnType<typeof fakeSupabase>) => fake.outbox()

suite('reporting case 1 — the confident name', () => {
  test('an exact name is fetched and answered: total + payment count', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'how much did we pay ramesh kumar?', {})
    const body = out(fake)[0]
    expect(/Ramesh Kumar/.test(body)).toBe(true)
    expect(/₹1,40,000/.test(body)).toBe(true)      // 100k + 40k, in Indian grouping
    expect(/2 payments/.test(body)).toBe(true)
  })

  // The voided ₹9,99,999 would dwarf the real total. vendorTrackingApi excludes it in the app; the WhatsApp
  // number must be the same number the Track hub shows, or one of them is lying.
  test('a VOIDED payment is not money, and is not counted', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('accountant', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar total?', {})
    expect(/999,999|9,99,999/.test(out(fake)[0])).toBe(false)
  })

  test('a party with no payments gets a plain answer, not ₹0', async () => {
    __readAskForTests(ask({ party: 'Suresh Tiles' }))
    const fake = fakeSupabase(seed('principal', money()))
    await runReporting(ctxFor(fake), 'how much to suresh tiles?', {})
    expect(/No payments recorded/i.test(out(fake)[0])).toBe(true)
  })

  // The full total reads total_amount (what left the account), so an unallocated payment still counts — and
  // the gap against the per-site numbers is NAMED, because a total that silently disagrees looks like a bug.
  test('an unallocated payment still counts, and the gap is named', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', {
      transactions: [{ txn_id: 'T9', stakeholder_id: 'S1', org_id: ORG, total_amount: 10000, status: 'Posted' }],
      txn_allocations: [],   // nobody has assigned it to a site yet
    }))
    await runReporting(ctxFor(fake), 'ramesh kumar?', {})
    const body = out(fake)[0]
    expect(/₹10,000/.test(body)).toBe(true)
    expect(/isn't assigned to a site/i.test(body)).toBe(true)
  })
})

suite('reporting case 1 — the total carries its per-site split', () => {
  test('the total is followed by a breakdown, biggest site first', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'how much did we pay ramesh kumar?', {})
    const body = out(fake)[0]
    expect(/₹1,40,000 — 2 payments/.test(body)).toBe(true)
    expect(/· The Pride — ₹1,00,000/.test(body)).toBe(true)     // 60k (T1) + 40k (T2)
    expect(/· ASM Elite — ₹40,000/.test(body)).toBe(true)       // 40k (T1)
    expect(body.indexOf('The Pride') < body.indexOf('ASM Elite')).toBe(true)   // biggest first
  })

  // One line repeating the total under the total is noise, not information.
  test('a single-site party gets NO breakdown', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', {
      transactions: [{ txn_id: 'T1', stakeholder_id: 'S1', org_id: ORG, total_amount: 50000, status: 'Posted' }],
      txn_allocations: [{ txn_id: 'T1', project_id: 'P1', allocated_amount: 50000 }],
    }))
    await runReporting(ctxFor(fake), 'ramesh kumar?', {})
    expect(/₹50,000/.test(out(fake)[0])).toBe(true)
    expect(/· The Pride/.test(out(fake)[0])).toBe(false)
  })

  test('a voided payment stays out of the breakdown too', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar?', {})
    // T3's ₹9,99,999 was allocated to P1 — if Voided leaked, The Pride's line would carry it.
    expect(/· The Pride — ₹1,00,000/.test(out(fake)[0])).toBe(true)
  })

  // He named a site because he wants ONE number. The split belongs to the total, not to this.
  test('a named site still gets its number ALONE, with no breakdown', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', site: 'The Pride' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar on the pride?', {})
    const body = out(fake)[0]
    expect(/₹1,00,000/.test(body)).toBe(true)
    expect(/ASM Elite/.test(body)).toBe(false)
  })
})

suite('reporting case 1 — the ambiguous name asks, and the pick answers', () => {
  test('"Ramesh" matches two — we ask, offering the nearest', async () => {
    __readAskForTests(ask({ party: 'Ramesh' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'how much did we pay ramesh?', {})
    const body = out(fake)[0]
    expect(/Which \*Ramesh\*/.test(body)).toBe(true)
    // …and it opened a REPORTING pending question for the reply to come back to.
    const convo = fake.writesTo('wa_conversations')[0]?.payload
    expect(convo?.owning_agent).toBe('REPORTING')
    expect(convo?.slots_so_far?.kind).toBe('reporting_payee_pick')
  })

  test('a TAP on the list resolves to that stakeholder and answers', async () => {
    const fake = fakeSupabase(seed('management', money()))
    const convo = {
      slots_so_far: { kind: 'reporting_payee_pick', raw: 'Ramesh', site: null,
        candidates: [{ id: 'S1', name: 'Ramesh Kumar' }, { id: 'S2', name: 'Ramesh Babu' }] },
    } as never
    const v = await answerReporting(ctxFor(fake, 'rep_payee_S1'), '', convo)
    expect(v).toBe(undefined)                       // resolved, not re-routed
    expect(/₹1,40,000/.test(out(fake)[0])).toBe(true)
  })

  test('a TYPED reply is matched against the FROZEN candidates only', async () => {
    const fake = fakeSupabase(seed('management', money()))
    const convo = {
      slots_so_far: { kind: 'reporting_payee_pick', raw: 'Ramesh', site: null,
        candidates: [{ id: 'S1', name: 'Ramesh Kumar' }, { id: 'S2', name: 'Ramesh Babu' }] },
    } as never
    await answerReporting(ctxFor(fake), 'kumar', convo)
    expect(/Ramesh Kumar/.test(out(fake)[0])).toBe(true)
  })

  // He changed the subject instead of picking. Not our answer to force — hand it back and let the dispatcher
  // re-route it as a fresh turn (and re-surface this question afterwards).
  test('a reply that matches nothing offered is not_an_answer', async () => {
    const fake = fakeSupabase(seed('management', money()))
    const convo = {
      slots_so_far: { kind: 'reporting_payee_pick', raw: 'Ramesh', site: null,
        candidates: [{ id: 'S1', name: 'Ramesh Kumar' }, { id: 'S2', name: 'Ramesh Babu' }] },
    } as never
    const v = await answerReporting(ctxFor(fake), 'actually 3rd floor slab is done', convo)
    expect(v).toBe('not_an_answer')
    expect(out(fake).length).toBe(0)
  })

  test('a name matching nobody says so — it does not answer ₹0', async () => {
    __readAskForTests(ask({ party: 'Zzzz Qqqq' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'how much to zzzz qqqq?', {})
    expect(/don't have anyone called/i.test(out(fake)[0])).toBe(true)
  })
})

suite('reporting case 1 — name + site is that site alone', () => {
  test('the named site gets its OWN number, not the full total', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', site: 'The Pride' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'how much did we pay ramesh kumar on the pride?', {})
    const body = out(fake)[0]
    expect(/The Pride/.test(body)).toBe(true)
    expect(/₹1,00,000/.test(body)).toBe(true)      // 60k (T1) + 40k (T2) on P1 — NOT the 1,40,000 total
    expect(/₹1,40,000/.test(body)).toBe(false)
  })

  // One payment split across two sites is still ONE payment; a site's slice of it is one payment's worth.
  test('the count is payments, not allocation rows', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', site: 'ASM Elite' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar asm elite?', {})
    const body = out(fake)[0]
    expect(/₹40,000/.test(body)).toBe(true)
    expect(/1 payment\b/.test(body)).toBe(true)
  })

  test('a site the party was never paid on says so', async () => {
    __readAskForTests(ask({ party: 'Ramesh Babu', site: 'The Pride' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh babu on the pride?', {})
    expect(/No payments recorded/i.test(out(fake)[0])).toBe(true)
  })
})

// THE LIVE BUG (2026-07-17), reported from WhatsApp: "xxx person ki yyy site ki entha ichanu" answered with
// the FULL TOTAL instead of that site's number.
//
// Root cause: `ask.site ? resolveSite(…) : null` collapsed "named a site we can't pin" into the same null as
// "named no site", and null means everywhere. The trigger was matchProject being Levenshtein over LATIN —
// the Telugu-script "ఏఎస్ఎం ఎలైట్" scores 0.08 against "ASM Elite", misses the 0.82 auto band, and vanished.
// The same Latin-only blindness as MONEY_QUERY_RE and the pick matcher Telugu could never answer.
//
// TWO fixes, and this gate pins the SECOND one — the one that holds however badly the mapping goes: an
// unpinnable site is never silently answered with another number. (The first fix, the model mapping the site
// onto the real project list, lives in READ_ASK_PROMPT and is proven live, not here.)
//
// Every existing test seeded a site the matcher could pin, which is exactly why 639 of them were green while
// this shipped: a fixture that cannot represent the failure cannot see it.
suite('reporting case 1 — an unpinnable site NEVER becomes the total', () => {
  test('a site we cannot pin says so — it does not answer the all-sites total', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', siteNamed: 'ఏఎస్ఎం ఎలైట్', siteId: null }))   // what the model returns when mapping fails
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh ki asm elite ki entha ichanu', {})
    const body = out(fake)[0]
    expect(/don't have a site called/i.test(body)).toBe(true)
    expect(/₹1,40,000/.test(body)).toBe(false)      // the total he did NOT ask for
    expect(/₹1,00,000/.test(body)).toBe(false)      // nor a guess at the nearest site
  })

  test('…and it names the sites he does have, so the next try lands', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', siteNamed: 'Nonesuch Towers', siteId: null }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh on nonesuch towers?', {})
    expect(/The Pride/.test(out(fake)[0])).toBe(true)
    expect(/ASM Elite/.test(out(fake)[0])).toBe(true)
  })

  // The distinction the bug erased: naming NO site still means everywhere, and still gets the total.
  test('naming no site still means everywhere', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar entha ichanu?', {})
    expect(/₹1,40,000/.test(out(fake)[0])).toBe(true)
  })

  // The model PICKS the project and returns its id, so what arrives here is already pinned — no scoring.
  test('a project id from the model pins exactly, whatever he called it', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', siteNamed: 'ఏఎస్ఎం ఎలైట్', siteId: 'P2' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh ki ఏఎస్ఎం ఎలైట్ ki entha ichanu', {})
    const body = out(fake)[0]
    expect(/ASM Elite/.test(body)).toBe(true)      // the LISTED name, not his words
    expect(/₹40,000/.test(body)).toBe(true)
    expect(/₹1,40,000/.test(body)).toBe(false)
  })

  // An id we don't have is never trusted — a model that invents one must not reach another site's money.
  test('an unknown id from the model is refused, not followed', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', siteNamed: 'somewhere', siteId: 'P-NOPE' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh on somewhere?', {})
    expect(/don't have a site called/i.test(out(fake)[0])).toBe(true)
    expect(/₹/.test(out(fake)[0])).toBe(false)
  })
})

// AMBIGUITY IS THE MODEL'S TO DECLARE. It holds the roster, so when his words genuinely fit two sites it
// says so with ids rather than picking one — and he chooses. No scorer, no threshold, no nearest-guess.
suite('reporting case 1 — an ambiguous site is asked, never guessed', () => {
  test('two sites fit → he is asked, over the real projects', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', siteNamed: 'the site', siteId: null, siteOptions: ['P1', 'P2'] }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh ki aa site ki entha ichanu', {})
    const body = out(fake)[0]
    expect(/Which \*the site\*/.test(body)).toBe(true)
    expect(/₹/.test(body)).toBe(false)                    // no number until he says which
    const convo = fake.writesTo('wa_conversations')[0]?.payload
    expect(convo?.slots_so_far?.kind).toBe('reporting_site_pick')
    expect(convo?.slots_so_far?.party?.name).toBe('Ramesh Kumar')   // the party was settled BEFORE the ask
  })

  test('tapping a site answers for that site alone', async () => {
    const fake = fakeSupabase(seed('management', money()))
    const convo = {
      slots_so_far: { kind: 'reporting_site_pick', raw: 'the site', party: { id: 'S1', name: 'Ramesh Kumar' },
        candidates: [{ id: 'P1', name: 'The Pride' }, { id: 'P2', name: 'ASM Elite' }] },
    } as never
    const v = await answerReporting(ctxFor(fake, 'rep_site_P2'), '', convo)
    expect(v).toBe(undefined)
    const body = out(fake)[0]
    expect(/ASM Elite/.test(body)).toBe(true)
    expect(/₹40,000/.test(body)).toBe(true)
    expect(/₹1,40,000/.test(body)).toBe(false)
  })

  // Ambiguity the model DIDN'T declare must not be invented: one id means one site, and we answer.
  test('a single option is not an ambiguity', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', siteNamed: 'pride', siteId: 'P1', siteOptions: [] }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh ki pride ki entha?', {})
    expect(/₹1,00,000/.test(out(fake)[0])).toBe(true)
    expect(/Which/.test(out(fake)[0])).toBe(false)
  })
})

// A number invites exactly one follow-up — "which payments?" — so every party answer carries the button to
// their ledger. It lands on the stakeholder drawer directly (?stakeholder=<id>, read by Ledger.tsx).
suite('reporting case 1 — every party answer carries its ledger', () => {
  const ctaOf = (fake: ReturnType<typeof fakeSupabase>) =>
    (fake.writesTo('outbox')[0]?.payload?.payload ?? {}) as { kind?: string; cta?: { text: string; url: string } }

  test('a total carries a View ledger button, deep-linked to that party', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar entha ichanu?', {})
    const m = ctaOf(fake)
    expect(m.kind).toBe('cta')
    expect(/\/ledger\?stakeholder=S1/.test(m.cta?.url ?? '')).toBe(true)
  })

  // A SITE ANSWER MUST LAND ON THAT SITE'S LEDGER. The message quoted The Pride's ₹1,00,000; a button
  // opening his ledger across every site would show ₹1,40,000 — two numbers that disagree, with nothing to
  // tell him which answers his question.
  test('a site answer deep-links to THAT site\'s ledger', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar', site: 'The Pride' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar pride?', {})
    const url = ctaOf(fake).cta?.url ?? ''
    expect(/\/ledger\?stakeholder=S1/.test(url)).toBe(true)
    expect(/[?&]project=P1/.test(url)).toBe(true)
  })

  // He asked about everywhere — the whole ledger IS the answer, so no filter is imposed on him.
  test('an all-sites answer carries NO project filter', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar?', {})
    expect(/project=/.test(ctaOf(fake).cta?.url ?? '')).toBe(false)
  })

  test('a vendor\'s ledger block deep-links to the site it priced', async () => {
    __readAskForTests(ask({ party: 'Ramesh Traders', site: 'The Pride' }))
    const fake = fakeSupabase(seed('management', {
      ...money(),
      stakeholders: [{ stakeholder_id: 'S1', name: 'Ramesh Traders', org_id: ORG, type: 'Vendor' }],
      v_vendor_balance: [{ org_id: ORG, stakeholder_id: 'S1', project_id: 'P1', owed: 350000 }],
    }))
    await runReporting(ctxFor(fake), 'ramesh traders pride balance?', {})
    expect(/[?&]project=P1/.test(ctaOf(fake).cta?.url ?? '')).toBe(true)
  })

  // "None on this site" is exactly the answer he'll want to check for himself.
  test('a NO-payments answer carries it as well', async () => {
    __readAskForTests(ask({ party: 'Suresh Tiles' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'suresh tiles?', {})
    const m = ctaOf(fake)
    expect(m.kind).toBe('cta')
    expect(/\/ledger\?stakeholder=S3/.test(m.cta?.url ?? '')).toBe(true)
  })

  // The interrupt ack is a just-committed payment's receipt. The answers became `cta` when they grew the
  // button, so a text-only fold would have dropped it silently — losing a real message.
  test('the interrupt prefix still folds in, now that the answer is a cta', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar?', { prefix: 'Saved that payment.' })
    expect(out(fake)[0].startsWith('Saved that payment.')).toBe(true)
    expect(/₹1,40,000/.test(out(fake)[0])).toBe(true)
  })
})

// ── GRAVE: "a vendor gets the ledger block" (v_vendor_balance.owed) — DELETED 2026-07-17 ────────────────
// Five tests lived here and all five passed, right up until a live probe of Pattabhi Traders proved the
// thing they were protecting was wrong. They pinned a card reading `Paid` over a rule over `Balance`, where
// Paid was every rupee ever paid and Balance was `v_vendor_balance.owed` — a number that netted payments
// across unrelated POs inside a project, measured ORDERS when the liability is the BILL, and clamped a
// ₹96,640 credit to zero before reporting ₹8,375 owed.
//
// The tests could not have caught it. They asserted the card faithfully rendered whatever the view returned
// ("the balance is the view's"), which it did. Nothing asked whether the view was right, or whether two
// numbers under a subtraction rule shared a denominator. A gate that pins "we display X correctly" can never
// notice that X is a lie — and this one made the lie load-bearing for a month.
//
// The replacement is __tests__/party_account.test.ts, built on Chandu's real production rows, asserting the
// arithmetic itself: Balance = billed − paid, signed, unclamped, with Ordered kept out of the column so
// nobody subtracts a commitment. v_vendor_balance is dead code in the database; v_party_orders emits facts
// and composes nothing.
//
// What survives here unchanged: the paid-to-date suites above. They were never wrong.

suite('reporting case 1 — the role gate', () => {
  for (const role of ['management', 'accountant', 'principal']) {
    test(`${role} gets the number`, async () => {
      __readAskForTests(ask({ party: 'Ramesh Kumar' }))
      const fake = fakeSupabase(seed(role, money()))
      await runReporting(ctxFor(fake), 'ramesh kumar total?', {})
      expect(/₹1,40,000/.test(out(fake)[0])).toBe(true)
    })
  }

  // The refusal is the SAME placeholder an unbuilt question gets — never "you're not allowed", which would
  // confirm the party exists and make the gate an oracle for the thing it is hiding.
  test('a supervisor gets the placeholder, and it reveals nothing', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('supervisor', money()))
    await runReporting(ctxFor(fake), 'how much did we pay ramesh kumar?', {})
    const body = out(fake)[0]
    expect(/can't answer/i.test(body)).toBe(true)
    expect(/Ramesh|₹|1,40,000/.test(body)).toBe(false)
  })

  test('the money tables are never even read for a supervisor', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase(seed('supervisor', money()))
    await runReporting(ctxFor(fake), 'ramesh kumar?', {})
    // A read is not a write, so assert the gate ran BEFORE any of it: the only outbound is the placeholder,
    // and no pick was opened (which is what a resolved-but-ambiguous name would have produced).
    expect(fake.writesTo('wa_conversations').length).toBe(0)
    expect(out(fake).length).toBe(1)
  })

  // FAILS CLOSED. An unregistered number, a missing profile, or an unreadable role is not a reason to guess.
  test('an unresolvable role is refused, not assumed', async () => {
    __readAskForTests(ask({ party: 'Ramesh Kumar' }))
    const fake = fakeSupabase({ ...seed('management', money()), wa_registered_numbers: [{ phone_number: SENDER, user_id: null }] })
    await runReporting(ctxFor(fake), 'ramesh kumar?', {})
    expect(/can't answer/i.test(out(fake)[0])).toBe(true)
  })
})

suite('reporting — everything except case 1 is still "coming soon"', () => {
  test('a work-progress question defers honestly', async () => {
    __readAskForTests({ kind: 'other', party: null, siteNamed: null, siteId: null, siteOptions: [] })
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), '3rd floor wiring ayipoyinda?', {})
    expect(/can't answer/i.test(out(fake)[0])).toBe(true)
    expect(/nothing .*recorded/i.test(out(fake)[0])).toBe(true)
  })

  test('a payment question naming NOBODY defers rather than guessing a party', async () => {
    __readAskForTests(ask({ party: null }))
    const fake = fakeSupabase(seed('management', money()))
    await runReporting(ctxFor(fake), 'how much have we paid out?', {})
    expect(/can't answer/i.test(out(fake)[0])).toBe(true)
  })
})
