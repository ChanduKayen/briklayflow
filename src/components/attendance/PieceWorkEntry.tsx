/**
 * PieceWorkEntry — log a discrete piece / gutha job for a worker. A standalone work certification
 * (no milestone or engagement): pick the site, the ₹ agreed, a note. Goes through the same governed
 * path — auto-approved within the submitter's authority, else Pending to the Works Approver — and
 * only becomes a payable once approved. Opened from the worker's party page.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { V, font } from '../txn-ledger/ledgerTokens';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSnackbar } from '../Snackbar';
import { submitWorkCertification } from '../../lib/workCertification';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export function PieceWorkEntry({ stakeholderId, partyName, onClose, onDone }: {
  stakeholderId: string; partyName: string; onClose: () => void; onDone: () => void;
}) {
  const orgId = useOrgId();
  const { show } = useSnackbar();
  const [projectId, setProjectId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ['active_projects_min'],
    queryFn: async () => (await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? [],
  });

  const amt = parseInt(amount.replace(/[^\d]/g, ''), 10) || 0;
  const ready = !!projectId && amt > 0;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await submitWorkCertification({
        orgId: orgId ?? '', projectId, woId: null, milestoneId: null, crewId: null, stakeholderId,
        readingKind: 'piece', readingValue: amt, computedAmount: amt, readingDate: date, note: note || 'Piece work',
      });
      show(r.status === 'approved' ? `${inr(amt)} certified for ${partyName}` : `${inr(amt)} sent for approval`);
      onDone(); onClose();
    } catch (e) { show((e as Error)?.message || 'Could not record the piece work', { type: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...font, position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(20,16,12,0.42)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px,100%)', background: V.surface, border: `1px solid ${V.line}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 60px -20px rgba(20,16,12,0.5)' }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${V.line}` }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: V.ink }}>Record piece work</p>
          <p style={{ fontSize: 12.5, color: V.sys, marginTop: 2 }}>A discrete job for {partyName} — certifies what's owed.</p>
        </div>
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: V.faint }}>Site</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: '9px 11px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 14, color: projectId ? V.ink : V.faint, outline: 'none', background: V.surface }}>
              <option value="">Pick a site…</option>
              {(projects as { project_id: string; name: string }[]).map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: V.faint }}>Amount agreed (₹)</label>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
              style={{ width: '100%', marginTop: 4, padding: '10px 12px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 16, color: V.ink, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: V.faint }}>What was the job?</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 5 door frames fixed, 3rd floor"
              style={{ width: '100%', marginTop: 4, padding: '10px 12px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 13.5, color: V.ink, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: V.faint }}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: '9px 11px', borderRadius: 10, border: `1px solid ${V.line}`, fontSize: 14, color: V.ink, outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button onClick={onClose} style={{ fontSize: 13, color: V.sys, background: 'none', border: 0, cursor: 'pointer' }}>Cancel</button>
            <button disabled={!ready || busy} onClick={submit}
              style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: ready ? V.terra : V.line, border: 0, borderRadius: 999, padding: '8px 16px', cursor: ready ? 'pointer' : 'default' }}>
              {busy ? 'Recording…' : 'Record piece work'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
