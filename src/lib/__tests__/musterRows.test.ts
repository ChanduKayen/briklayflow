// WHAT A MUSTER ALWAYS OFFERS.
//
// A mason does not turn up alone. The man marking the register is standing in the doorway counting
// heads, not editing an engagement, so the sheet that records a day always shows the same three
// lines — the trade, a male helper, a female helper — whether or not the crew carries them yet.
//
// The rules that matter: a line the crew already has keeps ITS label and ITS rate (a crew that pays
// its helper ₹620 is not re-quoted the card's ₹600); the three come first, in that order; anything
// else the crew carries keeps its place after them, because it was put there on purpose; and a crew
// with no trade at all — a gang of helpers — is not given a fake one.

import { suite, test, expect } from './harness'
import { musterLines, skilledOf, isHelper, HELPER_M, HELPER_F } from '../../components/attendance/musterRows'

const card: Record<string, number> = { Mason: 900, Tiler: 950, Supervisor: 1200, [HELPER_M]: 600, [HELPER_F]: 500 };
const rate = (l: string) => card[l] ?? 700;
const has = (...labels: string[]) => labels.map((label) => ({ label, row: { id: label } }));
const shape = (ls: ReturnType<typeof musterLines>) => ls.map((l) => `${l.label}${l.own ? '' : ' (offered)'}`);

suite('the lines a muster shows', () => {
  test('a mason on his own is still asked about his helpers', () => {
    expect(shape(musterLines('Mason', has('Mason'), rate)))
      .toEqual(['Mason', 'Helper · male (offered)', 'Helper · female (offered)']);
  });

  test('a crew that already has all three is left exactly as it is', () => {
    expect(shape(musterLines('Mason', has('Mason', HELPER_M, HELPER_F), rate)))
      .toEqual(['Mason', 'Helper · male', 'Helper · female']);
  });

  test('the trade leads, whatever order the crew was built in', () => {
    expect(shape(musterLines('Tiler', has(HELPER_F, 'Tiler'), rate)))
      .toEqual(['Tiler', 'Helper · male (offered)', 'Helper · female']);
  });

  test('a line the crew carries keeps the rate the crew pays', () => {
    const own = [{ label: HELPER_M, row: { id: 'x' } }];
    const lines = musterLines('Mason', own, (l) => (l === HELPER_M ? 620 : rate(l)));
    expect(lines.find((l) => l.label === HELPER_M)?.rate).toBe(620);
  });

  test('and an offered line is quoted from the rate card', () => {
    expect(musterLines('Mason', has('Mason'), rate).find((l) => l.label === HELPER_F)?.rate).toBe(500);
  });

  test('a gang of helpers is not given a trade it does not have', () => {
    expect(shape(musterLines(null, has(HELPER_M), rate))).toEqual(['Helper · male', 'Helper · female (offered)']);
  });

  test('a supervisor is not a trade, so the helpers are still offered under one', () => {
    expect(shape(musterLines(null, has('Supervisor'), rate)))
      .toEqual(['Helper · male (offered)', 'Helper · female (offered)', 'Supervisor']);
  });

  test('anything else the crew carries keeps its place, after the three', () => {
    expect(shape(musterLines('Mason', has('Mason', 'Supervisor', 'Bar bender'), rate)))
      .toEqual(['Mason', 'Helper · male (offered)', 'Helper · female (offered)', 'Supervisor', 'Bar bender']);
  });

  test('a second trade does not become a second first line', () => {
    const lines = musterLines('Mason', has('Bar bender', 'Mason'), rate);
    expect(lines[0].label).toBe('Mason');
    expect(lines.filter((l) => l.label === 'Bar bender').length).toBe(1);
  });

  test('a helper typed with a dash is the same helper, not a fourth line', () => {
    expect(shape(musterLines('Mason', has('Mason', 'Helper - male'), rate)))
      .toEqual(['Mason', 'Helper - male', 'Helper · female (offered)']);
  });

  test('the crew with no lines at all is still a full muster', () => {
    expect(shape(musterLines('Tiler', [], rate)))
      .toEqual(['Tiler (offered)', 'Helper · male (offered)', 'Helper · female (offered)']);
  });

  test('nothing at all, not even a trade — the two helpers stand', () => {
    expect(shape(musterLines(null, [], rate))).toEqual(['Helper · male (offered)', 'Helper · female (offered)']);
  });
});

suite('which line is the trade', () => {
  test('the crew was engaged as one', () => {
    expect(skilledOf('Mason', [HELPER_M])).toBe('Mason');
  });
  test('it was not, so the first line that is a trade stands in', () => {
    expect(skilledOf(null, [HELPER_M, 'Tiler'])).toBe('Tiler');
  });
  test('a helper is never the trade', () => {
    expect(skilledOf(HELPER_M, [HELPER_M])).toBe(null);
  });
  test('nor is a supervisor', () => {
    expect(skilledOf('Supervisor', ['Supervisor'])).toBe(null);
  });
  test('a helper is a helper however it is written', () => {
    expect([isHelper('helper male'), isHelper('Helper - Female'), isHelper('Mason')]).toEqual([true, true, false]);
  });
});

// THE CARD'S NAME FOR WHAT THEY DO.
//
// The party list and the rate card speak different dialects. A party is created as a "Tile Fitter" or
// a "Shuttering Carpenter" — the words the Parties drawer offers — while the card prices a "Tiler" and
// a "Carpenter". This map is what lets the muster quote a rate at all, and it used to sit verbatim in
// both attendance components while the card lookup ignored it entirely: a tiler was priced at the
// ₹700 fallback instead of his own ₹950.
//
// A role that is not a trade maps to nothing on purpose. It has no skilled rate, and the muster
// prices it from the unskilled side of the card instead.

import { cardTradeOf, rateNote, tradeOptionsHTML, OTHER_TRADE } from '../../components/attendance/tradeList'

suite('what the card calls this trade', () => {
  test('the party list’s words map onto the card’s', () => {
    expect(['Tile Fitter', 'Marble Fixer', 'Shuttering Carpenter', 'Stone Mason', 'Painting Worker', 'Bar Bender / Reinforcement']
      .map((t) => cardTradeOf(t)))
      .toEqual(['Tiler', 'Tiler', 'Carpenter', 'Mason', 'Painter', 'Bar bender']);
  });

  test('a trade the card already names is itself', () => {
    expect([cardTradeOf('Mason'), cardTradeOf('Plumber')]).toEqual(['Mason', 'Plumber']);
  });

  test('a trade nobody has written down is taken as given', () => {
    expect(cardTradeOf('Glazier')).toBe('Glazier');
  });

  test('what is not a trade maps to nothing, so it is priced as unskilled', () => {
    expect(['Helper · male', 'Unskilled Labour', 'Site Supervisor', 'Security Guard', 'Driver', 'Crane / JCB Operator']
      .map((t) => cardTradeOf(t))).toEqual([null, null, null, null, null, null]);
  });

  test('case and spacing do not change the answer', () => {
    expect([cardTradeOf('  tile fitter '), cardTradeOf('TILE FITTER')]).toEqual(['Tiler', 'Tiler']);
  });

  test('nothing at all is nothing', () => {
    expect([cardTradeOf(''), cardTradeOf(null), cardTradeOf(undefined)]).toEqual([null, null, null]);
  });
});

suite('what the site is told the day is worth', () => {
  test('a trade on the card, under its own name', () => {
    expect(rateNote('Mason', 'Mason', 900, true)).toBe('₹900/day from your rate card');
  });
  test('a trade on the card, under another name, says which', () => {
    expect(rateNote('Tile Fitter', 'Tiler', 950, true)).toBe('₹950/day · priced as Tiler');
  });
  test('a rate that was fallen back to is not called a rate the office set', () => {
    expect(rateNote('Glazier', 'Glazier', 700, false)).toBe('₹700/day · not on your rate card yet');
  });
  test('and no rate at all says so plainly', () => {
    expect(rateNote('Site Supervisor', null, 0, false)).toBe('no rate on your card yet — set one under Rate card');
  });
  test('nothing picked, nothing said', () => {
    expect(rateNote('', null, 0, false)).toBe('');
  });
});

suite('the dropdown the muster offers', () => {
  const html = tradeOptionsHTML('', (s: string) => s);
  test('it is the app’s own grouped list', () => {
    expect(html.includes('<optgroup label="Civil & Structural">') && html.includes('<option value="Mason">')).toBe(true);
  });
  test('it opens on a prompt, not on a trade', () => {
    expect(html.startsWith('<option value="">Select trade…</option>')).toBe(true);
  });
  test('and ends on "Other (specify)"', () => {
    expect(html.trimEnd().endsWith(`<option value="${OTHER_TRADE}">${OTHER_TRADE}</option></optgroup>`)).toBe(true);
  });
  test('what was already picked comes back selected', () => {
    expect(tradeOptionsHTML('Tile Fitter', (s: string) => s).includes('<option value="Tile Fitter" selected>')).toBe(true);
  });
});
