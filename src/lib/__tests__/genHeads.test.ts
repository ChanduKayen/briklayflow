// "THE PAYEE EDIT FIELD IS NOT SHOWING GENERAL EXPENSE HEADS IN DROPDOWN"
//
// Reported against the Day Book review page. Not every payment has a payee: diesel, hamali, a tea
// bill, the electricity. Those file under an overhead head with NO party — and if the picker doesn't
// offer the heads, the only way out is to invent "Diesel" as a party, which is how a contact list
// fills with things that are not people.
//
// The desktop editor had the heads; the phone's picker had none. Both now ask the same function, so
// what "hamali" finds on a laptop is what it finds on a phone. These are that function's terms:
//   · a street word finds its head ("hamali" → Loading & unloading)
//   · word order and separators don't matter ("load unload", "un-loading")
//   · nothing typed still answers — the common few, so overheads are visible before a letter is
//     typed (the phone picker's empty state)

import { suite, test, expect } from './harness'
import { searchGenHeads, COMMON_GEN_HEADS, GEN_HEADS } from '../costCodes'

const codes = (q: string) => searchGenHeads(q).map((h) => h.code);
const names = (q: string) => searchGenHeads(q).map((h) => h.name);

suite('general-expense heads — the payee picker\'s other half', () => {
  test('the word a site actually uses finds the head', () => {
    expect(codes('hamali')).toEqual(['GEN-16']);
    expect(codes('diesel')).toEqual(['GEN-02']);
    expect(codes('watchman')).toEqual(['GEN-15']);
  });

  test('word order and separators do not matter', () => {
    expect(codes('load unload')).toEqual(['GEN-16']);
    expect(codes('unloading loading')).toEqual(['GEN-16']);
    expect(codes('un-loading')).toEqual(['GEN-16']);
    expect(codes('  LOADING  ')).toEqual(['GEN-16']);
  });

  test('a partial word still lands (it is typed one letter at a time)', () => {
    expect(codes('fue')).toEqual(['GEN-02']);
    expect(codes('transp')).toEqual(['GEN-01']);
  });

  test('one query may answer with several heads', () => {
    expect(codes('site').length > 1).toBe(true);
  });

  test('a query that names nobody answers with nothing', () => {
    expect(codes('srinu')).toEqual([]);
    expect(codes('zzz')).toEqual([]);
  });

  test('nothing typed answers with the common few, in their stated order', () => {
    expect(codes('')).toEqual(COMMON_GEN_HEADS);
    expect(codes('   ')).toEqual(COMMON_GEN_HEADS);
  });

  test('every common head is a real head', () => {
    const all = GEN_HEADS.map((h) => h.code);
    expect(COMMON_GEN_HEADS.every((c) => all.includes(c))).toBe(true);
    expect(names('').includes('Miscellaneous / uncategorised')).toBe(true);
  });
});
