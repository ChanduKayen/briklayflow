/**
 * The "Towards which payable?" OPTIONS — the reusable body, without any modal/card chrome.
 *
 * It loads the targets, lets the user pick (nothing pre-selected, nothing auto-linked) and hands the
 * choice back via onConfirm. The container supplies the frame: the desktop PayablePicker wraps it in
 * a centred modal; the mobile cards render it in-place as their "next state". Theme-neutral — text
 * inherits currentColor and borders are translucent, so it sits on a dark card or a light one.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadAttributionTargets, attrTargetsKey, type Selection, type PayeeType } from '../../lib/payableAttribution';
import type { BillPick } from '../../lib/billsApi';
import { useOrgId } from '../../lib/auth/AuthProvider';
import NewBillModal, { type BillDraft } from '../bills/NewBillModal';
import { intakeCommit } from '../../lib/billIntake';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '';

export function PayableOptions({
  payee, projectId, projectName, txnDate, amount, selfPaid = 0, allowSkip = true, current = null, onConfirm,
}: {
  payee: { id: string; name: string; type: PayeeType };
  projectId: string;
  projectName?: string | null;
  txnDate: string | null;
  amount: number;
  selfPaid?: number;
  allowSkip?: boolean;
  /** The choice already on record — a tag ('this_week' | 'past' | 'other') or a milestone id. Opening
   *  on it is what makes this a picker you can come back to: reopening used to show a blank slate,
   *  which read as "nothing was saved" even though it had been. */
  current?: string | null;
  onConfirm: (sel: Selection) => void;
}) {
  const { data: targets, isLoading } = useQuery({
    queryKey: attrTargetsKey({ id: payee.id, type: payee.type }, projectId, txnDate, selfPaid),
    enabled: !!payee.id && !!projectId,
    queryFn: () => loadAttributionTargets({ id: payee.id, type: payee.type }, projectId, txnDate, selfPaid),
    staleTime: 60_000,
  });

  const [bills, setBills] = useState<string[]>([]);
  const [choice, setChoice] = useState<string | null>(current);
  const [addBill, setAddBill] = useState(false);   // the "upload / add a bill" door (vendors)
  const orgId = useOrgId();
  const qc = useQueryClient();

  const pour = useMemo(() => {
    if (targets?.kind !== 'vendor') return [] as Array<{ id: string; kind: 'bill' | 'po'; projectId: string | null; use: number }>;
    let left = amount; const out: Array<{ id: string; kind: 'bill' | 'po'; projectId: string | null; use: number }> = [];
    for (const id of bills) {
      const b = targets.bills.find((x) => x.id === id); if (!b) continue;
      const use = Math.min(left, b.remaining); if (use > 0) out.push({ id: b.id, kind: b.kind, projectId: b.projectId, use });
      left -= use; if (left <= 0.5) break;
    }
    return out;
  }, [bills, targets, amount]);

  const canConfirm = targets?.kind === 'vendor' ? pour.length > 0 : !!choice;

  const confirm = () => {
    if (!targets) return;
    if (targets.kind === 'vendor') {
      const picks: BillPick[] = pour.map((p) => ({ id: p.id, kind: p.kind, projectId: p.projectId, amount: p.use }));
      onConfirm({ type: 'bills', picks });
    } else if (targets.kind === 'worker_day') {
      if (choice === 'other') onConfirm({ type: 'other' });
      else onConfirm({ type: 'tag', tag: choice as 'this_week' | 'past' });
    } else {
      if (choice === 'other') onConfirm({ type: 'other' });
      else if (choice === 'past') onConfirm({ type: 'tag', tag: 'past' });
      else onConfirm({ type: 'phase', woId: targets.woId, milestoneId: choice, certify: !targets.wagesMode });
    }
  };

  return (
    <div className="pyo">
      <style>{CSS}</style>
      <div className="pyo-b">
        {isLoading || !targets ? (
          <div className="pyo-skel" aria-busy="true" aria-label="Loading payables">
            <span className="pyo-sk sk-hint" />
            <span className="pyo-sk sk-row" /><span className="pyo-sk sk-row" /><span className="pyo-sk sk-row" />
          </div>
        ) : targets.kind === 'vendor' ? (
          <>
            {targets.bills.length ? (
              <>
                <p className="pyo-hint">Tick the bill(s) this payment settles. One or more.</p>
                {targets.bills.map((b) => {
                  const on = bills.includes(b.id);
                  return (
                    <button key={b.id} type="button" className={`pyo-row${on ? ' on' : ''}`}
                      onClick={() => setBills((p) => (p.includes(b.id) ? p.filter((x) => x !== b.id) : [...p, b.id]))}>
                      <span className="pyo-ck">{on ? '✓' : ''}</span>
                      <span className="pyo-m">
                        <b>{b.billNo || 'Bill'}{b.date ? ` · ${fmtDate(b.date)}` : ''}</b>
                        <span>{inr(b.remaining)} left of {inr(b.amount)}{b.earlier ? ' · payment predates this bill' : ''}</span>
                      </span>
                      <em>{inr(b.remaining)}</em>
                    </button>
                  );
                })}
              </>
            ) : <div className="pyo-none">No unpaid bill for {payee.name}{projectName ? ` on ${projectName}` : ''} yet.</div>}
            {/* The bill module owns the actual upload/create; this is just its door on the txn side. */}
            <button type="button" className="pyo-add" onClick={() => setAddBill(true)}>+ Upload a bill · or enter it manually</button>
          </>
        ) : targets.kind === 'worker_day' ? (
          <>
            {targets.isAdvance
              ? <p className="pyo-note">Nothing is owed on this site before this payment — it looks like an <b>advance</b>.</p>
              : <p className="pyo-hint">What is this payment settling? (Figures are what was owed <b>before</b> this payment.)</p>}
            <Radio id="this_week" choice={choice} set={setChoice} disabled={targets.thisWeek <= 0.5}
              title="This week's payable" note={targets.thisWeek > 0.5 ? inr(targets.thisWeek) + ' — this week from work done' : 'nothing owed this week'} />
            <Radio id="past" choice={choice} set={setChoice} disabled={targets.pastBalance <= 0.5}
              title="Past ledger balance" note={targets.pastBalance > 0.5 ? inr(targets.pastBalance) + ' — carried from before' : 'nothing carried'} />
            <Radio id="other" choice={choice} set={setChoice} title="Other" note="Advance, or not against work done" />
          </>
        ) : (
          <>
            {targets.isAdvance
              ? <p className="pyo-note">Nothing is owed on this contract before this payment — it looks like an <b>advance</b>.</p>
              : <p className="pyo-hint">
                  {targets.wagesMode
                    ? `This week's payment of ${inr(amount)} — which phase of ${targets.woLabel} is it against?`
                    : targets.tracked
                      ? `${targets.woLabel} · certified from site readings — a payment can't settle a phase here.`
                      : `Pick a phase of ${targets.woLabel} to settle from this payment.`}
                </p>}
            {targets.phases.map((ph) => (
              <Radio key={ph.milestoneId} id={ph.milestoneId} choice={choice} set={setChoice}
                disabled={!targets.wagesMode && (targets.tracked || ph.remaining <= 0.5)}
                title={ph.name}
                note={targets.wagesMode
                  ? (targets.thisWeek > 0.5 ? `${inr(targets.thisWeek)} — this week's work` : `This week's payment recorded here`)
                  : ph.remaining > 0.5 ? `${inr(ph.remaining)} left of ${inr(ph.value)}` : 'fully certified'} />
            ))}
            {targets.pastBalance > 0.5 && (
              <Radio id="past" choice={choice} set={setChoice} title="Ledger balance" note={`${inr(targets.pastBalance)} — carried from before`} />
            )}
            <Radio id="other" choice={choice} set={setChoice} title="Other" note="Advance, or settle later" />
          </>
        )}
      </div>
      <div className="pyo-f">
        {allowSkip && <button className="pyo-ghost" onClick={() => onConfirm({ type: 'skip' })}>Skip</button>}
        <button className="pyo-prim" disabled={!canConfirm} onClick={confirm}>Attribute</button>
      </div>

      {addBill && (
        <NewBillModal
          open title="Upload the bill" stackAbove={10060}
          onClose={() => setAddBill(false)}
          lockVendor={{ id: payee.id, name: payee.name }}
          lockProject={projectId ? { id: projectId } : null}
          commit={async (d: BillDraft) => {
            const res = await intakeCommit(
              { orgId: orgId ?? '', source: 'tx_picker', file: d.file, vendorId: payee.id, projectId: d.projectId ?? projectId },
              { vendor: d.vendorName || payee.name, billNo: d.billNo, billDate: d.billDate, amount: d.amount, lines: d.lines },
              payee.id, { allowDuplicate: d.allowDuplicate },
            );
            if (res.status === 'duplicate') return { duplicate: res.existing };
            // Their new bill → refresh the list and pre-tick it (an explicit action, not an assumption).
            // The modal closes itself on success (its own leave animation → onClose → setAddBill(false)).
            await qc.invalidateQueries({ queryKey: attrTargetsKey({ id: payee.id, type: payee.type }, projectId, txnDate, selfPaid) });
            setBills([res.billId]);
          }}
        />
      )}
    </div>
  );
}

function Radio({ id, choice, set, title, note, disabled }: {
  id: string; choice: string | null; set: (v: string) => void; title: string; note: string; disabled?: boolean;
}) {
  const on = choice === id;
  return (
    <button type="button" className={`pyo-row${on ? ' on' : ''}`} disabled={disabled} onClick={() => set(id)}>
      <span className="pyo-rd">{on ? <i /> : null}</span>
      <span className="pyo-m"><b>{title}</b><span>{note}</span></span>
    </button>
  );
}

// Theme-neutral: text inherits currentColor; surfaces/borders are translucent so it reads on a dark
// card or a light one. --pyo-accent can be overridden by a container to match its brand.
const CSS = `
.pyo{--pyo-accent:#C8603A;display:flex;flex-direction:column;min-height:0;flex:1}
.pyo-b{display:flex;flex-direction:column;gap:8px;overflow-y:auto;min-height:0;padding:2px 0}
.pyo-hint{font-size:.8rem;opacity:.6;margin:0 0 2px}
.pyo-note{font-size:.82rem;background:rgba(200,140,40,.14);border:1px solid rgba(200,140,40,.35);border-radius:9px;padding:9px 11px;margin:0 0 4px;line-height:1.45}
.pyo-row{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:12px 13px;background:rgba(128,128,128,.08);border:1px solid rgba(128,128,128,.22);border-radius:12px;font:inherit;color:inherit;cursor:pointer}
.pyo-row:hover:not(:disabled){background:rgba(128,128,128,.14)}
.pyo-row.on{background:rgba(200,96,58,.16);border-color:var(--pyo-accent)}
.pyo-row:disabled{opacity:.4;cursor:not-allowed}
.pyo-ck{width:19px;height:19px;flex:none;border:1.5px solid rgba(128,128,128,.5);border-radius:5px;display:grid;place-items:center;font-size:.72rem;font-weight:800;color:var(--pyo-accent)}
.pyo-row.on .pyo-ck{border-color:var(--pyo-accent)}
.pyo-rd{width:18px;height:18px;flex:none;border:1.5px solid rgba(128,128,128,.5);border-radius:50%;display:grid;place-items:center}
.pyo-row.on .pyo-rd{border-color:var(--pyo-accent)}
.pyo-rd i{width:9px;height:9px;border-radius:50%;background:var(--pyo-accent)}
.pyo-m{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.pyo-m b{font-weight:600;font-size:.9rem}
.pyo-m span{font-size:.76rem;opacity:.62;overflow:hidden;text-overflow:ellipsis}
.pyo-row em{font-style:normal;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.85rem;flex:none}
.pyo-none{font-size:.85rem;opacity:.62;padding:14px 4px 4px;line-height:1.5;text-align:center}
.pyo-add{align-self:flex-start;background:none;border:1px dashed rgba(128,128,128,.4);border-radius:10px;padding:9px 13px;font:inherit;font-size:.82rem;color:var(--pyo-accent);cursor:pointer;margin-top:2px}
.pyo-add:hover{background:rgba(200,96,58,.08)}
.pyo-skel{display:flex;flex-direction:column;gap:8px}
.pyo-sk{display:block;border-radius:12px;background:linear-gradient(90deg,rgba(128,128,128,.10) 25%,rgba(128,128,128,.20) 37%,rgba(128,128,128,.10) 63%);background-size:400% 100%;animation:pyo-shim 1.3s ease-in-out infinite}
.pyo-sk.sk-hint{height:12px;width:60%;border-radius:6px;margin:2px 0 6px}
.pyo-sk.sk-row{height:58px}
@keyframes pyo-shim{0%{background-position:100% 0}100%{background-position:-100% 0}}
@media (prefers-reduced-motion:reduce){.pyo-sk{animation:none}}
.pyo-f{display:flex;justify-content:flex-end;gap:10px;padding-top:12px;margin-top:4px;border-top:1px solid rgba(128,128,128,.18)}
.pyo-ghost{background:none;border:1px solid rgba(128,128,128,.4);border-radius:9px;padding:9px 16px;font:inherit;font-size:.85rem;color:inherit;opacity:.8;cursor:pointer}
.pyo-prim{background:var(--pyo-accent);border:none;border-radius:9px;padding:9px 20px;font:inherit;font-size:.85rem;font-weight:600;color:#fff;cursor:pointer}
.pyo-prim:disabled{opacity:.45;cursor:default}
`;
