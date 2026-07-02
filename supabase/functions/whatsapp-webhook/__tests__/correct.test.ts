// STEP 4b — JOURNEY TESTS for the readback correction policy. The contrast with the Step 3 harvest is
// the whole point: a correction OVERWRITES (the user is fixing THIS readback), where the harvest fills
// only if empty. Bounded to safe fields; a signal-less reply changes nothing. PURE.

import { suite, test, expect } from './harness'
import { planCorrection, type CorrectionObject, type Signal } from '../_siteops_correct.ts'

const NOW = new Date('2026-07-02T09:00:00.000Z')   // a Thursday; parseWhen is pure given a base
const obj = (p: Partial<CorrectionObject>): CorrectionObject => ({ kind: p.kind ?? 'issue', cause: p.cause ?? null, deadline: p.deadline ?? null })
const sig = (p: Partial<Signal>): Signal => ({ cause: p.cause ?? null, date_hint: p.date_hint ?? null })

suite('siteops correct — planCorrection (authoritative overwrite)', () => {
  test('OVERWRITES an existing real cause (unlike harvest, which would keep it)', () => {
    const p = planCorrection(obj({ kind: 'issue', cause: 'material' }), sig({ cause: 'payment' }), NOW)
    expect(p.updates).toEqual({ cause: 'payment' })
    expect(p.changed).toBe(true)
  })

  test('OVERWRITES an existing deadline', () => {
    const p = planCorrection(obj({ kind: 'issue', deadline: '2026-07-10' }), sig({ date_hint: 'monday' }), NOW)
    expect(p.updates).toEqual({ deadline: '2026-07-06' })   // Mon after Thu 2026-07-02
  })

  test('a todo takes a corrected due date but NEVER a cause', () => {
    const p = planCorrection(obj({ kind: 'todo', deadline: '2026-07-10' }), sig({ cause: 'material', date_hint: 'tomorrow' }), NOW)
    expect(p.updates).toEqual({ deadline: '2026-07-03' })
  })

  test('an "other" cause is not a real correction → ignored', () => {
    expect(planCorrection(obj({ kind: 'issue', cause: 'material' }), sig({ cause: 'other' }), NOW).changed).toBe(false)
  })

  test('a signal-less reply changes nothing (never blanks a field)', () => {
    expect(planCorrection(obj({ kind: 'issue', cause: 'material', deadline: '2026-07-10' }), sig({}), NOW).changed).toBe(false)
  })

  test('an unparseable date is ignored (no false deadline)', () => {
    expect(planCorrection(obj({ kind: 'issue' }), sig({ date_hint: 'sometime soon-ish' }), NOW).updates).toEqual({})
  })
})
