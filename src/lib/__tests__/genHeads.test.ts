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

// ── which overheads belong to no job ───────────────────────────────────────────────────────────
//
// "Find a few overheads that don't require a site — office expense etc."
//
// Every other head is site work: hamali, PPE, site utilities, machinery hire, diesel, the watchman.
// A payment for those is a cost of the job it was spent on, so the site is asked for before it files.
// These four are the firm's own: the office rent, the bank's charges, the GST payment, the auditor's
// fee. Demanding a site for them means pinning the office rent to whichever job happens to be open —
// a client's project cost carrying the head office.
//
// A site is still ALLOWED (a licence fee for one building, the architect on one project). It is the
// demand that goes, and with no site named the payment files with no allocation at all.

import { COMPANY_GEN_HEADS, isCompanyHead } from '../costCodes'
import { gapsOf, isResolved } from '../../components/day-book/fileEntry'

const overhead = (head: string, projectId = '') =>
  ({ payeeId: '', projectId, amount: 300, description: 'rent', generalExpense: true, generalExpenseHead: head });

suite('a company overhead needs no site', () => {
  test('the four that the firm pays', () => {
    expect(isCompanyHead('GEN-07')).toBe(true)   // Office & administration
    expect(isCompanyHead('GEN-08')).toBe(true)   // Professional & consultant fees
    expect(isCompanyHead('GEN-09')).toBe(true)   // Government, taxes & statutory
    expect(isCompanyHead('GEN-13')).toBe(true)   // Bank & finance charges
    expect(COMPANY_GEN_HEADS.length).toBe(4)
  })

  test('site work is not among them — it is always a job\'s cost', () => {
    ;['GEN-01', 'GEN-02', 'GEN-03', 'GEN-04', 'GEN-05', 'GEN-06', 'GEN-10', 'GEN-11', 'GEN-12', 'GEN-14', 'GEN-15', 'GEN-16', 'GEN-99']
      .forEach((c) => expect(isCompanyHead(c)).toBe(false))
  })

  test('a code is read as written — case and stray spaces included', () => {
    expect(isCompanyHead('gen-07')).toBe(true)
    expect(isCompanyHead(' GEN-13 ')).toBe(true)
    expect(isCompanyHead(null)).toBe(false)
    expect(isCompanyHead('')).toBe(false)
    expect(isCompanyHead('MAT-04')).toBe(false)
  })

  test('THE POINT: with no site it is still ready to file', () => {
    expect(isResolved(overhead('GEN-07'))).toBe(true)
    expect(gapsOf(overhead('GEN-07'))).toEqual([])
  })

  test('a site-work head with no site is not — that money belongs to a job', () => {
    expect(isResolved(overhead('GEN-16'))).toBe(false)
    expect(gapsOf(overhead('GEN-16'))).toEqual(['project'])
  })

  test('naming a site anyway is allowed, not overruled', () => {
    expect(isResolved(overhead('GEN-09', 'PRJ-1'))).toBe(true)
    expect(gapsOf(overhead('GEN-09', 'PRJ-1'))).toEqual([])
  })

  test('a party payment is untouched — it still needs its site and its payee', () => {
    expect(gapsOf({ payeeId: '', projectId: '', amount: 300, description: '', generalExpense: false }))
      .toEqual(['payee', 'project'])
    expect(isResolved({ payeeId: 'S1', projectId: 'PRJ-1', amount: 300, description: '', generalExpense: false })).toBe(true)
  })

  test('an amount is still an amount — no head waives that', () => {
    expect(gapsOf({ ...overhead('GEN-07'), amount: 0 })).toEqual(['amount'])
  })
})
