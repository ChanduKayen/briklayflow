/**
 * CutoverSetup — the ledger go-live in ONE place: set the cutover DATE and enter each party's carried
 * balance as of it (what we owe them, or what they hold in advance). Before the date is settled; live
 * accrual counts on/after. Reuses stakeholder_opening_balances (as_of = the cutover date), so the two
 * halves of the cutover — the boundary and the opening amounts — are configured together.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { V, font } from '../txn-ledger/ledgerTokens';
import { useSnackbar } from '../Snackbar';
import { searchPayees } from '../../lib/payeeSearch';
import { saveOpeningBalance } from '../../lib/partyLedgerApi';
import { loadLedgerCutover, setLedgerCutover, loadOpeningBalances, removeOpeningBalance } from '../../lib/workCertification';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export function CutoverSetup({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const { data: cutover, refetch: refetchCut } = useQuery({ queryKey: ['ledger_cutover', orgId], queryFn: () => loadLedgerCutover(orgId) });
  const { data: openings = [], refetch: refetchOpen } = useQuery({ queryKey: ['opening_balances'], queryFn: loadOpeningBalances });
  const { data: parties = [] } = useQuery({
    queryKey: ['cutover_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, type, category').in('type', ['Vendor', 'Worker']).order('name')).data ?? [],
  });

  const [dateVal, setDateVal] = useState<string>(cutover ?? new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<'work_owed' | 'paid_ahead'>('work_owed');
  const [busy, setBusy] = useState(false);

  const haveOpening = useMemo(() => new Set(openings.map(o => o.stakeholderId)), [openings]);
  const matches = useMemo(() => (q.trim() ? searchPayees(parties as any, q) : []).filter((p: any) => !haveOpening.has(p.stakeholder_id)).slice(0, 6), [q, parties, haveOpening]);

  const saveDate = async (d: string | null) => {
    setBusy(true);
    try { await setLedgerCutover(orgId, d); show(d ? `Ledger opens ${new Date(d).toLocaleDateString('en-IN')}` : 'Cutover cleared'); refetchCut(); qc.invalidateQueries({ queryKey: ['weekly_payments'] }); qc.invalidateQueries({ queryKey: ['party_ledger'] }); }
    catch (e) { show((e as Error)?.message || 'Could not set the date', { type: 'error' }); }
    finally { setBusy(false); }
  };

  const addOpening = async () => {
    if (!pick || !amount) return;
    const total = parseInt(amount.replace(/[^\d]/g, ''), 10) || 0;
    if (total <= 0) return;
    setBusy(true);
    try {
      await saveOpeningBalance(orgId, pick.id, { asOf: cutover ?? dateVal, direction: dir, total, bySite: {}, note: 'Opening balance at cutover' });
      show(`Opening balance set for ${pick.name}`);
      setPick(null); setQ(''); setAmount(''); setDir('work_owed'); refetchOpen();
      qc.invalidateQueries({ queryKey: ['party_ledger'] }); qc.invalidateQueries({ queryKey: ['weekly_payments'] });
    } catch (e) { show((e as Error)?.message || 'Could not save', { type: 'error' }); }
    finally { setBusy(false); }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove the opening balance for ${name}?`)) return;
    try { await removeOpeningBalance(id); refetchOpen(); qc.invalidateQueries({ queryKey: ['party_ledger'] }); }
    catch (e) { show((e as Error)?.message || 'Could not remove', { type: 'error' }); }
  };

  return (
    <div style={{ ...font, position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(20,16,12,0.42)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px,100%)', maxHeight: '88vh', overflow: 'auto', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, boxShadow: '0 24px 60px -20px rgba(20,16,12,0.5)' }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${V.line}` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: V.ink }}>Ledger cutover</p>
          <p style={{ fontSize: 12.5, color: V.sys, marginTop: 2 }}>Set where the books start. Everything before is settled; enter what each party carries as of that day.</p>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, color: V.faint }}>Ledger start date</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)}
              style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 14, color: V.ink, outline: 'none' }} />
            <button disabled={busy || !dateVal} onClick={() => saveDate(dateVal)}
              style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: V.terra, border: 0, borderRadius: 999, padding: '8px 14px', cursor: 'pointer' }}>Save date</button>
            {cutover && <button disabled={busy} onClick={() => saveDate(null)} style={{ fontSize: 12.5, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>clear</button>}
          </div>
          <p style={{ fontSize: 11.5, color: V.faint }}>{cutover ? `Currently opens ${new Date(cutover).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.` : 'No cutover set — the ledger counts all history.'}</p>
        </div>

        <div style={{ padding: '4px 18px 16px', borderTop: `1px solid ${V.line}` }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: V.ink, margin: '12px 0 8px' }}>Opening balances</p>

          {/* add a party's opening balance */}
          {!pick ? (
            <div style={{ position: 'relative' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a vendor or worker to add a balance…"
                style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 13.5, color: V.ink, outline: 'none' }} />
              {matches.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, marginTop: 4, background: V.surface, border: `1px solid ${V.line}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 30px -14px rgba(20,16,12,0.4)' }}>
                  {matches.map((m: any) => (
                    <button key={m.stakeholder_id} onClick={() => { setPick({ id: m.stakeholder_id, name: m.name }); setQ(''); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', background: 'none', border: 0, fontSize: 13.5, color: V.ink, cursor: 'pointer' }}>
                      {m.name} <span style={{ color: V.faint, fontSize: 12 }}>· {m.type}{m.category ? ` · ${m.category}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 10, background: V.field, border: `1px solid ${V.line}` }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: V.ink }}>{pick.name}</span>
              <select value={dir} onChange={(e) => setDir(e.target.value as any)}
                style={{ fontSize: 12.5, padding: '5px 8px', borderRadius: 8, border: `1px solid ${V.line}`, background: V.surface, color: V.ink }}>
                <option value="work_owed">we owe them</option>
                <option value="paid_ahead">advance with them</option>
              </select>
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ amount" autoFocus
                style={{ width: 110, padding: '6px 9px', borderRadius: 8, border: `1px solid ${V.line}`, fontSize: 14, color: V.ink, outline: 'none' }} />
              <button disabled={busy || !amount} onClick={addOpening}
                style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: V.terra, border: 0, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>Add</button>
              <button onClick={() => { setPick(null); setAmount(''); }} style={{ fontSize: 12.5, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>cancel</button>
            </div>
          )}

          {/* existing opening balances */}
          <div style={{ marginTop: 10, border: openings.length ? `1px solid ${V.line}` : 'none', borderRadius: 10, overflow: 'hidden' }}>
            {openings.map((o, i) => (
              <div key={o.stakeholderId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center', padding: '9px 12px', borderTop: i ? `1px solid ${V.line}` : 'none' }}>
                <span style={{ fontSize: 13.5, color: V.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name} <span style={{ color: V.faint, fontSize: 12 }}>· {o.type}</span></span>
                <span style={{ fontSize: 13, fontWeight: 600, color: o.direction === 'work_owed' ? V.terraDeep : V.sage }}>{inr(o.total)} <span style={{ fontWeight: 400, fontSize: 11.5 }}>{o.direction === 'work_owed' ? 'we owe' : 'advance'}</span></span>
                <button onClick={() => remove(o.stakeholderId, o.name)} style={{ fontSize: 16, color: V.faint, background: 'none', border: 0, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
          {openings.length === 0 && <p style={{ fontSize: 12, color: V.faint, marginTop: 8 }}>No opening balances yet. Add anyone carried from before the cutover.</p>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: `1px solid ${V.line}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: V.ink, background: V.field, border: `1px solid ${V.line}`, borderRadius: 999, padding: '8px 18px', cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}
