/** The bill panel's rings — see billUnsure.test.ts for the terms. */
import type { BillState } from './txDraft';

/**
 * What the reader was unsure of. There is no per-field confidence coming back, so this is the honest
 * reading of what it returned: a field it could not find at all, and a date that cannot be right
 * (tomorrow's bill, or one from before the firm existed — the classic misread of a year or a due date).
 */
export function unsureOf(f: BillState['f']): string[] {
  const out: string[] = [];
  if (!f.vendor.trim()) out.push('vendor');
  if (!f.no.trim()) out.push('no');
  if (!f.date) out.push('date');
  else {
    const d = +new Date(f.date + 'T00:00:00'), now = Date.now();
    if (d > now + 864e5 || d < now - 550 * 864e5) out.push('date');
  }
  if (!(parseInt(f.amount || '0', 10) > 0)) out.push('amount');
  return out;
}
