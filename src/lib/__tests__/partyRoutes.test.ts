// Where the search sends you when you pick a party's Ledger / Orders / Bills.
//
// The rule that matters: a vendor is never offered Contracts and a worker is never offered Orders,
// because that row would land on a page with nothing on it.
import { suite, test, expect } from './harness'
import { crossCutsFor } from '../../components/search/partyRoutes'

const titles = (type: string) => crossCutsFor({ id: 'p1', type }).map(c => c.title)
const hrefOf = (type: string, key: string) => crossCutsFor({ id: 'p1', type }).find(c => c.key === key)?.href

suite('party cross-cuts', () => {
  test('a vendor: ledger, orders, bills, payments — never contracts', () => {
    expect(titles('Vendor')).toEqual(['Ledger', 'Orders', 'Bills', 'Payments'])
  })

  test('a worker: ledger, contracts, payments — never orders or bills', () => {
    expect(titles('Worker')).toEqual(['Ledger', 'Contracts', 'Payments'])
  })

  test('a client: ledger, invoices, payments', () => {
    expect(titles('Client')).toEqual(['Ledger', 'Invoices', 'Payments'])
  })

  test('an unknown or missing type is treated as a vendor', () => {
    expect(titles('')).toEqual(['Ledger', 'Orders', 'Bills', 'Payments'])
    expect(titles('supplier')).toEqual(['Ledger', 'Orders', 'Bills', 'Payments'])
  })

  test('type is matched case-insensitively — the column is title-case, the data is not always', () => {
    expect(titles('worker')).toEqual(['Ledger', 'Contracts', 'Payments'])
    expect(titles('WORKER')).toEqual(['Ledger', 'Contracts', 'Payments'])
  })

  test('every destination but the ledger narrows its page to the party', () => {
    expect(hrefOf('Vendor', 'po')).toBe('/purchase-orders?party=p1')
    expect(hrefOf('Vendor', 'bills')).toBe('/bills?party=p1')
    expect(hrefOf('Vendor', 'pay')).toBe('/ledger?party=p1')
    expect(hrefOf('Worker', 'wo')).toBe('/work-orders?party=p1')
    expect(hrefOf('Client', 'inv')).toBe('/invoices?party=p1')
  })

  test('the ledger is the party, so it is a page of its own, not a filter', () => {
    expect(hrefOf('Vendor', 'ledger')).toBe('/stakeholders/p1')
  })

  test('an id with characters a URL cares about survives the trip', () => {
    const href = crossCutsFor({ id: 'a/b c', type: 'Vendor' }).find(c => c.key === 'po')?.href
    expect(href).toBe('/purchase-orders?party=a%2Fb%20c')
  })
})
