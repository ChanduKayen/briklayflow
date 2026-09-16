// PutOnContractDialog — the daily-wage → contract cutover, rebuilt to the redesign artifact (a centred
// dialog: which contract, which stages with unit chips, the fate of wages already logged, and an
// advanced "how it's measured" choice). Same real writes as before, through attendanceApi:
// putCrewOnContract for a crew, promoteDirectToCrew for a lone worker (dated cutover + keep/fold
// snapshot). Desktop only.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import {
  loadWorkOrdersForProject, putCrewOnContract, promoteDirectToCrew,
  type ContractMode, type AccruedWages, type MeasureMode,
} from '../../lib/attendanceApi';

export type PocCtx = {
  kind: 'crew' | 'direct';
  orgId: string; projectId: string; stakeholderId: string | null; name: string;
  accrued: AccruedWages;
  crewId?: string;
  worker?: { id: string; name: string; category: string; rate: number; stakeholderId: string | null };
  trade?: string | null;
};

const INR = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
type WO = { wo_id: string; label: string; orderValue: number; stakeholderId: string | null };
type Stage = { milestone_id: string; name: string; unit: string };

// A milestone's unit chip label — 'LS' reads as "LS"; a measured unit shows as-is.
const unitChip = (u: string) => (u || 'LS');

export function PutOnContractDialog({ ctx, onClose, onDone, onError, onToast }: {
  ctx: PocCtx; onClose: () => void; onDone: () => void; onError: (m: string) => void; onToast: (m: string) => void;
}) {
  const navigate = useNavigate();
  const [wos, setWos] = useState<WO[] | null>(null);
  const [woId, setWoId] = useState<string>('');
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ContractMode>('keep_wages');   // fate of prior wages (percent mode)
  const [measure, setMeasure] = useState<MeasureMode>('percent');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    loadWorkOrdersForProject(ctx.projectId)
      .then((all) => { if (!off) setWos(all.filter((w) => !ctx.stakeholderId || w.stakeholderId === ctx.stakeholderId)); })
      .catch((e) => { if (!off) { onError(e?.message || 'Could not load contracts'); setWos([]); } });
    return () => { off = true; };
  }, [ctx.projectId, ctx.stakeholderId, onError]);

  // On picking a contract, load its stages WITH units (for the chips) and default every phase checked
  // (the artifact's shape). Un-checking narrows what shows in their payments.
  useEffect(() => {
    if (!woId) { setStages(null); setStageIds([]); return; }
    let off = false;
    supabase.from('wo_milestones').select('milestone_id, name, unit_type, seq_no').eq('wo_id', woId).order('seq_no')
      .then(({ data }) => {
        if (off) return;
        const s: Stage[] = (data ?? []).map((m: any) => ({ milestone_id: m.milestone_id, name: m.name, unit: (m.unit_type || 'LS') }));
        setStages(s); setStageIds(s.map((x) => x.milestone_id));
      });
    return () => { off = true; };
  }, [woId]);

  const startNew = () => navigate('/work-orders/new', { state: { projectId: ctx.projectId, stakeholderId: ctx.stakeholderId } });
  const toggleStage = (id: string) => setStageIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const phasesOk = !!stages && (stages.length <= 1 || stageIds.length > 0);
  const showWages = measure === 'percent' && ctx.accrued.amount > 0;
  const canConfirm = !!woId && phasesOk && !busy;

  async function confirm() {
    if (!canConfirm || !woId) return;
    const picked = measure === 'wages'
      ? (stageIds.length ? stageIds : null)
      : (stages && stageIds.length && stageIds.length < stages.length ? stageIds : null);
    setBusy(true);
    try {
      if (ctx.kind === 'crew' && ctx.crewId) {
        await putCrewOnContract({ crewId: ctx.crewId, orgId: ctx.orgId, projectId: ctx.projectId, stakeholderId: ctx.stakeholderId, woId, stageIds: picked, mode, snapshotAmount: ctx.accrued.amount, measure });
      } else if (ctx.kind === 'direct' && ctx.worker) {
        await promoteDirectToCrew(ctx.orgId, ctx.projectId, ctx.worker, woId, ctx.trade ?? null, picked, { mode, snapshotAmount: ctx.accrued.amount, measure });
      }
      onToast(`${ctx.name} is on contract from today`);
      onDone();
    } catch (e: any) { setBusy(false); onError(e?.message || 'Could not put on contract'); }
  }

  return (
    <div className="pdlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{PDLG_CSS}</style>
      <div className="pdlg" role="dialog" aria-modal="true" aria-label="Put on a contract">
        <form className="dlg" onSubmit={(e) => e.preventDefault()}>
          <h2>Put on a contract</h2>
          <p className="sub">{ctx.name} · paid by certified stages from today</p>

          <label className="q">Which contract?</label>
          {wos == null ? (
            <p className="loading">Loading contracts…</p>
          ) : (
            <>
              {wos.length === 0 && <p className="empty">No contract for this party on this site yet.</p>}
              {wos.map((w) => (
                <label className={`opt${woId === w.wo_id ? ' on' : ''}`} key={w.wo_id}>
                  <input type="radio" name="wo" checked={woId === w.wo_id} onChange={() => setWoId(w.wo_id)} />
                  <div><div className="l">{w.label}</div><div className="s">{w.wo_id}</div></div>
                  {w.orderValue ? <span className="m">{INR(w.orderValue)}</span> : null}
                </label>
              ))}
              <label className="opt dashed" onClick={startNew}>
                <input type="radio" name="wo" readOnly checked={false} />
                <div><div className="l terra">New contract for this party</div></div>
              </label>
            </>
          )}

          {woId && stages && stages.length > 1 && (
            <>
              <label className="q">Which stages will they work? <span className="mute">— only these show in their payments</span></label>
              <div className="checks">
                {stages.map((s) => (
                  <label key={s.milestone_id}>
                    <input type="checkbox" checked={stageIds.includes(s.milestone_id)} onChange={() => toggleStage(s.milestone_id)} />
                    {s.name} <span className="unitchip">{unitChip(s.unit)}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {showWages && (
            <>
              <label className="q">The <span className="mono">{ctx.accrued.days} day{ctx.accrued.days === 1 ? '' : 's'} · {INR(ctx.accrued.amount)}</span> already logged as wages</label>
              <label className={`opt${mode === 'keep_wages' ? ' on' : ''}`}>
                <input type="radio" name="prior" checked={mode === 'keep_wages'} onChange={() => setMode('keep_wages')} />
                <div><div className="l">Keep as wages</div><div className="s">{INR(ctx.accrued.amount)} stays owed for those days.</div></div>
              </label>
              <label className={`opt${mode === 'fold' ? ' on' : ''}`}>
                <input type="radio" name="prior" checked={mode === 'fold'} onChange={() => setMode('fold')} />
                <div><div className="l">Fold into the contract</div><div className="s">The contract value covers that work — the day-wages drop off.</div></div>
              </label>
            </>
          )}

          {woId && (
            <details className="adv">
              <summary>{measure === 'percent' ? 'Paid by certified stages' : 'Paid by counting days'} — change</summary>
              <label className={`opt${measure === 'percent' ? ' on' : ''}`}>
                <input type="radio" name="meas" checked={measure === 'percent'} onChange={() => setMeasure('percent')} />
                <div><div className="l">By certified stages</div><div className="s">Certify each stage in its own unit as work completes. The usual flow.</div></div>
              </label>
              <label className={`opt${measure === 'wages' ? ' on' : ''}`}>
                <input type="radio" name="meas" checked={measure === 'wages'} onChange={() => setMeasure('wages')} />
                <div><div className="l">Keep counting days, settle against the contract</div><div className="s">Daily attendance continues; wages are set off against a stage, capped, rolling to the next.</div></div>
              </label>
            </details>
          )}

          <div className="foot">
            <span className="fine">Advance and balance lines stay on the contract, not here.</span>
            <span className="acts">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={!canConfirm} onClick={confirm}>
                {busy ? 'Putting on contract…' : 'Put on contract'}
              </button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

const PDLG_CSS = `
.pdlg-scrim{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:16px;
  background:rgba(40,28,18,.28);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  font-family:'DM Sans',-apple-system,system-ui,sans-serif;color:#1E1915;animation:pdlg-fade .18s ease}
.pdlg *{box-sizing:border-box}
.pdlg{border-radius:20px;background:#FCFAF6;width:min(540px,calc(100vw - 32px));max-height:92vh;overflow-y:auto;
  box-shadow:0 28px 80px rgba(50,35,20,.20),0 6px 18px rgba(50,35,20,.08);animation:pdlg-pop .22s cubic-bezier(.2,.8,.2,1)}
.pdlg .dlg{padding:26px 28px 24px}
.pdlg h2{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:24px;margin:0 0 4px;letter-spacing:-.01em}
.pdlg .sub{color:#6E5F51;margin:0 0 20px;font-size:14px}
.pdlg .q{display:block;font-weight:500;margin:18px 0 8px}
.pdlg .q .mute{color:#A0958A;font-weight:400}
.pdlg .mono{font-family:'DM Mono',ui-monospace,monospace}
.pdlg .loading,.pdlg .empty{font-size:13px;color:#A0958A;padding:4px 0}
.pdlg .opt{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;cursor:pointer;margin-bottom:6px;
  background:#F4F0E8;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s,background .15s}
.pdlg .opt:hover{background:#EDE7DC}
.pdlg .opt.on{background:#FBEEE7;box-shadow:inset 0 0 0 1.5px #C4552D}
.pdlg .opt.dashed{border:1px dashed rgba(70,50,30,.18);background:transparent}
.pdlg .opt input{margin-top:3px;accent-color:#C4552D}
.pdlg .opt .l{font-weight:500}
.pdlg .opt .l.terra{color:#A8431F}
.pdlg .opt .s{color:#6E5F51;font-size:13px}
.pdlg .opt .m{margin-left:auto;font-family:'DM Mono',monospace;color:#6E5F51;white-space:nowrap;font-size:13px}
.pdlg .checks{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px}
.pdlg .checks label{display:flex;gap:9px;align-items:center;padding:6px 6px;font-size:13.5px;border-radius:6px}
.pdlg .checks label:hover{background:#F4F0E8}
.pdlg .checks input{accent-color:#C4552D}
.pdlg .unitchip{display:inline-block;font-family:'DM Mono',monospace;font-size:11px;color:#4A5F45;background:#E8EEE1;border-radius:4px;padding:1px 6px;margin-left:auto}
.pdlg details.adv{margin-top:16px;box-shadow:inset 0 1px rgba(70,50,30,.10);padding-top:12px}
.pdlg details.adv summary{color:#6E5F51;cursor:pointer;font-size:13.5px;list-style:none}
.pdlg details.adv summary::-webkit-details-marker{display:none}
.pdlg details.adv summary::before{content:"\\203A";display:inline-block;margin-right:8px;color:#A0958A;transition:transform .15s}
.pdlg details.adv[open] summary::before{transform:rotate(90deg)}
.pdlg details.adv .opt{margin-top:8px}
.pdlg .foot{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:12px}
.pdlg .foot .fine{color:#A0958A;font-size:12.5px}
.pdlg .foot .acts{display:flex;gap:8px}
.pdlg .btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:999px;font-weight:500;
  background:#FCFAF6;box-shadow:0 1px 2px rgba(50,35,20,.05),0 0 0 1px rgba(70,50,30,.10);cursor:pointer;color:#1E1915;font:inherit;border:0}
.pdlg .btn:hover{box-shadow:0 2px 6px rgba(50,35,20,.10),0 0 0 1px rgba(70,50,30,.18)}
.pdlg .btn.primary{background:#C4552D;color:#fff;box-shadow:0 1px 2px rgba(120,50,20,.25)}
.pdlg .btn.primary:hover{background:#A8431F}
.pdlg .btn:disabled{opacity:.45;pointer-events:none}
@keyframes pdlg-fade{from{opacity:0}to{opacity:1}}
@keyframes pdlg-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.pdlg,.pdlg-scrim{animation:none}}
`;
