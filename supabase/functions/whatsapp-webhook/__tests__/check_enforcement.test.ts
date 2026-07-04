// FAKE CHECK-ENFORCEMENT GATE (Phase 0 go-order step 2, ratified as a GATE before journeys a–g).
// Both landmines (siteops_unplaced.reason v2 parks, followup_events.type='bare_ack') were CHECK-rejected
// in prod while the offline gate stayed green, because the fake recorded every write unconditionally —
// pure-green-while-broken. These tests are the proof the fake stopped lying: constraints are PARSED FROM
// THE MIGRATIONS (never hand-copied), and the historical cases are pinned against the PRE-fix constraint
// sets, where they must FAIL exactly as prod failed.

import { suite, test, expect } from './harness'
import { fakeSupabase } from './fake_supabase'
import { loadEnumChecks, checkViolation } from './check_constraints'

suite('fake CHECK enforcement — constraints parsed from migrations (the fake stops lying)', () => {
  test('(proof-red №1) bare_ack vs the PRE-20260704000000 constraint → 23514, write NOT recorded — exactly as prod dropped it', async () => {
    const pre = loadEnumChecks({ before: '20260704000000' })
    const fake = fakeSupabase({}, { checks: pre })
    const res = await fake.from('followup_events')
      .insert({ org_id: 'o1', problem_id: 'p1', type: 'bare_ack', body: 'sari', actor_kind: 'system' })
      .select('id').single()
    expect(res.error?.code).toBe('23514')
    expect(res.data).toBeNull()
    expect(fake.trail().length).toBe(0)     // rejected row is NOT recorded — prod truth, not recorder truth
  })

  test('(proof-red №2) reopened vs the PRE-20260704000001 constraint → 23514 — landmine #3, the one this gate caught', async () => {
    const pre = loadEnumChecks({ before: '20260704000001' })
    const fake = fakeSupabase({}, { checks: pre })
    const res = await fake.from('followup_events')
      .insert({ org_id: 'o1', problem_id: 'p1', type: 'reopened', body: 'Reopened — you tapped "Not resolved"', actor_kind: 'user' })
      .select('id').single()
    expect(res.error?.code).toBe('23514')
    expect(fake.trail().length).toBe(0)
  })

  test('(now green) bare_ack + reopened pass the CURRENT constraint; an off-enum type still rejects', async () => {
    const fake = fakeSupabase()
    expect((await fake.from('followup_events').insert({ org_id: 'o1', problem_id: 'p1', type: 'bare_ack', body: 'sari' })).error).toBeNull()
    expect((await fake.from('followup_events').insert({ org_id: 'o1', problem_id: 'p1', type: 'reopened', body: 'undo' })).error).toBeNull()
    expect((await fake.from('followup_events').insert({ org_id: 'o1', problem_id: 'p1', type: 'not_a_trail_type', body: 'x' })).error?.code).toBe('23514')
    expect(fake.trail().length).toBe(2)
  })

  test('(reason) pending_stage2 + the v2 five admitted; an off-enum reason rejects', async () => {
    const fake = fakeSupabase()
    const ok = ['pending_stage2', 'non_batch_target', 'llm_unreadable', 'project']
    for (const reason of ok) {
      const res = await fake.from('siteops_unplaced').insert({ org_id: 'o1', reason, observation: { items: [] }, sender_number: '91x' })
      expect(res.error).toBeNull()
    }
    const bad = await fake.from('siteops_unplaced').insert({ org_id: 'o1', reason: 'no_project', observation: {}, sender_number: '91x' })
    expect(bad.error?.code).toBe('23514')   // E4 ruling: 'no_project' was NOT minted — the fake enforces that too
    expect(fake.writesTo('siteops_unplaced').length).toBe(ok.length)
  })

  test('(update too) an UPDATE carrying an off-enum status rejects; a valid one records', async () => {
    const fake = fakeSupabase({ problems: { p1: { id: 'p1', status: 'OPEN', title: 't' } } })
    expect((await fake.from('problems').update({ status: 'FIXED_I_GUESS' }).eq('id', 'p1')).error?.code).toBe('23514')
    expect((await fake.from('problems').update({ status: 'DISMISSED' }).eq('id', 'p1')).error).toBeNull()
    expect(fake.writesTo('problems').length).toBe(1)
  })

  test('(postgres NULL semantics) NULL/absent enum columns pass — CHECK is UNKNOWN, only FALSE rejects', async () => {
    const fake = fakeSupabase()
    const res = await fake.from('problems').insert({ org_id: 'o1', title: 'no status column supplied' })
    expect(res.error).toBeNull()
  })

  test('(parser: drop+re-add fold) final reason set = base six + v2 five + pending_stage2', () => {
    const c = loadEnumChecks().get('siteops_unplaced')?.get('siteops_unplaced_reason_check')
    expect(!!c).toBe(true)
    for (const v of ['disambig', 'typed_pick', 'project', 'photo_pick', 'batch_collision', 'floor',
      'llm_unreadable', 'evidence_await_placement', 'v2_effect_failed', 'v2_unhandled_terminal', 'non_batch_target',
      'pending_stage2']) expect(c!.values.has(v)).toBe(true)
    expect(c!.values.size).toBe(12)
  })

  test('(parser: inline + nullable forms) followup actor_kind and qc_status parsed from CREATE TABLE', () => {
    const checks = loadEnumChecks()
    const actor = checks.get('followup_events')?.get('followup_events_actor_kind_check')
    expect(actor?.values.has('system')).toBe(true)
    expect(actor?.values.has('user')).toBe(true)
    const qc = checks.get('site_task_qc')?.get('site_task_qc_qc_status_check')
    expect(qc?.values.has('pending')).toBe(true)
    expect(checkViolation(checks, 'site_task_qc', { qc_status: null })).toBeNull()   // nullable form: NULL passes
  })

  test('(parser: no RLS false-positives) policy WITH CHECK (org_id IN (SELECT …)) is not an enum check', () => {
    const checks = loadEnumChecks()
    for (const [, byName] of checks) for (const [, c] of byName) expect(c.column === 'org_id').toBe(false)
  })
})
