export interface TxnDisplay {
  line1: string; // Name · Trade
  line2: string; // Project · Annotation
  line3: string; // Mode · Date
  id: string;
  amount: number;
}

function isCostCode(s: string): boolean {
  return /^[A-Z]{2,4}-\d{2}(-\d{2})?$/.test(s);
}

export function formatTxn(txn: any): TxnDisplay {
  const name  = txn.stakeholders?.name || '';
  const trade = txn.stakeholders?.category || '';
  const line1 = dot([name, trade]) || 'Payment';

  const project    = txn.projects?.name || txn.txn_allocations?.[0]?.projects?.name || (txn as any).projectName || '';
  const rawAnnotation = txn.remarks?.slice(0, 60) || (!isCostCode(txn.category || '') ? txn.category : '') || '';
  const line2      = dot([project, rawAnnotation]);

  const mode = txn.payment_mode || '';
  const date = txn.date ? formatShortDate(txn.date) : '';
  const line3 = dot([mode, date]);

  return { line1, line2, line3, id: txn.txn_id || '', amount: txn.total_amount || 0 };
}

function dot(parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}

function formatShortDate(d: string): string {
  const date      = new Date(d);
  const today     = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString())     return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}
