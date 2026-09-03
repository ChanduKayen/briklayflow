/**
 * PendingCertifications — the Works Approver's inbox. Certifications submitted above a submitter's
 * limit (or by someone without certify rights) land here as Pending; only APPROVED becomes a payable.
 * Mounted on Payables (the money hub). Approve/Reject is authority-gated in the UI and re-checked by
 * decide_work_certification on the server.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { V, font } from '../txn-ledger/ledgerTokens';
import { useSnackbar } from '../Snackbar';
import {
  loadPendingCertifications, decideWorkCertification, loadMyCertAuthority, canApproveAmount,
} from '../../lib/workCertification';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function PendingCertifications({ orgId, userId }: { orgId: string; userId: string }) {
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: pending = [], refetch } = useQuery({ queryKey: ['pending_certs'], queryFn: loadPendingCertifications });
  const { data: auth } = useQuery({ queryKey: ['my_cert_authority', orgId, userId], queryFn: () => loadMyCertAuthority(orgId, userId), enabled: !!orgId && !!userId });

  if (!pending.length) return null;

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await decideWorkCertification(id, approve);
      show(approve ? 'Certification approved' : 'Certification rejected');
      refetch();
      // The approved obligation now flows into every derived surface.
      qc.invalidateQueries({ queryKey: ['weekly_payments'] });
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
      qc.invalidateQueries({ queryKey: ['v_party_balance'] });
    } catch (e) { show((e as Error)?.message || 'Could not record the decision', { type: 'error' }); }
    finally { setBusy(null); }
  };

  return (
    <section style={{ ...font, background: V.surface, border: `1px solid ${V.askLine}`, borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 18px', background: V.askWash, borderBottom: `1px solid ${V.askLine}` }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: V.ask }}>Work to approve</span>
        <span style={{ fontSize: 13, color: V.sys }}>{pending.length} certification{pending.length !== 1 ? 's' : ''} awaiting sign-off</span>
      </div>
      {pending.map(c => {
        const mayApprove = canApproveAmount(auth, c.computedAmount);
        return (
          <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '11px 18px', borderBottom: `1px solid ${V.line}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: V.ink, fontWeight: 500 }}>
                {inr(c.computedAmount)} <span style={{ color: V.sys, fontWeight: 400 }}>· {c.partyName || 'Worker'}</span>
              </div>
              <div style={{ fontSize: 12, color: V.faint, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.projectName || '—'} · {c.readingKind === 'lump' ? `${Math.round(c.readingValue)}% done` : c.readingKind === 'measured' ? `${c.readingValue} units` : 'piece'} · {fmtDate(c.readingDate)}{c.note ? ` · ${c.note}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {mayApprove ? (
                <>
                  <button disabled={busy === c.id} onClick={() => decide(c.id, false)}
                    style={{ fontSize: 12.5, color: V.sys, background: 'none', border: `1px solid ${V.line}`, borderRadius: 999, padding: '6px 12px', cursor: 'pointer' }}>Reject</button>
                  <button disabled={busy === c.id} onClick={() => decide(c.id, true)}
                    style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: V.sage, border: 0, borderRadius: 999, padding: '6px 14px', cursor: 'pointer' }}>
                    {busy === c.id ? '…' : 'Approve'}</button>
                </>
              ) : (
                <span style={{ fontSize: 11.5, color: V.faint, fontStyle: 'italic' }}>awaits the Works Approver</span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
