// Put a daily-wage crew / worker on a contract — a proper sheet in the platform's cream/terracotta
// language (replaces the DOM-string picker the attendance grid used to inject). Pick or create the
// contract, choose which phases apply, and — when day-wages are already logged — decide their fate.
// The write goes through attendanceApi (dated cutover + snapshot); this is the flow + the craft.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  loadWorkOrdersForProject, loadWorkOrderStages, putCrewOnContract, promoteDirectToCrew,
  type ContractMode, type AccruedWages, type WOStage, type MeasureMode,
} from '../../lib/attendanceApi';

export type ContractContext = {
  kind: 'crew' | 'direct';
  orgId: string; projectId: string; stakeholderId: string | null; name: string;
  accrued: AccruedWages;
  crewId?: string;
  worker?: { id: string; name: string; category: string; rate: number; stakeholderId: string | null };
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
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ContractMode | null>(ctx.accrued.amount > 0 ? null : 'fold');
  const [measure, setMeasure] = useState<MeasureMode>('percent');   // how the contract is valued
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let off = false;
    loadWorkOrdersForProject(ctx.projectId)
      .then((all) => { if (!off) setWos(all.filter((w) => !ctx.stakeholderId || w.stakeholderId === ctx.stakeholderId)); })
      .catch((e) => { if (!off) { onError(e?.message || 'Could not load contracts'); setWos([]); } });
    return () => { off = true; };
  }, [ctx.projectId, ctx.stakeholderId, onError]);

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
  // In 'wages' mode the past-wages keep/fold question is moot (day-wages keep counting), so it isn't required.
  const canConfirm = !!woId && (measure === 'wages' || ctx.accrued.amount <= 0 || mode != null) && !busy && !done;

  async function confirm() {
    if (!woId || !canConfirm) return;
    // In 'wages' mode the picked phases are the wage TARGET, so keep them even if it's all of them.
    const picked = measure === 'wages'
      ? (stageIds.length ? stageIds : null)
      : (stages && stageIds.length && stageIds.length < stages.length ? stageIds : null);
    const effMode: ContractMode = ctx.accrued.amount > 0 ? mode! : 'fold';
    setBusy(true);
    try {
      if (ctx.kind === 'crew' && ctx.crewId) {
        await putCrewOnContract({ crewId: ctx.crewId, orgId: ctx.orgId, projectId: ctx.projectId, stakeholderId: ctx.stakeholderId, woId, stageIds: picked, mode: effMode, snapshotAmount: ctx.accrued.amount, measure });
      } else if (ctx.kind === 'direct' && ctx.worker) {
        await promoteDirectToCrew(ctx.orgId, ctx.projectId, ctx.worker, woId, ctx.trade ?? null, picked, { mode: effMode, snapshotAmount: ctx.accrued.amount, measure });
      }
      setBusy(false); setDone(true);
      window.setTimeout(onDone, 900);   // let the success beat land before the sheet leaves
    } catch (e: any) { setBusy(false); onError(e?.message || 'Could not put on contract'); }
  }

  return createPortal(
    <div className="pocx" onClick={onClose}>
      <style>{POCX_CSS}</style>
      <div className="pocx-sheet" onClick={(e) => e.stopPropagation()}>
        {done && (
          <div className="pocx-success">
            <div className="pocx-tick"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></div>
            <p className="pocx-sx-t">On contract</p>
            <p className="pocx-sx-s">{ctx.name} · tracked by certified stages</p>
          </div>
        )}

        <div className="pocx-head">
          <div>
            <p className="pocx-title">Put on a contract</p>
            <p className="pocx-sub">{ctx.name} · paid by certified stages from now</p>
          </div>
          <button className="pocx-x" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
        </div>

        <div className="pocx-body">
          <p className="pocx-label">Which contract?</p>
          {wos == null ? (
            <div className="pocx-loading"><span className="pocx-spin" /> Loading contracts…</div>
          ) : (
            <div className="pocx-list">
              {wos.length === 0 && <p className="pocx-empty">No contract for this party on this site yet.</p>}
              {wos.map((w) => (
                <button key={w.wo_id} className={`pocx-card${woId === w.wo_id ? ' on' : ''}`} onClick={() => setWoId(w.wo_id)}>
                  <span className="pocx-doc"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5" /></svg></span>
                  <span className="pocx-card-t">
                    <b>{w.label}</b>
                    <small>{w.wo_id}{w.orderValue ? ` · ${inr(w.orderValue)}` : ''}</small>
                  </span>
                  <span className="pocx-radio" aria-hidden><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>
                </button>
              ))}
              <button className="pocx-new" onClick={startNew}>+ New contract for this party</button>
            </div>
          )}

          {woId && (
            <div className="pocx-measure">
              <p className="pocx-label">How is this contract measured?</p>
              <button className={`pocx-opt${measure === 'percent' ? ' on' : ''}`} onClick={() => setMeasure('percent')}>
                <b>By % of work done</b><small>Certify each phase as work completes — the usual contract flow.</small>
              </button>
              <button className={`pocx-opt${measure === 'wages' ? ' on' : ''}`} onClick={() => setMeasure('wages')}>
                <b>Keep counting wages, subtract from the contract</b><small>Stay on daily attendance; the day-wages get settled into a phase you choose (capped, rolling to the next).</small>
              </button>
            </div>
          )}

          {woId && stages && stages.length > 1 && (
            <div className="pocx-phases">
              <p className="pocx-label">{measure === 'wages' ? 'Which phase(s) do the wages subtract from?' : 'Which phases will they work?'}</p>
              <p className="pocx-hint">{measure === 'wages' ? 'Wages fill these in order — you can still change the target when you settle.' : 'Only these show in their payments.'}</p>
              {stages.map((s) => (
                <label key={s.milestone_id} className={`pocx-ph${stageIds.includes(s.milestone_id) ? ' on' : ''}`}>
                  <input type="checkbox" checked={stageIds.includes(s.milestone_id)} onChange={() => toggleStage(s.milestone_id)} />
                  <span className="pocx-tick-sm"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg></span>
                  {s.name}
                </label>
              ))}
            </div>
          )}

          {measure === 'percent' && ctx.accrued.amount > 0 && (
            <div className="pocx-wages">
              <p className="pocx-wages-h"><b>{ctx.accrued.days} day{ctx.accrued.days === 1 ? '' : 's'} · {inr(ctx.accrued.amount)}</b> in daily wages logged so far.</p>
              <p className="pocx-hint">From now they're paid by certified stages. What about those?</p>
              <button className={`pocx-opt${mode === 'keep_wages' ? ' on' : ''}`} onClick={() => setMode('keep_wages')}>
                <b>Keep as wages</b><small>{inr(ctx.accrued.amount)} stays owed — kept as a certified credit through today.</small>
              </button>
              <button className={`pocx-opt${mode === 'fold' ? ' on' : ''}`} onClick={() => setMode('fold')}>
                <b>Fold into the contract</b><small>The contract value covers that work — the day-wages drop off.</small>
              </button>
            </div>
          )}
        </div>

        <div className="pocx-foot">
          <button className="pocx-cancel" onClick={onClose}>Cancel</button>
          <button className="pocx-go" disabled={!canConfirm} onClick={() => void confirm()}>
            {busy ? <><span className="pocx-spin light" /> Putting on contract…</> : <>Put on contract<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></svg></>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const POCX_CSS = `
.pocx{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(42,36,28,.42);backdrop-filter:blur(2px);animation:pocx-fade .2s ease;
  font-family:'DM Sans',system-ui,-apple-system,sans-serif;color:#2A241C}
.pocx *{box-sizing:border-box}
.pocx-sheet{position:relative;background:#FFFDF7;width:100%;max-width:520px;border-radius:20px 20px 0 0;
  max-height:86vh;overflow-y:auto;box-shadow:0 -18px 50px -20px rgba(42,36,28,.4);
  animation:pocx-rise .34s cubic-bezier(.32,1.28,.5,1)}
@media(min-width:560px){.pocx{align-items:center;padding:20px}.pocx-sheet{border-radius:20px}}

.pocx-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:flex-start;
  gap:12px;padding:18px 18px 12px;background:#FFFDF7;border-bottom:1px solid #EFE9DE}
.pocx-title{margin:0;font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:600;letter-spacing:-.01em}
.pocx-sub{margin:3px 0 0;font-size:12px;color:#9A8C77}
.pocx-x{flex:none;border:0;background:none;color:#9A8C77;cursor:pointer;padding:4px;border-radius:8px;transition:.15s}
.pocx-x:hover{background:#F4EEE3;color:#2A241C}
.pocx-x svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}

.pocx-body{padding:16px 18px}
.pocx-label{margin:0 0 8px;font-size:12.5px;font-weight:600;color:#2A241C}
.pocx-hint{margin:-4px 0 10px;font-size:11px;color:#9A8C77}
.pocx-loading,.pocx-empty{font-size:12.5px;color:#9A8C77;display:flex;align-items:center;gap:8px;padding:6px 0}
.pocx-list{display:flex;flex-direction:column;gap:8px}

.pocx-card{display:flex;align-items:center;gap:11px;text-align:left;padding:11px 12px;border:1px solid #ECE5D9;
  background:#FFFDF7;border-radius:12px;cursor:pointer;transition:border-color .18s,background .18s,transform .12s}
.pocx-card:hover{border-color:#D9CFBE;background:#FBF7EF}
.pocx-card:active{transform:scale(.99)}
.pocx-card.on{border-color:#C4502B;background:#FCF3EF}
.pocx-doc{flex:none;width:30px;height:30px;border-radius:8px;background:#F4EEE3;display:grid;place-items:center}
.pocx-doc svg{width:15px;height:15px;fill:none;stroke:#9A8C77;stroke-width:1.7;stroke-linejoin:round}
.pocx-card-t{flex:1;min-width:0;display:flex;flex-direction:column}
.pocx-card-t b{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pocx-card-t small{font-size:11px;color:#9A8C77}
.pocx-radio{flex:none;width:20px;height:20px;border-radius:999px;border:1.5px solid #D9CFBE;display:grid;place-items:center;transition:.18s}
.pocx-radio svg{width:12px;height:12px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:scale(.4);transition:.2s cubic-bezier(.3,1.4,.5,1)}
.pocx-card.on .pocx-radio{background:#C4502B;border-color:#C4502B}
.pocx-card.on .pocx-radio svg{opacity:1;transform:scale(1)}

.pocx-new{margin-top:2px;padding:11px 12px;border:1px dashed #E0B7A5;border-radius:12px;background:#FFFDF7;
  color:#C4502B;font-weight:600;font-size:13px;cursor:pointer;transition:.18s}
.pocx-new:hover{background:#FCF3EF;border-color:#C4502B}

.pocx-measure{margin-top:18px;animation:pocx-fade .22s ease}
.pocx-phases{margin-top:18px;animation:pocx-fade .22s ease}
.pocx-ph{display:flex;align-items:center;gap:9px;padding:7px 4px;font-size:13px;color:#2A241C;cursor:pointer}
.pocx-ph input{position:absolute;opacity:0;width:0;height:0}
.pocx-tick-sm{flex:none;width:19px;height:19px;border-radius:6px;border:1.5px solid #D9CFBE;display:grid;place-items:center;transition:.16s}
.pocx-tick-sm svg{width:12px;height:12px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:scale(.5);transition:.18s cubic-bezier(.3,1.4,.5,1)}
.pocx-ph.on .pocx-tick-sm{background:#C4502B;border-color:#C4502B}
.pocx-ph.on .pocx-tick-sm svg{opacity:1;transform:scale(1)}

.pocx-wages{margin-top:18px;background:#FAF6EF;border:1px solid #EFE9DE;border-radius:14px;padding:13px;animation:pocx-fade .22s ease}
.pocx-wages-h{margin:0 0 2px;font-size:12.5px}
.pocx-opt{width:100%;text-align:left;display:flex;flex-direction:column;gap:1px;padding:10px 11px;margin-top:8px;
  border:1px solid #E7E0D3;background:#FFFDF7;border-radius:11px;cursor:pointer;transition:border-color .16s,background .16s,transform .12s}
.pocx-opt:hover{border-color:#D9CFBE}
.pocx-opt:active{transform:scale(.99)}
.pocx-opt.on{border-color:#C4502B;background:#FCF3EF}
.pocx-opt b{font-size:12.5px;font-weight:600}
.pocx-opt small{font-size:11px;color:#9A8C77}

.pocx-foot{position:sticky;bottom:0;display:flex;gap:10px;padding:14px 18px;background:#FFFDF7;border-top:1px solid #EFE9DE}
.pocx-cancel{flex:none;padding:11px 16px;border:1px solid #E7E0D3;border-radius:11px;background:#FFFDF7;color:#9A8C77;font-size:13px;cursor:pointer;transition:.15s}
.pocx-cancel:hover{background:#F4EEE3;color:#2A241C}
.pocx-go{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 12px;border:0;border-radius:11px;
  background:#C4502B;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:background .16s,transform .1s,box-shadow .16s;
  box-shadow:0 6px 14px -6px rgba(196,80,43,.55)}
.pocx-go:hover:not(:disabled){background:#A8431F}
.pocx-go:active:not(:disabled){transform:translateY(1px);box-shadow:0 3px 8px -4px rgba(196,80,43,.5)}
.pocx-go:disabled{background:#E4DACF;color:#B5AEA7;cursor:default;box-shadow:none}
.pocx-go svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

.pocx-spin{width:14px;height:14px;border-radius:999px;border:2px solid #D9CFBE;border-top-color:#C4502B;animation:pocx-spin .7s linear infinite;display:inline-block}
.pocx-spin.light{border-color:rgba(255,255,255,.45);border-top-color:#fff}

.pocx-success{position:absolute;inset:0;z-index:5;background:#FFFDF7;border-radius:20px 20px 0 0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:6px;animation:pocx-fade .2s ease}
@media(min-width:560px){.pocx-success{border-radius:20px}}
.pocx-tick{width:64px;height:64px;border-radius:999px;background:#EAF6ED;display:grid;place-items:center;margin-bottom:6px;
  animation:pocx-pop .5s cubic-bezier(.2,1.5,.4,1) both}
.pocx-tick svg{width:30px;height:30px;fill:none;stroke:#2FA04C;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:26;stroke-dashoffset:26;animation:pocx-draw .4s .12s ease forwards}
.pocx-sx-t{margin:0;font-family:'Playfair Display',Georgia,serif;font-size:19px;font-weight:600}
.pocx-sx-s{margin:0;font-size:12px;color:#9A8C77}

@keyframes pocx-fade{from{opacity:0}to{opacity:1}}
@keyframes pocx-rise{from{transform:translateY(28px);opacity:.4}to{transform:translateY(0);opacity:1}}
@keyframes pocx-spin{to{transform:rotate(360deg)}}
@keyframes pocx-pop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
@keyframes pocx-draw{to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.pocx,.pocx-sheet,.pocx-phases,.pocx-wages,.pocx-success,.pocx-tick,.pocx-tick svg{animation:none}}
`;
