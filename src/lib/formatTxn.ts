export function formatTxn(txn: any) {
  const who =
    txn.stakeholders?.name ||
    txn.payee_name ||
    txn.payee_raw ||
    txn.category ||
    'Payment';

  const what =
    txn.remarks?.slice(0, 40) ||
    txn.category ||
    '';

  const site = txn.projects?.name || null;
  const mode = txn.payment_mode || null;
  const date = txn.date ? formatShortDate(txn.date) : null;

  const subParts = [site, mode, date].filter(Boolean);

  return {
    primary: what ? `${who} · ${what}` : who,
    sub: subParts.join(' · '),
    id: txn.txn_id || '',
    amount: txn.total_amount || 0,
  };
}

function formatShortDate(d: string): string {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}
