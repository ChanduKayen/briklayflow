// PayablesMobile — the weekly payment run on a phone, built to the payables reference design.
//
// Presentation only. Every figure, every total and every action belongs to Payables and arrives as
// props, so recording a payment still runs through recordWeeklyPayment / settleWeeklyPaymentOnLedger.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const CSS = `
.plm{--tint:#C4502B;--tint-press:#A8431F;--ink:#1B1713;--ink-2:#87807A;--ink-3:#B5AEA7;
  --bg:#F8F6F3;--card:#FFFFFF;--hair:rgba(50,42,35,.1);--good:#2FA04C;--warn:#B45309;--r:18px;
  --spring:cubic-bezier(.32,1.4,.5,1);--ease:cubic-bezier(.25,.1,.25,1);--sheet:cubic-bezier(.32,.72,0,1);
  background:var(--bg);color:var(--ink);min-height:100vh;line-height:normal;
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','DM Sans',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.plm *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.plm button{font:inherit}

/* the run scrolls with the page; the padding clears the app's own tab bar */
.plm .run{padding:18px 20px calc(96px + env(safe-area-inset-bottom))}

.plm .title{font-size:30px;font-weight:800;letter-spacing:-.03em;margin:0}

.plm .weekbar{display:flex;align-items:center;gap:8px;margin-top:12px}
.plm .wbtn{width:36px;height:36px;border:0;border-radius:12px;background:var(--card);cursor:pointer;
  display:grid;place-items:center;color:var(--ink-2);transition:transform .15s var(--spring);
  box-shadow:0 1px 6px -2px rgba(27,23,19,.12);position:relative}
.plm .wbtn:active{transform:scale(.88)}
.plm .wlabel{flex:1;text-align:center;font-size:15px;font-weight:600;background:var(--card);
  height:36px;display:grid;place-items:center;border-radius:12px;box-shadow:0 1px 6px -2px rgba(27,23,19,.12);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}
.plm .wnow{border:0;background:none;font-size:14px;font-weight:600;color:var(--tint);
  cursor:pointer;padding:8px 6px;transition:opacity .15s;white-space:nowrap;position:relative}
.plm .wnow:active{opacity:.35}
/* 36px reads right beside 15px text; the hit area is still a full 44 */
.plm .wbtn::after,.plm .wnow::after{content:'';position:absolute;top:50%;left:50%;
  width:max(100%,44px);height:44px;transform:translate(-50%,-50%)}

.plm .hero{margin-top:16px;background:var(--card);border-radius:22px;padding:22px 22px 20px;
  box-shadow:0 8px 28px -16px rgba(27,23,19,.16)}
.plm .hero .k{font-size:14px;font-weight:500;color:var(--ink-2)}
.plm .hero .v{font-size:40px;font-weight:800;letter-spacing:-.04em;margin-top:4px;font-variant-numeric:tabular-nums}
.plm .prog{height:6px;border-radius:6px;background:rgba(27,23,19,.07);margin-top:16px;overflow:hidden}
.plm .prog i{display:block;height:100%;border-radius:6px;background:var(--good);width:0;transition:width .8s var(--ease)}
.plm .hero .sub{display:flex;justify-content:space-between;gap:12px;margin-top:10px;
  font-size:13.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.plm .hero .sub b{color:var(--good);font-weight:600}

.plm .sect{margin-top:26px}
.plm .sect-h{display:flex;align-items:baseline;margin:0 4px 8px}
.plm .sect-h .n{font-size:13px;font-weight:600;color:var(--ink-2);flex:1;min-width:0}
.plm .sect-h .t{font-size:13px;font-weight:600;color:var(--ink-2);font-variant-numeric:tabular-nums;flex-shrink:0}
.plm .group{background:var(--card);border-radius:var(--r);overflow:hidden}

.plm .p{position:relative;transition:background .4s}
.plm .p+.p::before,.plm .addline::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;
  background:var(--hair);transform:scaleY(.5)}
.plm .p .main{display:flex;align-items:center;gap:12px;padding:14px 18px;min-height:64px}
.plm .p .who{flex:1;min-width:0;cursor:pointer;border:0;background:none;text-align:left;padding:0;color:inherit}
/* every row opens to show how its figure was reached, so every row says so */
.plm .p .rl .chev{flex-shrink:0;color:var(--ink-3);font-size:14px;line-height:1;
  transition:transform .25s var(--ease),color .2s}
.plm .p.open .rl .chev{transform:rotate(90deg);color:var(--tint)}
.plm .p.open{background:#FCFAF8}
.plm .p.open::after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--tint)}
.plm .p .nm{font-size:16px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plm .p .rl{font-size:13.5px;color:var(--ink-2);margin-top:2px;display:flex;align-items:center;gap:5px}
.plm .p .rl .rt{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plm .p .flag{font-size:13px;font-weight:500;color:var(--warn);margin-top:3px}
.plm .p .flag.calm{color:var(--ink-2)}
.plm .p .flag.good{color:var(--good)}
.plm .p .amt{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em;
  text-align:right;flex-shrink:0}
.plm .p .amt span{display:block;font-size:11.5px;font-weight:500;color:var(--ink-3)}
/* what is owed from before — stated beside the party, never added into this week's figure */
.plm .p .flag.bf{color:var(--warn)}
.plm .p.paid .flag.bf{color:var(--ink-3);font-weight:400}
.plm .sums{margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--hair)}
.plm .sums:last-child{margin-bottom:0;padding-bottom:0;border-bottom:0}
.plm .erow.af{margin-top:6px;padding-top:8px;border-top:1px dashed var(--hair);color:var(--ink-2)}
.plm .erow.af .l{color:var(--ink-2)}
.plm .pay{border:0;border-radius:999px;background:rgba(196,80,43,.1);color:var(--tint);
  font-size:14.5px;font-weight:600;padding:9px 18px;cursor:pointer;flex-shrink:0;
  transition:transform .15s var(--spring),background .2s}
.plm .pay:active{transform:scale(.92);background:rgba(196,80,43,.18)}
.plm .pay:disabled{opacity:.4;transform:none}
.plm .p.paid{background:#FBFDFB}
.plm .p.paid .pay{display:none}
.plm .p .done{display:none;align-items:center;gap:6px;flex-shrink:0;font-size:14px;font-weight:600;color:var(--good)}
.plm .p.paid .done{display:flex}
.plm .p.paid .amt{color:var(--ink-2);font-weight:600}
.plm .ckc{width:20px;height:20px;border-radius:50%;background:var(--good);display:grid;place-items:center;
  color:#fff;animation:plmpop .45s var(--spring)}
@keyframes plmpop{from{transform:scale(0)}to{transform:scale(1)}}

.plm .p.carried .amt{color:var(--ink-3);font-weight:600}
.plm .carrybtn{border:0;background:none;font-size:14.5px;font-weight:600;color:var(--ink-3);
  padding:9px 4px;cursor:pointer;flex-shrink:0}
.plm .expl{display:grid;grid-template-rows:0fr;transition:grid-template-rows .38s var(--sheet)}
.plm .expl.open{grid-template-rows:1fr}
.plm .expl>.expl-w{overflow:hidden;min-height:0;margin:0;padding:0;border:0}
.plm .expl-in{margin:0 18px 16px;background:var(--bg);border-radius:14px;padding:14px 16px}
.plm .expl-in .e0{font-size:13.5px;color:var(--ink-2);line-height:1.5;margin-bottom:10px}
.plm .erow{display:flex;justify-content:space-between;gap:12px;font-size:14px;padding:5px 0;font-variant-numeric:tabular-nums}
.plm .erow .l{color:var(--ink-2)}
.plm .erow.tt{border-top:1px solid var(--hair);margin-top:4px;padding-top:9px;font-weight:600}
.plm .ledgerlink{display:block;width:100%;text-align:left;border:0;background:none;margin-top:12px;
  padding:4px 0;font-size:13.5px;font-weight:600;color:var(--tint);cursor:pointer}
.plm .ledgerlink:active{opacity:.4}

/* the desktop's Rationale, wearing this design — same component, same arithmetic */
.plm .rat{margin-top:2px}
.plm .rat .box{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;font-size:13px}
.plm .rat .box>div{min-width:0;overflow-x:auto}
.plm .rat .cap{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3);margin-bottom:7px}
.plm .rat .mini{border-collapse:collapse;width:100%}
.plm .rat .mini th,.plm .rat .mini td{text-align:center;padding:4px 6px;font-size:12.5px;border-bottom:1px solid var(--hair)}
.plm .rat .mini th{color:var(--ink-3);font-weight:500;font-size:11.5px}
.plm .rat .mini td:first-child,.plm .rat .mini th:first-child{text-align:left;color:var(--ink-2);width:110px}
.plm .rat .mini td:last-child,.plm .rat .mini th:last-child{text-align:right;font-weight:500;white-space:nowrap}
.plm .rat .mini .off{color:var(--ink-3)}
.plm .rat .ledger .ln{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px dashed var(--hair)}
.plm .rat .ledger .ln:first-child{border-top:0}
.plm .rat .ledger .ln.sum{border-top:1px solid var(--hair);font-weight:600;margin-top:3px;padding-top:7px}
.plm .rat .ledger .minus{color:var(--ink-2)}
.plm .rat .ledger .tag{font-size:11.5px;color:var(--ink-2);margin-left:6px}
.plm .rat .mono{font-variant-numeric:tabular-nums}

/* the row answers the finger before the panel moves — the quietest way to say it opens */
.plm .p .main{transition:background .2s var(--ease)}
.plm .p:not(.open) .main:active{background:#F4F0EB}

.plm .addline{display:block;width:100%;border:0;background:none;font-size:15px;font-weight:600;
  color:var(--tint);padding:15px;cursor:pointer;transition:background .15s;position:relative}
.plm .addline:active{background:#F6F2ED}

.plm .empty{background:var(--card);border-radius:var(--r);padding:20px 18px;text-align:left}
.plm .empty p{font-size:14.5px;color:var(--ink-2);line-height:1.5;margin:0}
.plm .empty button{border:0;background:none;font-size:15px;font-weight:600;color:var(--tint);
  cursor:pointer;margin-top:10px;padding:4px 0;transition:opacity .15s}
.plm .empty button:active{opacity:.35}

.plm .state{padding:44px 6px;color:var(--ink-2);font-size:14.5px}
.plm .state.bad{color:var(--tint)}

/* the rate card is the reference's quiet row: the real panel, wearing that shape */
.plm .ratecard{background:var(--card);border-radius:var(--r);overflow:hidden}
.plm .rc-head{width:100%;display:flex;align-items:center;gap:12px;padding:16px 18px;
  background:none;border:0;cursor:pointer;text-align:left;transition:transform .15s var(--spring)}
.plm .rc-head:active{transform:scale(.985)}
.plm .rc-t{font-size:15.5px;font-weight:600}
.plm .rc-s{flex:1;font-size:13.5px;color:var(--ink-2);margin-top:1px}
.plm .rc-head{flex-wrap:wrap}
.plm .rc-t{flex-basis:100%}
.plm .rc-chev{color:var(--ink-3);font-size:17px;transition:transform .2s var(--ease);flex-shrink:0}
.plm .rc-chev.on{transform:rotate(90deg);color:var(--tint)}
.plm .rc-body{padding:2px 18px 14px}
.plm .rc-row{display:flex;align-items:center;gap:12px;padding:10px 0;font-size:14px;
  border-top:1px solid var(--hair)}
.plm .rc-n{flex:1;min-width:0}
.plm .rc-v{border:0;background:none;font-size:15px;font-weight:600;color:var(--ink);
  font-variant-numeric:tabular-nums;padding:4px 0;cursor:default}
.plm .rc-v.edit{color:var(--tint);cursor:pointer}
.plm .rc-per{font-size:11.5px;font-weight:500;color:var(--ink-3);margin-left:2px}
.plm .rc-in{width:110px;height:40px;border:1px solid var(--hair);border-radius:11px;background:var(--bg);
  padding:0 11px;font:inherit;font-size:16px;text-align:right;font-variant-numeric:tabular-nums;outline:none}
.plm .rc-foot{font-size:12.5px;color:var(--ink-3);line-height:1.45;margin:10px 0 0}

/* ---------- sheets ---------- */
.plm .scrim{position:fixed;inset:0;z-index:60;background:rgba(20,16,12,.42);opacity:0;
  pointer-events:none;transition:opacity .35s var(--ease)}
.plm .scrim.show{opacity:1;pointer-events:auto}
.plm .sheet{position:fixed;left:0;right:0;bottom:0;z-index:61;background:var(--bg);
  border-radius:24px 24px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));
  transform:translateY(105%);transition:transform .45s var(--sheet);
  box-shadow:0 -10px 40px rgba(20,16,12,.18);max-height:92vh;overflow-y:auto}
.plm .sheet.show{transform:translateY(0)}
.plm .grab{width:36px;height:4.5px;border-radius:3px;background:rgba(27,23,19,.18);margin:0 auto 16px}
.plm .sheet .to{font-size:14px;color:var(--ink-2)}
.plm .sheet .toname{font-size:20px;font-weight:700;letter-spacing:-.02em;margin-top:2px}
.plm .bigamt{display:flex;align-items:baseline;justify-content:center;gap:4px;margin:22px 0 6px}
.plm .bigamt .cur{font-size:24px;font-weight:600;color:var(--ink-2)}
.plm .bigamt input{border:0;background:none;font:inherit;font-size:44px;font-weight:800;letter-spacing:-.03em;
  color:var(--ink);outline:none;width:200px;text-align:center;font-variant-numeric:tabular-nums}
.plm .basis{text-align:center;font-size:13.5px;color:var(--ink-2);margin-bottom:20px}
.plm .methods{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:22px}
.plm .methods button{border:0;background:var(--card);font-size:14.5px;font-weight:500;color:var(--ink-2);
  padding:10px 20px;border-radius:999px;cursor:pointer;transition:all .2s}
.plm .methods button.on{background:var(--ink);color:#fff;font-weight:600}
.plm .b2{width:100%;height:52px;border:0;border-radius:16px;font-size:16.5px;font-weight:600;
  color:#fff;background:var(--tint);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;
  transition:transform .18s var(--spring),background .3s}
.plm .b2:active{transform:scale(.97);background:var(--tint-press)}
.plm .b2:disabled{background:var(--ink-3);transform:none}
.plm .b2.ok{background:var(--good)}
.plm .b2 .ring{width:19px;height:19px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);
  border-top-color:#fff;animation:plmsp .7s linear infinite;display:none}
.plm .b2.loading .ring{display:block}
.plm .b2.loading .txt{display:none}
@keyframes plmsp{to{transform:rotate(360deg)}}

/* paying something other than the computed figure has to be explained — the desktop run
   asks the same question in a popover; on a phone it belongs in the sheet, above the button */
.plm .why{background:var(--card);border-radius:16px;padding:14px 16px;margin-bottom:16px}
.plm .why .wh{font-size:13.5px;color:var(--ink-2);line-height:1.5;margin-bottom:10px}
.plm .why .wh b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.plm .wopt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:0;
  background:none;padding:9px 0;cursor:pointer;color:inherit}
.plm .wopt .dot{width:19px;height:19px;border-radius:50%;flex-shrink:0;margin-top:1px;
  border:1.5px solid var(--ink-3);display:grid;place-items:center;transition:border-color .15s}
.plm .wopt.on .dot{border-color:var(--tint)}
.plm .wopt.on .dot::after{content:'';width:10px;height:10px;border-radius:50%;background:var(--tint)}
.plm .wopt .wt{font-size:14.5px;font-weight:600}
.plm .wopt .wd{font-size:12.5px;color:var(--ink-2);margin-top:1px;line-height:1.4}
.plm .why textarea{width:100%;margin-top:8px;border:1px solid var(--hair);border-radius:12px;
  background:var(--bg);padding:10px 12px;font:inherit;font-size:16px;color:var(--ink);outline:none;resize:none}

@media (prefers-reduced-motion:reduce){
  .plm *,.plm *::before,.plm *::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export type PlmDiff = { kind: 'carry' | 'advance' | 're'; reason: string };

export interface PlmRow {
  key: string;
  /** the payee */
  name: string;
  /** trade · site */
  role: string;
  /** what will be paid if nothing is changed */
  amount: number;
  /** the computed figure this week — paying anything else has to be explained */
  computed: number;
  basis: string;
  /** carried from before; drives the reference's "carries forward" row */
  balanceBf: number;
  /** where paying this amount leaves them — the desktop run's "After" column */
  after?: { v: number; m: string } | null;
  flag?: string | null;
  advanceNote?: string | null;
  paidAmount?: number | null;
  paidMode?: string | null;
  /** how this figure was reached — the page's own Rationale, shown when the row opens */
  detail?: ReactNode;
}

export interface PlmSection {
  id: string;
  title: string;
  total: number;
  rows: PlmRow[];
  /** the reference's "Add a payment request" line under the group */
  addLabel?: string | null;
  /** shown instead of the group when it has no rows */
  empty?: { text: string; action: string } | null;
}

export interface PayablesMobileProps {
  weekLabel: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  left: number;
  paid: number;
  plannedTotal: number;
  countLeft: number;
  sections: PlmSection[];
  modes: string[];
  mode: string;
  onMode: (m: string) => void;
  onPay: (row: PlmRow, amount: number, diff: PlmDiff | null) => Promise<void>;
  onOpenParty: (row: PlmRow) => void;
  /** the "Add a payment request" line / the empty section's action */
  onAdd: (sectionId: string) => void;
  /** an open form, rendered in its own sheet */
  formSheet?: { title: string; body: ReactNode } | null;
  onCloseForm?: () => void;
  rateCard?: ReactNode;
  aboveRun?: ReactNode;
  loading?: boolean;
  errorText?: string | null;
  emptyText?: string | null;
}

/** Counts from the previous value to the current one, the way the reference's hero does. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, d = 700;
    if (a === value) return;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / d), e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * e));
      if (p < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export default function PayablesMobile(p: PayablesMobileProps) {
  const [payFor, setPayFor] = useState<PlmRow | null>(null);
  const [amtText, setAmtText] = useState('');
  const [diffKind, setDiffKind] = useState<PlmDiff['kind']>('carry');
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<'idle' | 'saving' | 'done'>('idle');
  const [openExpl, setOpenExpl] = useState<string | null>(null);

  const shownLeft = useCountUp(p.left);
  const shownPaid = useCountUp(p.paid);
  const pct = p.plannedTotal > 0 ? Math.min(100, (p.paid / p.plannedTotal) * 100) : 0;

  const openPay = (row: PlmRow) => {
    setPayFor(row);
    setAmtText(String(row.amount || ''));
    setDiffKind(row.amount < row.computed ? 'carry' : 'advance');
    setReason('');
    setStage('idle');
  };
  const closePay = () => { if (stage !== 'saving') setPayFor(null); };

  const amount = parseInt(amtText.replace(/[^\d]/g, ''), 10) || 0;
  const delta = payFor ? payFor.computed - amount : 0;
  const needsWhy = !!payFor && Math.abs(delta) >= 1;
  const needsReason = needsWhy && diffKind === 're';
  const canPay = amount > 0 && (!needsReason || !!reason.trim());

  const submit = async () => {
    if (!payFor || !canPay || stage !== 'idle') return;
    setStage('saving');
    try {
      await p.onPay(payFor, amount, needsWhy ? { kind: diffKind, reason: reason.trim() } : null);
      setStage('done');
      setTimeout(() => setPayFor(null), 620);
    } catch {
      // the page reports the failure through the app's snackbar; leave the sheet open to retry
      setStage('idle');
    }
  };

  const sheetOpen = !!payFor || !!p.formSheet;

  return (
    <div className="plm">
      <style>{CSS}</style>

      <div className="run">
        <h1 className="title">Payments</h1>

        <div className="weekbar">
          <button type="button" className="wbtn" onClick={p.onPrevWeek} aria-label="Previous week">
            <svg width="10" height="16" viewBox="0 0 12 20" fill="none" aria-hidden="true">
              <path d="M10 2L3 10l7 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="wlabel">{p.weekLabel}</div>
          <button type="button" className="wbtn" onClick={p.onNextWeek} aria-label="Next week">
            <svg width="10" height="16" viewBox="0 0 12 20" fill="none" style={{ transform: 'rotate(180deg)' }} aria-hidden="true">
              <path d="M10 2L3 10l7 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="wnow" onClick={p.onThisWeek}>This week</button>
        </div>

        <div className="hero">
          <div className="k">Still to pay this week</div>
          <div className="v">{inr(shownLeft)}</div>
          <div className="prog"><i style={{ width: `${pct}%` }} /></div>
          <div className="sub">
            <span><b>{inr(shownPaid)}</b> paid</span>
            <span>{p.countLeft} payment{p.countLeft === 1 ? '' : 's'} {p.paid > 0 ? 'left' : 'planned'}</span>
          </div>
        </div>

        {p.aboveRun && <div className="sect">{p.aboveRun}</div>}

        {p.loading && <div className="state">Loading the week…</div>}
        {p.errorText && <div className="state bad">{p.errorText}</div>}
        {p.emptyText && <div className="state">{p.emptyText}</div>}

        {p.sections.map(s => (
          <div className="sect" key={s.id}>
            <div className="sect-h">
              <div className="n">{s.title}</div>
              <div className="t">{s.rows.length ? inr(s.total) : 'None yet'}</div>
            </div>

            {s.rows.length === 0 && s.empty ? (
              <div className="empty">
                <p>{s.empty.text}</p>
                <button type="button" onClick={() => p.onAdd(s.id)}>{s.empty.action}</button>
              </div>
            ) : (
              <div className="group">
                {s.rows.map(row => {
                  const isPaid = row.paidAmount != null;
                  const carries = !isPaid && row.amount < 1 && row.balanceBf > 0.5;
                  const open = openExpl === row.key;
                  const toggle = () => setOpenExpl(o => (o === row.key ? null : row.key));
                  return (
                    <div className={`p${isPaid ? ' paid' : ''}${carries ? ' carried' : ''}${open ? ' open' : ''}`} key={row.key}>
                      <div className="main">
                        <button type="button" className="who" onClick={toggle}
                          aria-expanded={open} aria-label={`${row.name} — how this figure was reached`}>
                          <div className="nm">{row.name}</div>
                          <div className="rl"><span className="rt">{row.role}</span><span className="chev" aria-hidden="true">›</span></div>
                          {carries && <div className="flag calm">Owed {inr(row.balanceBf)} from earlier — carries forward</div>}
                          {!carries && row.balanceBf > 0.5 && (
                            <div className="flag bf">{inr(row.balanceBf)} from earlier</div>
                          )}
                          {!carries && row.flag && <div className="flag">{row.flag}</div>}
                          {!carries && row.advanceNote && <div className="flag good">{row.advanceNote}</div>}
                        </button>
                        <div className="amt" onClick={toggle}>
                          {carries ? '₹0' : inr(isPaid ? row.paidAmount! : row.amount)}
                          {carries && <span>this week</span>}
                        </div>
                        {carries ? (
                          <button type="button" className="carrybtn" onClick={toggle}>Why?</button>
                        ) : (
                          <button type="button" className="pay" disabled={!row.amount} onClick={() => openPay(row)}>Pay</button>
                        )}
                        <div className="done">
                          <span className="ckc">
                            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                              <path d="M4 10.5l4 4 8-9" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span>Paid{row.paidMode ? ` · ${row.paidMode}` : ''}</span>
                        </div>
                      </div>
                      <div className={`expl${open ? ' open' : ''}`} aria-hidden={!open}>
                        {/* a bare box to clip against: the padded card inside it must not size the row */}
                        <div className="expl-w">
                        <div className="expl-in">
                          {carries && (
                            <>
                              <div className="e0">Nothing recorded on attendance this week, so there is nothing new to pay. The earlier balance stays on their ledger.</div>
                              <div className="erow"><span className="l">This week's work</span><span>₹0</span></div>
                              <div className="erow"><span className="l">Carried from ledger</span><span>{inr(row.balanceBf)}</span></div>
                              <div className="erow tt"><span className="l">Carries forward</span><span>{inr(row.balanceBf)}</span></div>
                            </>
                          )}
                          {!carries && (row.balanceBf > 0.5 || row.after) && (
                            <div className="sums">
                              <div className="erow"><span className="l">This week's work</span><span>{inr(row.computed)}</span></div>
                              {row.balanceBf > 0.5 && (
                                <>
                                  <div className="erow"><span className="l">Balance carried in</span><span>{inr(row.balanceBf)}</span></div>
                                  <div className="erow tt"><span className="l">Owed in total</span><span>{inr(row.computed + row.balanceBf)}</span></div>
                                </>
                              )}
                              {row.after && (
                                <div className="erow af">
                                  <span className="l">{isPaid ? 'After this payment' : 'After paying this'}</span>
                                  <span>{row.after.v > 0.5 ? `${inr(row.after.v)} ${row.after.m}` : row.after.m}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {row.detail && <div className="rat">{row.detail}</div>}
                          <button type="button" className="ledgerlink" onClick={() => p.onOpenParty(row)}>
                            Open {row.name}'s ledger →
                          </button>
                        </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {s.addLabel && (
                  <button type="button" className="addline" onClick={() => p.onAdd(s.id)}>{s.addLabel}</button>
                )}
              </div>
            )}
          </div>
        ))}

        {p.rateCard && <div className="sect">{p.rateCard}</div>}
      </div>

      <div className={`scrim${sheetOpen ? ' show' : ''}`} onClick={() => { closePay(); p.onCloseForm?.(); }} />

      <div className={`sheet${payFor ? ' show' : ''}`} role="dialog" aria-label="Record a payment">
        <div className="grab" />
        <div className="to">Pay</div>
        <div className="toname">{payFor?.name ?? '—'}</div>
        <div className="bigamt">
          <span className="cur">₹</span>
          <input className="own-size" inputMode="numeric" value={amtText} aria-label="Amount"
            onChange={(e) => setAmtText(e.target.value.replace(/[^\d]/g, ''))} />
        </div>
        <div className="basis">{payFor?.basis ?? ''}</div>

        <div className="methods">
          {p.modes.map(m => (
            <button type="button" key={m} className={m === p.mode ? 'on' : ''} onClick={() => p.onMode(m)}>{m}</button>
          ))}
        </div>

        {needsWhy && payFor && (
          <div className="why">
            <div className="wh">
              This week's figure is <b>{inr(payFor.computed)}</b>. Paying <b>{inr(amount)}</b> — the {inr(Math.abs(delta))} {delta > 0 ? 'less' : 'more'} is…
            </div>
            {([
              delta > 0
                ? ['carry', 'Still owed to them', `${inr(delta)} of this week's work carries to next week`]
                : ['advance', 'Advance on next week', `${inr(-delta)} over this week's work — recovers next week`],
              ['re', `This week's figure is actually ${inr(amount)}`, 'Not the computed amount — say why below'],
            ] as [PlmDiff['kind'], string, string][])
              .map(([k, t, d]) => (
                <button type="button" key={k} className={`wopt${diffKind === k ? ' on' : ''}`} onClick={() => setDiffKind(k)}>
                  <span className="dot" />
                  <span><span className="wt">{t}</span><span className="wd" style={{ display: 'block' }}>{d}</span></span>
                </button>
              ))}
            {needsReason && (
              <textarea rows={2} placeholder="Why is it different? e.g. 2nd floor plaster redone at their cost"
                value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </div>
        )}

        <button type="button" className={`b2${stage === 'saving' ? ' loading' : ''}${stage === 'done' ? ' ok' : ''}`}
          disabled={!canPay || stage !== 'idle'} onClick={submit}>
          <span className="ring" aria-hidden="true" />
          <span className="txt">{stage === 'done' ? 'Paid' : `Pay ${inr(amount)}`}</span>
        </button>
      </div>

      <div className={`sheet${p.formSheet ? ' show' : ''}`} role="dialog" aria-label={p.formSheet?.title ?? 'Form'}>
        <div className="grab" />
        <div className="toname" style={{ marginBottom: 14 }}>{p.formSheet?.title ?? ''}</div>
        {p.formSheet?.body}
      </div>
    </div>
  );
}
