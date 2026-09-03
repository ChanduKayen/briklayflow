/**
 * LedgerCutoverControl — set the org's ledger go-live (opening cutover). Before the date is settled
 * (opening balances); wage & certified accrual counts only on/after it. Management-only; a subtle line
 * so it stays out of the way once set. NULL cutover = accrual counts all history (the default).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadLedgerCutover } from '../../lib/workCertification';
import { CutoverSetup } from './CutoverSetup';
import { V } from '../txn-ledger/ledgerTokens';

const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Portable (uses the ledger V palette, not page-scoped CSS vars) so it works on both Payables and the Ledger.
export function LedgerCutoverControl({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const { data: cutover } = useQuery({ queryKey: ['ledger_cutover', orgId], queryFn: () => loadLedgerCutover(orgId), enabled: !!orgId });
  const [open, setOpen] = useState(false);

  if (!isManager) {
    return cutover ? <span style={{ fontSize: 12.5, color: V.sys }}>Ledger opens {fmt(cutover)}</span> : null;
  }

  return (
    <span style={{ fontSize: 12.5, color: V.sys }}>
      {cutover ? <>Ledger opens {fmt(cutover)}</> : 'No ledger start set — counting all history'}
      {' · '}
      <button onClick={() => setOpen(true)}
        style={{ color: V.inkSoft, textDecoration: 'underline', textDecorationColor: V.line, textUnderlineOffset: 3, background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
        {cutover ? 'configure cutover' : 'set up the cutover'}
      </button>
      {open && <CutoverSetup orgId={orgId} onClose={() => setOpen(false)} />}
    </span>
  );
}
