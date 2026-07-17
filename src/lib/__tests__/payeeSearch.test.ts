// "WHEN A USER SEARCHES SREENU IT'S NOT SHOWING ANYTHING RELATED TO SRINU"
//
// Reported live, 2026-07-17, against the Day Book approve/edit picker. The filter was:
//
//     stakeholders.filter((s) => s.name.toLowerCase().includes(payeeSearch.toLowerCase()))
//
// `"srinu".includes("sreenu")` → false. Nothing matches, and the dropdown's zero-match branch promotes
// "Create *sreenu*" to the top as the hero. The picker did not just fail to find Srinu — it offered to file
// a second one, one tap away, and every payment after that splits between two Srinus at random.
//
// The same query on WhatsApp scores Srinu at 0.70 and asks "which Srinu?". Same org, same roster, same
// name, two matchers, two answers. This gate is the Day Book's half.

import { suite, test, expect } from './harness'
import { searchPayees, rankPayeeName, PAYEE_SEARCH_FLOOR } from '../payeeSearch'

const ROSTER = [
  { stakeholder_id: 'S1', name: 'Srinu' },
  { stakeholder_id: 'S2', name: 'Suribabu' },
  { stakeholder_id: 'S3', name: 'Raju' },
  { stakeholder_id: 'S4', name: 'Srinu Reddy' },
  { stakeholder_id: 'S5', name: 'Ramesh Kumar' },
];
const found = (q: string) => searchPayees(ROSTER, q).map((s) => s.name);

// ── The bug, in the reporter's own words ─────────────────────────────────────────────────────────────────
suite('payee search — a misspelt name finds the man', () => {
  test('"sreenu" finds Srinu', () => {
    expect(found('sreenu').includes('Srinu')).toBe(true);
  });

  // …and finds him FIRST. Buried at rank 4 is barely better than not found, on a phone.
  test('…and Srinu leads the list', () => {
    expect(found('sreenu')[0]).toBe('Srinu');
  });

  // The other half of the same rule: finding him must not mean finding everyone. This is the picker twin of
  // pickable() on the WhatsApp side — Suribabu is not a near-Srinu there and is not one here.
  test('…and Suribabu and Raju are NOT dragged in with him', () => {
    expect(found('sreenu').includes('Suribabu')).toBe(false);
    expect(found('sreenu').includes('Raju')).toBe(false);
  });

  // More real spellings the site actually types. Each is a 1–2 edit hop, which is what d<=2 buys.
  test('the common Telugu spelling variants all land', () => {
    for (const [q, want] of [['sreenu', 'Srinu'], ['seenu', 'Srinu'], ['srinu', 'Srinu']] as const) {
      expect(searchPayees(ROSTER, q).map((s) => s.name).includes(want)).toBe(true);
    }
    expect(searchPayees([{ name: 'Navin' }], 'naveen').length).toBe(1);
    expect(searchPayees([{ name: 'Santosh' }], 'santhosh').length).toBe(1);
    expect(searchPayees([{ name: 'Bhaskar' }], 'baskar').length).toBe(1);
  });
});

// ── The regression a naive fix would have shipped ────────────────────────────────────────────────────────
// The scorer's substring/prefix rules need q.length >= 3, so swapping includes() for the scorer outright
// would score "s" at 0.2 and empty the dropdown on the first two keystrokes of EVERY search — handing back
// the same "Create…" hero this fix exists to prevent, for a completely different reason.
suite('payee search — incremental typing still works, letter by letter', () => {
  test('one letter already narrows, and shows nobody it should not', () => {
    const r = found('s');
    expect(r.includes('Srinu')).toBe(true);
    expect(r.includes('Suribabu')).toBe(true);
    expect(r.includes('Raju')).toBe(false);
  });

  test('two letters narrow further', () => {
    expect(found('sr').includes('Srinu')).toBe(true);
    expect(found('sr').includes('Suribabu')).toBe(false);
  });

  test('a prefix beats a mid-word hit', () => {
    expect(found('sri')[0]).toBe('Srinu');
  });

  test('a second-word prefix is still a hit ("reddy" → Srinu Reddy)', () => {
    expect(found('reddy').includes('Srinu Reddy')).toBe(true);
  });

  test('an exact name leads, ahead of the longer name that contains it', () => {
    expect(found('srinu')[0]).toBe('Srinu');
    expect(found('srinu').includes('Srinu Reddy')).toBe(true);
  });
});

// ── Browsing is not searching ────────────────────────────────────────────────────────────────────────────
suite('payee search — an empty box is not a filter', () => {
  test('no query returns the whole roster, in its given order', () => {
    expect(searchPayees(ROSTER, '').length).toBe(ROSTER.length);
    expect(searchPayees(ROSTER, '   ').map((s) => s.name)[0]).toBe('Srinu');
  });

  test('a name nobody has finds nobody — the Create hero is CORRECT here', () => {
    expect(found('zzzz qqqq')).toEqual([]);
  });
});

// ── The known gap, pinned honestly ───────────────────────────────────────────────────────────────────────
// d<=2 carries one- and two-edit variance, which is most of it. It does NOT carry multi-character
// substitutions: ksh→x is three edits. laxmi/Lakshmi scores 0.57 and falls below the floor — in the Day
// Book AND on WhatsApp, identically, because the scorers are mirrors.
//
// This test asserts the CURRENT truth so the gap is a known quantity rather than a surprise, and so that
// the day someone adds a phonetic fold (ee→i, oo→u, th→t, ksh→x) this test fails LOUDLY and gets rewritten
// deliberately. It is not a claim that 0.57 is correct. It is a claim that we know it is 0.57.
suite('payee search — the phonetic gap is known, not hidden', () => {
  test('laxmi does NOT yet find Lakshmi (ksh→x is 3 edits, below the floor)', () => {
    expect(rankPayeeName('laxmi', 'Lakshmi') < PAYEE_SEARCH_FLOOR).toBe(true);
    expect(searchPayees([{ name: 'Lakshmi' }], 'laxmi')).toEqual([]);
  });
});
