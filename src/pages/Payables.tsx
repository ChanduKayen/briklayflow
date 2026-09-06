// Payables — the weekly payment run (labour-first). Rows are party × project, rolled up from
// the attendance week; each figure shows its basis + arithmetic on expand; paying ≠ the computed
// figure asks WHY (carried / advance / re-agreed); Mark-paid records a REAL transaction.
// Vendors, salaries, bills and the WhatsApp receipt are the next slices.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { searchPayees } from '../lib/payeeSearch';
import { createParty } from '../components/day-book/fileEntry';
import {
  loadWeeklyPayments, recordWeeklyPayment, settleWeeklyPaymentOnLedger, loadWeeklyPaid, mondayOf, weekLabel,
  loadRecurring, recurringToRow, addRecurring, removeRecurring, loadVendorRows,
  type PayRow, type PaySection,
} from '../lib/weeklyPaymentsApi';
import { isNewLedgerOrg } from '../lib/ledgerRead';
import { PendingCertifications } from '../components/attendance/PendingCertifications';
import { LedgerCutoverControl } from '../components/attendance/LedgerCutoverControl';
import { useUserProfile } from '../App';
import { RateCardPanel } from '../components/attendance/RateCardPanel';
import { useIsMobile } from '../lib/useIsMobile';
import PayablesMobile, { type PlmRow, type PlmSection } from '../components/payables/PayablesMobile';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const MODES = ['UPI', 'NEFT', 'Cash', 'Cheque'];

const CSS = `
.wpx{--cream:#f6f2ea;--paper:#fdfbf7;--line:#e6dfd2;--line-2:#d5cbb9;--walnut:#3b2f27;--walnut-2:#6d5f54;--walnut-3:#9c9083;--terracotta:#b8613a;--sage:#5f7a5e;
  background:#FBF9F6;color:var(--walnut);font:14.5px/1.45 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;padding:34px 28px 44px;min-height:100vh}
.wpx *{box-sizing:border-box}
.wpx .wrap{width:100%;max-width:1180px;margin:0 auto}
.wpx .mono{font-family:"DM Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wpx .top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:22px;gap:20px;flex-wrap:wrap}
.wpx h1{font:400 36px/1.05 "Playfair Display",serif}
.wpx .sub{color:var(--walnut-3);margin-top:8px;font-size:14px;display:flex;gap:10px;align-items:center}
.wpx .sub button{background:none;border:0;color:var(--walnut-2);cursor:pointer;text-decoration:underline;text-decoration-color:var(--line-2);text-underline-offset:3px;font:inherit}
.wpx .stats{display:flex;gap:28px;text-align:right}
.wpx .st .l{font-size:12.5px;color:var(--walnut-3)}
.wpx .st .v{font-size:22px;font-weight:500;margin-top:2px}
.wpx .st.paid .v{color:var(--sage)}.wpx .st.left .v{color:var(--terracotta)}
.wpx .site{background:var(--paper);border:1px solid var(--line);border-radius:14px;margin-bottom:16px}
.wpx .site-h{display:flex;justify-content:space-between;align-items:baseline;padding:12px 18px;background:var(--cream);border-bottom:1px solid var(--line);border-radius:14px 14px 0 0}
.wpx .site-h .n{font:500 17px "Playfair Display",serif}
.wpx .site-h .s{font-size:13px;color:var(--walnut-3)}.wpx .site-h .s b{color:var(--walnut);font-weight:500}
.wpx .hdr,.wpx .row{display:grid;grid-template-columns:minmax(110px,150px) minmax(80px,118px) minmax(0,1fr) 84px 116px 88px 100px;gap:12px;align-items:center;padding:9px 16px}
.wpx .who,.wpx .what,.wpx .sitecol{min-width:0}
.wpx .sitecol{font-size:12.5px;color:var(--walnut-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpx .who .n,.wpx .who .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* a quiet source hint that fades in on hover — where the figure comes from */
.wpx .what .srchint{color:var(--walnut-3);font-style:italic;opacity:0;transition:opacity .15s ease}
.wpx .row:hover .what .srchint{opacity:1}
.wpx .hdr{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--walnut-3);height:30px;border-bottom:1px solid var(--line)}
.wpx .hdr .r{text-align:right}
.wpx .row{min-height:56px;padding:9px 18px;border-bottom:1px solid var(--line);cursor:pointer;position:relative}
.wpx .row:hover{background:#faf8f2}
.wpx .row .chev{position:absolute;left:4px;top:50%;transform:translateY(-50%);color:var(--line-2);font-size:12px;transition:transform .15s,color .15s}
.wpx .row.exp .chev{transform:translateY(-50%) rotate(90deg);color:var(--walnut-2)}
.wpx .row.exp{background:#faf8f2;border-bottom-color:transparent}
.wpx .row.paid{background:#fbfaf5}.wpx .row.paid .who,.wpx .row.paid .what,.wpx .row.paid .bf{opacity:.55}
.wpx .who .n{font-weight:600}.wpx .who .t{font-size:12.5px;color:var(--walnut-3)}
.wpx .what{font-size:13px;color:var(--walnut-2);display:flex;flex-direction:column;gap:2px}
.wpx .what .basis .m{color:var(--walnut-3)}
.wpx .what input{border:0;background:transparent;font-size:13px;color:var(--walnut-2);width:100%;padding:0;border-bottom:1px dashed transparent}
.wpx .what input::placeholder{color:var(--line-2)}
.wpx .what input:hover,.wpx .what input:focus{border-bottom-color:var(--line-2);outline:none}
.wpx .bf{text-align:right;color:var(--walnut-2)}.wpx .bf .m{display:block;font-size:11.5px;color:var(--walnut-3)}
.wpx .plan{display:flex;justify-content:flex-end;position:relative}
.wpx .in{display:flex;align-items:center;border:1px solid var(--line);background:#fff;border-radius:9px;height:38px;padding:0 10px;gap:4px;width:120px;max-width:100%}
.wpx .in:focus-within{border-color:var(--walnut)}
.wpx .in span{color:var(--walnut-3)}
.wpx .in input{border:0;background:transparent;width:100%;text-align:right;font-size:15px;font-weight:500}
.wpx .in input:focus{outline:none}.wpx .in input::placeholder{color:var(--line-2)}
.wpx .row.paid .in{border-color:transparent;background:transparent}
.wpx .in.paid-v{justify-content:flex-end;gap:3px}
.wpx .in.paid-v b{font-size:15px;font-weight:500}
.wpx .after{text-align:right;color:var(--walnut-2)}.wpx .after .m{display:block;font-size:11.5px;color:var(--walnut-3)}.wpx .after.zero{color:var(--sage)}
.wpx .status{display:flex;justify-content:flex-end}
.wpx .mark{border:1px solid var(--line-2);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:500;color:var(--walnut);background:var(--paper);white-space:nowrap;cursor:pointer}
.wpx .mark:hover{border-color:var(--walnut)}.wpx .mark:disabled{opacity:.4;cursor:default}
.wpx .done{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--sage);font-weight:500;white-space:nowrap}
.wpx .rat{padding:0 18px 16px 34px;border-bottom:1px solid var(--line);background:#faf8f2}
.wpx .rat .box{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 16px;display:grid;grid-template-columns:1fr 300px;gap:20px;font-size:13px}
.wpx .cap{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--walnut-3);margin-bottom:8px}
.wpx .mini{border-collapse:collapse;width:100%}
.wpx .mini th,.wpx .mini td{text-align:center;padding:4px 6px;font-size:12.5px;border-bottom:1px solid var(--line)}
.wpx .mini th{color:var(--walnut-3);font-weight:500;font-size:11.5px}
.wpx .mini td:first-child,.wpx .mini th:first-child{text-align:left;color:var(--walnut-2);width:120px}
.wpx .mini td:last-child,.wpx .mini th:last-child{text-align:right;font-weight:500}
.wpx .mini .off{color:var(--line-2)}
.wpx .ledger .ln{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px dashed var(--line)}
.wpx .ledger .ln:first-child{border-top:0}
.wpx .ledger .ln.sum{border-top:1px solid var(--line-2);font-weight:500;margin-top:3px;padding-top:6px}
.wpx .ledger .minus{color:var(--walnut-3)}.wpx .ledger .tag{font-size:11.5px;color:var(--walnut-3);margin-left:6px}
.wpx .pop{position:absolute;right:0;top:44px;z-index:20;width:320px;background:var(--paper);border:1px solid var(--line-2);border-radius:12px;padding:14px 16px;box-shadow:0 14px 40px -18px rgba(59,47,39,.45);font-size:13.5px;cursor:default;text-align:left}
.wpx .pop .h{color:var(--walnut-2);margin-bottom:10px}.wpx .pop .h b{color:var(--walnut);font-weight:500}
.wpx .pop label{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px;cursor:pointer}
.wpx .pop label.on{border-color:var(--walnut);background:#fbf9f3}
.wpx .pop label .t{font-weight:500}.wpx .pop label .d{font-size:12.5px;color:var(--walnut-3);margin-top:1px}
.wpx .pop .why{width:100%;border:1px solid var(--line-2);border-radius:8px;background:#fff;font:inherit;font-size:13px;padding:8px 10px;margin-top:4px;color:var(--walnut);resize:none}
.wpx .pop .why:focus{outline:none;border-color:var(--walnut)}
.wpx .pop .acts{display:flex;justify-content:flex-end;gap:14px;margin-top:12px;align-items:center}
.wpx .pop .acts .cancel{background:none;border:0;color:var(--walnut-3);font-size:13px;cursor:pointer}
.wpx .pop .acts .ok{background:var(--walnut);color:var(--paper);border:0;border-radius:999px;padding:7px 14px;font-weight:500;font-size:13px;cursor:pointer}
.wpx .pop .acts .ok:disabled{background:var(--line-2)}
.wpx .foot{background:var(--paper);border:1px solid var(--line);border-radius:14px;margin-top:6px}
.wpx .foot-in{padding:14px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.wpx .foot .s{color:var(--walnut-2);font-size:14px}.wpx .foot .s b{color:var(--walnut);font-weight:500}
.wpx .foot .acts{display:flex;gap:12px;align-items:center}
.wpx .foot .acts .lbl,.wpx .foot .acts .hint{font-size:12.5px;color:var(--walnut-3)}
.wpx .modesel{border:1px solid var(--line-2);border-radius:9px;height:38px;padding:0 10px;background:var(--paper);font:inherit;font-size:13.5px}
/* ── rate card — the day rates behind the labour figures ── */
.wpx .ratecard{background:var(--paper);border:1px solid var(--line);border-radius:14px;margin-bottom:16px;overflow:hidden}
.wpx .rc-head{width:100%;display:flex;align-items:center;gap:10px;padding:13px 18px;background:none;border:0;cursor:pointer;text-align:left;font:inherit}
.wpx .rc-head:active{background:var(--cream)}
.wpx .rc-t{font:500 15px "Playfair Display",serif;color:var(--walnut);flex-shrink:0}
.wpx .rc-s{font-size:12.5px;color:var(--walnut-3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpx .rc-chev{color:var(--line-2);font-size:15px;transition:transform .18s ease;flex-shrink:0}
.wpx .rc-chev.on{transform:rotate(90deg);color:var(--walnut-2)}
.wpx .rc-body{border-top:1px solid var(--line);padding:4px 18px 12px}
.wpx .rc-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:13.5px}
.wpx .rc-row:last-of-type{border-bottom:0}
.wpx .rc-n{flex:1;min-width:0;color:var(--walnut-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wpx .rc-v{border:0;background:none;font:inherit;font-weight:500;color:var(--walnut);padding:6px 2px;cursor:default}
.wpx .rc-v.edit{cursor:pointer;border-bottom:1px dashed var(--line-2)}
.wpx .rc-v.edit:active{color:var(--terracotta)}
.wpx .rc-per{color:var(--walnut-3);font-weight:400;font-size:12px;margin-left:2px}
.wpx .rc-in{width:104px;text-align:right;border:1px solid var(--walnut);border-radius:9px;background:#fff;font:inherit;font-size:15px;padding:7px 10px;outline:none}
.wpx .rc-foot{margin:10px 0 0;font-size:12px;line-height:1.45;color:var(--walnut-3)}
@media (max-width:640px){
  .wpx .ratecard{border-radius:16px;margin-bottom:14px}
  .wpx .rc-head{padding:13px 15px;min-height:52px}
  .wpx .rc-body{padding:4px 15px 12px}
  .wpx .rc-row{padding:11px 0}
  .wpx .rc-v{padding:9px 2px}
  .wpx .rc-in{width:118px;height:44px}
}
.wpx .state{padding:70px 18px;text-align:center;color:var(--walnut-3);font-size:14px}
.wpx .emptyrow{padding:14px 18px;color:var(--walnut-3);font-size:13px;border-bottom:1px solid var(--line)}
.wpx .recbody{padding:6px 18px 14px}
.wpx .recitem{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:13.5px}
.wpx .recitem b{font-weight:600}
.wpx .recitem .rm-proj{color:var(--walnut-3);font-size:12.5px}
.wpx .recitem .mono{margin-left:auto;font-weight:500}
.wpx .rm-x{width:22px;height:22px;border-radius:7px;font-size:16px;line-height:1;color:var(--line-2);background:none;border:0;cursor:pointer}
.wpx .rm-x:hover{color:var(--terracotta);background:color-mix(in srgb,var(--terracotta) 12%,transparent)}
.wpx .recadd{margin-top:10px;color:var(--terracotta);font-weight:600;font-size:13.5px;border:1px dashed color-mix(in srgb,var(--terracotta) 45%,transparent);background:color-mix(in srgb,var(--terracotta) 5%,transparent);border-radius:9px;padding:8px 14px;cursor:pointer}
.wpx .recadd:hover{border-color:var(--terracotta)}
.wpx .recform{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
.wpx .recform select,.wpx .recform input{height:38px;border:1px solid var(--line-2);border-radius:8px;background:var(--paper);padding:0 10px;font:inherit;font-size:13.5px}
.wpx .recform input:focus,.wpx .recform select:focus{outline:none;border-color:var(--walnut)}
.wpx .recform input.amt{width:120px;text-align:right}
.wpx .recform .go{background:var(--walnut);color:var(--paper);border-radius:999px;padding:9px 16px;font-weight:500;font-size:13px;cursor:pointer;border:0}
.wpx .recform .go:disabled{background:var(--line-2);cursor:default}
.wpx .recform .x{color:var(--walnut-3);font-size:13px;background:none;border:0;cursor:pointer}
.wpx .addrow{padding:12px 16px;background:var(--cream);border-top:1px solid var(--line);border-radius:0 0 14px 14px}
.wpx .addpill{display:inline-flex;align-items:center;gap:8px;color:var(--terracotta);font-weight:600;font-size:13.5px;border:1px dashed color-mix(in srgb,var(--terracotta) 45%,transparent);background:color-mix(in srgb,var(--terracotta) 5%,transparent);border-radius:9px;padding:8px 14px;cursor:pointer}
.wpx .addpill:hover{border-color:var(--terracotta)}
.wpx .addpill .hint{color:var(--walnut-3);font-weight:400;font-size:12.5px}
.wpx .addform{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.wpx .addform select,.wpx .addform input{height:38px;border:1px solid var(--line-2);border-radius:8px;background:var(--paper);padding:0 10px;font:inherit;font-size:13.5px}
.wpx .addform input:focus,.wpx .addform select:focus{outline:none;border-color:var(--walnut)}
.wpx .addform input.amt{width:120px;text-align:right}
.wpx .addform input.note{flex:1;min-width:160px}
.wpx .addform .go{background:var(--walnut);color:var(--paper);border-radius:999px;padding:9px 16px;font-weight:500;font-size:13px;cursor:pointer;border:0}
.wpx .addform .go:disabled{background:var(--line-2);cursor:default}
.wpx .addform .x{color:var(--walnut-3);font-size:13px;background:none;border:0;cursor:pointer}
.wpx .psrch{position:relative;display:inline-block}
.wpx .psrch>input{height:38px;border:1px solid var(--line-2);border-radius:8px;background:var(--paper);padding:0 12px;font:inherit;font-size:13.5px;width:220px}
.wpx .psrch>input:focus{outline:none;border-color:var(--walnut)}
.wpx .psrch-menu{position:absolute;left:0;top:calc(100% + 4px);z-index:15;min-width:260px;background:var(--paper);border:1px solid var(--line-2);border-radius:10px;box-shadow:0 12px 30px -14px rgba(59,47,39,.4);padding:4px;max-height:280px;overflow:auto}
.wpx .psrch-item{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:none;border-radius:7px;font:inherit;font-size:13.5px;color:var(--walnut);cursor:pointer}
.wpx .psrch-item:hover{background:var(--cream)}
.wpx .psrch-item small{color:var(--walnut-3)}
.wpx .psrch-item.psrch-create{color:var(--walnut-2);border-top:1px solid var(--line);margin-top:2px;font-weight:500}
.wpx .psrch-item.psrch-create b{color:var(--walnut)}
.wpx .psrch-empty{padding:8px 10px;color:var(--walnut-3);font-size:13px}
/* ── mobile: stack each row into a card ── */
@media (max-width:960px){
  .wpx{padding:20px 12px 40px}
  .wpx h1{font-size:30px}
  .wpx .top{flex-direction:column;align-items:flex-start;gap:14px}
  .wpx .stats{gap:20px;text-align:left}
  .wpx .hdr{display:none}
  .wpx .row{grid-template-columns:1fr auto;grid-template-areas:'who status' 'sitecol sitecol' 'what what' 'plan after';gap:8px 12px;padding:12px 14px 12px 22px;min-height:0}
  .wpx .row .who{grid-area:who;min-width:0}
  .wpx .row .sitecol{grid-area:sitecol;color:var(--walnut-3);font-size:12px}
  .wpx .row .what{grid-area:what}
  .wpx .row .bf{display:none}
  .wpx .row .plan{grid-area:plan;justify-content:flex-start}
  .wpx .row .after{grid-area:after;text-align:right;align-self:center}
  .wpx .row .status{grid-area:status;justify-content:flex-end}
  .wpx .in{width:150px}
  .wpx .rat{padding:0 14px 14px 22px;overflow-x:auto}
  .wpx .rat .box{grid-template-columns:1fr;gap:14px}
  .wpx .pop{right:auto;left:0;width:min(320px,calc(100vw - 40px))}
  .wpx .foot-in{flex-direction:column;align-items:flex-start;gap:10px}
  .wpx .recform{flex-direction:column;align-items:stretch}
  .wpx .recform input,.wpx .recform select,.wpx .recform input.amt{width:100%}
  .wpx .addform{flex-direction:column;align-items:stretch}
  .wpx .addform input,.wpx .addform select,.wpx .addform input.amt,.wpx .addform input.note{width:100%}
  .wpx .psrch,.wpx .psrch>input{width:100%}
  .wpx .addpill{width:100%;flex-wrap:wrap}
  .wpx .addpill .hint{flex-basis:100%}
}

/* ── phone (≤640px): the run reads as a native payables app — a week stepper, one money
   card led by what is still owed, and each person as a card with the amount to the right
   and one clear action. Everything above stays the desktop table. ── */
@media (max-width:640px){
  /* room for the bottom tab bar and the FAB, so the last card is never covered */
  .wpx{padding:16px 12px calc(96px + env(safe-area-inset-bottom))}
  .wpx h1{font-size:27px;letter-spacing:-.01em}
  .wpx .top{gap:12px;margin-bottom:16px;width:100%}
  .wpx .lead{width:100%;min-width:0}

  /* week stepper — ‹ · 31 Aug – 6 Sep · › · this week — one row that never wraps.
     DOM order is label-first for the desktop line; flex order puts the arrows either side here. */
  .wpx .wknav{margin-top:12px;gap:8px;width:100%;flex-wrap:nowrap}
  .wpx .wknav .wkw{display:none}
  .wpx .wknav .wkstep.prev{order:1}
  .wpx .wknav .wklab{order:2}
  .wpx .wknav .wkstep.next{order:3}
  .wpx .wknav .wknow{order:4}
  .wpx .wknav .wkstep{flex:0 0 38px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;
    border:1px solid var(--line);border-radius:11px;background:var(--paper);color:var(--walnut-2);
    font-size:21px;line-height:1;padding-bottom:2px;text-decoration:none;-webkit-tap-highlight-color:transparent}
  .wpx .wknav .wkstep:active{background:var(--cream)}
  .wpx .wknav .wklab{flex:1;min-width:0;text-align:center;font-size:14px;font-weight:500;color:var(--walnut);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .wpx .wknav .wknow{flex:0 0 auto;height:38px;padding:0 13px;border:1px solid var(--line);border-radius:11px;
    background:var(--paper);color:var(--walnut-2);font-size:12.5px;font-weight:500;
    text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}
  .wpx .wknav .wknow:active{background:var(--cream)}
  /* 38px reads right beside 14px text; the hit area is still a full 44 */
  .wpx .wknav .wkstep,.wpx .wknav .wknow,.wpx .rm-x{position:relative}
  .wpx .wknav .wkstep::after,.wpx .wknav .wknow::after,.wpx .rm-x::after{content:"";position:absolute;top:50%;left:50%;width:max(100%,44px);height:44px;transform:translate(-50%,-50%)}
  .wpx .cutover{margin-top:10px;font-size:12px;line-height:1.45;color:var(--walnut-3);display:block}

  /* money card — what is still owed leads; planned and paid support it underneath */
  .wpx .stats{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:0 14px;text-align:left;
    background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:15px 16px 13px}
  .wpx .stats .st.left{grid-column:1/-1;order:-1;padding-bottom:12px}
  .wpx .stats .st.left .l{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase}
  .wpx .stats .st.left .v{font-size:31px;line-height:1.02;margin-top:4px;letter-spacing:-.02em}
  .wpx .stats .st:not(.left){border-top:1px solid var(--line);padding-top:11px}
  .wpx .stats .st:not(.left) .l{font-size:11px}
  .wpx .stats .st:not(.left) .v{font-size:16px;margin-top:1px}

  /* site card */
  .wpx .site{border-radius:16px;margin-bottom:14px}
  .wpx .site-h{padding:12px 15px;border-radius:16px 16px 0 0;gap:10px}
  .wpx .site-h .n{font-size:16px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wpx .site-h .s{font-size:12px;text-align:right;flex-shrink:0}

  /* a person's card: who + amount on top, then the note and one action on a divided line */
  .wpx .row{grid-template-columns:minmax(0,1fr) auto;
    grid-template-areas:'who plan' 'sitecol plan' 'what what' 'after status';
    gap:0 12px;padding:12px 14px 11px 20px;align-items:start;-webkit-tap-highlight-color:transparent}
  .wpx .row:active{background:#faf8f2}
  .wpx .row .who{grid-area:who}
  .wpx .row .who .n{font-size:15px}
  .wpx .row .who .t{font-size:12.5px;line-height:1.3;margin-top:1px}
  .wpx .row .sitecol{grid-area:sitecol;font-size:12px;line-height:1.3;margin-top:1px}
  .wpx .row .what{grid-area:what;margin-top:7px;gap:3px}
  .wpx .row .plan{grid-area:plan;justify-content:flex-end;align-self:start}
  .wpx .row .after{grid-area:after;text-align:left;align-self:center;font-size:12.5px;margin-top:9px}
  .wpx .row .after .m{display:inline;margin-left:5px}
  .wpx .row .status{grid-area:status;align-self:center;margin-top:9px}
  /* the source hint only ever appears on hover, which a touch screen has not got */
  .wpx .row .what .srchint{display:none}
  /* the row opens to show how the figure was reached — say so with a real affordance
     rather than a 12px caret hiding in the gutter */
  .wpx .row .chev{left:6px;font-size:15px;color:var(--walnut-3);width:14px;text-align:center}
  .wpx .row.exp .chev{color:var(--terracotta)}
  /* a tap anywhere on the card reads as a press, and the card lifts a hair while open */
  .wpx .row{transition:transform .14s cubic-bezier(.2,.7,.3,1),background-color .14s ease}
  .wpx .row:active{transform:scale(.992)}
  .wpx .row.exp{box-shadow:inset 3px 0 0 var(--terracotta)}
  /* Mark paid is the row's job — give it the full width of its column and a real target */
  .wpx .status{width:100%}
  .wpx .mark{width:100%;min-height:46px;justify-content:center}
  /* 16px keeps iOS Safari from zooming the page when a field takes focus */
  .wpx .in{width:126px;height:44px;border-radius:12px;padding:0 11px}
  /* a settled row shows the figure as text, so the column hugs it instead of reserving a field */
  .wpx .row.paid .in{width:auto;padding:0}
  .wpx .in.paid-v b{font-size:16px}
  .wpx .in input{font-size:16px}
  .wpx .what input{font-size:16px;border-bottom:1px dashed var(--line);padding-bottom:3px}
  .wpx .mark{padding:10px 17px;font-size:13.5px;font-weight:600;color:var(--terracotta);
    border-color:color-mix(in srgb,var(--terracotta) 34%,transparent);
    background:color-mix(in srgb,var(--terracotta) 7%,transparent)}
  .wpx .mark:active{background:color-mix(in srgb,var(--terracotta) 15%,transparent)}
  .wpx .mark:disabled{background:transparent;border-color:var(--line);color:var(--walnut-3)}
  .wpx .done{font-size:13.5px}
  .wpx .emptyrow{padding:14px}
  .wpx .state{padding:48px 16px}

  /* the "why is this different" sheet opens leftward from the amount field it belongs to */
  .wpx .pop{left:auto;right:0;width:min(300px,calc(100vw - 48px))}

  /* footer — the pay-by control gets room, its caption drops to its own line */
  .wpx .foot{border-radius:16px;margin-top:10px}
  .wpx .foot-in{padding:14px 16px;gap:12px}
  .wpx .foot .s{font-size:13.5px}
  .wpx .foot .acts{width:100%;flex-wrap:wrap;gap:10px}
  .wpx .foot .acts .modesel{flex:1;min-width:150px;height:44px;border-radius:11px;font-size:15px}
  .wpx .foot .acts .hint{flex-basis:100%;order:3}

  /* the add / recurring forms: full-width controls, real tap targets */
  .wpx .addrow{padding:12px 14px;border-radius:0 0 16px 16px}
  .wpx .addpill{justify-content:flex-start;gap:6px;padding:11px 14px;border-radius:11px}
  .wpx .addpill .hint{text-align:left;margin-top:2px}
  .wpx .addform input,.wpx .addform select,.wpx .recform input,.wpx .recform select{height:44px;font-size:16px}
  .wpx .addform .go,.wpx .recform .go{height:44px;width:100%}
  .wpx .addform .x,.wpx .recform .x{padding:8px}
  .wpx .psrch>input{height:44px;font-size:16px}
  .wpx .recitem{gap:10px;font-size:13.5px}
}
`;

type Diff = { kind: 'carry' | 'advance' | 're'; reason: string };

export default function Payables({ session }: { session: Session }) {
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);
  const isManager = profile?.role === 'management' || profile?.role === 'principal';
  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()));
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [diffs, setDiffs] = useState<Record<string, Diff>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [why, setWhy] = useState<string | null>(null);       // row key with an open why-popover
  const [mode, setMode] = useState('UPI');
  const [busy, setBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, PayRow[]>>({});  // ad-hoc "Add a payment" rows, per project
  const navigate = useNavigate();
  // 640px, the width at which the run stops being a table and becomes the phone design.
  const isPhone = useIsMobile(640);
  const [addSheet, setAddSheet] = useState<null | 'worker' | 'recurring'>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['weekly_payments', monday.toISOString().slice(0, 10)],
    queryFn: () => loadWeeklyPayments(monday),
  });
  const { data: newLedger } = useQuery({
    queryKey: ['org_new_ledger', orgId],
    queryFn: () => isNewLedgerOrg(orgId),
    enabled: !!orgId,
  });
  // What this run has already settled, read back from the payments themselves. Without it a
  // wage row — whose figure comes from the attendance register — returns at its full amount on
  // the next load, with no sign it has been paid.
  const { data: serverPaid = {}, refetch: refetchPaid } = useQuery({
    queryKey: ['weekly_paid', monday.toISOString().slice(0, 10)],
    queryFn: () => loadWeeklyPaid(monday),
  });
  const { data: recurring, refetch: refetchRec } = useQuery({ queryKey: ['recurring_payments'], queryFn: loadRecurring });
  const { data: vendorRows } = useQuery({ queryKey: ['vendor_payables'], queryFn: loadVendorRows });
  const { data: parties } = useQuery({
    queryKey: ['payables_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, type, category').order('name')).data ?? [] as any[],
  });
  const { data: projects } = useQuery({
    queryKey: ['projects_active_min'],
    queryFn: async () => (await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? [],
  });

  // One Workers group (all projects, project shown as a column) + a Vendors section (open bills)
  // + a Recurring & fixed section. Labour is no longer split into a card per project.
  const sections: PaySection[] = useMemo(() => {
    const labourRows = (data?.sections ?? []).flatMap(s => s.rows);
    const extraRows  = Object.values(extra).flat();
    const workerRows = [...labourRows, ...extraRows]
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || b.thisWeek - a.thisWeek);
    const out: PaySection[] = [];
    if ((data?.sections ?? []).length || workerRows.length)
      out.push({ projectId: '__workers__', projectName: 'Workers — this week', rows: workerRows });
    if ((vendorRows ?? []).length) out.push({ projectId: '__vendors__', projectName: 'Vendors — bills to pay', rows: vendorRows! });
    const recRows = (recurring ?? []).map(recurringToRow);
    if (recRows.length) out.push({ projectId: '__recurring__', projectName: 'Recurring & fixed', rows: recRows });
    return out;
  }, [data, vendorRows, recurring, extra]);

  const paidOf = (r: PayRow): number | null => paid[r.key] ?? serverPaid[r.key] ?? null;
  const planned = (r: PayRow) => paidOf(r) ?? plan[r.key] ?? Math.round(r.thisWeek);
  const owed = (r: PayRow) => r.balanceBf + r.thisWeek;
  const afterOf = (r: PayRow, isPaid: boolean): { v: number; m: string; cls: string } | null => {
    // "This week's figure is actually ₹X" (re-agreed): the paid amount IS the correct figure, so the
    // difference is NOT carried/advanced — only any prior balance remains. Otherwise the shortfall/
    // surplus carries as usual (kind 'carry' / 'advance', or an unexplained change).
    const reAgreed = diffs[r.key]?.kind === 're';
    const thisWeekFig = reAgreed ? planned(r) : r.thisWeek;
    const rem = (r.balanceBf + thisWeekFig) - planned(r);
    if (isPaid) {
      if (Math.abs(rem) < 1) return { v: 0, m: 'settled', cls: 'zero' };
      return rem > 0 ? { v: rem, m: 'carried', cls: '' } : { v: -rem, m: 'advance to them', cls: '' };
    }
    // Not paid yet — never say "settled". A pure wage row has no running balance to show.
    if (r.balanceBf < 1 && Math.abs(rem) < 1) return null;
    if (Math.abs(rem) < 1) return { v: 0, m: 'clears the balance', cls: 'zero' };
    return rem > 0 ? { v: rem, m: 'would carry', cls: '' } : { v: -rem, m: 'advance', cls: '' };
  };

  const totals = useMemo(() => {
    let pl = 0, pd = 0, n = 0;
    sections.forEach(s => s.rows.forEach(r => { pl += planned(r); const done = paidOf(r); if (done) pd += done; else if (planned(r)) n++; }));
    return { planned: pl, paid: pd, left: pl - pd, count: n };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, plan, paid, serverPaid]);

  // The one place a payment is recorded. The desktop row and the phone's pay sheet both come
  // through here, so a payment made on a phone is the same transaction, settled the same way.
  const payRow = async (r: PayRow, amt: number, reason: string, note: string) => {
    if (!amt) return;
    setBusy(r.key);
    try {
      const txnId = await recordWeeklyPayment(orgId, r, amt, mode, reason, monday, note);
      if (newLedger) { try { await settleWeeklyPaymentOnLedger(txnId, r, amt, monday); } catch (e: any) { showSnackbar(`Paid, but ledger link failed: ${e?.message || 'error'}`, { type: 'error' }); } }
      setPaid(p => ({ ...p, [r.key]: amt }));
      showSnackbar(`Paid ${inr(amt)} to ${r.party}`);
      refetch(); refetchPaid();
    } catch (e: any) {
      showSnackbar(e?.message || 'Could not record the payment', { type: 'error' });
      throw e;                                   // the sheet keeps itself open so it can be retried
    } finally { setBusy(null); }
  };
  const doPay = (r: PayRow) => payRow(r, planned(r), diffs[r.key]?.reason || '', notes[r.key] ?? '').catch(() => {});

  const onMark = (r: PayRow) => {
    if (Math.abs(planned(r) - r.thisWeek) >= 1 && !diffs[r.key]) { setWhy(r.key); return; }
    doPay(r);
  };

  const shiftWeek = (d: number) => setMonday(m => { const x = new Date(m); x.setDate(x.getDate() + d * 7); return x; });
  // Where a row's figure comes from — shown subtly on hover so the source is clear.
  const sourceHint = (r: PayRow) => r.att ? 'from the attendance sheet' : r.stage ? 'from the contract stages' : r.bills ? 'from open purchase orders' : r.kind === 'recurring' ? 'a standing recurring line' : 'typed here';

  if (isPhone) {
    const byKey = new Map<string, PayRow>();
    sections.forEach(sec => sec.rows.forEach(r => byKey.set(r.key, r)));
    const toPlm = (r: PayRow): PlmRow => ({
      key: r.key,
      name: r.party,
      role: [r.trade, r.projectName].filter(Boolean).join(' · '),
      amount: planned(r),
      computed: Math.round(r.thisWeek),
      basis: r.basis,
      balanceBf: r.balanceBf,
      flag: (r.withoutBills ?? 0) > 0.5 ? `${inr(r.withoutBills!)} paid without bills` : null,
      advanceNote: (r.advance ?? 0) > 0.5 ? `${inr(r.advance!)} paid ahead · advance` : null,
      paidAmount: paidOf(r),
      paidMode: paidOf(r) != null ? mode : null,
      // The same Rationale the desktop table opens — the attendance register, the stage
      // readings, the open bills, and the arithmetic that lands on this week's figure.
      detail: <Rationale row={r} planned={planned(r)} diff={diffs[r.key]} />,
      after: afterOf(r, paidOf(r) != null),
      note: notes[r.key] ?? '',
    });
    const sectionOf = (id: string, title: string): PlmSection | null => {
      const sec = sections.find(x => x.projectId === id);
      const rows = (sec?.rows ?? []).map(toPlm);
      const total = rows.reduce((a, r) => a + (r.paidAmount ?? r.amount), 0);
      if (id === '__workers__') return { id, title, total, rows, addLabel: 'Add a payment request' };
      if (id === '__recurring__') return {
        id, title, total, rows,
        empty: { text: 'Rent, a watchman, a weekly supervisor — standing payments appear here every week on their own.', action: 'Add a recurring payment' },
      };
      return rows.length ? { id, title, total, rows } : null;
    };
    const plmSections = [
      sectionOf('__workers__', 'Workers'),
      sectionOf('__vendors__', 'Vendor bills'),
      sectionOf('__recurring__', 'Recurring'),
    ].filter(Boolean) as PlmSection[];

    // The add forms have no design in the reference — only the line that opens them — so the
    // sheet hosts the page's own forms, in a .wpx scope of their own so those styles reach them
    // and nothing else.
    const formScope = (body: React.ReactNode) => (
      <div className="wpx" style={{ padding: 0, minHeight: 0, background: 'transparent' }}>
        <style>{CSS}</style>
        {body}
      </div>
    );
    const formSheet = addSheet === 'worker'
      ? { title: 'Add a payment request', body: formScope(
          <AddPaymentRow defaultOpen projects={(projects ?? []) as { project_id: string; name: string }[]} parties={parties ?? []} orgId={orgId}
            onError={(m) => showSnackbar(m, { type: 'error' })}
            onAdd={(row) => { setExtra(x => ({ ...x, [row.projectId]: [...(x[row.projectId] ?? []), row] })); setAddSheet(null); }} />) }
      : addSheet === 'recurring'
      ? { title: 'Recurring & fixed', body: formScope(
          <RecurringManager defaultOpen orgId={orgId} recurring={recurring ?? []} projects={(projects ?? []) as { project_id: string; name: string }[]}
            onChanged={() => { refetchRec(); setAddSheet(null); }} onError={(m) => showSnackbar(m, { type: 'error' })} />) }
      : null;

    return (
      <PayablesMobile
        weekLabel={weekLabel(monday)}
        onPrevWeek={() => shiftWeek(-1)}
        onNextWeek={() => shiftWeek(1)}
        onThisWeek={() => setMonday(mondayOf(new Date()))}
        left={totals.left} paid={totals.paid} plannedTotal={totals.planned} countLeft={totals.count}
        sections={plmSections}
        modes={MODES} mode={mode} onMode={setMode}
        onPay={async (row, amount, diff, note) => {
          const r = byKey.get(row.key);
          if (!r) return;
          if (diff) setDiffs(d => ({ ...d, [r.key]: diff as Diff }));
          setPlan(pp => ({ ...pp, [r.key]: amount }));
          if (note) setNotes(n => ({ ...n, [r.key]: note }));
          await payRow(r, amount, diff?.reason || '', note);
        }}
        onOpenParty={(row) => {
          const id = byKey.get(row.key)?.stakeholderId;
          if (id) navigate(`/ledger?stakeholder=${id}`);
        }}
        onNote={(key, value) => setNotes(n => ({ ...n, [key]: value }))}
        onAdd={(id) => setAddSheet(id === '__recurring__' ? 'recurring' : 'worker')}
        formSheet={formSheet}
        onCloseForm={() => setAddSheet(null)}
        rateCard={orgId ? <RateCardPanel orgId={orgId} isManager={isManager} /> : null}
        aboveRun={orgId && session.user?.id ? <PendingCertifications orgId={orgId} userId={session.user.id} /> : null}
        loading={isLoading}
        errorText={error ? `Could not load — ${(error as { message?: string } | null)?.message || 'try again'}` : null}
        emptyText={!isLoading && !error && sections.length === 0 ? 'No active projects yet — create a project to start the payment run.' : null}
      />
    );
  }

  return (
    <div className="wpx">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="top">
          <div className="lead">
            <h1>Payments</h1>
            <div className="sub wknav">
              <span className="wklab"><span className="wkw">Week of </span>{weekLabel(monday)}<span className="wkw"> ·</span></span>
              <button className="wkstep prev" onClick={() => shiftWeek(-1)} aria-label="Previous week">‹<span className="wkw"> last week</span></button>
              <button className="wkstep next" onClick={() => shiftWeek(1)} aria-label="Next week"><span className="wkw">next week </span>›</button>
              <button className="wknow" onClick={() => setMonday(mondayOf(new Date()))}>this week</button>
            </div>
            {orgId && <div className="sub cutover"><LedgerCutoverControl orgId={orgId} isManager={isManager} /></div>}
          </div>
          <div className="stats">
            <div className="st"><div className="l">Planned</div><div className="v mono">{inr(totals.planned)}</div></div>
            <div className="st paid"><div className="l">Paid</div><div className="v mono">{inr(totals.paid)}</div></div>
            <div className="st left"><div className="l">Still to pay</div><div className="v mono">{inr(totals.left)}</div></div>
          </div>
        </div>

        {/* Work awaiting sign-off — approving here mints the obligation into the run below. */}
        {orgId && session.user?.id && <PendingCertifications orgId={orgId} userId={session.user.id} />}

        {/* The day rates that produced the labour figures below — collapsed until asked for. */}
        {orgId && <RateCardPanel orgId={orgId} isManager={isManager} />}

        {isLoading && <div className="state">Loading the week…</div>}
        {error && <div className="state" style={{ color: 'var(--terracotta)' }}>Could not load — {(error as any)?.message || 'try again'}</div>}
        {!isLoading && !error && sections.length === 0 && <div className="state">No active projects yet — create a project to start the payment run.</div>}

        {sections.map(section => {
          const sPlan = section.rows.reduce((a, r) => a + planned(r), 0);
          const sPaid = section.rows.reduce((a, r) => a + (paidOf(r) || 0), 0);
          return (
            <section className="site" key={section.projectId}>
              <div className="site-h"><span className="n">{section.projectName}</span><span className="s"><b className="mono">{inr(sPlan)}</b> this week{sPaid ? ` · ${inr(sPaid)} paid` : ''}</span></div>
              {section.rows.length > 0 && <div className="hdr"><div>Who</div><div>Site</div><div>For</div><div className="r">Balance b/f</div><div className="r">This week</div><div className="r">After</div><div className="r" /></div>}
              {section.rows.length === 0 && section.projectId === '__workers__' && <div className="emptyrow">No labour on the attendance sheet this week — add a payment below.</div>}
              {section.rows.map(r => {
                const settled = paidOf(r), isPaid = settled != null, isExp = expanded.has(r.key), af = afterOf(r, isPaid);
                const unexplained = Math.abs(planned(r) - r.thisWeek) >= 1 && !diffs[r.key];
                return (
                  <div key={r.key}>
                    <div className={`row${isPaid ? ' paid' : ''}${isExp ? ' exp' : ''}`} onClick={(e) => { if ((e.target as HTMLElement).closest('input,button,select')) return; setExpanded(s => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; }); }}>
                      <span className="chev">›</span>
                      <div className="who"><div className="n">{r.party}</div><div className="t">{r.trade}</div></div>
                      <div className="sitecol" title={r.projectName}>{r.projectName}</div>
                      <div className="what">
                        <div className="basis">{r.basis} <span className="srchint">· {sourceHint(r)}</span></div>
                        {/* Advance / paid-without-bills shown SEPARATELY from the due — never netted into it */}
                        {(r.advance ?? 0) > 0.5 && <div className="basis" style={{ color: 'var(--sage)' }}>₹{inr(r.advance!)} paid ahead · advance</div>}
                        {(r.withoutBills ?? 0) > 0.5 && <div className="basis" style={{ color: 'var(--terracotta)' }}>₹{inr(r.withoutBills!)} paid without bills</div>}
                        {isPaid
                          ? (notes[r.key]?.trim() ? <div className="basis" style={{ color: 'var(--walnut-2)' }}>{notes[r.key]}</div> : null)
                          : <input placeholder="note…" value={notes[r.key] ?? ''} onChange={(e) => setNotes(n => ({ ...n, [r.key]: e.target.value }))} />}
                      </div>
                      <div className="bf mono">{r.balanceBf ? inr(r.balanceBf) : <span style={{ color: 'var(--line-2)' }}>—</span>}{r.balanceBf ? <span className="m">carried</span> : null}</div>
                      <div className="plan">
                        {isPaid
                          ? <div className="in paid-v"><span>₹</span><b className="mono">{settled!.toLocaleString('en-IN')}</b></div>
                          : <div className="in"><span>₹</span><input className="mono" inputMode="numeric" value={planned(r) || ''} placeholder="0"
                              onChange={(e) => { const v = parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0; setPlan(p => ({ ...p, [r.key]: v })); setDiffs(d => { const n = { ...d }; delete n[r.key]; return n; }); }}
                              onBlur={() => { setTimeout(() => { if (!paid[r.key] && Math.abs(planned(r) - r.thisWeek) >= 1 && !diffs[r.key] && why !== r.key) setWhy(r.key); }, 120); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></div>}
                        {why === r.key && !isPaid && (
                          <WhyPopover row={r} planned={planned(r)} owed={owed(r)}
                            onPutBack={() => { setPlan(p => ({ ...p, [r.key]: Math.round(r.thisWeek) })); setDiffs(d => { const n = { ...d }; delete n[r.key]; return n; }); setWhy(null); }}
                            onDone={(diff) => { setDiffs(d => ({ ...d, [r.key]: diff })); setWhy(null); }} />
                        )}
                      </div>
                      <div className={`after mono ${af?.cls || ''}`}>{af ? <>{inr(af.v)}<span className="m">{af.m}</span></> : <span style={{ color: 'var(--line-2)' }}>—</span>}</div>
                      <div className="status">
                        {isPaid
                          ? <span className="done">✓ Paid</span>
                          : <button className="mark" disabled={!planned(r) || unexplained || busy === r.key} title={unexplained ? 'say what the difference is first' : ''} onClick={() => onMark(r)}>{busy === r.key ? '…' : 'Mark paid'}</button>}
                      </div>
                    </div>
                    {isExp && <div className="rat"><Rationale row={r} planned={planned(r)} diff={diffs[r.key]} /></div>}
                  </div>
                );
              })}
              {section.projectId === '__workers__' && (
                <AddPaymentRow projects={(projects ?? []) as { project_id: string; name: string }[]} parties={(parties ?? []) as any[]} orgId={orgId}
                  onError={(m) => showSnackbar(m, { type: 'error' })}
                  onAdd={(row) => setExtra(x => ({ ...x, [row.projectId]: [...(x[row.projectId] ?? []), row] }))} />
              )}
            </section>
          );
        })}

        <RecurringManager orgId={orgId} recurring={recurring ?? []} projects={(projects ?? []) as { project_id: string; name: string }[]}
          onChanged={() => refetchRec()} onError={(m) => showSnackbar(m, { type: 'error' })} />

        <div className="foot"><div className="foot-in">
          <div className="s">{totals.count ? <><b>{totals.count}</b> payments planned, not yet made · <b className="mono">{inr(totals.left)}</b></> : 'Everything planned is paid.'}</div>
          <div className="acts">
            <span className="lbl">pay by</span>
            <select className="modesel" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(m => <option key={m}>{m}</option>)}</select>
            <span className="hint">· each payment is recorded to the ledger</span>
          </div>
        </div></div>
      </div>
    </div>
  );
}

// Manage the standing recurring/fixed lines that surface on the run each week.
function RecurringManager({ orgId, recurring, projects, onChanged, onError, defaultOpen = false }: {
  orgId: string; recurring: import('../lib/weeklyPaymentsApi').Recurring[];
  projects: { project_id: string; name: string }[]; onChanged: () => void; onError: (m: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [f, setF] = useState({ project_id: '', who: '', party: '', label: '', amount: '', cadence: 'weekly' as 'weekly' | 'monthly' });
  const [busy, setBusy] = useState(false);
  const { data: parties } = useQuery({
    queryKey: ['payables_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, type').order('name')).data ?? [],
  });
  const amt = parseInt((f.amount || '').replace(/[^\d]/g, ''), 10) || 0;
  const whoOk = f.who && (f.who !== '__other' || f.party.trim());
  const ready = !!f.project_id && !!whoOk && amt > 0;
  const add = async () => {
    if (!ready) return; setBusy(true);
    const picked = (parties ?? []).find((p: any) => p.stakeholder_id === f.who) as any;
    const partyName = f.who === '__other' ? f.party.trim() : (picked?.name || '');
    const stakeholderId = f.who === '__other' ? null : f.who;
    try {
      await addRecurring(orgId, { projectId: f.project_id, stakeholderId, partyName, label: f.label.trim(), amount: amt, cadence: f.cadence, category: 'Recurring' });
      setF({ project_id: '', who: '', party: '', label: '', amount: '', cadence: 'weekly' }); setOpen(false); onChanged();
    } catch (e: any) { onError(e?.message || 'Could not add the recurring payment'); } finally { setBusy(false); }
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Stop the recurring payment for ${name}?`)) return;
    try { await removeRecurring(id); onChanged(); } catch (e: any) { onError(e?.message || 'Could not remove'); }
  };
  return (
    <section className="site recmgr">
      <div className="site-h"><span className="n">Recurring & fixed — manage</span><span className="s">{recurring.length} standing line{recurring.length !== 1 ? 's' : ''}</span></div>
      <div className="recbody">
        {recurring.map(r => (
          <div className="recitem" key={r.id}>
            <span><b>{r.partyName}</b>{r.label ? ` · ${r.label}` : ''} <span className="rm-proj">· {r.projectName} · {r.cadence}</span></span>
            <span className="mono">{inr(r.amount)}</span>
            <button className="rm-x" title="Stop this recurring payment" onClick={() => remove(r.id, r.partyName)}>×</button>
          </div>
        ))}
        {recurring.length === 0 && <div className="recitem" style={{ color: 'var(--walnut-3)' }}>No recurring payments yet — add rent, a watchman, a utility, a weekly supervisor.</div>}
        {open ? (
          <div className="recform">
            <select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Project…</option>{projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}</select>
            <select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}>
              <option value="">Who…</option>
              {(parties ?? []).map((p: any) => <option key={p.stakeholder_id} value={p.stakeholder_id}>{p.name}{p.type ? ` · ${p.type}` : ''}</option>)}
              <option value="__other">Other (a utility, rent)…</option>
            </select>
            {f.who === '__other' && <input placeholder="Name — e.g. Office rent, Power bill" value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} />}
            <input placeholder="note (optional)" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
            <input className="amt mono" placeholder="₹ amount" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <select value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value as 'weekly' | 'monthly' })}><option value="weekly">weekly</option><option value="monthly">monthly</option></select>
            <button className="go" disabled={!ready || busy} onClick={add}>{busy ? '…' : 'Add'}</button>
            <button className="x" onClick={() => setOpen(false)}>cancel</button>
          </div>
        ) : (
          <button className="recadd" onClick={() => setOpen(true)}>＋ Add a recurring payment</button>
        )}
      </div>
    </section>
  );
}

// A type-to-search party picker — ranked suggestions + "create new", the same pattern the
// transaction payee field and the attendance add flow use. Scoped to workers here.
function PartySearch({ parties, orgId, onPick, onError }: { parties: any[]; orgId: string; onPick: (p: { id: string | null; name: string }) => void; onError: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState(false);
  const workers = useMemo(() => parties.filter(p => p.type === 'Worker'), [parties]);
  const matches = (q.trim() ? searchPayees(workers as any, q) : workers).slice(0, 8);
  const pick = (p: { id: string | null; name: string }) => { setQ(p.name); setOpenList(false); onPick(p); };
  const create = async () => {
    if (busy || !q.trim()) return; setBusy(true);
    try { const c = await createParty(q.trim(), 'Worker', orgId); pick({ id: c.id, name: c.name }); }
    catch (e: any) { onError(e?.message || 'Could not create the party'); } finally { setBusy(false); }
  };
  return (
    <div className="psrch">
      <input value={q} placeholder="Search a worker…" autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpenList(true); onPick({ id: null, name: '' }); }}
        onFocus={() => setOpenList(true)} onBlur={() => setTimeout(() => setOpenList(false), 150)} />
      {openList && (
        <div className="psrch-menu">
          {matches.map((m: any) => (
            <button key={m.stakeholder_id} className="psrch-item" onMouseDown={(e) => { e.preventDefault(); pick({ id: m.stakeholder_id, name: m.name }); }}>{m.name}{m.category ? <small> · {m.category}</small> : null}</button>
          ))}
          {q.trim() && <button className="psrch-item psrch-create" onMouseDown={(e) => { e.preventDefault(); create(); }}>{matches.length ? 'Not here? ' : ''}Create <b>{q.trim()}</b> · new worker</button>}
          {!q.trim() && matches.length === 0 && <div className="psrch-empty">Type a name to search…</div>}
        </div>
      )}
    </div>
  );
}

// "Add a payment request" — an ad-hoc row for something the register doesn't know. Now that all
// workers live in one group, the payment must say which site it belongs to, so it carries a project picker.
function AddPaymentRow({ projects, parties, orgId, onError, onAdd, defaultOpen = false }: { projects: { project_id: string; name: string }[]; parties: any[]; orgId: string; onError: (m: string) => void; onAdd: (row: PayRow) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [amount, setAmount] = useState(''); const [note, setNote] = useState('');
  const amt = parseInt(amount.replace(/[^\d]/g, ''), 10) || 0;
  const ready = !!projectId && !!picked.name.trim() && amt > 0;
  const add = () => {
    if (!ready) return;
    const projectName = projects.find(p => p.project_id === projectId)?.name || projectId;
    onAdd({ key: `x-${projectId}-${Date.now()}`, projectId, projectName, stakeholderId: picked.id, party: picked.name.trim(), trade: note.trim() || 'added here', kind: 'wages', basis: 'added here · not from the register', thisWeek: amt, balanceBf: 0, woId: null, milestoneId: null });
    setProjectId(''); setPicked({ id: null, name: '' }); setAmount(''); setNote(''); setOpen(false);
  };
  return (
    <div className="addrow">
      {open ? (
        <div className="addform">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Site…</option>{projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}</select>
          <PartySearch parties={parties} orgId={orgId} onPick={setPicked} onError={onError} />
          <input className="amt mono" placeholder="₹ amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="note" placeholder="for what — e.g. advance, flat 501 tiles" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="go" disabled={!ready} onClick={add}>Add payment</button>
          <button className="x" onClick={() => setOpen(false)}>cancel</button>
        </div>
      ) : (
        <button className="addpill" onClick={() => setOpen(true)}>＋ Add a payment request</button>
      )}
    </div>
  );
}

// The arithmetic + provenance shown when a row is expanded.
function Rationale({ row, planned, diff }: { row: PayRow; planned: number; diff?: Diff }) {
  const exp = row.thisWeek, d = exp - planned;
  const left = (
    row.bills ? (
      <div>
        <div className="cap">Open bills · paid oldest first</div>
        <div className="ledger">
          {(() => { let rem = planned; return row.bills!.map((b, i) => { const a = Math.min(b.balance, Math.max(0, rem)); rem -= a; return (
            <div className="ln" key={i}><span>Bill {b.no}{b.projectName ? <span style={{ color: 'var(--walnut-3)' }}> · {b.projectName}</span> : null}{b.date ? <span style={{ color: 'var(--walnut-3)' }}> · {new Date(b.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span> : null}</span><span className="mono">{inr(b.balance)}{a > 0.5 ? <span className="tag" style={{ color: 'var(--terracotta)' }}> ← {inr(a)}</span> : null}</span></div>
          ); }); })()}
        </div>
      </div>
    ) : row.att ? (
      <div>
        <div className="cap">From the attendance register · {row.att.period}</div>
        <table className="mini"><thead><tr><th /> {row.att.days.map(dn => <th key={dn}>{dn}</th>)}<th>Days × rate</th></tr></thead>
          <tbody>{row.att.cats.map((c, i) => { const days = c.cells.reduce((a: number, v) => a + (v || 0), 0); return (
            <tr key={i}><td>{c.name}</td>{c.cells.map((v, j) => <td key={j}>{v ? v : <span className="off">·</span>}</td>)}<td className="mono">{days} × ₹{c.rate} = {inr(days * c.rate)}</td></tr>
          ); })}</tbody></table>
      </div>
    ) : row.stage ? (
      <div>
        <div className="cap">Stage readings on the contract</div>
        <div className="ledger">{row.stage.readings.map(([n, m, v], i) => <div className="ln" key={i}><span>{n}<span style={{ color: 'var(--walnut-3)' }}> · {m}</span></span><span className="mono">{inr(v)}</span></div>)}</div>
      </div>
    ) : <div><div className="cap">Where this comes from</div><div style={{ color: 'var(--walnut-3)' }}>{row.kind === 'recurring' ? `A standing recurring payment · ${row.basis}. Paying it records a transaction like any other row.` : 'Recorded on the attendance page.'}</div></div>
  );
  const ledger = (row.att?.ledger ?? row.stage?.ledger ?? (row.bills ? [['Bills due', row.thisWeek]] : [['This week', row.thisWeek]])) as [string, number][];
  return (
    <div className="box">
      {left}
      <div>
        <div className="cap">Arithmetic</div>
        <div className="ledger">
          {ledger.map(([t, v], i) => <div className="ln" key={i}><span>{t}</span><span className={`mono ${v < 0 ? 'minus' : ''}`}>{v < 0 ? '− ' + inr(-v) : inr(v)}</span></div>)}
          <div className="ln sum"><span>This week's figure</span><span className="mono">{inr(exp)}</span></div>
          {Math.abs(d) >= 1 && <div className="ln"><span>Paying{diff ? <span className="tag">· {diff.kind === 'carry' ? `${inr(Math.abs(d))} carried` : diff.kind === 'advance' ? `${inr(Math.abs(d))} advance` : 're-agreed'}{diff.reason ? ` — ${diff.reason}` : ''}</span> : <span className="tag" style={{ color: 'var(--terracotta)' }}>· say why</span>}</span><span className="mono">{inr(planned)}</span></div>}
        </div>
      </div>
    </div>
  );
}

// The "why is it different" popover.
function WhyPopover({ row, planned, onPutBack, onDone }: { row: PayRow; planned: number; owed: number; onPutBack: () => void; onDone: (d: Diff) => void }) {
  const d = row.thisWeek - planned;
  const less = d > 0;
  const opts: [Diff['kind'], string, string][] = less
    ? [['carry', 'Still owed to them', `${inr(d)} of this week's work carries to next week`], ['re', `This week's figure is actually ${inr(planned)}`, 'Not the computed amount — say why below']]
    : [['advance', 'Advance on next week', `${inr(-d)} over this week's work — recovers next week`], ['re', `This week's figure is actually ${inr(planned)}`, 'Not the computed amount — say why below']];
  const [kind, setKind] = useState<Diff['kind']>(opts[0][0]);
  const [reason, setReason] = useState('');
  const needReason = kind === 're';
  return (
    <div className="pop" onClick={(e) => e.stopPropagation()}>
      <div className="h">This week's figure is <b className="mono">{inr(row.thisWeek)}</b>. Paying <b className="mono">{inr(planned)}</b> — the {inr(Math.abs(d))} {less ? 'less' : 'more'} is…</div>
      {opts.map(([k, t, dd]) => (
        <label key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
          <input type="radio" checked={kind === k} onChange={() => setKind(k)} />
          <span><div className="t">{t}</div><div className="d">{dd}</div></span>
        </label>
      ))}
      {needReason && <textarea className="why" rows={2} placeholder="Why is it different? e.g. 2nd floor plaster redone at their cost" value={reason} onChange={(e) => setReason(e.target.value)} />}
      <div className="acts"><button className="cancel" onClick={onPutBack}>put it back</button><button className="ok" disabled={needReason && !reason.trim()} onClick={() => onDone({ kind, reason: reason.trim() })}>Done</button></div>
    </div>
  );
}
