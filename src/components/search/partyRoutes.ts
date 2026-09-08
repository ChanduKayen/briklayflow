/**
 * Where a party lives.
 *
 * A vendor never has a contract and a worker never has a purchase order, so neither is ever offered
 * a row that lands on an empty page. Kept free of React and supabase so it can be tested on its own.
 */
export interface PartyLike { id: string; type: string }
export interface CrossCut { key: string; title: string; href: string; icon: string }

export function crossCutsFor(p: PartyLike): CrossCut[] {
  const q = `?party=${encodeURIComponent(p.id)}`;
  const ledger: CrossCut = { key: 'ledger', title: 'Ledger', href: `/stakeholders/${p.id}`, icon: '▤' };
  const payments: CrossCut = { key: 'pay', title: 'Payments', href: `/ledger${q}`, icon: '⇄' };
  const t = (p.type || '').toLowerCase();
  if (t === 'worker') return [ledger, { key: 'wo', title: 'Contracts', href: `/work-orders${q}`, icon: '▥' }, payments];
  if (t === 'client') return [ledger, { key: 'inv', title: 'Invoices', href: `/invoices${q}`, icon: '▤' }, payments];
  return [
    ledger,
    { key: 'po', title: 'Orders', href: `/purchase-orders${q}`, icon: '▦' },
    { key: 'bills', title: 'Bills', href: `/bills${q}`, icon: '▤' },
    payments,
  ];
}
