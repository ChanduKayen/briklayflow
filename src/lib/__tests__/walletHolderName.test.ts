// "WHEN A PARTY NAME IS CHANGED, IT'S NOT REFLECTING IN THE WALLET."
//
// Reported live, 2026-09-18. wallets.holder_name is a SNAPSHOT, taken when the wallet was made — and
// every "X's wallet" line in the app reads it: the wallet rail, the ledger rows (they join
// wallets(holder_name)), the transaction page. Rename the person and the whole app followed except
// the wallet, which went on saying the old name.
//
// The person is one person in two records — a member who signs in (user_profiles) and a party who
// gets paid (stakeholders) — bridged by their WhatsApp number in wa_registered_numbers, the same
// bridge walletForSender crosses in the other direction. This is the order that bridge implies.

import { suite, test, expect } from './harness'
import { holderNameNow } from '../walletApi'

suite('whose wallet it is — the name that person carries now', () => {
  test('THE BUG: the party name wins over the snapshot the wallet was born with', () => {
    expect(holderNameNow({ stakeholderName: 'Kollu Durga Prasad', profileName: 'kollu', snapshot: 'kollu dirga prasad' }))
      .toBe('Kollu Durga Prasad')
  })

  test('no party record → the member profile names them', () => {
    expect(holderNameNow({ stakeholderName: null, profileName: 'Ravi Teja', snapshot: 'Ravi' })).toBe('Ravi Teja')
  })

  test('neither readable → the snapshot stands, never an empty name', () => {
    expect(holderNameNow({ stakeholderName: null, profileName: null, snapshot: 'Ravi' })).toBe('Ravi')
    expect(holderNameNow({ snapshot: 'Ravi' })).toBe('Ravi')
  })

  test('a blank or spaces-only name is not a name — it does not win', () => {
    expect(holderNameNow({ stakeholderName: '   ', profileName: 'Ravi Teja', snapshot: 'Ravi' })).toBe('Ravi Teja')
    expect(holderNameNow({ stakeholderName: '', profileName: '  ', snapshot: 'Ravi' })).toBe('Ravi')
  })

  test('the name is taken as the party writes it, spacing and case included', () => {
    expect(holderNameNow({ stakeholderName: 'K. D. Prasad', snapshot: 'KD Prasad' })).toBe('K. D. Prasad')
  })
})
