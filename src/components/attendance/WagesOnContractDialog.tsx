// The one question a wages engagement leaves open, asked at the moment it is created: do these day
// wages come off the contract this party already holds here, or stand beside it? Desktop half of the
// ask — the phone asks the same thing, in the same words, from its bottom sheet.
//
// Only what is necessary is on screen: the two answers, and (when there is more than one) which
// contract they come off. Nothing is certified from here; the fold happens day by day as attendance
// is marked.
import { useState } from 'react';
import { WAGES_ASK, setWagesAgainstContract, shortContract, type WageContract } from './wagesOnContract';

export type WagesAskCtx = {
  orgId: string; projectId: string; stakeholderId: string | null;
  crewId: string; name: string;
};

const INR = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export function WagesOnContractDialog({ ctx, contracts, onClose, onDone, onError, onToast }: {
  ctx: WagesAskCtx; contracts: WageContract[];
  onClose: () => void; onDone: () => void; onError: (m: string) => void; onToast: (m: string) => void;
}) {
  const [choice, setChoice] = useState<'off' | 'keep'>('off');
  const [woId, setWoId] = useState<string>(contracts[0]?.woId ?? '');
  const [busy, setBusy] = useState(false);

  const picked = contracts.find((c) => c.woId === woId) ?? contracts[0];

  async function confirm() {
    if (busy) return;
    if (choice === 'keep') { onToast(WAGES_ASK.doneKeep(ctx.name)); onDone(); return; }
    if (!picked) return;
    setBusy(true);
    try {
      await setWagesAgainstContract({ crewId: ctx.crewId, orgId: ctx.orgId, projectId: ctx.projectId, stakeholderId: ctx.stakeholderId, woId: picked.woId });
      onToast(WAGES_ASK.doneOff(ctx.name, picked.label));
      onDone();
    } catch (e) { setBusy(false); onError((e instanceof Error && e.message) || 'Could not set the wages against that contract'); }
  }

  return (
    <div className="wdlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{WDLG_CSS}</style>
      <div className="wdlg" role="dialog" aria-modal="true" aria-label={WAGES_ASK.title}>
        <form className="dlg" onSubmit={(e) => e.preventDefault()}>
          <h2>{WAGES_ASK.title}</h2>
          <p className="sub">{WAGES_ASK.sub(ctx.name)}</p>

          <label className={`opt${choice === 'off' ? ' on' : ''}`}>
            <input type="radio" name="wages-ask" checked={choice === 'off'} onChange={() => setChoice('off')} />
            <div>
              <div className="l">{WAGES_ASK.offLabel}</div>
              <div className="s">{picked ? WAGES_ASK.offDesc(picked) : ''}</div>
              {picked && contracts.length === 1 && (
                <div className="conname" title={picked.label}>{WAGES_ASK.offMeta(picked)}</div>
              )}
            </div>
          </label>
          <label className={`opt${choice === 'keep' ? ' on' : ''}`}>
            <input type="radio" name="wages-ask" checked={choice === 'keep'} onChange={() => setChoice('keep')} />
            <div>
              <div className="l">{WAGES_ASK.keepLabel}</div>
              <div className="s">{WAGES_ASK.keepDesc}</div>
            </div>
          </label>

          {choice === 'off' && contracts.length > 1 && (
            <>
              <label className="q">{WAGES_ASK.which}</label>
              {contracts.map((c) => (
                <label className={`opt${woId === c.woId ? ' on' : ''}`} key={c.woId}>
                  <input type="radio" name="wages-wo" checked={woId === c.woId} onChange={() => setWoId(c.woId)} />
                  <div className="grow"><div className="l clip" title={c.label}>{shortContract(c.label, 46)}</div><div className="s">{INR(c.left)} still to certify</div></div>
                  {c.value ? <span className="m">{INR(c.value)}</span> : null}
                </label>
              ))}
            </>
          )}

          <div className="foot">
            <span className="acts">
              <button type="button" className="btn" onClick={onClose}>Not now</button>
              <button type="button" className="btn primary" disabled={busy || (choice === 'off' && !picked)} onClick={confirm}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

const WDLG_CSS = `
.wdlg-scrim{position:fixed;inset:0;z-index:92;display:grid;place-items:center;padding:16px;
  background:rgba(40,28,18,.28);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  font-family:'DM Sans',-apple-system,system-ui,sans-serif;color:#1E1915;animation:wdlg-fade .18s ease}
.wdlg *{box-sizing:border-box}
.wdlg{border-radius:20px;background:#FCFAF6;width:min(500px,calc(100vw - 32px));max-height:92vh;overflow-y:auto;
  box-shadow:0 28px 80px rgba(50,35,20,.20),0 6px 18px rgba(50,35,20,.08);animation:wdlg-pop .22s cubic-bezier(.2,.8,.2,1)}
.wdlg .dlg{padding:26px 28px 24px}
.wdlg h2{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:23px;margin:0 0 4px;letter-spacing:-.01em}
.wdlg .sub{color:#6E5F51;margin:0 0 18px;font-size:14px}
.wdlg .q{display:block;font-weight:500;margin:18px 0 8px}
.wdlg .opt{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border-radius:12px;cursor:pointer;margin-bottom:8px;
  background:#F4F0E8;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s,background .15s}
.wdlg .opt:hover{background:#EDE7DC}
.wdlg .opt.on{background:#FBEEE7;box-shadow:inset 0 0 0 1.5px #C4552D}
.wdlg .opt input{margin-top:3px;accent-color:#C4552D}
.wdlg .opt .l{font-weight:500}
.wdlg .opt .s{color:#6E5F51;font-size:13px;line-height:1.5;margin-top:2px}
.wdlg .opt .grow{min-width:0;flex:1}
.wdlg .opt .l.clip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* a contract's name is often its whole scope — it gets its own clamped line, never a clause */
.wdlg .conname{margin-top:8px;padding:5px 8px;border-radius:6px;background:#FBEEE7;color:#A8431F;
  font-family:'DM Mono',ui-monospace,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wdlg .opt.on .conname{background:#F6E2D8}
.wdlg .opt .m{margin-left:auto;font-family:'DM Mono',monospace;color:#6E5F51;white-space:nowrap;font-size:13px}
.wdlg .foot{display:flex;justify-content:flex-end;align-items:center;margin-top:20px;gap:12px}
.wdlg .foot .acts{display:flex;gap:8px}
.wdlg .btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:999px;font-weight:500;
  background:#FCFAF6;box-shadow:0 1px 2px rgba(50,35,20,.05),0 0 0 1px rgba(70,50,30,.10);cursor:pointer;color:#1E1915;font:inherit;border:0}
.wdlg .btn:hover{box-shadow:0 2px 6px rgba(50,35,20,.10),0 0 0 1px rgba(70,50,30,.18)}
.wdlg .btn.primary{background:#C4552D;color:#fff;box-shadow:0 1px 2px rgba(120,50,20,.25)}
.wdlg .btn.primary:hover{background:#A8431F}
.wdlg .btn:disabled{opacity:.45;pointer-events:none}
@keyframes wdlg-fade{from{opacity:0}to{opacity:1}}
@keyframes wdlg-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.wdlg,.wdlg-scrim{animation:none}}
`;
