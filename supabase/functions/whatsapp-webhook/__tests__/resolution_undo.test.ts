// UNIFIED INBOUND RESOLUTION v2 — UNDO (Layer 2b) gate. The undo is the safety mechanism that EARNS the
// auto-resolve rung: a wrong RESOLVE is the silent failure this whole design prevents, and one-tap undo is
// what makes auto-firing sound. So its correctness is load-bearing, and the guard that matters most is the
// STALE case — an undo bound to an old resolve event must NEVER clobber a later legitimate re-resolution.
// Written test-first (the reopen behaviour is a stub → U-active is RED until the real logic lands).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { handleUndoResolve } from '../_agents/siteops.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-undo', lang: 'te' as const })
const seedWith = (status: string, active: string | null): Seed => ({
  problems: { 'iss-x': { id: 'iss-x', status, active_resolve_event: active } },
  wa_message_map: [{ outbound_wamid: 'wamid-1', object_refs: [{ kind: 'issue', id: 'iss-x', event: 'E1' }] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: '919900000000', is_active: true }],
})

suite('siteops resolution v2 — undo (bounded, idempotent, stale-safe)', () => {
  // THE STALE SEQUENCE — the guard's whole reason to exist. Resolve X (event E1, readback wamid-1); a later
  // message legitimately re-resolves X (now active_resolve_event = E2); the supervisor taps the OLD undo on
  // wamid-1 (bound to E1). E1 ≠ active E2 → NO-OP. The correct re-resolution must NOT be clobbered.
  test('(U-stale) old undo after a legitimate re-resolve → NO-OP (no clobber)', async () => {
    const fake = fakeSupabase(seedWith('RESOLVED', 'E2'))     // active is E2; the old button is bound to E1
    await handleUndoResolve(ctxFor(fake), 'wamid-1')
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)   // untouched — no reopen
  })

  // Active resolve → tap undo → reopens THIS issue to ADDRESSING (back on the chase) + a reopened trail.
  test('(U-active) undo while the resolve is still active → reopen to ADDRESSING + trail', async () => {
    const fake = fakeSupabase(seedWith('RESOLVED', 'E1'))     // active === bound event
    await handleUndoResolve(ctxFor(fake), 'wamid-1')
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING')).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.active_resolve_event === null)).toBe(true)
    expect(fake.trail().some((r) => r.type === 'reopened')).toBe(true)
  })

  // Idempotent — the issue is already open (active null, e.g. a double-tap or an earlier undo) → no-op.
  test('(U-idempotent) undo on an already-open issue → no-op', async () => {
    const fake = fakeSupabase(seedWith('ADDRESSING', null))
    await handleUndoResolve(ctxFor(fake), 'wamid-1')
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)
  })

  // No map row for the tapped message → nothing to undo (returns false; not an error).
  test('(U-nomap) undo with no mapped resolve → no-op false', async () => {
    const fake = fakeSupabase({ problems: {}, wa_message_map: [] })
    const handled = await handleUndoResolve(ctxFor(fake), 'wamid-unknown')
    expect(handled).toBe(false)
  })
})
