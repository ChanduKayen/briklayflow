export type TxnContext = 'global' | 'wo' | 'po' | 'stakeholder' | 'project';

export interface TxnDisplay {
  primary: string;
  secondary: string | null;
  tertiary: string | null;
  id: string;
  amount: number;
  status?: string;
}

function isCostCode(s: string): boolean {
  return /^[A-Z]{2,4}-\d{2}(-\d{2})?$/.test(s);
}

function dot(parts: (string | null | undefined)[]): string | null {
  const joined = parts.filter(Boolean).join(' · ');
  return joined || null;
}

export function formatTxn(txn: any, context: TxnContext = 'global'): TxnDisplay {
  const name    = txn.stakeholders?.name || null;
  const trade   = txn.stakeholders?.category || null;
  const project = txn.projects?.name
    || txn.txn_allocations?.[0]?.projects?.name
    || (txn as any).projectName
    || null;
  const rawDetail = txn.remarks?.slice(0, 60)
    || (!isCostCode(txn.category || '') ? (txn.category || null) : null);
  const mode = txn.payment_mode || null;
  const date = txn.date ? formatShortDate(txn.date) : null;
  const modeDate = dot([mode, date]);

  let primary: string;
  let secondary: string | null;
  let tertiary: string | null;

  switch (context) {
    case 'wo':
    case 'po':
      // Stakeholder + project already shown in page header — show WHAT · WHEN
      primary   = rawDetail || 'Payment';
      secondary = modeDate;
      tertiary  = null;
      break;

    case 'stakeholder':
      // Person known — show WHERE · WHAT, then WHEN
      primary   = dot([project, rawDetail]) || 'Payment';
      secondary = modeDate;
      tertiary  = null;
      break;

    case 'project':
      // Project known — show WHO · TRADE, then WHAT, then WHEN
      primary   = dot([name, trade]) || rawDetail || 'Payment';
      secondary = name ? rawDetail : null;
      tertiary  = modeDate;
      break;

    case 'global':
    default:
      // Show everything: WHO · TRADE / WHERE · WHAT / WHEN
      primary   = dot([name, trade]) || rawDetail || 'Payment';
      secondary = dot([project, rawDetail]);
      tertiary  = modeDate;
      break;
  }

  return {
    primary,
    secondary,
    tertiary,
    id: txn.txn_id || '',
    amount: Number(txn.total_amount) || 0,
    status: txn.status,
  };
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
