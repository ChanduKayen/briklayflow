// Attendance — a live, per-project labour muster. This is the exact visual and
// interaction model of the attendance.html reference, wired to Supabase via
// attendanceApi: the reference's in-memory DATA/CARD are loaded from the labour_*
// tables, and every cell edit / rate change / add persists back. The grid render
// stays imperative (a faithful port of the reference script) inside a scoped root.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useSnackbar } from '../Snackbar';
import {
  loadWeek, loadParties, mondayOf, weekDates, weekLabel,
  saveCell, saveRate, setCategoryRate, setDirectRate, setCrewBasis, addCategory, addDirectWorker, addCrew,
  loadWorkOrdersForProject, loadWorkOrderStages, linkCrewToWorkOrder, promoteDirectToCrew, removeCrew, removeDirectWorker, removeCategory,
  cardIsEmpty, seedRateCard, SUPERVISOR_KEY,
  type SiteRow, type RateCard, type Cell,
} from '../../lib/attendanceApi';
import { searchPayees } from '../../lib/payeeSearch';
import { createParty } from '../day-book/fileEntry';
import { CertificationWizard, type CertifyContext } from './CertificationWizard';
import { setEngagementBasis, submitWorkCertification } from '../../lib/workCertification';

const ATDX_CSS = `
.atdx{
  --cream:#FAF7F0; --paper:#FFFDF7; --ink:#2A241C; --walnut:#6E5F4C; --soft:#9A8C77;
  --rule:#E6DECD; --terra:#C0603F; --terra-soft:#F7E9E2; --sage:#6E8260; --sage-soft:#E4EADD;
  --today:#FBF4E6;
  --serif:'Playfair Display', Georgia, serif;
  --sans:'DM Sans', -apple-system, sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;
}
.atdx *{margin:0;padding:0;box-sizing:border-box}
.atdx{background:var(--cream); color:var(--ink); font-family:var(--sans); min-height:100vh; padding:44px 40px 120px}
.atdx .page{max-width:1120px; margin:0 auto}
.atdx .head{display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin-bottom:18px}
.atdx h1{font-family:var(--serif); font-size:36px; font-weight:600; line-height:1}
.atdx .hero{display:flex; gap:32px; text-align:right; align-items:flex-end}
.atdx .hero .h b{display:block; font-family:var(--mono); font-size:22px; font-weight:500}
.atdx .hero .h span{font-family:var(--mono); font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--soft)}
.atdx .hero .h.gap b{color:var(--terra)}
.atdx .toolbar{display:flex; align-items:center; gap:14px; margin-bottom:16px; flex-wrap:wrap}
.atdx .wkpager{display:flex; align-items:center; gap:10px}
.atdx .wkbtn{width:30px; height:30px; border-radius:50%; border:1px solid var(--rule); background:var(--paper); color:var(--walnut); cursor:pointer}
.atdx .wkbtn:hover{border-color:var(--walnut)}
.atdx .wklabel{font-family:var(--serif); font-size:18px; font-weight:600}
.atdx .tlink{font-size:13px; color:var(--soft); cursor:pointer; border-bottom:1px solid transparent}
.atdx .tlink:hover{color:var(--walnut); border-color:var(--rule)}
.atdx .chips{display:flex; gap:8px; margin-left:auto; flex-wrap:wrap}
.atdx .chip{display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; color:var(--walnut);
  background:var(--paper); border:1px solid var(--rule); border-radius:999px; padding:7px 14px; cursor:pointer}
.atdx .chip .cdot{width:7px; height:7px; border-radius:50%}
.atdx .chip.on{background:var(--ink); color:var(--cream); border-color:var(--ink)}
.atdx .info{width:26px; height:26px; border-radius:50%; border:1px solid var(--rule); background:var(--paper); color:var(--soft);
  font-size:12px; cursor:pointer; position:relative; flex:none}
.atdx .info:hover{color:var(--walnut)}
.atdx .tip{position:absolute; right:0; top:calc(100% + 8px); width:280px; background:var(--paper); border:1px solid var(--rule);
  border-radius:12px; box-shadow:0 24px 48px -24px rgba(42,36,28,.45); padding:14px 16px; text-align:left;
  font-size:12.5px; color:var(--walnut); line-height:1.6; display:none; z-index:50; font-weight:400}
.atdx .info.open .tip{display:block}
.atdx .tip b{color:var(--ink)}
.atdx .tip .dot{display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--sage); margin:0 3px 1px 0}
.atdx /* ---------- layout: day header card + site cards,.atdx cream seams between ---------- */
.cols{display:grid; grid-template-columns:280px repeat(7, 1fr) 150px; align-items:center}
.atdx .dayhead{position:sticky; top:0; z-index:10; background:var(--paper); border:1px solid var(--rule); border-radius:14px;
  box-shadow:0 10px 24px -18px rgba(42,36,28,.35); margin-bottom:18px}
.atdx .dayhead .dh{text-align:center; padding:10px 0 8px; cursor:pointer; border-radius:10px; margin:6px 2px; transition:background .2s}
.atdx .dayhead .dh:hover{background:var(--cream)}
.atdx .dayhead .dh small{display:block; font-family:var(--mono); font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--soft)}
.atdx .dayhead .dh b{font-family:var(--serif); font-size:16px; font-weight:600; color:var(--walnut)}
.atdx .dayhead .dh.today{background:var(--today)}
.atdx .dayhead .dh.today b{color:var(--terra)}
.atdx .dayhead .dh.future{opacity:.35; cursor:default}
.atdx .dayhead .corner{padding:12px 20px; font-family:var(--mono); font-size:10.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--soft)}
.atdx .dayhead .wk{text-align:right; padding-right:20px; font-size:12.5px; color:var(--soft)}
.atdx /* each site = its own card; the cream between them is the seam */
.siteblock{background:var(--paper); border:1px solid var(--rule); border-radius:16px; margin-bottom:26px}
.atdx .sitehead{position:sticky; top:74px; z-index:6; display:flex; align-items:center; gap:11px; padding:15px 20px 12px;
  background:var(--paper); border-radius:16px 16px 0 0; border-bottom:1px solid var(--rule)}
.atdx .sitedot{width:9px; height:9px; border-radius:50%; flex:none}
.atdx .sitehead b{font-family:var(--serif); font-size:19px; font-weight:600}
.atdx .sitehead .area{font-size:12.5px; color:var(--soft)}
.atdx .sitehead .stotal{margin-left:auto; font-family:var(--mono); font-size:12.5px; color:var(--walnut)}
.atdx .sitehead .addw{font-size:12.5px; font-weight:600; color:var(--walnut); cursor:pointer; margin-left:18px}
.atdx .sitehead .addw:hover{color:var(--ink)}
.atdx .siteempty{padding:14px 20px 16px; font-size:13px; color:var(--soft)}
.atdx .siteempty a{color:var(--walnut); font-weight:600; cursor:pointer; border-bottom:1px solid var(--rule)}
.atdx .siteempty a:hover{color:var(--ink)}
.atdx .wrow{border-top:1px solid var(--rule)}
.atdx .wrow:first-of-type{border-top:0}
.atdx .wname{padding:13px 20px; display:flex; align-items:center; gap:12px; min-width:0}
.atdx .wav{width:34px; height:34px; border-radius:50%; background:var(--cream); border:1px solid var(--rule); flex:none;
  display:grid; place-items:center; font-family:var(--serif); font-size:13px; color:var(--walnut)}
.atdx .wmid{min-width:0}
.atdx .wmid b{display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.atdx .wmid span{font-size:11.5px; color:var(--soft)}
.atdx .wmid .crewtag{font-family:var(--mono); font-size:10px; color:var(--terra); background:var(--terra-soft); border-radius:99px; padding:1px 7px; margin-left:5px}
.atdx .cellwrap{padding:6px 4px; position:relative}
.atdx .cell{height:44px; border-radius:10px; display:grid; place-items:center; cursor:pointer; user-select:none; position:relative;
  font-family:var(--mono); font-size:14px; color:transparent;
  transition:background .15s, box-shadow .2s, transform .12s}
.atdx .cell:hover{background:var(--cream); box-shadow:inset 0 0 0 1.5px var(--rule)}
.atdx .cell:active{transform:scale(.94)}
.atdx .cell.today{background:var(--today)}
.atdx .cell.future{pointer-events:none; opacity:.3}
.atdx .cell.filled{color:var(--ink); font-weight:500; background:var(--sage-soft)}
.atdx .cell.filled:hover{box-shadow:inset 0 0 0 1.5px var(--sage)}
.atdx .cell.filled.pop{animation:cellpop .3s cubic-bezier(.2,.9,.3,1.6)}
@keyframes cellpop{0%{transform:scale(.75)}100%{transform:scale(1)}}
.atdx .cell .src{position:absolute; top:5px; right:6px; width:5px; height:5px; border-radius:50%; background:var(--sage)}
.atdx .wtotal{text-align:right; padding-right:20px; font-family:var(--mono); font-size:13px; color:var(--walnut); white-space:nowrap}
.atdx .wtotal b{color:var(--ink); font-weight:500}
.atdx .sitefoot{border-top:1px solid var(--rule); border-radius:0 0 16px 16px}
.atdx .sitefoot .lab{padding:8px 20px; font-family:var(--mono); font-size:9.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--soft)}
.atdx .sitefoot .dc{text-align:center; font-family:var(--mono); font-size:12px; color:var(--walnut)}
.atdx .sitefoot .dc.today{color:var(--terra); font-weight:500}
.atdx .sitefoot .sum{text-align:right; padding-right:20px; font-family:var(--mono); font-size:12px; color:var(--walnut)}
.atdx .bpop{position:absolute; z-index:40; top:calc(100% + 10px); left:50%; transform:translateX(-50%) scale(.94); transform-origin:top center;
  width:252px; background:var(--paper); border:1px solid var(--rule); border-radius:16px;
  box-shadow:0 2px 0 rgba(255,255,255,.7) inset, 0 30px 60px -26px rgba(42,36,28,.55); padding:14px 14px 12px; opacity:0; pointer-events:none;
  transition:opacity .18s ease, transform .28s cubic-bezier(.2,.9,.3,1.25)}
.atdx .bpop.show{opacity:1; transform:translateX(-50%) scale(1); pointer-events:auto}
/* a notch, so it is plainly the day you tapped that it belongs to */
.atdx .bpop::before{content:""; position:absolute; top:-6px; left:50%; margin-left:-6px; width:11px; height:11px;
  background:var(--paper); border-left:1px solid var(--rule); border-top:1px solid var(--rule); transform:rotate(45deg); border-radius:2px 0 0 0}
.atdx .bp-title{font-family:var(--mono); font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--soft);
  margin-bottom:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.atdx .bp-row{position:relative; display:flex; align-items:center; gap:10px; padding:7px 0; font-size:13.5px}
.atdx .bp-row + .bp-row{border-top:1px solid color-mix(in srgb, var(--rule) 55%, transparent)}
.atdx .bp-row .t{flex:1; min-width:0; line-height:1.25}
.atdx .bp-row .rate{font-family:var(--mono); font-size:10.5px; color:var(--soft); margin-top:1px}
/* one pill, split by a hairline — not two loose buttons */
.atdx .step{display:inline-flex; align-items:center; border:1px solid var(--rule); border-radius:999px; background:var(--cream); flex:none}
.atdx .step button{width:26px; height:26px; border-radius:999px; color:var(--walnut); font-size:14px; line-height:1;
  display:grid; place-items:center; transition:background .14s, color .14s}
.atdx .step button:hover{background:var(--terra-soft); color:var(--terra)}
.atdx .step b{font-family:var(--mono); font-size:13.5px; min-width:26px; text-align:center; color:var(--soft);
  border-left:1px solid var(--rule); border-right:1px solid var(--rule); line-height:26px}
.atdx .bp-row.on .step b{color:var(--ink)}
.atdx .bp-foot{border-top:1px solid var(--rule); margin-top:10px; padding-top:10px; display:flex; justify-content:space-between;
  align-items:baseline; font-family:var(--mono); font-size:11px; letter-spacing:.04em; color:var(--soft)}
.atdx .bp-foot b{font-size:14px; color:var(--ink); font-weight:500}
.atdx .bp-done{width:100%; margin-top:11px; background:var(--ink); color:var(--cream); border:0; border-radius:999px;
  padding:10px 0; font-family:var(--sans); font-weight:600; font-size:13px; cursor:pointer; transition:transform .18s cubic-bezier(.2,.9,.3,1.4), background .2s}
.atdx .bp-done:hover{background:#1d1913; transform:translateY(-1px)}
.atdx .bp-done:active{transform:scale(.98)}
.atdx #toast{position:fixed; left:50%; bottom:28px; transform:translate(-50%,16px); background:var(--ink); color:var(--cream);
  font-size:13.5px; border-radius:999px; padding:11px 20px; opacity:0; transition:all .35s cubic-bezier(.2,.9,.3,1.2); z-index:60}
.atdx #toast.show{opacity:1; transform:translate(-50%,0)}


/* ── what the reference has no equivalent for ────────────────────────────────
   The clean mock shows a single-site week of daily wages. The live sheet also
   carries contracts measured by stage, a rate card, the add-worker flow and the
   remove affordance. Those keep their behaviour and are dressed in the mock's
   own tokens — nothing here restyles anything the mock defines. */

/* the old table palette, kept as aliases so the feature rules below still read */
.atdx{--line:var(--rule);--line-2:#D8CEBB;--walnut-2:#6E5F4C;--walnut-3:#9A8C77;
  --terracotta:var(--terra);--terracotta-bg:var(--terra-soft);--sage-bg:var(--sage-soft);
  --slate:#5b6b78;--slate-bg:#e8ecef}
/* The mock never resets buttons: its own controls declare their font where they need one, and the
   two round chrome buttons (‹ › and i) are drawn on the UA font because of it. A blanket
   button{font:inherit;color:inherit} both breaks that AND out-specifies every component rule that
   sets its own colour — which is how the Done button ended up ink-on-ink. So there is no blanket
   reset; the app's own controls name their font here, and each keeps its own colour. */
.atdx input,.atdx select,.atdx textarea{font:inherit;color:inherit}
.atdx .oncontract,.atdx .measurebasis,.atdx .ppitem,.atdx .ppempty,.atdx .new .x,.atdx .addw,
.atdx .bp-addskill,.atdx .rc-f button,.atdx .pp-link,.atdx .pp-cancel,.atdx .kindbtn,
.atdx .wrow button.rmw,.atdx .seg button,.atdx .bp-done,.atdx .step button,
.atdx .siteempty a,.atdx .kpx{font-family:var(--sans)}
.atdx button{background:none;border:0;cursor:pointer;padding:0}
.atdx :focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:6px}
.atdx .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}

/* a stage row of a contract: the name cell holds a select, the total a progress bar */
.atdx .wname .stsel{max-width:100%}
.atdx .wrow.sub .wname{padding-left:66px}
.atdx .wrow.sub .st{font-size:11.5px;color:var(--soft);margin-left:8px}

/* remove-from-sheet: a quiet × that only appears on the row it belongs to */
.atdx .wrow{position:relative}
.atdx .wrow button.rmw{position:absolute;left:2px;top:50%;transform:translateY(-50%);width:20px;height:20px;
  border-radius:50%;color:transparent;font-size:12px;line-height:1;display:grid;place-items:center;
  transition:color .15s,background .15s}
.atdx .wrow:hover button.rmw{color:var(--soft)}
.atdx .wrow button.rmw:hover{background:var(--terra-soft);color:var(--terra)}

/* a cell that is a measured quantity or a percentage rather than a headcount */
.atdx .cell.qty small{font-size:9px;color:var(--soft);margin-left:1px}
.atdx .cell.gap{color:var(--soft);font-weight:400}
.atdx .cell.off{color:#CFC4B0;pointer-events:none}

/* the add-worker flow lives inside the site card, below its rows */
.atdx .siteblock > [id^="add-"]:not(:empty){padding:14px 20px 16px;border-top:1px solid var(--rule)}
.atdx .new{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.atdx .new .x{font-size:12.5px;color:var(--soft)}
.atdx .new .x:hover{color:var(--walnut)}
.atdx .pp{position:relative;display:inline-block;min-width:320px;max-width:100%}

/* the crew stepper's own extras — the mock has the popover, not these */
.atdx .bpop .bp-row .rm{position:absolute;left:-14px;top:50%;margin-top:-7px;opacity:0;color:var(--soft);font-family:var(--sans);font-size:11px;line-height:14px;width:14px;height:14px;border-radius:50%;transition:opacity .15s,background .15s,color .15s}
.atdx .bpop .bp-row:hover .rm{opacity:1}
.atdx .bpop .bp-row .rm:hover{background:var(--terra-soft);color:var(--terra)}
.atdx .bpop .bp-row .rate{cursor:text}
.atdx .bpop .bp-row .rate:hover{color:var(--walnut)}

/* the WhatsApp-sourced reading behind a cell */
.atdx .ctip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);
  background:var(--ink);color:var(--cream);font-size:11px;white-space:nowrap;border-radius:7px;
  padding:4px 8px;opacity:0;pointer-events:none;transition:opacity .15s;z-index:30}
.atdx .cell:hover .ctip{opacity:1}

.atdx .seg{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:2px;background:var(--cream);margin-top:6px}

.atdx .oncontract{font-size:12px;color:var(--terracotta);font-weight:500;text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--terracotta) 40%,transparent);text-underline-offset:2px}
.atdx .oncontract:hover{text-decoration-color:var(--terracotta)}
.atdx .ocsel{max-width:250px;width:auto;font-size:13px;font-weight:500;color:var(--walnut);border:1px solid var(--line-2);border-radius:9px;background-color:var(--paper);padding:6px 30px 6px 12px;background-position:right 10px center}
.atdx .ocsel:hover{border-color:var(--terracotta)}
.atdx .ocsel:focus{border-color:var(--terracotta);border-bottom:1px solid var(--terracotta)}
.atdx .ocx{margin-left:8px;font-size:12.5px;color:var(--walnut-3)}
/* phase multi-select inside the contract wizard */
.atdx .phasepick{display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:var(--paper);border:1px solid var(--line-2);border-radius:11px;max-width:340px;animation:atdx-fade .18s ease}
.atdx .pp-h{font-size:12.5px;color:var(--walnut-2);font-weight:500}
.atdx .pp-h .pp-s{color:var(--walnut-3);font-weight:400}
.atdx .pp-list{display:flex;flex-direction:column;gap:2px}
.atdx .pp-opt{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:7px;font-size:13px;color:var(--walnut);cursor:pointer}
.atdx .pp-opt:hover{background:var(--cream)}
.atdx .pp-opt input{accent-color:var(--terracotta);width:15px;height:15px;cursor:pointer}
.atdx .pp-acts{display:flex;align-items:center;gap:10px;margin-top:2px}
.atdx .pp-link{height:34px;padding:0 16px;border-radius:9px;background:var(--terracotta);color:var(--paper);font-size:13px;font-weight:600;cursor:pointer}
.atdx .pp-link:disabled{opacity:.6;cursor:default}
.atdx .pp-cancel{font-size:12.5px;color:var(--walnut-3)}
.atdx .assumed{font-size:11px;color:#a9781c;font-style:italic;margin-left:6px;cursor:help}
.atdx .measurebasis{margin-left:8px;font-size:11px;color:var(--walnut-3);background:none;border:0;cursor:pointer;text-decoration:underline;text-decoration-color:var(--line-2);text-underline-offset:2px}
.atdx .measurebasis:hover{color:var(--terracotta);text-decoration-color:var(--terracotta)}
.atdx .measurebasis.on{color:var(--sage);font-weight:500;text-decoration-color:color-mix(in srgb,var(--sage) 45%,transparent)}
.atdx .seg button{padding:2px 10px;border-radius:999px;font-size:12px;color:var(--walnut-3)}
.atdx .seg button[aria-pressed=true]{background:var(--paper);color:var(--walnut);font-weight:500;box-shadow:0 1px 2px rgba(59,47,39,.08)}
.atdx .wname .rt{font-size:12px;color:var(--walnut-3);margin-left:6px}
.atdx .rt[data-rate]{cursor:text;border-bottom:1px dashed transparent}
.atdx .rt[data-rate]:hover{border-bottom-color:var(--line-2);color:var(--walnut)}
.atdx .rt input{width:54px;border:0;border-bottom:1px solid var(--walnut);background:transparent;font:inherit;padding:0}
.atdx .rt input:focus{outline:none}
/* worker-category row — a clear label, a tappable rate chip, a quiet "custom" flag */
.atdx .catn{display:flex;align-items:center;gap:9px;padding:0 12px 0 34px;font-size:13.5px;white-space:nowrap}
.atdx .catn .clab{color:var(--walnut);font-weight:500;flex:0 0 auto}
.atdx .catn .ratechip{flex:0 0 auto;display:inline-flex;align-items:baseline;gap:1px;font-size:12px;color:var(--walnut-2);background:var(--cream);border:1px solid var(--line-2);border-radius:8px;padding:2px 8px;cursor:text;white-space:nowrap;transition:border-color .15s,color .15s}
.atdx .catn .ratechip small{font-size:10px;color:var(--walnut-3)}
.atdx .catn .ratechip:hover{border-color:var(--terracotta);color:var(--walnut)}
.atdx .catn .ratechip input{width:46px;border:0;border-bottom:1px solid var(--walnut);background:transparent;font:inherit;padding:0;outline:none}
.atdx .catn .ownflag{flex:0 0 auto;font-size:11px;color:var(--walnut-3);font-style:italic}
.atdx .wtotal .brk{margin-left:7px;color:var(--walnut-3);font-size:11.5px}
.atdx .stsel{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:var(--walnut-2);padding:2px 18px 2px 0;cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%239c9083' stroke-width='1.4'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 2px center;max-width:230px;text-overflow:ellipsis}
.atdx .stsel:hover{color:var(--walnut)}
.atdx .stsel:focus{outline:none;border-bottom:1px solid var(--walnut)}
.atdx .stsel.ghost{color:var(--terracotta);font-size:13px;font-weight:500}
/* a clear "add" affordance — a dashed terracotta pill, fully visible (no width cap / truncation) */
.atdx .stsel.ghost.addskill{max-width:none;width:auto;text-overflow:clip;font-weight:600;line-height:1.4;
  border:1px dashed color-mix(in srgb,var(--terracotta) 55%,transparent);border-radius:9px;background:color-mix(in srgb,var(--terracotta) 7%,transparent);padding:6px 30px 6px 13px;background-position:right 10px center}
.atdx .stsel.ghost.addskill:hover{border-color:var(--terracotta);background:color-mix(in srgb,var(--terracotta) 12%,transparent)}
.atdx .cell .half{color:var(--walnut-2)}
.atdx .cell .zero{color:var(--line-2)}
.atdx .cell.qty{font-size:13.5px}
.atdx .cell.qty small{font-size:11px;color:var(--walnut-3);margin-left:2px}
.atdx .bpop .bp-addskill{display:block;width:100%;text-align:left;margin-top:9px;font-size:11.5px;letter-spacing:.02em;color:var(--terra);font-weight:600}
.atdx .bpop .bp-addskill:hover{color:#a44f2f;text-decoration:underline;text-underline-offset:2px}
.atdx .bar{height:4px;background:var(--line);border-radius:2px;margin-top:5px;position:relative;overflow:hidden;width:120px;margin-left:auto}
.atdx .bar i{position:absolute;left:0;top:0;bottom:0;background:var(--slate)}
.atdx .bar b{position:absolute;top:0;bottom:0;background:var(--terracotta)}
.atdx .psearch{height:38px;border:1px solid var(--line-2);border-radius:9px;background:var(--paper);padding:0 12px;font-size:14px;width:260px}
.atdx .psearch:focus{outline:none;border-color:var(--walnut)}
.atdx .ppmenu{position:absolute;left:0;top:calc(100% + 4px);z-index:45;min-width:280px;background:var(--paper);border:1px solid var(--line-2);border-radius:10px;box-shadow:0 10px 28px -12px rgba(59,47,39,.35);padding:4px;max-height:300px;overflow:auto}
.atdx .ppitem{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:7px;font-size:13.5px;color:var(--walnut)}
.atdx .ppitem:hover{background:var(--cream)}
.atdx .ppitem small{color:var(--walnut-3)}
.atdx .ppitem.ppcreate{color:var(--walnut-2);border-top:1px solid var(--line);margin-top:2px;font-weight:500}
.atdx .ppitem.ppcreate b{color:var(--walnut)}
.atdx .ppempty{padding:8px 10px;color:var(--walnut-3);font-size:13px}
/* single add button — idle / hover / press */
.atdx .addbtn{display:inline-flex;align-items:center;gap:9px;height:42px;padding:0 20px 0 15px;border-radius:11px;border:1px solid var(--line-2);background:var(--paper);color:var(--walnut);font-family:inherit;font-size:14px;font-weight:500;cursor:pointer;transition:background .16s,border-color .16s,box-shadow .2s,transform .12s}
.atdx .addbtn svg{width:17px;height:17px;stroke:var(--terracotta);stroke-width:2.2;fill:none;transition:transform .22s cubic-bezier(.34,1.3,.5,1)}
.atdx .addbtn:hover{border-color:var(--walnut);box-shadow:0 4px 14px -7px rgba(59,47,39,.4);transform:translateY(-1px)}
.atdx .addbtn:hover svg{transform:rotate(90deg)}
.atdx .addbtn:active{transform:translateY(0) scale(.98);box-shadow:none}
/* step 2 — worker or crew */
.atdx .kindpick{display:flex;flex-direction:column;gap:12px;animation:atdx-fade .2s ease}
.atdx .kp-h{font-size:13.5px;color:var(--walnut-2)}
.atdx .kp-h b{color:var(--walnut);font-weight:600}
.atdx .kp-opts{display:flex;gap:12px;flex-wrap:wrap}
.atdx .kindbtn{position:relative;display:flex;align-items:center;gap:11px;min-width:264px;padding:12px 16px;border-radius:12px;border:1px solid var(--line-2);background:var(--paper);cursor:pointer;text-align:left;overflow:hidden;transition:border-color .16s,box-shadow .2s,transform .12s,opacity .2s,filter .2s}
.atdx .kindbtn .ic svg{width:19px;height:19px;stroke:var(--terracotta);stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round}
.atdx .kindbtn .kmeta{display:flex;flex-direction:column;gap:1px;min-width:0}
.atdx .kindbtn .kt{font-size:14px;font-weight:600;color:var(--walnut)}
.atdx .kindbtn .ks{font-size:12px;color:var(--walnut-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atdx .kindbtn:hover{border-color:var(--terracotta);box-shadow:0 5px 16px -9px rgba(59,47,39,.45);transform:translateY(-1px)}
.atdx .kindbtn:active{transform:translateY(0) scale(.985)}
.atdx .kindbtn.dim{opacity:.38;filter:grayscale(.35);pointer-events:none;transform:none}
.atdx .kindbtn .spin,.atdx .kindbtn .ok{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:var(--paper)}
.atdx .kindbtn.loading{pointer-events:none;border-color:var(--line-2)}
.atdx .kindbtn.loading .spin{display:flex}
.atdx .kindbtn .spin::after{content:"";width:19px;height:19px;border:2px solid var(--line-2);border-top-color:var(--terracotta);border-radius:50%;animation:atdx-spin .7s linear infinite}
.atdx .kindbtn.done{pointer-events:none;border-color:var(--sage);animation:atdx-pop .42s ease}
.atdx .kindbtn.done .ok{display:flex;background:color-mix(in srgb,var(--sage) 11%,var(--paper))}
.atdx .kindbtn.done .ok svg{width:23px;height:23px;stroke:var(--sage);stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:26;stroke-dashoffset:26;animation:atdx-draw .42s .05s cubic-bezier(.6,0,.2,1) forwards}
.atdx .pctpop{position:absolute;z-index:7;left:50%;top:-6px;transform:translate(-50%,-100%);background:var(--paper);border:1px solid var(--line-2);border-radius:10px;box-shadow:0 10px 28px -12px rgba(59,47,39,.4);padding:10px 12px;width:158px;display:flex;flex-direction:column;gap:8px;cursor:default}
.atdx .pctpop input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:var(--line-2);outline:none;cursor:pointer;margin:2px 0}
.atdx .pctpop input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;border-radius:50%;background:var(--terracotta);border:2px solid var(--paper);box-shadow:0 1px 3px rgba(59,47,39,.3);cursor:pointer}
.atdx .pctpop input[type=range]::-moz-range-thumb{width:15px;height:15px;border:2px solid var(--paper);border-radius:50%;background:var(--terracotta);cursor:pointer}
.atdx .pctrow{display:flex;align-items:center;justify-content:space-between}
.atdx .pctrow .pctval{font-size:15px;font-weight:500;color:var(--walnut)}
.atdx .pctrow .pctok{font-size:12px;color:var(--terracotta);font-weight:500}
.atdx .legend{display:flex;gap:22px;padding:12px 18px;font-size:12.5px;color:var(--walnut-3);border-top:1px solid var(--line);flex-wrap:wrap}
.atdx .legend span{display:inline-flex;align-items:center;gap:7px}
.atdx .legend .sw{width:22px;text-align:center;font-size:14px}
.atdx .legend .sw.wa{font-weight:500;color:var(--walnut)}
.atdx .legend .sw.off{color:var(--walnut-2)}
.atdx .legend .sw.gap{color:var(--terracotta)}
.atdx .legend .pl{width:14px;height:2px;background:var(--sage);opacity:.6;display:inline-block}
.atdx .legend .srcd{width:6px;height:6px;border-radius:50%;background:var(--sage);display:inline-block}
.atdx .rc{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:18px}
.atdx .rc-h{display:flex;align-items:baseline;gap:14px;padding:14px 18px 10px;flex-wrap:wrap}
.atdx .rc-h .t{font:500 18px "Playfair Display",serif}
.atdx .rc-h .s{font-size:13px;color:var(--walnut-3)}
.atdx .rc th{font-size:12px;font-weight:500;color:var(--walnut-3);padding:8px 10px;text-align:right;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.atdx .rc th.cat{text-align:left;padding-left:18px;width:200px}
.atdx .rc th .p{display:block;font:500 14px "Playfair Display",serif;color:var(--walnut-2)}
.atdx .rc td{padding:0;text-align:right;border-bottom:1px solid var(--line);height:40px}
.atdx .rc td.cat{text-align:left;padding-left:18px;font-size:14px}
.atdx .rc tr.grp td{background:var(--cream);height:28px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--walnut-3);text-align:left;padding-left:18px}
.atdx .rc .cc{display:flex;justify-content:flex-end;align-items:baseline;gap:6px;padding:0 14px;height:100%;cursor:text;width:100%}
.atdx .rc .cc:hover{background:rgba(59,47,39,.04)}
.atdx .rc .cc .v{font-weight:500}
.atdx .rc .cc .since{font-size:11px;color:var(--walnut-3)}
.atdx .rc .cc input{width:60px;text-align:right;border:0;border-bottom:1.5px solid var(--walnut);background:transparent;font-size:14px;padding:0}
.atdx .rc .cc input:focus{outline:none}
.atdx .rc-f{padding:11px 18px;font-size:13px;border-top:1px solid var(--line)}
.atdx .rc-f button{color:var(--walnut-2);font-weight:500;display:inline-flex;align-items:center;gap:6px}
.atdx .rc-f button:hover{color:var(--walnut)}
.atdx .state{padding:60px 18px;text-align:center;color:var(--walnut-3);font-size:14px}
.atdx .hide{display:none!important}

@keyframes atdx-cellpop{0%{transform:scale(.75)}100%{transform:scale(1)}}
@keyframes atdx-spin{to{transform:rotate(360deg)}}
@keyframes atdx-draw{to{stroke-dashoffset:0}}
@keyframes atdx-pop{0%{transform:scale(.99)}45%{transform:scale(1.03)}100%{transform:scale(1)}}
@keyframes atdx-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
`;

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
/** Each site gets a colour, in the mock's order, so its dot and its chip agree. */
const SITE_DOT = ['#C0603F', '#6E8260', '#B98A2F', '#5E7A8A'];
/** The chips carry a short name — the mock takes the first two words. */
const shortSite = (label: string) => label.split(' ').slice(0, 2).join(' ');
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export default function AttendanceSheet({ session }: { session: Session }) {
  const orgId = useOrgId();
  const navigate = useNavigate();
  const { show: showSnackbar } = useSnackbar();
  const byName = (session.user?.user_metadata?.name as string) || (session.user?.user_metadata?.full_name as string) || session.user?.email || 'Office';

  const rootRef = useRef<HTMLDivElement>(null);
  const DATA = useRef<SiteRow[]>([]);
  const CARD = useRef<RateCard | null>(null);
  const PARTIES = useRef<{ stakeholder_id: string; name: string; category: string | null }[]>([]);
  const filterRef = useRef<string>('all');
  const seededRef = useRef(false);

  const [monday, setMonday] = useState<Date>(() => mondayOf(new Date()));
  const [rcOpen, setRcOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [certCtx, setCertCtx] = useState<CertifyContext | null>(null);   // the certify-work wizard's open context

  const dates = weekDates(monday);
  const todayISO = isoOf(new Date());
  const TODAY = todayISO > dates[6] ? 6 : todayISO < dates[0] ? -1 : dates.indexOf(todayISO);

  // ── rate helpers (ported from the reference, reading the live CARD) ──────────
  const rateFor = useCallback((trade: string | null, cat: string): number => {
    const C = CARD.current; if (!C) return 0;
    if (cat === 'Supervisor') return C.supervisor ?? 0;
    if (cat === 'Helper · male') return (trade ? C.trades[trade]?.hm : null) ?? C.unskilled.hm ?? 0;
    if (cat === 'Helper · female') return (trade ? C.trades[trade]?.hf : null) ?? C.unskilled.hf ?? 0;
    return C.trades[cat]?.skilled ?? 700; // a skilled trade not yet on the card gets a sensible default
  }, []);
  // A crew's mix = its own skilled trade row + helpers. An unknown trade (not on the card) still
  // gets both helpers; a card trade honours whether it defines a female-helper rate.
  const mixFor = useCallback((trade: string | null): string[] => {
    if (!trade) return ['Helper · male', 'Helper · female'];
    const t = CARD.current?.trades[trade];
    const femaleHelper = !t || t.hf != null;
    return [trade, 'Helper · male', ...(femaleHelper ? ['Helper · female'] : [])];
  }, []);
  // Map a party's stakeholder category (trades.ts naming) to a skilled-trade row. Helpers /
  // unskilled / non-trade roles → null (a plain gang of helpers); a real trade keeps its name
  // (mapped to a card key when we recognise it) so the SKILLED row always shows for a skilled party.
  const TRADE_ALIASES: Record<string, string> = {
    'painting worker': 'Painter', 'polish worker': 'Painter', 'wood polish worker': 'Painter', 'painter': 'Painter',
    'tile fitter': 'Tiler', 'marble fixer': 'Tiler', 'granite fixer': 'Tiler', 'tiler': 'Tiler',
    'shuttering carpenter': 'Carpenter', 'carpenter': 'Carpenter', 'modular kitchen installer': 'Carpenter', 'wardrobe installer': 'Carpenter',
    'bar bender / reinforcement': 'Bar bender', 'bar bender': 'Bar bender',
    'mason': 'Mason', 'stone mason': 'Mason', 'concrete worker': 'Mason',
    'electrician': 'Electrician', 'plumber': 'Plumber',
  };
  const resolveTrade = useCallback((category: string | null): string | null => {
    const c = (category || '').trim(); if (!c) return null;
    const lc = c.toLowerCase();
    if (/helper|unskilled|labour|labor|supervisor|guard|housekeep|cleaner|driver|operator|material handler|security/.test(lc)) return null;
    return TRADE_ALIASES[lc] || c; // recognised → card key; else the trade name itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load a week + build the in-memory model, then render ─────────────────────
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let [{ sites, card }, parties] = await Promise.all([loadWeek(monday), loadParties()]);
      // First visit for a fresh org: seed the starter rate card, then re-read so the
      // page opens with sensible defaults instead of an empty card.
      if (cardIsEmpty(card) && !seededRef.current) {
        seededRef.current = true;
        try { await seedRateCard(orgId); const r2 = await loadWeek(monday); sites = r2.sites; card = r2.card; } catch { /* seeding is best-effort */ }
      }
      DATA.current = sites; CARD.current = card; PARTIES.current = parties;
      setLoading(false);
      requestAnimationFrame(() => { render(); if (rcOpen) renderCard(); });
    } catch (e: any) {
      setErr(e?.message || 'Could not load attendance'); setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday]);

  useEffect(() => { load(); }, [load]);

  // (The column crosshair and group glow went with the table. In the card layout a row is its own
  //  block and a cell answers for itself on hover, which is what the design asks for.)

  useEffect(() => { if (!loading && rcOpen) renderCard(); if (!loading && !rcOpen) { const t = rootRef.current?.querySelector('#atdxRc') as HTMLElement | null; if (t) t.hidden = true; } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcOpen, loading]);

  // ── grid render (faithful port) ──────────────────────────────────────────────
  const q = (sel: string) => rootRef.current?.querySelector(sel) as HTMLElement | null;
  const sum = (cells: Cell[]) => cells.reduce((s, c) => s + ((c && c !== 'off') ? c.v : 0), 0);

  const srcDot = (c: any) => c.src === 'wa' ? '<span class="src"></span>' : '';
  const ctip = (c: any) => c.by ? `<div class="ctip">${c.v} · ${c.by} · ${c.at || ''}${c.photo ? ' · photo' : ''}</div>` : '';
  /** Every day is one grid cell: blank until it holds something, dimmed once it is out of reach. */
  const wrap = (inner: string) => `<div class="cellwrap">${inner}</div>`;
  const cls = (i: number, extra = '') =>
    `cell${i === TODAY ? ' today' : ''}${i > TODAY || i === 6 ? ' future' : ''}${extra}`;

  function dayCell(c: Cell, i: number, ref: string) {
    if (c === 'off') return wrap(`<div class="${cls(i)} off"></div>`);
    if (!c) return wrap(`<div class="${cls(i)}" data-day="${i}" data-cycle="${ref}"></div>`);
    const t = c.v === 1 ? '1' : c.v === 0.5 ? '<span class="half">½</span>' : '<span class="zero">0</span>';
    return wrap(`<div class="${cls(i, c.v > 0 ? ' filled' : '')}" data-day="${i}" data-cycle="${ref}">${t}${srcDot(c)}${ctip(c)}</div>`);
  }
  function qtyCell(c: Cell, i: number, ref: string, unit?: string) {
    if (c === 'off') return wrap(`<div class="${cls(i)} off"></div>`);
    if (!c) return wrap(`<div class="${cls(i)} qty" data-day="${i}" data-edit="${ref}"></div>`);
    return wrap(`<div class="${cls(i, c.v > 0 ? ' filled' : '')} qty" data-day="${i}" data-edit="${ref}">${c.v}<small>${unit || ''}</small>${srcDot(c)}${ctip(c)}</div>`);
  }
  // A labour crew shows ONE row; its day cell is the whole crew's headcount for that day (e.g. "1+2"),
  // and a click opens the breakdown popover to set each skill. Keeps the grid uncluttered.
  function crewDayCell(crew: any, i: number, si: number, ci: number) {
    const ref = `${si}.${ci}.${i}`;
    if (i === 6 || i > TODAY) return wrap(`<div class="${cls(i)} off"></div>`);
    const nz = crew.cats.map((cat: any) => { const c = cat.cells[i]; return (c && c !== 'off') ? c.v : 0; });
    const total = nz.reduce((a: number, b: number) => a + b, 0);
    const wa = crew.cats.some((cat: any) => { const c = cat.cells[i]; return c && c !== 'off' && c.src === 'wa'; });
    if (total <= 0) return wrap(`<div class="${cls(i)}" data-day="${i}" data-crewcell="${ref}"></div>`);
    const disp = nz.filter((v: number) => v > 0).join('+');
    return wrap(`<div class="${cls(i, ' filled')}" data-day="${i}" data-crewcell="${ref}">${disp}${wa ? '<span class="src"></span>' : ''}</div>`);
  }
  function pctCell(c: Cell, i: number, ref: string, prev: number) {
    if (c === 'off') return wrap(`<div class="${cls(i)} off"></div>`);
    if (!c) return wrap(`<div class="${cls(i)} qty" data-day="${i}" data-edit="${ref}"></div>`);
    const drop = c.v < prev ? ' style="color:var(--terra)"' : '';
    return wrap(`<div class="${cls(i, c.v > 0 ? ' filled' : '')} qty" data-day="${i}" data-edit="${ref}"${drop}>${c.v}<small>%</small>${srcDot(c)}${ctip(c)}</div>`);
  }
  const latestPct = (st: any) => st.cells.reduce((p: number, c: Cell) => (c && c !== 'off') ? c.v : p, st.before);
  function stageMath(st: any) {
    if (st.type === 'lump') {
      const pct = latestPct(st), earned = (st.amount || 0) * pct / 100;
      return { earned, prog: pct / 100, pct, label: `<b>${pct}%</b> of ${inr(st.amount || 0)} · ${inr(earned)}` };
    }
    const done = st.before + sum(st.cells), earned = done * (st.rate || 0);
    return { earned, prog: st.total ? done / st.total : 0, pct: st.total ? Math.round(done / st.total * 100) : 0,
             label: `<b>${done.toLocaleString('en-IN')}</b> / ${(st.total || 0).toLocaleString('en-IN')} ${st.unit || ''} · ${inr(earned)}` };
  }

  function render() {
    const body = q('#atdxBody'); if (!body) return;
    let wd = 0, wv = 0, we = 0, gaps = 0, todayCount = 0;
    body.innerHTML = DATA.current.map((site, si) => {
      // Every site is its own card; the cream between them is the seam.
      const dot = SITE_DOT[si % SITE_DOT.length];
      let rows = '';
      let sno = 0;
      const dayHead = [0, 0, 0, 0, 0, 0, 0]; let siteWage = 0;
      site.crews.forEach((crew, ci) => {
        const onContract = crew.basis === 'contract';
        const catDays = crew.cats.reduce((s2, cat) => s2 + sum(cat.cells), 0);
        const wage = crew.cats.reduce((s2, cat) => s2 + sum(cat.cells) * cat.rate, 0);
        const earned = crew.stages.reduce((s2, st) => s2 + stageMath(st).earned - st.paid, 0);
        if (onContract) { we += earned; }
        else {
          wd += catDays; wv += wage; siteWage += wage;
          for (let i = 0; i < 7; i++) crew.cats.forEach(cat => { const c = cat.cells[i]; if (c && c !== 'off') dayHead[i] += c.v; });
          if (crew.cats.length) for (let i = 0; i <= TODAY; i++) { if (i === 6) continue; if (!crew.cats.some(cat => { const c = cat.cells[i]; return c && c !== 'off'; })) gaps++; }
        }
        const stageVal = crew.stages.reduce((s2, st) => s2 + (st.type === 'lump' ? (st.amount || 0) : (st.total || 0) * (st.rate || 0)), 0);
        const stageEarnedGross = crew.stages.reduce((s2, st) => s2 + stageMath(st).earned, 0);
        const overallPct = stageVal ? Math.round(stageEarnedGross / stageVal * 100) : 0;
        const assumed = !crew.basisConfirmed ? ` <span class="assumed" title="Basis assumed — pick Contract or Labour to confirm">· assumed</span>` : '';
        const measuring = crew.accrualBasis === 'measurement';
        const measureToggle = (crew.contract && onContract)
          ? ` <button class="measurebasis${measuring ? ' on' : ''}" data-measurebasis="${si}.${ci}" title="${measuring ? 'Measured by attendance — each measured day auto-certifies. Click to switch back to milestone certification.' : 'Certify by milestones. Click to measure by attendance instead.'}">${measuring ? '✓ measured by attendance' : 'measure by attendance'}</button>`
          : '';
        sno++;
        if (!onContract) {
          // ── LABOUR crew → ONE row. The cell is the crew's headcount; a click opens the stepper. ──
          const contractLink = crew.contract
            ? `<button class="oncontract" data-basis="${si}.${ci}.contract" title="This party has a contract — switch to tracking it by stages">on a contract?</button>`
            : `<button class="oncontract" data-oncontract="${si}.${ci}">put on contract</button>`;
          rows += `<div class="cols wrow" data-grp="c${si}-${ci}">
            <div class="wname"><button class="rmw" data-rmc="${si}.${ci}" title="Remove from sheet" aria-label="Remove ${escapeHtml(crew.n)}">×</button>
              <div class="wav">${avatarOf(crew.n)}</div>
              <div class="wmid"><b>${escapeHtml(crew.n)}<span class="crewtag">crew</span></b>
              <span>${escapeHtml(crew.trade || crew.d || 'Labour')} · daily wages · ${contractLink}</span></div></div>
            ${crew.head.map((_c: Cell, i: number) => crewDayCell(crew, i, si, ci)).join('')}
            <div class="wtotal">${catDays ? `<b>${catDays} wd</b> · ${inr(wage)}` : ''}</div></div>`;
          return;
        }
        // ── CONTRACT crew → heading row + a row per live stage ──
        const seg = `<div class="seg"><button data-basis="${si}.${ci}.contract" aria-pressed="${onContract}">Contract</button><button data-basis="${si}.${ci}.labour" aria-pressed="${!onContract}">Labour</button>${assumed}${measureToggle}</div>`;
        rows += `<div class="cols wrow" data-grp="c${si}-${ci}">
          <div class="wname"><button class="rmw" data-rmc="${si}.${ci}" title="Remove from sheet" aria-label="Remove ${escapeHtml(crew.n)}">×</button>
            <div class="wav">${avatarOf(crew.n)}</div>
            <div class="wmid"><b>${escapeHtml(crew.n)}</b><span>${escapeHtml(crew.d || '')} · contract</span>${seg}</div></div>
          ${crew.head.map((_c: Cell, i: number) => wrap(`<div class="${cls(i)} off"></div>`)).join('')}
          <div class="wtotal"><b>${overallPct}%</b> · ${inr(earned)}</div></div>`;
        {
          (crew as any).shown = (crew as any).shown || crew.stages.map((_st, ki) => ki).filter((ki) => {
            const m = stageMath(crew.stages[ki]); const st = crew.stages[ki];
            return !(m.pct >= 100 && m.earned - st.paid <= 0);
          });
          const opts = (sel: number) => crew.stages.map((st, ki) => `<option value="${ki}" ${ki === sel ? 'selected' : ''} ${(crew as any).shown.includes(ki) && ki !== sel ? 'disabled' : ''}>${st.n}${stageMath(st).pct >= 100 ? ' · done' : ''}</option>`).join('')
            + `<option disabled>──────</option><option value="new">+ Add a stage…</option>`;
          (crew as any).shown.forEach((ki: number, n: number) => {
            const st = crew.stages[ki], ref = `${si}.s${ci}.${ki}`, m = stageMath(st);
            let prev = st.before;
            const cells = st.type === 'lump'
              ? st.cells.map((c, i) => { const h = pctCell(c, i, ref, prev); if (c && c !== 'off') prev = c.v; return h; }).join('')
              : st.cells.map((c, i) => qtyCell(c, i, ref, st.unit)).join('');
            const denom = st.type === 'lump' ? (st.amount || 1) : ((st.total || 0) * (st.rate || 0) || 1);
            rows += `<div class="cols wrow sub" data-grp="c${si}-${ci}">
              <div class="wname"><select class="stsel" data-swap="${si}.${ci}.${n}">${opts(ki)}</select><span class="st">${st.type === 'lump' ? 'lump sum' : `per ${st.unit || ''}`}</span></div>${cells}
              <div class="wtotal">${m.label}<div class="bar"><i style="width:${Math.min(100, m.prog * 100)}%"></i><b style="left:0;width:${Math.min(100, st.paid / denom * 100)}%"></b></div></div></div>`;
          });
          const hidden = crew.stages.length - (crew as any).shown.length;
          rows += `<div class="cols wrow sub" data-grp="c${si}-${ci}"><div class="wname" id="stadd-${si}-${ci}">
            <select class="stsel ghost" data-swap="${si}.${ci}.new"><option value="" selected>+ Stage…${hidden ? ` (${hidden} more on this contract)` : ''}</option>${opts(-1)}</select></div>
            ${dates.map((_d, i) => wrap(`<div class="${cls(i)} off"></div>`)).join('')}<div class="wtotal"></div></div>`;
        }
      });
      site.direct.forEach((w, wi) => {
        const d = sum(w.cells), amt = d * w.rate; wd += d; wv += amt; siteWage += amt;
        w.cells.forEach((c, i) => { if (c && c !== 'off') dayHead[i] += c.v; if (!c && i <= TODAY) gaps++; });
        sno++;
        rows += `<div class="cols wrow" data-grp="d${si}-${wi}">
          <div class="wname"><button class="rmw" data-rmw="${si}.${wi}" title="Remove from sheet" aria-label="Remove ${escapeHtml(w.n)}">×</button>
            <div class="wav">${avatarOf(w.n)}</div>
            <div class="wmid"><b>${escapeHtml(w.n)}</b><span data-ocwrap="${si}.${wi}">${escapeHtml(w.d || '')} · <span class="rt mono" data-rate="${si}.d${wi}" title="click to change rate">₹${w.rate}</span>/day · <button class="oncontract" data-ocw="${si}.${wi}">put on contract</button></span></div></div>
          ${w.cells.map((c, i) => dayCell(c, i, `${si}.d${wi}`)).join('')}
          <div class="wtotal">${d ? `<b>${d} wd</b> · ${inr(amt)}` : ''}</div></div>`;
      });
      todayCount += TODAY >= 0 ? dayHead[TODAY] : 0;

      const head = `<div class="sitehead"><span class="sitedot" style="background:${dot}"></span>
        <b>${escapeHtml(site.label)}</b>${site.hint ? `<span class="area">${escapeHtml(site.hint)}</span>` : ''}
        <span class="stotal">${siteWage ? inr(siteWage) + ' this week' : ''}</span><span class="addw" data-add="${si}">＋ Add worker</span></div>`;
      const empty = `<div class="siteempty">No attendance yet this week — <a data-add="${si}">add a worker</a> or wait for the site to WhatsApp it in.</div>`;
      const foot = `<div class="cols sitefoot"><div class="lab">On site</div>${dates.map((_d, i) => `<div class="dc${i === TODAY ? ' today' : ''}">${dayHead[i] || ''}</div>`).join('')}<div class="sum">${siteWage ? inr(siteWage) : ''}</div></div>`;
      return `<div class="siteblock" data-site="${site.site}">${head}${sno ? rows + foot : empty}<div id="add-${si}"></div></div>`;
    }).join('') || `<div class="state">No active projects yet — create a project to start tracking attendance.</div>`;
    const setTxt = (id: string, v: string) => { const el = q('#' + id); if (el) el.textContent = v; };
    setTxt('atdxWd', String(wd)); setTxt('atdxAccrued', inr(wv + we)); setTxt('atdxToday', String(todayCount)); setTxt('atdxGaps', String(gaps));
    bind(); applyFilter();
  }

  // ── resolve a cell ref to its in-memory target + persistence subject ─────────
  function resolve(ref: string) {
    const [si, part, ki] = ref.split('.'); const site = DATA.current[+si];
    if (part[0] === 'h') { const crew = site.crews[+part.slice(1)]; return { cells: crew.head, projectId: site.site, subject: { type: 'crew_head' as const, crew_id: crew.crewId } }; }
    if (part[0] === 'c') { const cat = site.crews[+part.slice(1)].cats[+ki]; return { cells: cat.cells, target: cat, projectId: site.site, subject: { type: 'crew_category' as const, category_id: cat.id } }; }
    if (part[0] === 's') { const st = site.crews[+part.slice(1)].stages[+ki]; return { cells: st.cells, target: st, projectId: site.site, subject: { type: 'stage' as const, milestone_id: st.milestoneId } }; }
    const w = site.direct[+part.slice(1)]; return { cells: w.cells, target: w, projectId: site.site, subject: { type: 'direct' as const, direct_worker_id: w.id } };
  }
  const colOf = (div: Element) => Number((div as HTMLElement).dataset.day ?? -1);
  const fail = (e: any) => { showSnackbar(e?.message || 'Could not save', { type: 'error' }); load(); };

  async function persistCell(subject: any, projectId: string, i: number, value: number) {
    try { await saveCell(orgId, projectId, dates[i], subject, value, byName); } catch (e) { fail(e); }
  }

  // Click a day header → mark everyone with an empty cell present (1) for that day. Only fills gaps
  // (never overwrites a real mark), skips contract crews (measured, not mustered) and days off.
  function fillDay(i: number) {
    if (i < 0 || i > 6) return;
    let marked = 0;
    const saves: Promise<void>[] = [];
    const mark = (cells: Cell[], subject: any, projectId: string) => {
      const c = cells[i]; if (c === 'off' || c) return;
      cells[i] = { v: 1, src: 'office', by: byName, at: 'just now' }; marked++;
      saves.push(saveCell(orgId, projectId, dates[i], subject, 1, byName));
    };
    DATA.current.forEach(site => {
      site.crews.forEach(crew => {
        if (crew.basis === 'contract') return;
        crew.cats.forEach(cat => mark(cat.cells, { type: 'crew_category', category_id: cat.id }, site.site));
      });
      site.direct.forEach(w => mark(w.cells, { type: 'direct', direct_worker_id: w.id }, site.site));
    });
    render();
    Promise.all(saves).catch(fail);
    const dayName = new Date(dates[i]).toLocaleString('en-US', { weekday: 'long' });
    showSnackbar(marked ? `Marked ${marked} present on ${dayName} — tap any cell to adjust` : `Everyone already marked on ${dayName}`);
  }

  // Open the certification wizard for a stage cell — the contract-stage reading is now an accountable,
  // evidenced, role-gated event (submit → auto-approve within rights, else the Works Approver).
  function openCertWizard(ref: string) {
    const [si, part, ki] = ref.split('.');
    const site = DATA.current[+si]; const crew = site.crews[+part.slice(1)]; const st = crew.stages[+ki] as any;
    setCertCtx({
      orgId, projectId: site.site, projectName: site.label,
      woId: crew.woId ?? null, milestoneId: st.milestoneId, crewId: crew.crewId, stakeholderId: crew.stakeholderId ?? null,
      partyName: crew.n, milestoneName: st.n,
      kind: st.type === 'lump' ? 'lump' : 'measured',
      planned: st.amount || 0, rate: st.rate || 0, unit: st.unit,
      priorReading: st.type === 'lump' ? (st.before || 0) : 0,
    });
  }

  // MEASUREMENT basis, measured stage — the muster day IS the reading. Enter the qty inline and it
  // auto-certifies (qty × rate) through the governed path, no wizard ceremony: the certification is
  // auto-approved within the marker's authority, else it routes Pending to the Works Approver.
  function openMeasuredEntry(div: HTMLElement, ref: string, i: number) {
    const [si, part, ki] = ref.split('.');
    const site = DATA.current[+si]; const crew = site.crews[+part.slice(1)]; const st = crew.stages[+ki] as any;
    const t = resolve(ref);
    const cur = t.cells[i] && t.cells[i] !== 'off' ? (t.cells[i] as any).v : '';
    const wasEmpty = cur === '';   // certify ONLY the first entry of a day — never double-accrue on a correction
    div.innerHTML = `<input class="mono" value="${cur}" inputmode="decimal" placeholder="qty">`;
    const inp = div.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
    let doneOnce = false;
    const commit = async () => {
      if (doneOnce) return; doneOnce = true;
      const v = parseFloat(inp.value);
      if (isNaN(v) || v <= 0) { render(); return; }
      t.cells[i] = { v, src: 'office', by: byName, at: 'just now' };
      persistCell(t.subject, t.projectId, i, v);          // the reading (display + progress)
      if (!wasEmpty) { showSnackbar('Reading updated (already certified for that day)'); render(); return; }
      const amount = Math.round((st.rate || 0) * v);       // the certified value
      try {
        const r = await submitWorkCertification({
          orgId, projectId: site.site, woId: crew.woId ?? null, milestoneId: st.milestoneId, crewId: crew.crewId,
          stakeholderId: crew.stakeholderId ?? null, readingKind: 'measured', readingValue: v, computedAmount: amount,
          readingDate: dates[i], note: `${st.n} · measured`,
        });
        showSnackbar(r.status === 'approved' ? `Certified ${inr(amount)}` : `${inr(amount)} sent for approval`);
      } catch (e) { showSnackbar((e as any)?.message || 'Could not certify', { type: 'error' }); }
      render();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { doneOnce = true; inp.removeEventListener('blur', commit); render(); } });
  }

  // The crew breakdown popover (the mockup): steppers per skill for ONE day, live count + cost, a
  // clickable rate, and add/remove skill. Persists each change; the cell repaints live, totals on close.
  function openCrewPopover(cellDiv: HTMLElement, si: number, ci: number, i: number) {
    const host = cellDiv.closest('.cellwrap') as HTMLElement | null; if (!host) return;
    host.querySelector('.bpop')?.remove();
    const crew = DATA.current[si].crews[ci];
    const dt = new Date(dates[i]);
    const dayLbl = dt.toLocaleString('en-US', { weekday: 'short' }) + ' ' + dt.getDate();
    const valOf = (ki: number) => { const c = crew.cats[ki].cells[i]; return (c && c !== 'off') ? c.v : 0; };
    const pop = document.createElement('div');
    pop.className = 'bpop';
    pop.innerHTML =
      `<div class="bp-title">${escapeHtml(crew.n)} · ${dayLbl}</div>` +
      crew.cats.map((cat, ki) => `<div class="bp-row" data-ki="${ki}">
          <button class="rm" data-rmk="${ki}" title="Remove this skill">×</button>
          <div class="t">${escapeHtml(cat.n)}<div class="rate" data-poprate="${ki}" title="Tap to change the daily rate">${inr(cat.rate)}/day</div></div>
          <div class="step"><button data-d="-1" data-ki="${ki}">−</button><b data-q="${ki}">${valOf(ki)}</b><button data-d="1" data-ki="${ki}">＋</button></div>
        </div>`).join('') +
      `<button class="bp-addskill" data-addcat="${si}.${ci}">＋ add a skill</button>` +
      `<div class="bp-foot"><span data-foot-c></span><b data-foot-amt></b></div>` +
      `<button class="bp-done">Done</button>`;
    host.appendChild(pop);
    requestAnimationFrame(() => pop.classList.add('show'));

    const repaintCell = () => {
      const nz = crew.cats.map(cat => { const c = cat.cells[i]; return (c && c !== 'off') ? c.v : 0; });
      const total = nz.reduce((a, b) => a + b, 0);
      const wa = crew.cats.some(cat => { const c = cat.cells[i]; return c && c !== 'off' && c.src === 'wa'; });
      const day = Number(cellDiv.dataset.day ?? -1);
      cellDiv.className = cls(day, total > 0 ? ' filled' : '');
      cellDiv.innerHTML = total > 0 ? nz.filter(v => v > 0).join('+') + (wa ? '<span class="src"></span>' : '') : '';
    };
    const foot = () => {
      const count = crew.cats.reduce((s, cat) => s + valOf(crew.cats.indexOf(cat)), 0);
      const cost = crew.cats.reduce((s, cat, ki) => s + valOf(ki) * cat.rate, 0);
      (pop.querySelector('[data-foot-c]') as HTMLElement).textContent = count ? `${count} on site` : 'nobody yet';
      (pop.querySelector('[data-foot-amt]') as HTMLElement).textContent = inr(cost);
      // a skill with somebody on it reads in ink; the rest stay quiet
      pop.querySelectorAll('.bp-row').forEach(r => {
        const ki = Number((r as HTMLElement).dataset.ki ?? -1);
        r.classList.toggle('on', ki >= 0 && valOf(ki) > 0);
      });
    };
    foot();

    let dirty = false;
    const close = () => { document.removeEventListener('mousedown', onDoc); pop.remove(); if (dirty) render(); };
    const onDoc = (e: MouseEvent) => { if (!pop.contains(e.target as Node) && e.target !== cellDiv) close(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc), 0);

    pop.querySelectorAll('.step button').forEach(b => b.addEventListener('click', () => {
      const ki = +(b as HTMLElement).dataset.ki!, d = +(b as HTMLElement).dataset.d!;
      const v = Math.max(0, valOf(ki) + d);
      crew.cats[ki].cells[i] = { v, src: 'office', by: byName, at: 'just now' };
      (pop.querySelector(`b[data-q="${ki}"]`) as HTMLElement).textContent = String(v);
      dirty = true; foot(); repaintCell();
      persistCell({ type: 'crew_category', category_id: crew.cats[ki].id }, DATA.current[si].site, i, v);
    }));
    pop.querySelectorAll('[data-poprate]').forEach(r => r.addEventListener('click', () => {
      if (r.querySelector('input')) return;
      const ki = +(r as HTMLElement).dataset.poprate!;
      (r as HTMLElement).innerHTML = `₹<input class="mono" value="${crew.cats[ki].rate}" inputmode="numeric" style="width:56px">`;
      const inp = r.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => {
        const v = parseInt(inp.value.replace(/,/g, ''), 10);
        if (!isNaN(v)) { crew.cats[ki].rate = v; crew.cats[ki].own = true; setCategoryRate(crew.cats[ki].id, v).catch(fail); (r as HTMLElement).textContent = `${inr(v)}/day`; dirty = true; foot(); }
        else (r as HTMLElement).textContent = `${inr(crew.cats[ki].rate)}/day`;
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); (r as HTMLElement).textContent = `${inr(crew.cats[ki].rate)}/day`; } });
    }));
    pop.querySelectorAll('[data-rmk]').forEach(x => x.addEventListener('click', async () => {
      const ki = +(x as HTMLElement).dataset.rmk!;
      if (!window.confirm(`Remove the ${crew.cats[ki].n} skill? Its attendance will be deleted.`)) return;
      close(); try { await removeCategory(crew.cats[ki].id); await load(); } catch (e) { fail(e); }
    }));
    (pop.querySelector('[data-addcat]') as HTMLElement).addEventListener('click', async () => {
      const have = crew.cats.map(c => c.n);
      const choices = ['Mason', 'Carpenter', 'Bar bender', 'Painter', 'Tiler', 'Electrician', 'Plumber', 'Helper · male', 'Helper · female'].filter(n => !have.includes(n));
      const n = window.prompt(`Add a skill to ${crew.n} — e.g. ${choices.slice(0, 3).join(', ') || 'Mason'}`)?.trim();
      if (!n) return;
      close(); try { await addCategory(orgId, crew.crewId, n, rateFor(crew.trade, n)); await load(); } catch (e) { fail(e); }
    });
    (pop.querySelector('.bp-done') as HTMLElement).addEventListener('click', close);
  }

  function bind() {
    const body = q('#atdxBody'); if (!body) return;
    body.querySelectorAll('[data-crewcell]').forEach(div => div.addEventListener('click', (e) => {
      e.stopPropagation();
      const [si, ci, i] = (div as HTMLElement).dataset.crewcell!.split('.').map(Number);
      openCrewPopover(div as HTMLElement, si, ci, i);
    }));
    body.querySelectorAll('[data-edit]').forEach(div => div.addEventListener('click', () => {
      if (div.querySelector('input')) return;
      const t = resolve((div as HTMLElement).dataset.edit!), i = colOf(div);
      // A contract stage's reading MINTS a governed obligation. Measurement-basis + a measured stage
      // auto-certifies inline (the day is the reading); everything else opens the Certification Wizard.
      if (t.subject.type === 'stage') {
        const ref = (div as HTMLElement).dataset.edit!;
        const [si, part] = ref.split('.'); const crew = DATA.current[+si].crews[+part.slice(1)]; const st = t.target as any;
        if (crew.accrualBasis === 'measurement' && st?.type !== 'lump') { openMeasuredEntry(div as HTMLElement, ref, i); return; }
        openCertWizard(ref); return;
      }
      const cur = t.cells[i] && t.cells[i] !== 'off' ? (t.cells[i] as any).v : '';
      div.innerHTML = `<input class="mono" value="${cur}" inputmode="numeric">`;
      const inp = div.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => { const v = parseFloat(inp.value); if (!isNaN(v)) { t.cells[i] = { v, src: 'office', by: byName, at: 'just now' }; persistCell(t.subject, t.projectId, i, v); } render(); };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); render(); } });
    }));
    body.querySelectorAll('[data-cycle]').forEach(div => div.addEventListener('click', () => {
      const t = resolve((div as HTMLElement).dataset.cycle!), i = colOf(div), c = t.cells[i];
      let v: number;
      if (!c || c === 'off') { v = 1; t.cells[i] = { v, src: 'office', by: byName, at: 'just now' }; }
      else { v = c.v === 1 ? 0.5 : c.v === 0.5 ? 0 : 1; t.cells[i] = { v, src: 'office', by: byName, at: 'just now' }; }
      persistCell(t.subject, t.projectId, i, v); render();
    }));
    body.querySelectorAll('[data-swap]').forEach(sel => sel.addEventListener('change', () => {
      const [si, ci, slot] = (sel as HTMLElement).dataset.swap!.split('.'), crew = DATA.current[+si].crews[+ci] as any;
      const val = (sel as HTMLSelectElement).value;
      if (val === 'new') { showSnackbar('Add stages from the contract for this crew, then they show up here.'); (sel as HTMLSelectElement).value = ''; return; }
      if (val === '') return;
      const ki = +val;
      if (slot === 'new') crew.shown.push(ki); else crew.shown[+slot] = ki;
      render();
    }));
    body.querySelectorAll('[data-rate]').forEach(sp => sp.addEventListener('click', () => {
      if (sp.querySelector('input')) return;
      const t = resolve((sp as HTMLElement).dataset.rate!); const target = t.target as any; if (!target) return;
      sp.innerHTML = `₹<input class="mono" value="${target.rate}" inputmode="numeric">`;
      const inp = sp.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => {
        const v = parseInt(inp.value.replace(/,/g, ''), 10);
        if (!isNaN(v)) {
          target.rate = v; target.own = true;
          const save = t.subject.type === 'crew_category' ? setCategoryRate(t.subject.category_id, v) : setDirectRate((t.subject as any).direct_worker_id, v);
          save.catch(fail);
        }
        render();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); render(); } });
    }));
    body.querySelectorAll('[data-addcat]').forEach(sel => sel.addEventListener('change', async () => {
      const [si, ci] = (sel as HTMLElement).dataset.addcat!.split('.'), crew = DATA.current[+si].crews[+ci];
      let n = (sel as HTMLSelectElement).value; if (!n) return;
      if (n === 'custom') { n = prompt('Category name') || ''; if (!n) { render(); return; } }
      try { await addCategory(orgId, crew.crewId, n, rateFor(crew.trade, n)); await load(); } catch (e) { fail(e); }
    }));
    body.querySelectorAll('[data-basis]').forEach(b => b.addEventListener('click', () => {
      const [si, ci, basis] = (b as HTMLElement).dataset.basis!.split('.'); const crew = DATA.current[+si].crews[+ci];
      crew.basis = basis as 'contract' | 'labour'; crew.accrualBasis = basis === 'contract' ? 'work' : 'day'; crew.basisConfirmed = true;
      setCrewBasis(crew.crewId, crew.basis).catch(fail); render();
    }));
    // Toggle a contract crew between milestone certification ('work') and attendance measurement ('measurement').
    body.querySelectorAll('[data-measurebasis]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const [si, ci] = (b as HTMLElement).dataset.measurebasis!.split('.'); const crew = DATA.current[+si].crews[+ci];
      const next = crew.accrualBasis === 'measurement' ? 'work' : 'measurement';
      crew.accrualBasis = next; crew.basisConfirmed = true;
      setEngagementBasis('crew', crew.crewId, next).catch(fail); render();
      showSnackbar(next === 'measurement' ? 'Measured by attendance — each measured day auto-certifies' : 'Certify by milestones');
    }));
    body.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addEntity(+(b as HTMLElement).dataset.add!)));
    body.querySelectorAll('[data-oncontract]').forEach(b => b.addEventListener('click', () => { const [si, ci] = (b as HTMLElement).dataset.oncontract!.split('.'); onContractForm(+si, +ci); }));
    body.querySelectorAll('[data-ocw]').forEach(b => b.addEventListener('click', () => { const [si, wi] = (b as HTMLElement).dataset.ocw!.split('.'); onContractDirect(+si, +wi); }));
    // The serial-number cell IS the remove control. On a device with hover (desktop) the
    // number morphs to × on row-hover and a click removes; on touch (no hover) the first tap
    // "arms" the cell (reveals ×), the second tap removes. window.confirm is the final guard.
    const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches;
    const armFirst = (cell: HTMLElement): boolean => {
      if (canHover || cell.classList.contains('armed')) return false; // ready to remove
      body.querySelectorAll('.sno.armed').forEach(c => c.classList.remove('armed'));
      cell.classList.add('armed'); return true; // first tap only armed it
    };
    body.querySelectorAll('[data-rmc]').forEach(b => b.addEventListener('click', async () => {
      if (armFirst(b as HTMLElement)) return;
      const [si, ci] = (b as HTMLElement).dataset.rmc!.split('.'); const crew = DATA.current[+si].crews[+ci];
      if (!window.confirm(`Remove ${crew.n} from the sheet? Their attendance here will be deleted.`)) { (b as HTMLElement).classList.remove('armed'); return; }
      try { await removeCrew(crew.crewId); await load(); } catch (e) { fail(e); }
    }));
    body.querySelectorAll('[data-rmw]').forEach(b => b.addEventListener('click', async () => {
      if (armFirst(b as HTMLElement)) return;
      const [si, wi] = (b as HTMLElement).dataset.rmw!.split('.'); const w = DATA.current[+si].direct[+wi];
      if (!window.confirm(`Remove ${w.n} from the sheet? Their attendance here will be deleted.`)) { (b as HTMLElement).classList.remove('armed'); return; }
      try { await removeDirectWorker(w.id); await load(); } catch (e) { fail(e); }
    }));
    body.querySelectorAll('[data-rmcat]').forEach(b => b.addEventListener('click', async () => {
      if (armFirst(b as HTMLElement)) return;
      const [si, ci, ki] = (b as HTMLElement).dataset.rmcat!.split('.'); const cat = DATA.current[+si].crews[+ci].cats[+ki];
      if (!window.confirm(`Remove the ${cat.n} skill row? Its attendance will be deleted.`)) { (b as HTMLElement).classList.remove('armed'); return; }
      try { await removeCategory(cat.id); await load(); } catch (e) { fail(e); }
    }));
  }

  // Put a wage crew on a contract: link an existing work order (reveals its stages + the
  // Contract/Labour toggle), or start a new contract prefilled for this crew's project + party.
  async function onContractForm(si: number, ci: number) {
    const crew = DATA.current[si].crews[ci]; const site = DATA.current[si];
    const lbl = q(`[data-wageslbl="${si}.${ci}"]`); if (!lbl) return;
    lbl.textContent = 'Loading contracts…';
    const startNew = () => navigate('/work-orders/new', { state: { projectId: site.site, stakeholderId: crew.stakeholderId } });
    let wos;
    try { wos = await loadWorkOrdersForProject(site.site); } catch (e) { fail(e); return; }
    // Only contracts for THIS crew's party on THIS project (the query already scopes the project).
    wos = crew.stakeholderId ? wos.filter(w => w.stakeholderId === crew.stakeholderId) : [];
    if (wos.length === 0) {
      lbl.innerHTML = `No contract for this party yet · <button class="oncontract ocnew">start a contract</button> · <button class="x ocx">cancel</button>`;
      (lbl.querySelector('.ocnew') as HTMLButtonElement).addEventListener('click', startNew);
      (lbl.querySelector('.ocx') as HTMLButtonElement).addEventListener('click', () => render());
      return;
    }
    const opts = wos.map(w => `<option value="${w.wo_id}">${escapeHtml(w.label)}${w.orderValue ? ` · ${inr(w.orderValue)}` : ''}</option>`).join('');
    lbl.innerHTML = `<select class="stsel ocsel"><option value="">Link this party's contract…</option>${opts}<option value="__new">+ New contract…</option></select> <button class="x ocx">cancel</button>`;
    const sel = lbl.querySelector('.ocsel') as HTMLSelectElement;
    (lbl.querySelector('.ocx') as HTMLButtonElement).addEventListener('click', () => render());
    sel.addEventListener('change', async () => {
      if (sel.value === '__new') { startNew(); return; }
      if (!sel.value) return;
      const woId = sel.value;
      let stages; try { stages = await loadWorkOrderStages(woId); } catch (e) { fail(e); return; }
      const link = async (ids: string[] | null) => { try { await linkCrewToWorkOrder(crew.crewId, woId, ids); await load(); } catch (e) { fail(e); } };
      if (stages.length <= 1) { await link(null); return; }   // single / lump-sum → just link
      phasePicker(lbl, stages, link);                          // has phases → pick which apply
    });
    sel.focus();
  }

  // The phase multi-select — only the ticked phases become the crew's stage rows (the payments
  // section). Defaults to all ticked; persists via labour_crews.stage_ids.
  function phasePicker(container: HTMLElement, stages: { milestone_id: string; name: string }[], onLink: (ids: string[] | null) => Promise<void>) {
    container.innerHTML = `<div class="phasepick">
        <div class="pp-h">Which phases will they work? <span class="pp-s">only these show in payments</span></div>
        <div class="pp-list">${stages.map(s => `<label class="pp-opt"><input type="checkbox" value="${s.milestone_id}" checked><span>${escapeHtml(s.name)}</span></label>`).join('')}</div>
        <div class="pp-acts"><button class="pp-link">Link contract</button><button class="x pp-cancel">cancel</button></div>
      </div>`;
    const boxes = [...container.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    (container.querySelector('.pp-cancel') as HTMLButtonElement).addEventListener('click', () => render());
    const btn = container.querySelector('.pp-link') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      const ids = boxes.filter(b => b.checked).map(b => b.value);
      if (!ids.length) { showSnackbar('Tick at least one phase.'); return; }
      btn.disabled = true; btn.textContent = 'Linking…';
      await onLink(ids.length === stages.length ? null : ids); // all ticked → null (all phases)
    });
  }

  // Put a single (direct) worker on a contract — promotes them into a one-person crew linked
  // to a work order, which then shows the Contract/Labour toggle + stages. Same picker as crews.
  async function onContractDirect(si: number, wi: number) {
    const site = DATA.current[si]; const w = site.direct[wi];
    const wrap = q(`[data-ocwrap="${si}.${wi}"]`); if (!wrap) return;
    wrap.textContent = 'Loading contracts…';
    const trade = resolveTrade(w.cat);
    const startNew = () => navigate('/work-orders/new', { state: { projectId: site.site, stakeholderId: w.stakeholderId } });
    const promote = async (woId: string, ids: string[] | null) => {
      try { await promoteDirectToCrew(orgId, site.site, { id: w.id, name: w.n, category: w.cat, rate: w.rate, stakeholderId: w.stakeholderId }, woId, trade, ids); await load(); }
      catch (e) { fail(e); }
    };
    let wos;
    try { wos = await loadWorkOrdersForProject(site.site); } catch (e) { fail(e); return; }
    wos = w.stakeholderId ? wos.filter(x => x.stakeholderId === w.stakeholderId) : [];
    if (wos.length === 0) {
      wrap.innerHTML = `No contract for this worker yet · <button class="oncontract ocnew">start a contract</button> · <button class="x ocx">cancel</button>`;
      (wrap.querySelector('.ocnew') as HTMLButtonElement).addEventListener('click', startNew);
      (wrap.querySelector('.ocx') as HTMLButtonElement).addEventListener('click', () => render());
      return;
    }
    const opts = wos.map(x => `<option value="${x.wo_id}">${escapeHtml(x.label)}${x.orderValue ? ` · ${inr(x.orderValue)}` : ''}</option>`).join('');
    wrap.innerHTML = `<select class="stsel ocsel"><option value="">Put on this contract…</option>${opts}<option value="__new">+ New contract…</option></select> <button class="x ocx">cancel</button>`;
    const sel = wrap.querySelector('.ocsel') as HTMLSelectElement;
    (wrap.querySelector('.ocx') as HTMLButtonElement).addEventListener('click', () => render());
    sel.addEventListener('change', async () => {
      if (sel.value === '__new') { startNew(); return; }
      if (!sel.value) return;
      const woId = sel.value;
      let stages; try { stages = await loadWorkOrderStages(woId); } catch (e) { fail(e); return; }
      if (stages.length <= 1) { await promote(woId, null); return; }
      phasePicker(wrap, stages, (ids) => promote(woId, ids));
    });
    sel.focus();
  }

  // A single search box: type a name → ranked party matches (same searchPayees the
  // transaction payee field uses) → pick one, or create a new party if not found.
  const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const avatarOf = (n: string) => escapeHtml((n.trim()[0] || '?').toUpperCase());
  type Party = { stakeholder_id: string; name: string; category: string | null };
  function partyPicker(si: number, placeholder: string, excludeNames: string[], onPick: (p: Party) => Promise<void>) {
    const td = q('#add-' + si); if (!td) return;
    td.innerHTML = `<span class="new"><span class="pp">
        <input class="psearch" placeholder="${placeholder}" autocomplete="off">
        <div class="ppmenu" style="display:none"></div>
      </span><button class="x">cancel</button></span>`;
    const input = td.querySelector('.psearch') as HTMLInputElement;
    const menu = td.querySelector('.ppmenu') as HTMLElement;
    (td.querySelector('.x') as HTMLButtonElement).addEventListener('click', () => render());
    const avail = () => PARTIES.current.filter(p => !excludeNames.includes(p.name));
    let busy = false;
    const commit = async (p: Party) => { if (busy) return; busy = true; menu.style.display = 'none'; try { await onPick(p); } catch (e) { busy = false; fail(e); } };
    const draw = () => {
      const query = input.value.trim();
      const matches = (query ? searchPayees(avail(), query) : avail()).slice(0, 8);
      const rows = matches.map(m => `<button class="ppitem" data-id="${m.stakeholder_id}">${escapeHtml(m.name)}${m.category ? `<small> · ${escapeHtml(m.category)}</small>` : ''}</button>`).join('');
      const create = query ? `<button class="ppitem ppcreate" data-create="1">${matches.length ? 'Not here? ' : ''}Create <b>${escapeHtml(query)}</b> · new party</button>` : '';
      menu.innerHTML = (rows + create) || `<div class="ppempty">Type a name to search…</div>`;
      menu.style.display = 'block';
      menu.querySelectorAll('[data-id]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); const p = PARTIES.current.find(x => x.stakeholder_id === (b as HTMLElement).dataset.id); if (p) commit(p); }));
      const cb = menu.querySelector('[data-create]');
      if (cb) cb.addEventListener('mousedown', async e => {
        e.preventDefault(); if (busy) return; busy = true;
        try { const c = await createParty(query, 'Worker', orgId); busy = false; await commit({ stakeholder_id: c.id, name: c.name, category: null }); }
        catch (err) { busy = false; fail(err); }
      });
    };
    input.addEventListener('input', draw);
    input.addEventListener('focus', draw);
    input.addEventListener('blur', () => setTimeout(() => { menu.style.display = 'none'; }, 150));
    input.focus();
  }

  // One entry point: search/create a party, THEN ask whether they join as a single
  // worker or a crew. Everything already on this project (crews + direct) is excluded.
  function addEntity(si: number) {
    const onSite = [...DATA.current[si].crews.map(c => c.n), ...DATA.current[si].direct.map(w => w.n)];
    partyPicker(si, 'Search a worker or crew by name…', onSite, async (p) => { chooseKind(si, p); });
  }

  // Step 2 — is this one worker, or a crew? Each choice is a real button with its own
  // hover, loading (spinner) and success (check) states; on success the sheet settles (reloads).
  function chooseKind(si: number, p: Party) {
    const td = q('#add-' + si); if (!td) return;
    const check = `<span class="ok"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg></span><span class="spin" />`;
    td.innerHTML = `<div class="kindpick">
        <div class="kp-h">Add <b>${escapeHtml(p.name)}</b>${p.category ? ` · ${escapeHtml(p.category)}` : ''} —</div>
        <div class="kp-opts">
          <button class="kindbtn" data-kind="worker">
            <span class="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.1" /><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /></svg></span>
            <span class="kmeta"><span class="kt">Working alone</span><span class="ks">Only this person is on site · a daily wage</span></span>${check}
          </button>
          <button class="kindbtn" data-kind="crew">
            <span class="ic"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="2.6" /><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5" /><circle cx="17" cy="8.5" r="2.2" /><path d="M15.2 14.1c2.2.5 3.8 2.4 3.8 4.8" /></svg></span>
            <span class="kmeta"><span class="kt">Bringing a team</span><span class="ks">Their whole crew is on site · paid as one</span></span>${check}
          </button>
        </div>
        <button class="x kpx">cancel</button>
      </div>`;
    const opts = [...td.querySelectorAll('.kindbtn')] as HTMLButtonElement[];
    (td.querySelector('.kpx') as HTMLButtonElement).addEventListener('click', () => render());
    let busy = false;
    opts.forEach(b => b.addEventListener('click', async () => {
      if (busy) return; busy = true;
      b.classList.add('loading');
      opts.forEach(o => { if (o !== b) o.classList.add('dim'); });
      try {
        if (b.dataset.kind === 'worker') {
          const cat = p.category || 'Helper · male';
          await addDirectWorker(orgId, DATA.current[si].site, p.name, cat, rateFor(null, cat), p.stakeholder_id || undefined);
        } else {
          const trade = resolveTrade(p.category);
          const cats = mixFor(trade).map(c => ({ category: c, rate: rateFor(trade, c) }));
          await addCrew(orgId, DATA.current[si].site, p.name, trade, cats, p.stakeholder_id || undefined);
        }
        b.classList.remove('loading'); b.classList.add('done');
        setTimeout(() => load(), 640); // let the success beat play, then settle
      } catch (e) {
        busy = false; b.classList.remove('loading'); opts.forEach(o => o.classList.remove('dim')); fail(e);
      }
    }));
  }

  // Add a new department (trade) to the rate card. It appears immediately with empty
  // rates; typing a rate into any cell persists that (trade, kind) row (saveRate).
  function addDepartment() {
    const name = prompt('Department / trade name (e.g. Welder, Fabricator)')?.trim();
    if (!name || !CARD.current) return;
    if (CARD.current.trades[name] || name === SUPERVISOR_KEY) { showSnackbar('That department already exists.'); return; }
    CARD.current.trades[name] = { skilled: null, hm: null, hf: null };
    if (!rcOpen) setRcOpen(true); else renderCard();
  }

  // ── rate card ────────────────────────────────────────────────────────────────
  function renderCard() {
    const rc = q('#atdxRc'); const table = q('#atdxRcTable'); const C = CARD.current; if (!rc || !table || !C) return;
    rc.hidden = false;
    const fmt = (n: number | null) => n == null ? '<span style="color:var(--line-2)">—</span>' : n.toLocaleString('en-IN');
    const cell = (key: string, field: string, v: number | null) => `<td><div class="cc" data-rc="${key}" data-f="${field}"><span class="v mono">${fmt(v)}</span>${C.since[key + '.' + field] ? `<span class="since">${C.since[key + '.' + field]}</span>` : ''}</div></td>`;
    const trades = Object.keys(C.trades);
    table.innerHTML =
      `<thead><tr><th class="cat">Worker type</th><th>Skilled<span class="p">per day</span></th><th>Helper · male<span class="p">per day</span></th><th>Helper · female<span class="p">per day</span></th></tr></thead><tbody>` +
      `<tr class="grp"><td colspan="4">Skilled trades — and the helpers who work under them</td></tr>` +
      (trades.length ? trades.map(t => `<tr><td class="cat">${t}</td>${cell(t, 'skilled', C.trades[t].skilled)}${cell(t, 'hm', C.trades[t].hm)}${cell(t, 'hf', C.trades[t].hf)}</tr>`).join('')
                     : `<tr><td class="cat" colspan="4" style="color:var(--walnut-3);font-size:13px">No trades yet — add one below.</td></tr>`) +
      `<tr class="grp"><td colspan="4">Unskilled — general labour, no trade</td></tr>` +
      `<tr><td class="cat">Unskilled labour</td><td><div class="cc" style="cursor:default"><span class="v mono" style="color:var(--line-2)">—</span></div></td>${cell('unskilled', 'hm', C.unskilled.hm)}${cell('unskilled', 'hf', C.unskilled.hf)}</tr>` +
      `<tr class="grp"><td colspan="4">Supervision</td></tr>` +
      `<tr><td class="cat">Supervisor</td>${cell('supervisor', 'skilled', C.supervisor)}<td></td><td></td></tr></tbody>`;
    table.querySelectorAll('[data-rc]').forEach(div => div.addEventListener('click', () => {
      if (div.querySelector('input')) return;
      const key = (div as HTMLElement).dataset.rc!, f = (div as HTMLElement).dataset.f! as 'skilled' | 'hm' | 'hf';
      const cur = key === 'unskilled' ? C.unskilled[f as 'hm' | 'hf'] : key === 'supervisor' ? C.supervisor : C.trades[key][f];
      div.innerHTML = `<input class="mono" value="${cur ?? ''}" inputmode="numeric">`;
      const inp = div.querySelector('input') as HTMLInputElement; inp.focus(); inp.select();
      const commit = () => {
        const v = parseInt(inp.value.replace(/,/g, ''), 10);
        if (!isNaN(v)) {
          if (key === 'unskilled') C.unskilled[f as 'hm' | 'hf'] = v; else if (key === 'supervisor') C.supervisor = v; else C.trades[key][f] = v;
          C.since[key + '.' + f] = 'today';
          saveRate(orgId, key, f, v).catch(fail);
        }
        renderCard();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.removeEventListener('blur', commit); renderCard(); } });
    }));
  }

  useEffect(() => {
    if (!infoOpen) return;
    const h = () => setInfoOpen(false);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [infoOpen]);

  // ── site filter ──────────────────────────────────────────────────────────────
  function applyFilter() {
    const f = filterRef.current;
    rootRef.current?.querySelectorAll('#atdxBody .siteblock').forEach(el => (el as HTMLElement).classList.toggle('hide', f !== 'all' && (el as HTMLElement).dataset.site !== f));
  }

  const sites = DATA.current;

  return (
    <div className="atdx" ref={rootRef}>
      <style>{ATDX_CSS}</style>
      {certCtx && <CertificationWizard ctx={certCtx}
        onClose={() => setCertCtx(null)}
        onDone={() => { setCertCtx(null); load(); }}
        onReading={(value, date) => {
          // Keep the muster grid + progress bar populated (display-only; the obligation is the cert).
          if (certCtx.projectId && certCtx.milestoneId) void saveCell(orgId, certCtx.projectId, date, { type: 'stage', milestone_id: certCtx.milestoneId }, value, byName).catch(() => {});
        }} />}
      <div className="page">
        <div className="head">
          <h1>Attendance</h1>
          <div className="hero">
            <div className="h"><b id="atdxWd">0</b><span>worker-days</span></div>
            <div className="h"><b id="atdxAccrued">₹0</b><span>accrued</span></div>
            <div className="h"><b id="atdxToday">0</b><span>on site today</span></div>
            <div className="h gap"><b id="atdxGaps">0</b><span>gaps to fill</span></div>
          </div>
        </div>

        <div className="toolbar">
          <div className="wkpager">
            <button className="wkbtn" aria-label="Previous week" onClick={() => setMonday(m => { const d = new Date(m); d.setDate(d.getDate() - 7); return d; })}>‹</button>
            <span className="wklabel">{weekLabel(monday)}</span>
            <button className="wkbtn" aria-label="Next week" onClick={() => setMonday(m => { const d = new Date(m); d.setDate(d.getDate() + 7); return d; })}>›</button>
          </div>
          <span className="tlink" onClick={() => setMonday(mondayOf(new Date()))}>this week</span>
          <span className="tlink" onClick={() => setRcOpen(o => !o)}>{rcOpen ? 'hide rate card' : 'rate card'}</span>

          <div className="chips" role="group">
            {[{ k: 'all', l: 'All sites', c: '' }, ...sites.map((s2, i) => ({ k: s2.site, l: shortSite(s2.label), c: SITE_DOT[i % SITE_DOT.length] }))].map((c, i) => (
              <span key={c.k} className={`chip${i === 0 ? ' on' : ''}`} onClick={(e) => {
                filterRef.current = c.k;
                rootRef.current?.querySelectorAll('.chips .chip').forEach(x => x.classList.toggle('on', x === e.currentTarget));
                applyFilter();
              }}>{c.c ? <span className="cdot" style={{ background: c.c }} /> : null}{c.l}</span>
            ))}
          </div>

          <button className={`info${infoOpen ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); setInfoOpen(o => !o); }}>i
            <span className="tip"><b>How this page fills.</b> WhatsApp reports from site land here with a <span className="dot" /> mark.
            Click any cell to mark or correct · click a day header to mark every site present ·
            direct workers cycle 1 → ½ → 0 → clear.</span>
          </button>
        </div>

        <section className="rc" id="atdxRc" hidden>
          <div className="rc-h"><span className="t">Rate card</span><span className="s">Daily rates by worker type. A trade&apos;s helpers can cost differently from general unskilled labour. Click to change — from today; earlier weeks keep the old rate.</span></div>
          <table id="atdxRcTable" />
          <div className="rc-f"><button onClick={addDepartment}>+ Add department</button></div>
        </section>

        <div className="cols dayhead">
          <div className="corner">Crew · worker</div>
          {dates.map((d, i) => {
            const dt = new Date(d);
            const fillable = i <= TODAY && i !== 6;
            return (
              <div key={d} className={`dh${i === TODAY ? ' today' : ''}${i > TODAY ? ' future' : ''}`}
                onClick={fillable ? () => fillDay(i) : undefined}>
                <small>{dt.toLocaleString('en-US', { weekday: 'short' })}</small><b>{dt.getDate()}</b>
              </div>
            );
          })}
          <div className="wk">This week</div>
        </div>

        <div id="atdxBody" />

        {loading && <div className="state">Loading attendance…</div>}
        {err && <div className="state" style={{ color: 'var(--terracotta)' }}>{err} · <button style={{ textDecoration: 'underline' }} onClick={() => load()}>retry</button></div>}
      </div>
    </div>
  );
}
