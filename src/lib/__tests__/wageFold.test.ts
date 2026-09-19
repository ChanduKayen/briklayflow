// WAGES SET AGAINST A CONTRACT.
//
// A worker on daily wages who also holds the contract for that work can be paid in one of two ways,
// and the difference is real money: either each day's wage is owed as a wage BESIDE the contract, or
// it is an advance the contract absorbs. When the site says "take them off the contract", every day
// marked has to reduce what is left to certify on it — exactly once, never twice, and never for work
// the contract has no room for.
//
// Two decisions carry that weight, and both are pure:
//
//   planWageFold   — which phases the unsettled wages come off (in order, each capped at the room it
//                    has left, the remainder rolling on), and the whole days that plan covers. A day
//                    is never split across the line: the last step is trimmed back to the last whole
//                    day, so what is certified and what is settled are always the same rupees.
//   daysCovered    — which of those days an APPROVED certification actually pays for. A certification
//                    beyond the submitter's authority comes back pending, and is not owed yet; its
//                    days must keep standing as wages, or the money falls between the two columns and
//                    the worker is owed nothing at all for a day they worked.

import { suite, test, expect } from './harness'
import { planWageFold, daysCovered, type SettlementPhase, type SettlementRow } from '../attendanceApi'

const day = (id: string, amount: number): SettlementRow => ({ id, date: '2026-09-14', amount });
const lump = (id: string, value: number, certified = 0): SettlementPhase =>
  ({ milestoneId: id, name: id, kind: 'lump', value, rate: 0, certified, remaining: Math.max(0, value - certified) });
const measured = (id: string, qty: number, rate: number, certified = 0): SettlementPhase =>
  ({ milestoneId: id, name: id, kind: 'measured', value: qty * rate, rate, certified, remaining: Math.max(0, qty * rate - certified) });

suite('planning the fold', () => {
  test('nothing marked, nothing to fold', () => {
    expect(planWageFold([], [lump('M1', 10000)]).steps.length).toBe(0);
  });

  test('no contract phase, nothing to fold', () => {
    expect(planWageFold([day('A1', 900)], []).steps.length).toBe(0);
  });

  test('a phase with room takes the whole week', () => {
    const p = planWageFold([day('A1', 900), day('A2', 900)], [lump('M1', 10000)]);
    expect(p.steps).toEqual([{ milestoneId: 'M1', applied: 1800 }]);
    expect(p.rowIds).toEqual(['A1', 'A2']);
  });

  test('a phase is capped at the room it has left, and the rest rolls to the next', () => {
    const p = planWageFold([day('A1', 1000), day('A2', 1000), day('A3', 1000)], [lump('M1', 1500), measured('M2', 100, 50)]);
    expect(p.steps).toEqual([{ milestoneId: 'M1', applied: 1500 }, { milestoneId: 'M2', applied: 1500 }]);
    expect(p.rowIds).toEqual(['A1', 'A2', 'A3']);
  });

  test('a phase already part-certified only offers what is left of it', () => {
    const p = planWageFold([day('A1', 1000)], [lump('M1', 3000, 2500), lump('M2', 5000)]);
    expect(p.steps).toEqual([{ milestoneId: 'M1', applied: 500 }, { milestoneId: 'M2', applied: 500 }]);
  });

  test('a full phase is skipped, not part-filled', () => {
    const p = planWageFold([day('A1', 800)], [lump('M1', 3000, 3000), lump('M2', 5000)]);
    expect(p.steps).toEqual([{ milestoneId: 'M2', applied: 800 }]);
  });

  test('a contract with no room left takes nothing', () => {
    const p = planWageFold([day('A1', 800)], [lump('M1', 3000, 3000)]);
    expect(p.steps.length).toBe(0);
    expect(p.rowIds.length).toBe(0);
  });

  test('a day is never half-settled — the last step is trimmed back to the last whole day', () => {
    // ₹1,200 of room, ₹900/day: only one whole day fits, so only ₹900 is certified.
    const p = planWageFold([day('A1', 900), day('A2', 900)], [lump('M1', 1200)]);
    expect(p.steps).toEqual([{ milestoneId: 'M1', applied: 900 }]);
    expect(p.rowIds).toEqual(['A1']);
  });

  test('what is certified always equals what is settled', () => {
    const rows = [day('A1', 700), day('A2', 1100), day('A3', 400)];
    const p = planWageFold(rows, [lump('M1', 1000), measured('M2', 10, 90)]);
    const certified = p.steps.reduce((a, s) => a + s.applied, 0);
    const settled = p.rowIds.reduce((a, id) => a + rows.find(r => r.id === id)!.amount, 0);
    expect(certified).toBe(settled);
  });

  test('not even the first day fits — nothing is planned', () => {
    const p = planWageFold([day('A1', 900)], [lump('M1', 400)]);
    expect(p.steps.length).toBe(0);
    expect(p.rowIds.length).toBe(0);
  });
});

suite('settling only what an approval covers', () => {
  const week = [{ id: 'A1', amount: 900 }, { id: 'A2', amount: 900 }, { id: 'A3', amount: 900 }];

  test('nothing approved settles no day', () => {
    expect(daysCovered(week, 0)).toEqual([]);
  });

  test('the whole week approved settles the whole week', () => {
    expect(daysCovered(week, 2700)).toEqual(['A1', 'A2', 'A3']);
  });

  test('a part approved settles only the days it reaches', () => {
    expect(daysCovered(week, 1800)).toEqual(['A1', 'A2']);
  });

  test('a part-day of approval settles no extra day — that wage keeps standing', () => {
    expect(daysCovered(week, 2000)).toEqual(['A1', 'A2']);
  });

  test('rounding to the rupee never strands a day', () => {
    expect(daysCovered([{ id: 'A1', amount: 333.34 }], 333)).toEqual(['A1']);
  });

  test('the first day it cannot reach stops the run', () => {
    expect(daysCovered([{ id: 'A1', amount: 900 }, { id: 'A2', amount: 5000 }, { id: 'A3', amount: 100 }], 1500))
      .toEqual(['A1']);
  });
});
