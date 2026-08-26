// Project grounding — a project name the model INVENTED (never in the user's message) must
// never reach the Day Book. The live bug: the extractor's few-shot examples used
// "Dr Shyam's Residence"; on the vague input "…Dr site…" the model echoed that example, and
// the card showed "Dr Shyam's Residence" (tagged "not a project") for an org whose only real
// project is "Dr Soundharya Residence". buildPlan must drop an ungrounded project.
//
// This tests the DETERMINISTIC floor (buildPlan), not the model. What the model emits is a
// prompt question Chandu verifies live; what we prove here is that a fabricated string — however
// it arises — cannot surface, and that the raw mention the user DID say still resolves.

import { suite, test, expect } from './harness'
import { buildPlan } from '../_agents/transaction.ts'
import type { TxnExtract } from '../_extract.ts'

const FROM = '919900000000'
const NO_STAKE: { stakeholder_id: string; name: string }[] = []
const DR_SOUNDHARYA = [{ project_id: 'P1', name: 'Dr Soundharya Residence' }]

const extOf = (over: Partial<TxnExtract>): TxnExtract => ({
  amount: 7500, amount_source_phrase: '7500', amount_confidence: 'high',
  payee: 'Suryanarayana', project: null, direction: 'out', mode: null, note: null, ref: null,
  ...over,
})

// The real message from the screenshot — only ever says "Dr site", never "Shyam".
const MSG = 'Suryanarayana (JCB) Dr site Payment 30/06/2025 7500 New Site Cleaning JCB Payment (Suresh nagar)'

suite('project grounding — no invented project name reaches the Day Book', () => {
  test('a project whose distinctive word is NOWHERE in the message is dropped (few-shot leak)', () => {
    const plan = buildPlan(extOf({ project: "Dr Shyam's Residence" }), NO_STAKE, DR_SOUNDHARYA, FROM, MSG)
    expect(plan.projectName).toBe(null)                 // not auto-linked to anything
    expect(plan.projectRaw).toBe(null)                  // and NOT shown as a raw mention
    expect(plan.ai.project_raw).toBe(null)
    expect(plan.slots.project).toBe(null)
  })

  test('the raw mention the user actually said ("Dr site") survives and gets the RIGHT suggestion', () => {
    // "Dr site" is only a title + filler -> nothing to disprove -> kept as a grounded raw mention.
    // It scores 0.8 (confirm band) against the real project, so it is offered as a one-tap
    // suggestion rather than silently auto-linked. Both facts matter: the raw survives, and the
    // suggestion points at the REAL project, never the invented one.
    const plan = buildPlan(extOf({ project: 'Dr site' }), NO_STAKE, DR_SOUNDHARYA, FROM, MSG)
    expect(plan.projectRaw).toBe('Dr site')
    expect((plan.ai.suggested_project as { name: string } | null)?.name).toBe('Dr Soundharya Residence')
  })

  test('a grounded mention (its word IS in the message) is preserved, not treated as fabrication', () => {
    const msg = 'paid 5000 at Pride site for cleaning'
    const plan = buildPlan(extOf({ project: 'Pride' }), NO_STAKE, [{ project_id: 'P2', name: 'The Pride' }], FROM, msg)
    expect(plan.projectName).toBe('The Pride')          // "pride" grounded -> matcher auto-links
  })

  test('the generic title alone ("Dr") does not count as grounding', () => {
    // "Dr" appears in the message but is a generic honorific; it must not launder an invented name.
    const plan = buildPlan(extOf({ project: 'Dr Meghana Towers' }), NO_STAKE, DR_SOUNDHARYA, FROM, MSG)
    expect(plan.projectRaw).toBe(null)                  // "meghana"/"towers" absent -> dropped
    expect(plan.projectName).toBe(null)
  })
})
