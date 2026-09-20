/**
 * "Towards which payable?" — the DESKTOP presentation: a centred modal around <PayableOptions>.
 * The mobile cards render PayableOptions in-place as their own next state instead of this modal.
 */
import { createPortal } from 'react-dom';
import { PayableOptions } from './PayableOptions';
import type { Selection, PayeeType } from '../../lib/payableAttribution';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export function PayablePicker({
  payee, projectId, projectName, txnDate, amount, selfPaid = 0, current = null, onConfirm, onClose, allowSkip = true,
}: {
  payee: { id: string; name: string; type: PayeeType };
  projectId: string;
  projectName?: string | null;
  txnDate: string | null;
  amount: number;
  selfPaid?: number;
  /** the choice already on record, so reopening shows it instead of a blank slate */
  current?: string | null;
  onConfirm: (sel: Selection) => void;
  onClose: () => void;
  allowSkip?: boolean;
}) {
  const sub = payee.name + (projectName ? ` · ${projectName}` : '');
  // Portal to <body>: often opened from inside a transformed/animated card, where a position:fixed
  // scrim would be trapped by that ancestor and clip.
  return createPortal((
    <div className="ppk-scrim" onClick={onClose}>
      <style>{CSS}</style>
      <div className="ppk" onClick={(e) => e.stopPropagation()}>
        <div className="ppk-h">
          <div><h3>Towards which payable?</h3><span>{sub} · {inr(amount)}</span></div>
          <button className="ppk-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <PayableOptions
          payee={payee} projectId={projectId} projectName={projectName}
          txnDate={txnDate} amount={amount} selfPaid={selfPaid} allowSkip={allowSkip} current={current}
          onConfirm={onConfirm}
        />
      </div>
    </div>
  ), document.body);
}

const CSS = `
.ppk-scrim{position:fixed;inset:0;z-index:120;background:rgba(30,24,18,.5);display:grid;place-items:center;padding:16px}
.ppk{width:min(460px,100%);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 30px 70px -24px rgba(30,24,18,.6);overflow:hidden;font-family:'Instrument Sans',system-ui,sans-serif;color:#2B211A;padding:0 18px 16px}
.ppk-h{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 0 12px;border-bottom:1px solid #EFE7DE;margin:0 0 8px}
.ppk-h h3{margin:0;font-size:1.05rem;font-weight:600}
.ppk-h span{font-size:.78rem;color:#9B8B7B}
.ppk-x{background:none;border:none;font-size:1rem;color:#9B8B7B;cursor:pointer;line-height:1;padding:2px 4px}
.ppk .pyo{--pyo-accent:#C8603A}
@media (prefers-color-scheme:dark){
  .ppk{background:#211C17;color:#F0E9E1}
  .ppk-h{border-color:#3A322A}
  .ppk-h span,.ppk-x{color:#A99A8A}
}
@media (max-width:640px){
  .ppk-scrim{padding:0;align-items:stretch}
  .ppk{width:100%;max-width:100%;height:100dvh;max-height:100dvh;border-radius:0}
}
`;
