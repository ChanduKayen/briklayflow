/**
 * LedgerCutoverControl — set the org's ledger go-live (opening cutover). Before the date is settled
 * (opening balances); wage & certified accrual counts only on/after it. Management-only; a subtle line
 * so it stays out of the way once set. NULL cutover = accrual counts all history (the default).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadLedgerCutover } from '../../lib/workCertification';
import { CutoverSetup } from './CutoverSetup';

const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function LedgerCutoverControl({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const { data: cutover } = useQuery({ queryKey: ['ledger_cutover', orgId], queryFn: () => loadLedgerCutover(orgId), enabled: !!orgId });
  const [open, setOpen] = useState(false);

  if (!isManager) {
    return cutover ? <span style={{ fontSize: 12.5, color: 'var(--walnut-3)' }}>Ledger opens {fmt(cutover)}</span> : null;
  }

  return (
    <span style={{ fontSize: 12.5, color: 'var(--walnut-3)' }}>
      {cutover ? <>Ledger opens {fmt(cutover)}</> : 'No ledger start set — counting all history'}
      {' · '}
      <button onClick={() => setOpen(true)}
        style={{ color: 'var(--walnut-2)', textDecoration: 'underline', textDecorationColor: 'var(--line-2)', textUnderlineOffset: 3, background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
        {cutover ? 'configure cutover' : 'set up the cutover'}
      </button>
      {open && <CutoverSetup orgId={orgId} onClose={() => setOpen(false)} />}
    </span>
  );
}
