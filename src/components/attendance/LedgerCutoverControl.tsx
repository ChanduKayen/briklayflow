/**
 * LedgerCutoverControl — set the org's ledger go-live (opening cutover). Before the date is settled
 * (opening balances); wage & certified accrual counts only on/after it. Management-only; a subtle line
 * so it stays out of the way once set. NULL cutover = accrual counts all history (the default).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadLedgerCutover, setLedgerCutover } from '../../lib/workCertification';
import { useSnackbar } from '../Snackbar';

const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function LedgerCutoverControl({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const { data: cutover, refetch } = useQuery({ queryKey: ['ledger_cutover', orgId], queryFn: () => loadLedgerCutover(orgId), enabled: !!orgId });
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isManager) {
    return cutover ? <span style={{ fontSize: 12.5, color: 'var(--walnut-3)' }}>Ledger opens {fmt(cutover)}</span> : null;
  }

  const save = async (date: string | null) => {
    setBusy(true);
    try {
      await setLedgerCutover(orgId, date);
      show(date ? `Ledger opens ${fmt(date)} — earlier is settled` : 'Cutover cleared — counting all history');
      setEditing(false); refetch();
      qc.invalidateQueries({ queryKey: ['weekly_payments'] });
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
    } catch (e) { show((e as Error)?.message || 'Could not set the cutover', { type: 'error' }); }
    finally { setBusy(false); }
  };

  if (editing) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--walnut-2)', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="date" value={val} onChange={(e) => setVal(e.target.value)}
          style={{ fontSize: 12.5, padding: '3px 6px', border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--paper)', color: 'var(--walnut)' }} />
        <button disabled={busy || !val} onClick={() => save(val)} style={{ color: 'var(--terracotta)', fontWeight: 600, background: 'none', border: 0, cursor: 'pointer' }}>save</button>
        {cutover && <button disabled={busy} onClick={() => save(null)} style={{ color: 'var(--walnut-3)', background: 'none', border: 0, cursor: 'pointer' }}>clear</button>}
        <button onClick={() => setEditing(false)} style={{ color: 'var(--walnut-3)', background: 'none', border: 0, cursor: 'pointer' }}>cancel</button>
      </span>
    );
  }

  return (
    <span style={{ fontSize: 12.5, color: 'var(--walnut-3)' }}>
      {cutover ? <>Ledger opens {fmt(cutover)}</> : 'No ledger start set — counting all history'}
      {' · '}
      <button onClick={() => { setVal(cutover ?? new Date().toISOString().slice(0, 10)); setEditing(true); }}
        style={{ color: 'var(--walnut-2)', textDecoration: 'underline', textDecorationColor: 'var(--line-2)', textUnderlineOffset: 3, background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
        {cutover ? 'change' : 'set a start date'}
      </button>
    </span>
  );
}
