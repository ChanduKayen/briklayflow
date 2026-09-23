// CertifyDialog — the attendance sheet's "Certify work" dialog, rebuilt to the redesign artifact
// (contract + stage selects, a unit-aware done-to-date / certifying-now pair, a live ₹ line, a note,
// and the stage's certification log). It is the artifact's exact shape, wired to the REAL governed
// path: submitWorkCertification (auto-approves within the submitter's authority, else routes to the
// Works Approver). Only APPROVED becomes a payable. Used on desktop only; the phone keeps the
// slider CertificationWizard. Certify semantics mirror the sheet's other paths exactly:
//   · lump     → readingValue = the new cumulative %, computedAmount = the ₹ increment
//   · measured → readingValue = the qty increment,   computedAmount = round(rate × increment)
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { submitWorkCertification } from '../../lib/workCertification';
import type { StageRow } from '../../lib/attendanceApi';

export interface CertifyCrewCtx {
  orgId: string;
  projectId: string;
  projectName?: string;
  crewId: string;
  stakeholderId: string | null;
  partyName: string;
  woId: string | null;
  woLabel: string;
  stages: StageRow[];    // the crew's stages (already filtered to the ones it works)
  stageIndex: number;    // the stage to open on
}

const INR = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtQ = (n: number) => (+n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const todayISO = () => new Date().toISOString().slice(0, 10);
const dLabel = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('en-US', { day: 'numeric', month: 'short' }); };

type LogEntry = { date: string; kind: string; reading: number; amount: number; note: string | null };

// The stage's shape in the units the dialog speaks: a lump stage is a %, a measured stage a quantity.
// Every phase also carries a single "% of work completed" (certified ÷ the phase's contract value) —
// payment on a phase is always this proportion of its value, so the % is the honest headline.
function stageShape(st: StageRow) {
  const isLS = st.type === 'lump';
  // The phase's ₹ worth is its AGREED value (planned) — the same figure the contract page uses; a
  // measured phase with no rate on file (qty × rate = 0) still has its value here, so its % is honest.
  const budget = (st.planned || 0) > 0 ? st.planned : (isLS ? (st.amount || 0) : (st.total || 0) * (st.rate || 0));
  const ratePer = isLS ? (budget ? budget / 100 : 0) : (st.rate || 0);   // ₹ per unit (per 1% for lump)
  // Completion reflects the GREATER of certified and paid — a phase already paid on is work done.
  const accounted = Math.max(st.certified || 0, st.paid || 0);
  const done = isLS ? (budget ? accounted / budget * 100 : 0) : (st.rate ? accounted / st.rate : 0);
  const pct = budget > 0 ? Math.min(100, Math.round(accounted / budget * 100)) : 0;
  // What is already PAID, in this stage's own input unit — the floor the reading can't drop below.
  const paidFloor = isLS ? (budget ? Math.min(100, (st.paid || 0) / budget * 100) : 0) : (st.rate ? (st.paid || 0) / st.rate : 0);
  return { isLS, budget, ratePer, done, pct, paidFloor, unit: isLS ? '%' : (st.unit || 'unit'), accounted, certified: st.certified || 0, paid: st.paid || 0, qty: st.total || 0 };
}

export function CertifyDialog({ ctx, onClose, onDone, onToast }: {
  ctx: CertifyCrewCtx;
  onClose: () => void;
  onDone: () => void;                 // successful certify → reload the week
  onToast: (m: string) => void;
}) {
  const [stI, setStI] = useState(Math.max(0, Math.min(ctx.stageIndex, ctx.stages.length - 1)));
  const st = ctx.stages[stI];
  const shape = useMemo(() => stageShape(st), [st]);
  const [total, setTotal] = useState<number>(shape.done);     // done-to-date, in the stage's unit
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const noteRef = useRef<HTMLInputElement>(null);

  // Re-seed the done-to-date and pull the log whenever the stage changes.
  useEffect(() => { setTotal(shape.done); setNote(''); }, [stI]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!st.milestoneId) { setLog([]); return; }
    supabase.from('work_certifications')
      .select('reading_date, created_at, reading_kind, reading_value, computed_amount, note, status')
      .eq('milestone_id', st.milestoneId).eq('status', 'approved')
      .then(({ data }) => {
        if (!live) return;
        const rows = (data ?? []) as any[];
        rows.sort((a, b) => `${a.reading_date || ''}#${a.created_at || ''}`.localeCompare(`${b.reading_date || ''}#${b.created_at || ''}`));
        setLog(rows.reverse().map(r => ({ date: r.reading_date, kind: r.reading_kind, reading: Number(r.reading_value) || 0, amount: Number(r.computed_amount) || 0, note: r.note })));
      });
    return () => { live = false; };
  }, [st.milestoneId]);

  const dq = Math.max(0, +(total - shape.done).toFixed(shape.isLS ? 2 : 3));   // increment in unit/%
  const amt = shape.isLS ? Math.round(dq * shape.ratePer) : Math.round(dq * (st.rate || 0));
  const reaches = total;
  const over = shape.isLS ? total > 100 : total > shape.qty;
  const overBy = shape.isLS ? total - 100 : total - shape.qty;

  // Locked floor: you can never take a stage BELOW what's already been paid on it — that work is agreed
  // and the money is out. The reading holds at the paid mark (or higher); it can only move up.
  const lock = shape.paidFloor;
  const setFromTotal = (v: number) => setTotal(Math.max(lock, v));
  const setFromNew = (n: number) => setTotal(Math.max(lock, +(shape.done + (shape.isLS ? (shape.ratePer ? n / shape.ratePer : 0) : n)).toFixed(2)));
  // Keep the reading at/above the paid floor as the stage changes.
  useEffect(() => { setTotal((t) => (t < lock ? lock : t)); }, [lock]);
  const newValue = shape.isLS ? Math.round(dq * shape.ratePer) : +dq.toFixed(2);   // ₹ for lump, qty for measured
  // The % of the phase this reading would reach (payment is always this proportion of the phase value).
  const reachedPct = shape.isLS ? Math.max(0, Math.round(total)) : (shape.qty ? Math.max(0, Math.round(total / shape.qty * 100)) : 0);
  const barNow = Math.min(100, shape.pct);
  const barAdd = Math.max(0, Math.min(100, reachedPct) - barNow);

  async function certify() {
    if (dq <= 0 || busy) return;
    setBusy(true);
    try {
      const r = await submitWorkCertification({
        orgId: ctx.orgId, projectId: ctx.projectId, woId: ctx.woId, milestoneId: st.milestoneId,
        crewId: ctx.crewId, stakeholderId: ctx.stakeholderId,
        readingKind: shape.isLS ? 'lump' : 'measured',
        readingValue: shape.isLS ? total : dq,      // lump: cumulative %; measured: the increment qty
        computedAmount: amt, readingDate: todayISO(), note: note.trim(),
      });
      onToast(r.status === 'approved' ? `Certified ${INR(amt)} on ${st.n} · now due on Payables` : `${INR(amt)} sent to the Works Approver`);
      onDone();
    } catch (e: any) {
      setBusy(false);
      onToast(e?.message || 'Could not certify');
    }
  }

  const accountedNote = shape.paid > shape.certified ? ` (incl. ${INR(shape.paid)} paid)` : '';
  const stageInfo = shape.isLS
    ? <>Lump sum <b>{INR(shape.budget)}</b> · <b>{shape.pct}% complete</b> — {INR(shape.accounted)} done so far{accountedNote}.</>
    : <><b>{fmtQ(shape.qty)} {shape.unit}</b> at <b>{INR(st.rate || 0)}</b>/{shape.unit} = {INR(shape.budget)} · <b>{fmtQ(shape.done)} {shape.unit} ({shape.pct}% complete)</b> — {INR(shape.accounted)} done so far{accountedNote}.</>;

  return (
    <div className="cdlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CDLG_CSS}</style>
      <div className="cdlg" role="dialog" aria-modal="true" aria-label="Certify work">
        <form className="dlg" onSubmit={(e) => e.preventDefault()}>
          <h2>Certify work</h2>
          <p className="sub">{ctx.partyName}{ctx.projectName ? ` · ${ctx.projectName}` : ''}</p>

          <div className="two">
            <div>
              <p className="lbl">Contract</p>
              <select className="sel" value={ctx.woId || ''} disabled>
                <option value={ctx.woId || ''}>{ctx.woLabel}</option>
              </select>
            </div>
            <div>
              <p className="lbl">Stage</p>
              <select className="sel" value={stI} onChange={(e) => setStI(+e.target.value)}>
                {ctx.stages.map((s, i) => {
                  const sh = stageShape(s);
                  const doneCap = sh.pct >= 100;
                  return <option key={s.milestoneId} value={i}>{s.n} — {sh.pct}% done{doneCap ? ' ✓' : ''}</option>;
                })}
              </select>
            </div>
          </div>

          <div className="live" style={{ marginTop: 10 }}>{stageInfo}</div>
          <div className="cprog">
            <div className="cprog-track"><i className="cprog-now" style={{ width: `${barNow}%` }} /><i className="cprog-add" style={{ left: `${barNow}%`, width: `${barAdd}%` }} /></div>
            <span className="cprog-lbl"><b>{shape.pct}%</b> completed{barAdd > 0 ? <> · <em>→ {Math.min(100, reachedPct)}% after this</em></> : ''}</span>
          </div>

          <div className="two" style={{ marginTop: 14 }}>
            <div>
              <p className="lbl">Done to date</p>
              <label className="field">
                <input type="number" min={round2(lock)} step="any" inputMode="decimal" value={round2(total)}
                  onChange={(e) => setFromTotal(parseFloat(e.target.value) || 0)} />
                <span>{shape.unit}</span>
              </label>
              {lock > 0 && <p style={{ fontSize: 11.5, color: '#A0958A', margin: '6px 0 0' }}>🔒 {INR(shape.paid)} already paid — can't go below {shape.isLS ? `${Math.round(lock)}%` : `${fmtQ(lock)} ${shape.unit}`}</p>}
            </div>
            <div>
              <p className="lbl">Certifying now</p>
              <label className="field">
                <input type="number" min={0} step="any" inputMode="decimal" value={round2(newValue)}
                  onChange={(e) => setFromNew(parseFloat(e.target.value) || 0)} />
                <span>{shape.isLS ? '₹' : shape.unit}</span>
              </label>
            </div>
          </div>

          <div className="live">
            {dq > 0
              ? <>Certifying <b>+{fmtQ(dq)}{shape.isLS ? '%' : ' ' + shape.unit}</b> · <b>{INR(amt)}</b> new — that's <b>{Math.min(100, reachedPct) - shape.pct}%</b> of the phase. Stage reaches <b>{shape.isLS ? fmtQ(reaches) + '%' : fmtQ(reaches) + ' ' + shape.unit} ({Math.min(100, reachedPct)}% complete)</b>{over ? <> — <b>{fmtQ(overBy)} {shape.unit}</b> over the contract quantity; fine if extra work was agreed.</> : '.'}</>
              : total < shape.done ? 'Below what’s already certified. Lower it only to correct a mistake.'
                : 'Nothing new yet — enter what’s done to date or what you’re certifying now.'}
          </div>

          <input className="note" ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was finished (optional)" />

          <div className="log">
            {log.length
              ? <>
                <div className="loghd">Certified so far</div>
                {log.map((e, i) => (
                  <div className="le" key={i}>
                    <span className="ld">{dLabel(e.date)}</span>
                    <span className="lq">{e.kind === 'lump' ? `${fmtQ(e.reading)}%` : `+${fmtQ(e.reading)} ${shape.unit}`}</span>
                    <span className="ln">{e.note || ''}</span>
                    <span className="la">{INR(e.amount)}</span>
                  </div>
                ))}
              </>
              : <div className="loghd">Nothing certified on this stage yet</div>}
          </div>

          <div className="foot">
            <span className="fine">Certified amount shows up as due on Payables.</span>
            <span className="acts">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={dq <= 0 || busy} onClick={certify}>
                {busy ? 'Certifying…' : dq > 0 ? `Certify ${INR(amt)}` : 'Certify'}
              </button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const CDLG_CSS = `
.cdlg-scrim{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:16px;
  background:rgba(40,28,18,.28);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  font-family:'DM Sans',-apple-system,system-ui,sans-serif;color:#1E1915;animation:cdlg-fade .18s ease}
.cdlg *{box-sizing:border-box}
.cdlg{border-radius:20px;background:#FCFAF6;width:min(540px,calc(100vw - 32px));max-height:92vh;overflow-y:auto;
  box-shadow:0 28px 80px rgba(50,35,20,.20),0 6px 18px rgba(50,35,20,.08);animation:cdlg-pop .22s cubic-bezier(.2,.8,.2,1)}
.cdlg .dlg{padding:26px 28px 24px}
.cdlg h2{font-family:'Playfair Display',Georgia,serif;font-weight:500;font-size:24px;margin:0 0 4px;letter-spacing:-.01em}
.cdlg .sub{color:#6E5F51;margin:0 0 20px;font-size:14px}
.cdlg .lbl{font-size:12.5px;color:#A0958A;margin:0 0 6px}
.cdlg .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cdlg .field{display:flex;align-items:center;gap:6px;border-radius:12px;padding:0 14px;height:46px;background:#F4F0E8;
  box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s,background .15s}
.cdlg .field:focus-within{background:#FCFAF6;box-shadow:inset 0 0 0 1.5px #C4552D}
.cdlg .field span{color:#A0958A;font-size:13px;white-space:nowrap}
.cdlg .field input{border:0;background:transparent;outline:0;font-family:'DM Mono',ui-monospace,monospace;font-size:18px;width:100%;color:#1E1915;min-width:0}
.cdlg .field input::-webkit-outer-spin-button,.cdlg .field input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.cdlg .sel{appearance:none;-webkit-appearance:none;border:0;border-radius:12px;
  background:#F4F0E8 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236E5F51' fill='none' stroke-width='1.4'/%3E%3C/svg%3E") no-repeat right 14px center;
  padding:0 36px 0 14px;height:46px;font:inherit;color:#1E1915;width:100%;outline:0;transition:box-shadow .15s;text-overflow:ellipsis}
.cdlg .sel:focus-visible{box-shadow:inset 0 0 0 1.5px #C4552D;outline:0}
.cdlg .sel:disabled{color:#6E5F51;opacity:1}
.cdlg .live{margin:14px 0 0;padding:12px 14px;border-radius:12px;background:#F4F0E8;font-size:13.5px;color:#6E5F51;line-height:1.5}
.cdlg .live b{color:#1E1915;font-weight:500;font-family:'DM Mono',monospace}
.cdlg .cprog{display:flex;align-items:center;gap:12px;margin-top:10px}
.cdlg .cprog-track{flex:1;height:6px;border-radius:999px;background:#EDE7DC;position:relative;overflow:hidden}
.cdlg .cprog-track i{position:absolute;top:0;height:100%;border-radius:999px}
.cdlg .cprog-now{left:0;background:#7F927A}
.cdlg .cprog-add{background:#C4552D}
.cdlg .cprog-lbl{font-family:'DM Mono',monospace;font-size:12px;color:#6E5F51;white-space:nowrap}
.cdlg .cprog-lbl b{color:#1E1915;font-weight:500}
.cdlg .cprog-lbl em{font-style:normal;color:#A8431F;font-weight:500}
.cdlg .note{width:100%;border:0;border-radius:12px;padding:0 14px;height:42px;background:#F4F0E8;font:inherit;color:#1E1915;outline:0;margin-top:12px;transition:box-shadow .15s,background .15s}
.cdlg .note:focus{background:#FCFAF6;box-shadow:inset 0 0 0 1.5px #C4552D}
.cdlg .note::placeholder{color:#A0958A}
.cdlg .log{margin-top:18px;box-shadow:inset 0 1px rgba(70,50,30,.10);padding-top:12px}
.cdlg .loghd{font-size:12.5px;color:#A0958A;margin-bottom:6px}
.cdlg .le{display:grid;grid-template-columns:58px 150px 1fr auto;gap:12px;align-items:baseline;padding:6px 0;font-size:13px}
.cdlg .le + .le{box-shadow:inset 0 1px rgba(70,50,30,.05)}
.cdlg .le .ld{color:#A0958A;font-size:12.5px}
.cdlg .le .lq{font-family:'DM Mono',monospace;color:#1E1915;white-space:nowrap}
.cdlg .le .ln{color:#6E5F51;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cdlg .le .la{font-family:'DM Mono',monospace;color:#6E5F51;white-space:nowrap}
.cdlg .foot{display:flex;justify-content:space-between;align-items:center;margin-top:22px;gap:12px}
.cdlg .foot .fine{color:#A0958A;font-size:12.5px}
.cdlg .foot .acts{display:flex;gap:8px}
.cdlg .btn{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:999px;font-weight:500;
  background:#FCFAF6;box-shadow:0 1px 2px rgba(50,35,20,.05),0 0 0 1px rgba(70,50,30,.10);cursor:pointer;color:#1E1915;font:inherit;border:0}
.cdlg .btn:hover{box-shadow:0 2px 6px rgba(50,35,20,.10),0 0 0 1px rgba(70,50,30,.18)}
.cdlg .btn.primary{background:#C4552D;color:#fff;box-shadow:0 1px 2px rgba(120,50,20,.25)}
.cdlg .btn.primary:hover{background:#A8431F}
.cdlg .btn:disabled{opacity:.45;pointer-events:none}
@keyframes cdlg-fade{from{opacity:0}to{opacity:1}}
@keyframes cdlg-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.cdlg,.cdlg-scrim{animation:none}}
`;
