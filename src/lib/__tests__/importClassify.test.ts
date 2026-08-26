// importClassify — the code-disposes floor around the party-trade LLM: whatever the model says, the
// result is snapped onto the real trades.ts taxonomy, so a hallucinated or off-list trade can never
// reach the create-new form. And only NEW (unmatched) parties are sent for classification.

import { suite, test, expect } from './harness';
import { snapClassification, partiesToClassify, classificationsByName } from '../importClassify';
import { OTHER_TRADE } from '../trades';
import type { NameGroup } from '../importResolve';

const grp = (src: string, band: 'auto' | 'confirm' | 'open', notes: string[] = []): NameGroup => ({
  key: src.toLowerCase(), src, rowNos: [1], notes,
  match: { band, best: band === 'open' ? null : { id: 'X', name: src, score: 1 }, alts: [], doubt: false, closest: [] },
});

suite('importClassify — snap the model onto the real taxonomy', () => {
  test('an exact trade is kept, and it fixes the type (a Mason is a Worker)', () => {
    expect(snapClassification({ type: 'Vendor', trade: 'Mason' })).toEqual({ type: 'Worker', trade: 'Mason' });
  });

  test('an exact vendor trade is kept as a Vendor', () => {
    expect(snapClassification({ type: 'Vendor', trade: 'Cement Supplier' })).toEqual({ type: 'Vendor', trade: 'Cement Supplier' });
  });

  test('case-insensitive exact match still lands', () => {
    expect(snapClassification({ type: 'worker', trade: 'mason' })).toEqual({ type: 'Worker', trade: 'Mason' });
  });

  test('a near miss snaps to the closest real trade in the given type', () => {
    // "cement" → "Cement Supplier" within Vendor (substring score 0.9).
    expect(snapClassification({ type: 'Vendor', trade: 'cement' })).toEqual({ type: 'Vendor', trade: 'Cement Supplier' });
  });

  test('an invented trade falls back to Other (specify), never leaks through', () => {
    expect(snapClassification({ type: 'Worker', trade: 'Spaceship Pilot' })).toEqual({ type: 'Worker', trade: OTHER_TRADE });
  });

  test('a garbage/absent type defaults to Vendor (commonest on an expenses import)', () => {
    expect(snapClassification({ type: 'xyz', trade: '' }).type).toBe('Vendor');
    expect(snapClassification({}).trade).toBe(OTHER_TRADE);
  });
});

suite('importClassify — only NEW parties are classified', () => {
  test('open-band names are sent (with their notes); matched/confirm are not', () => {
    const groups = [
      grp('Balaji Hardware', 'auto'),
      grp('Durga', 'confirm'),
      grp('Nagaraju Sand', 'open', ['river sand', 'lorry']),
    ];
    const parties = partiesToClassify(groups);
    expect(parties.map((p) => p.name)).toEqual(['Nagaraju Sand']);
    expect(parties[0].notes).toEqual(['river sand', 'lorry']);
  });
});

suite('importClassify — fold results into a name-keyed prefill map', () => {
  test('results snap and key by normalized name; garbage rows drop', () => {
    const map = classificationsByName([
      { name: 'Nagaraju Sand', type: 'Vendor', trade: 'sand & aggregate' },   // → snaps within Vendor
      { name: '', type: 'Worker', trade: 'Mason' },                           // dropped (no name)
    ]);
    expect(Object.keys(map)).toEqual(['nagaraju sand']);
    expect(map['nagaraju sand'].type).toBe('Vendor');
    expect(map['nagaraju sand'].trade).toBe('Sand & Aggregate Supplier');
  });
});
