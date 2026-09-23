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
import { loadAttributionTargets, attrTargetsKey, type Selection, type PayeeType, type ContractTarget } from '../../lib/payableAttribution';
import type { BillPick } from '../../lib/billsApi';
import { useOrgId } from '../../lib/auth/AuthProvider';
import NewBillModal, { type BillDraft } from '../bills/NewBillModal';
import { billDoor } from '../nav/txDraft';
import { useIsMobile } from '../../lib/useIsMobile';
import { intakeCommit } from '../../lib/billIntake';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
/** A sheet of paper with a plus — the door to recording one, not a drop zone. */
const DOC_ADD = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H13" />
    <path d="M13.5 3.5 18.5 8.5V11" />
    <path d="M13.5 3.5V8a.5.5 0 0 0 .5.5h4.5" />
    <path d="M18 14.5v6M15 17.5h6" />
  </svg>
);
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
  // The phone's door is the card the bar already carries — camera first, then the slip. The desktop
  // keeps the wide composer, which is what a desktop has room for.
  const isMobile = useIsMobile();
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
  // Nothing of theirs is on the books: there is no choice to make here, and an Attribute that can
  // never be pressed is just a dead weight under the one thing you CAN do. Record the bill first.
  const nothingToPick = targets?.kind === 'vendor' && targets.bills.length === 0;

  // A bill just filed from either door: re-read what is owed and tick the new one.
  const adoptFiled = async (billId: string) => {
    await qc.invalidateQueries({ queryKey: attrTargetsKey({ id: payee.id, type: payee.type }, projectId, txnDate, selfPaid) });
    setBills([billId]);
  };

  const openBillDoor = () => {
    if (isMobile && billDoor.available) {
      billDoor.open({
        lock: { vendorId: payee.id, vendorName: payee.name, projectId, projectName: projectName ?? '' },
        onFiled: (billId) => { void adoptFiled(billId); },
      });
      return;
    }
    setAddBill(true);
  };

  // "Advance" as its own active option: paid ahead of work. If the party has open contracts on this
  // project it reveals them — pick one and the money lands as an OPEN payment on that contract (no
  // stage certified yet; it waits on the contract page to be adjusted onto a phase). No contract →
  // it stays a party-level advance (a recoverable). Kept alongside "On account", which is the escape
  // hatch for money not tied to this party's work at all.
  const advanceRows = (contracts: ContractTarget[]) => (
    <>
      <Radio id="advance" choice={choice?.startsWith('advance') ? 'advance' : choice} set={() => setChoice('advance')}
        title="Advance" note={contracts.length ? 'paid ahead of work — put it on a contract' : 'paid ahead of work — recoverable'} />
      {choice?.startsWith('advance') && contracts.length > 0 && (
        <div className="pyo-sub">
          {contracts.map((c) => (
            <button key={c.woId} type="button" className={`pyo-row sub${choice === `advance:${c.woId}` ? ' on' : ''}`}
              onClick={() => setChoice(`advance:${c.woId}`)}>
              <span className="pyo-rd">{choice === `advance:${c.woId}` ? <i /> : null}</span>
              <span className="pyo-m"><b>{c.label}</b><span>{inr(c.outstanding)} outstanding of {inr(c.value)}</span></span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  const confirm = () => {
    if (!targets) return;
    if (targets.kind === 'vendor') {
      const picks: BillPick[] = pour.map((p) => ({ id: p.id, kind: p.kind, projectId: p.projectId, amount: p.use }));
      onConfirm({ type: 'bills', picks });
    } else if (targets.kind === 'worker_day') {
      if (choice === 'other') onConfirm({ type: 'other' });
      else if (choice === 'advance') onConfirm({ type: 'tag', tag: 'advance' });
      else if (choice?.startsWith('advance:')) onConfirm({ type: 'advance_contract', woId: choice.slice(8), projectId });
      // On a CERTIFIED contract, settling ("this week" / "earlier dues") carries the money into the
      // certified stages so the contract page reflects it — not just a tag. Pure day-wage → a tag.
      else if ((choice === 'this_week' || choice === 'past') && targets.contractWoId) onConfirm({ type: 'settle_certified', woId: targets.contractWoId, projectId });
      else onConfirm({ type: 'tag', tag: choice as 'this_week' | 'past' });
    } else {
      if (choice === 'other') onConfirm({ type: 'other' });
      else if (choice === 'past') onConfirm({ type: 'tag', tag: 'past' });
      else if (choice === 'advance') onConfirm({ type: 'tag', tag: 'advance' });
      else if (choice?.startsWith('advance:')) onConfirm({ type: 'advance_contract', woId: choice.slice(8), projectId });
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
                        <b>{b.billNo ? `Bill #${b.billNo}` : 'Bill'}{b.date ? ` · ${fmtDate(b.date)}` : ''}</b>
                        {b.items && <span>{b.items}</span>}
                        <span>{inr(b.remaining)} left of {inr(b.amount)}{b.earlier ? ' · payment predates this bill' : ''}</span>
                      </span>
                      <em>{inr(b.remaining)}</em>
                    </button>
                  );
                })}
              </>
            ) : <p className="pyo-none">No unpaid bill for {payee.name}{projectName ? ` on ${projectName}` : ''} yet.</p>}
            {/* The bill module owns the actual upload/create; this is just its door on the txn side.
                It is built as a row, like the choices above it: an absence is still part of the same
                list, and a dashed outline promised a drop zone this never was. */}
            <button type="button" className="pyo-add" onClick={openBillDoor}>
              <span className="pyo-ic" aria-hidden="true">{DOC_ADD}</span>
              <span className="pyo-m">
                <b>{targets.bills.length ? 'Another bill' : 'Record the bill'}</b>
                <span>Scan the paper, or type it in</span>
              </span>
              <span className="pyo-go" aria-hidden="true">›</span>
            </button>
          </>
        ) : targets.kind === 'worker_day' ? (
          <>
            {targets.isAdvance
              ? <p className="pyo-note">Nothing is owed on this site before this payment — it sits as an <b>advance</b> (a recoverable) until it is earned.</p>
              : <p className="pyo-hint">What does this payment settle? (Figures are what was owed <b>before</b> it.)</p>}
            <Radio id="this_week" choice={choice} set={setChoice} disabled={targets.thisWeek <= 0.5}
              title="This week's payment" note={targets.thisWeek > 0.5 ? inr(targets.thisWeek) + " — this week's payable (certified work or wages)" : 'nothing owed this week'} />
            <Radio id="past" choice={choice} set={setChoice} disabled={targets.pastBalance <= 0.5}
              title="Earlier dues" note={targets.pastBalance > 0.5 ? inr(targets.pastBalance) + ' — carried from before this week' : 'nothing carried'} />
            {advanceRows(targets.contracts)}
            <Radio id="other" choice={choice} set={setChoice} title="On account" note="not tied to specific work yet" />
          </>
        ) : (
          <>
            {targets.isAdvance
              ? <p className="pyo-note">Nothing is owed on this contract before this payment — it sits as an <b>advance</b> (a recoverable) until it is earned.</p>
              : <p className="pyo-hint">
                  {targets.wagesMode
                    ? `This week's payment of ${inr(amount)} — which stage of ${targets.woLabel} is it against?`
                    : targets.tracked
                      ? `${targets.woLabel} · certified from site readings — a payment can't settle a stage here.`
                      : `Pick a stage of ${targets.woLabel} this payment settles.`}
                </p>}
            {targets.phases.map((ph) => (
              <Radio key={ph.milestoneId} id={ph.milestoneId} choice={choice} set={setChoice}
                disabled={!targets.wagesMode && (targets.tracked || ph.remaining <= 0.5)}
                title={ph.name}
                note={targets.wagesMode
                  ? `${ph.spec}${targets.thisWeek > 0.5 ? ` · ${inr(targets.thisWeek)} this week` : ''}`
                  : ph.remaining > 0.5 ? `${ph.spec} · ${inr(ph.remaining)} left` : `${ph.spec} · fully certified`} />
            ))}
            {targets.pastBalance > 0.5 && (
              <Radio id="past" choice={choice} set={setChoice} title="Earlier dues" note={`${inr(targets.pastBalance)} — carried from before this week`} />
            )}
            {advanceRows(targets.contracts)}
            <Radio id="other" choice={choice} set={setChoice} title="On account" note="not tied to specific work yet" />
          </>
        )}
      </div>
      {(allowSkip || !nothingToPick) && (
        <div className="pyo-f">
          {allowSkip && <button className="pyo-ghost" onClick={() => onConfirm({ type: 'skip' })}>Skip</button>}
          {!nothingToPick && <button className="pyo-prim" disabled={!canConfirm} onClick={confirm}>Attribute</button>}
        </div>
      )}

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
            await adoptFiled(res.billId);
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
.pyo-none{font-size:.85rem;opacity:.6;padding:6px 2px 4px;margin:0;line-height:1.5}
/* Contracts revealed under "Advance": a nested list, marked by a left rail so they read as belonging to it. */
.pyo-sub{display:flex;flex-direction:column;gap:6px;margin:-2px 0 2px;padding-left:14px;border-left:2px solid rgba(200,96,58,.28)}
.pyo-sub .pyo-row{padding:10px 12px}
/* The same row the choices are cut from, without their fill: this is an action, not an option. */
.pyo-add{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:12px 13px;background:none;
  border:1px solid rgba(128,128,128,.22);border-radius:12px;font:inherit;color:inherit;cursor:pointer;margin-top:2px;
  transition:background .18s,border-color .18s,transform .12s}
.pyo-add:hover{background:rgba(128,128,128,.09);border-color:rgba(128,128,128,.34)}
.pyo-add:active{transform:scale(.994)}
.pyo-ic{flex:none;width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:rgba(200,96,58,.16);color:var(--pyo-accent)}
.pyo-ic svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.pyo-go{flex:none;font-size:1.05rem;line-height:1;opacity:.38}
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
