// TWO PLACES NAMED THE SAME PAYMENT DIFFERENTLY.
//
// Reported live with a screenshot, 2026-09-18. A WhatsApp capture — "Paid 300 to kollu dirga
// prasad" — was re-filed at review as an overhead under GEN-01. The ledger row then read
// "Transport & logistics", the head it was filed under. The transaction page, one tap away, still
// read "Paid to kollu dirga prasad" and offered to "link kollu dirga prasad's contract".
//
// The list asked payeeLabel(). The detail page had grown its own line:
//
//     txn.stakeholders?.name || (isGeneralExpense(txn) ? (ai_flag_data.general_payee || …) : 'Unknown')
//
// general_payee is the name the SITE said at capture — who the cash was handed to. It is not who the
// books owe: an overhead is party-less by construction. Preferring it there meant the page named a
// person the transaction deliberately does not have, and then offered that person a contract.
//
// These are payeeLabel's terms, so the one function both pages read cannot drift again.

import { suite, test, expect } from './harness'
import { payeeLabel, generalExpenseLabel, isGeneralExpense } from '../transactions'

const gen = (category: string, heard?: string) => ({
  stakeholder_id: null, category,
  ai_flag_data: heard ? { general_payee: heard } : {},
});

suite('a general expense is named by its head, never by who held the cash', () => {
  test('THE BUG: the head wins over the name the site said', () => {
    expect(payeeLabel(gen('GEN-01', 'kollu dirga prasad'))).toBe('Transport & logistics')
    expect(payeeLabel(gen('GEN-16', 'hamali boys'))).toBe('Loading & unloading (hamali)')
  })

  test('with no heard name it still reads as its head', () => {
    expect(payeeLabel(gen('GEN-02'))).toBe('Fuel & diesel')
  })

  test('the catch-all head stays generic — GEN-99 names nothing in particular', () => {
    expect(generalExpenseLabel(gen('GEN-99', 'someone'))).toBe('General expense')
    expect(payeeLabel(gen('GEN-99', 'someone'))).toBe('General expense')
  })

  test('an unknown GEN code falls back rather than printing the code', () => {
    expect(generalExpenseLabel(gen('GEN-77'))).toBe('General expense')
  })

  test('a party payment is untouched — the party names it', () => {
    expect(payeeLabel({ stakeholder_id: 'S1', stakeholders: { name: 'Srinu' }, category: 'MAT-04' })).toBe('Srinu')
  })

  test('a NULL party that is NOT a general expense is a removed contact, not an overhead', () => {
    expect(isGeneralExpense({ stakeholder_id: null, category: 'MAT-04' })).toBe(false)
    expect(payeeLabel({ stakeholder_id: null, category: 'MAT-04' })).toBe('(removed contact)')
  })

  test('a wallet transfer names the wallet, whatever else is on the row', () => {
    expect(payeeLabel({ stakeholder_id: null, category: 'GEN-01', wallet_dir: 'in', is_transfer: true, wallets: { holder_name: 'Ravi' } }))
      .toBe("Ravi's wallet")
  })
})
