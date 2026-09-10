// Put a daily-wage crew / worker on a contract — a real sheet (replaces the DOM-string picker the
// attendance grid used to inject). Pick or create the contract, choose which phases apply, and — when
// there are day-wages already logged — decide their fate (keep as a credit, or fold into the contract).
// The write goes through attendanceApi (dated cutover + snapshot); this component is just the flow.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { X, FileText, ChevronRight, Loader2, Check } from 'lucide-react';
import {
  loadWorkOrdersForProject, loadWorkOrderStages, putCrewOnContract, promoteDirectToCrew,
  type ContractMode, type AccruedWages, type WOStage,
} from '../../lib/attendanceApi';

export type ContractContext = {
  kind: 'crew' | 'direct';
  orgId: string; projectId: string; stakeholderId: string | null; name: string;
  accrued: AccruedWages;
  crewId?: string;   // kind='crew'
  worker?: { id: string; name: string; category: string; rate: number; stakeholderId: string | null };  // kind='direct'
  trade?: string | null;
};

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
type WO = { wo_id: string; label: string; orderValue: number; stakeholderId: string | null };

export function PutOnContractSheet({ ctx, onClose, onDone, onError }: {
  ctx: ContractContext; onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const navigate = useNavigate();
  const [wos, setWos] = useState<WO[] | null>(null);
  const [woId, setWoId] = useState<string>('');
  const [stages, setStages] = useState<WOStage[] | null>(null);
  const [stageIds, setStageIds] = useState<string[]>([]);   // ticked phases (empty = all)
  const [mode, setMode] = useState<ContractMode | null>(ctx.accrued.amount > 0 ? null : 'fold');
  const [busy, setBusy] = useState(false);

  // The party's live contracts on this site — the pick-list.
  useEffect(() => {
    let off = false;
    loadWorkOrdersForProject(ctx.projectId)
      .then((all) => { if (!off) setWos(all.filter((w) => !ctx.stakeholderId || w.stakeholderId === ctx.stakeholderId)); })
      .catch((e) => { if (!off) { onError(e?.message || 'Could not load contracts'); setWos([]); } });
    return () => { off = true; };
  }, [ctx.projectId, ctx.stakeholderId, onError]);

  // When a WO is picked, load its phases (so multi-phase contracts can scope which apply).
  useEffect(() => {
    if (!woId) { setStages(null); setStageIds([]); return; }
    let off = false;
    loadWorkOrderStages(woId)
      .then((s) => { if (!off) { setStages(s); setStageIds(s.map((x) => x.milestone_id)); } })
      .catch(() => { if (!off) { setStages([]); setStageIds([]); } });
    return () => { off = true; };
  }, [woId]);

  const startNew = () => navigate('/work-orders/new', { state: { projectId: ctx.projectId, stakeholderId: ctx.stakeholderId } });
  const toggleStage = (id: string) => setStageIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const canConfirm = !!woId && (ctx.accrued.amount <= 0 || mode != null) && !busy;

  async function confirm() {
    if (!woId) return;
    if (ctx.accrued.amount > 0 && mode == null) { onError('Choose what happens to the logged wages.'); return; }
    // All phases ticked → null (all); a partial pick → just those.
    const picked = stages && stageIds.length && stageIds.length < stages.length ? stageIds : null;
    const effMode: ContractMode = ctx.accrued.amount > 0 ? mode! : 'fold';
    setBusy(true);
    try {
      if (ctx.kind === 'crew' && ctx.crewId) {
        await putCrewOnContract({
          crewId: ctx.crewId, orgId: ctx.orgId, projectId: ctx.projectId, stakeholderId: ctx.stakeholderId,
          woId, stageIds: picked, mode: effMode, snapshotAmount: ctx.accrued.amount,
        });
      } else if (ctx.kind === 'direct' && ctx.worker) {
        await promoteDirectToCrew(
          ctx.orgId, ctx.projectId, ctx.worker, woId, ctx.trade ?? null, picked,
          { mode: effMode, snapshotAmount: ctx.accrued.amount },
        );
      }
      onDone();
    } catch (e: any) { onError(e?.message || 'Could not put on contract'); setBusy(false); }
  }

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: '18px 18px 0 0', maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '16px 16px 10px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1B1713', margin: 0 }}>Put on a contract</p>
            <p style={{ fontSize: 12, color: '#87807a', margin: '2px 0 0' }}>{ctx.name} · tracked by certified stages from now</p>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', color: '#87807a', cursor: 'pointer', padding: 4 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16 }}>
          {/* 1 — pick the contract */}
          <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1B1713', margin: '0 0 8px' }}>Which contract?</p>
          {wos == null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#87807a', fontSize: 13, padding: '8px 0' }}><Loader2 size={14} className="animate-spin" /> Loading contracts…</div>
          ) : (
            <>
              {wos.length === 0 && <p style={{ fontSize: 12.5, color: '#87807a', margin: '0 0 8px' }}>No contract for this party on this site yet.</p>}
              {wos.map((w) => (
                <button key={w.wo_id} onClick={() => setWoId(w.wo_id)} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', padding: '10px 12px', border: `1px solid ${woId === w.wo_id ? '#C4502B' : '#eee'}`, background: woId === w.wo_id ? '#FCF3EF' : '#fff', borderRadius: 10, marginBottom: 8, cursor: 'pointer' }}>
                  <FileText size={16} style={{ color: '#87807a', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1B1713', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.label}</span>
                    <span style={{ display: 'block', fontSize: 11, color: '#999' }}>{w.wo_id}{w.orderValue ? ` · ${inr(w.orderValue)}` : ''}</span>
                  </span>
                  {woId === w.wo_id && <Check size={16} style={{ color: '#C4502B', flexShrink: 0 }} />}
                </button>
              ))}
              <button onClick={startNew} style={{ width: '100%', padding: '10px 12px', border: '1px dashed #C4502B', borderRadius: 10, color: '#C4502B', fontWeight: 600, fontSize: 13, background: '#fff', cursor: 'pointer' }}>+ New contract for this party</button>
            </>
          )}

          {/* 2 — which phases (multi-phase contracts only) */}
          {woId && stages && stages.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12.5, fontWeight: 600, color: '#1B1713', margin: '0 0 2px' }}>Which phases will they work?</p>
              <p style={{ fontSize: 11, color: '#87807a', margin: '0 0 8px' }}>Only these show in their payments.</p>
              {stages.map((s) => (
                <label key={s.milestone_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', fontSize: 13, color: '#1B1713', cursor: 'pointer' }}>
                  <input type="checkbox" checked={stageIds.includes(s.milestone_id)} onChange={() => toggleStage(s.milestone_id)} />
                  {s.name}
                </label>
              ))}
            </div>
          )}

          {/* 3 — the day-wages already logged: keep or fold */}
          {ctx.accrued.amount > 0 && (
            <div style={{ marginTop: 16, background: '#FAF7F4', border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
              <p style={{ fontSize: 12.5, color: '#1B1713', margin: '0 0 2px' }}>
                <b>{ctx.accrued.days} day{ctx.accrued.days === 1 ? '' : 's'} · {inr(ctx.accrued.amount)}</b> in daily wages are logged so far.
              </p>
              <p style={{ fontSize: 11, color: '#87807a', margin: '0 0 10px' }}>From now they're paid by certified stages. What about the wages already logged?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => setMode('keep_wages')} style={{ textAlign: 'left', padding: '9px 11px', border: `1px solid ${mode === 'keep_wages' ? '#C4502B' : '#e5e0da'}`, background: mode === 'keep_wages' ? '#FCF3EF' : '#fff', borderRadius: 10, cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1B1713' }}>Keep as wages</span>
                  <span style={{ display: 'block', fontSize: 11, color: '#87807a' }}>{inr(ctx.accrued.amount)} stays owed — recorded as a certified credit through today.</span>
                </button>
                <button onClick={() => setMode('fold')} style={{ textAlign: 'left', padding: '9px 11px', border: `1px solid ${mode === 'fold' ? '#C4502B' : '#e5e0da'}`, background: mode === 'fold' ? '#FCF3EF' : '#fff', borderRadius: 10, cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#1B1713' }}>Fold into the contract</span>
                  <span style={{ display: 'block', fontSize: 11, color: '#87807a' }}>The contract value covers that work — the day-wages drop off.</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid #eee', position: 'sticky', bottom: 0, background: '#fff', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: '0 0 auto', padding: '11px 16px', border: '1px solid #e5e0da', borderRadius: 10, background: '#fff', color: '#87807a', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => void confirm()} disabled={!canConfirm} style={{ flex: 1, padding: '11px 12px', border: 'none', borderRadius: 10, background: canConfirm ? '#C4502B' : '#e5e0da', color: '#fff', fontSize: 14, fontWeight: 700, cursor: canConfirm ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
            {busy ? <><Loader2 size={15} className="animate-spin" /> Putting on contract…</> : <>Put on contract <ChevronRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
