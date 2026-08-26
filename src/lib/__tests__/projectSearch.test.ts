// projectSearch — the browser twin of the Edge project scorer, for the Transactions importer's
// site-resolution step. Proves the bands the importer's state machine reads (auto → collapse,
// confirm → "?" + alternates, open → create-new) and the "which one?" doubt flag. Kept in lockstep
// with supabase/functions/whatsapp-webhook/_match.ts (scoreName + distinctiveTokens + FILLER).

import { suite, test, expect } from './harness';
import { matchProject, scoreProjectName } from '../projectSearch';

const PROJECTS = [
  { id: 'P1', name: 'Gandhinagar Villas' },
  { id: 'P2', name: 'The Pride' },
  { id: 'P3', name: 'Sri Lakshmi Residence' },
  { id: 'P4', name: 'Sri Lakshmi Towers' },
  { id: 'P5', name: 'Kakinada Bypass Duplex' },
  { id: 'P6', name: 'Sri Raghavendra Constructions' },
  { id: 'P7', name: 'Prestige' },
];

suite('projectSearch — bands the importer reads', () => {
  test('an exact name is an AUTO match to that project', () => {
    const m = matchProject('Gandhinagar Villas', PROJECTS);
    expect(m.band).toBe('auto');
    expect(m.best?.id).toBe('P1');
    expect(m.doubt).toBe(false);
  });

  test('a substring mention ("pride") auto-links to the real project', () => {
    const m = matchProject('pride', PROJECTS);
    expect(m.band).toBe('auto');
    expect(m.best?.id).toBe('P2');
  });

  test('filler is stripped — "kakinada bypass" reaches "Kakinada Bypass Duplex"', () => {
    const m = matchProject('kakinada bypass', PROJECTS);
    expect(m.best?.id).toBe('P5');
    expect(m.band).toBe('auto');
  });

  test('a full initialism ("SRC") structurally matches "Sri Raghavendra Constructions"', () => {
    const m = matchProject('SRC', PROJECTS);
    expect(m.best?.id).toBe('P6');
    expect(m.band).toBe('auto');
  });

  test('two "Sri Lakshmi" projects → both offered, flagged as a doubt (which one?)', () => {
    const m = matchProject('lakshmi', PROJECTS);
    expect(m.band).toBe('auto');
    expect(m.doubt).toBe(true);                                  // near-tie → surface the "?"
    const ids = [m.best?.id, ...m.alts.map((a) => a.id)].sort();
    expect(ids).toEqual(['P3', 'P4']);                           // best + its twin, both offered
  });

  test('a confirm-grade fuzzy hit is offered WITH a doubt, not silently taken', () => {
    const m = matchProject('prestege', PROJECTS);               // 1 edit from "Prestige" → 0.7
    expect(m.band).toBe('confirm');
    expect(m.best?.id).toBe('P7');
    expect(m.doubt).toBe(true);
  });

  test('no plausible project → OPEN (drop to create-new), best is null but closest is kept', () => {
    const m = matchProject('Zenith Heights', PROJECTS);
    expect(m.band).toBe('open');
    expect(m.best).toBe(null);
    expect(m.closest.length > 0).toBe(true);                    // still ranked, for a lower-floor caller
  });

  test('an empty mention resolves to nothing', () => {
    const m = matchProject('   ', PROJECTS);
    expect(m.band).toBe('open');
    expect(m.best).toBe(null);
  });

  test('scoreProjectName is exact-1 / substring-0.9, matching the Edge scorer', () => {
    expect(scoreProjectName('the pride', 'The Pride')).toBe(1.0);
    expect(scoreProjectName('pride', 'The Pride')).toBe(0.9);
  });
});
