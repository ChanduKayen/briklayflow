// PO list — exact port of po-list.html (reference), wired to real data.
// Scoped under .polx so its CSS can't leak into the rest of the app. Fonts use the app's
// existing stacks (serif title, system sans, mono numerics) per decision.
//
// Used by both the main /purchase-orders page and the per-project PO list — pass projectId to scope.
import type React from 'react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { poPayState } from '../../lib/poLifecycle';
import { useSearch, useSearchScope } from '../search/searchScope';
import PartyFilterChip from '../search/PartyFilterChip';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import DragSheet from '../DragSheet';
import POListDesktop from './POListDesktop';
import { WhatsAppGlyph } from '../day-book/atoms';
import { useIsMobile } from '../../lib/useIsMobile';
import { usePullToRefresh, useLiveCount } from '../../lib/usePullToRefresh';
import { billedByPO } from '../../lib/billsApi';

const POLX_CSS = `
/* "From WhatsApp" draft-request strip — the review nudge atop the list (twin of the Day Book capture). */
.polx .wadrafts{background:var(--paper);border:1px solid #CDE9D3;border-radius:10px;overflow:hidden;margin-bottom:16px;box-shadow:var(--shadow)}
.polx .wadrafts .wd-h{display:flex;align-items:center;gap:8px;padding:9px 14px;font:600 11.5px/1 "DM Sans";letter-spacing:.06em;text-transform:uppercase;color:#3B7A4B;background:#EAF6ED}
.polx .wadrafts .wd-h em{font-style:normal;margin-left:auto;color:#5B8A66;font-weight:600}
.polx .wadrafts .wd-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 14px;border:0;border-top:1px solid var(--line-2);background:none;font:inherit;color:inherit;cursor:pointer;transition:background .14s}
.polx .wadrafts .wd-row:first-of-type{border-top:0}
.polx .wadrafts .wd-row:hover{background:var(--paper-2)}
.polx .wadrafts .wd-thumb{flex:none;width:38px;height:38px;border-radius:8px;object-fit:cover;background:var(--paper-2);border:1px solid var(--line);display:grid;place-items:center;font-size:18px}
.polx .wadrafts .wd-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.polx .wadrafts .wd-t b{font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .wadrafts .wd-t small{font-size:12.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .wadrafts .wd-go{flex:none;color:var(--terra);font-weight:600;font-size:13px}
.polx .wadrafts.m{margin:0 0 14px}
.polx{
  --cream:#F6F2EA; --paper:#FFFDF9; --paper-2:#FBF8F2;
  --ink:#2F2622; --ink-2:#6E635B; --ink-3:#A39A91;
  --line:#E4DCD0; --line-2:#EFE9DF;
  /* One terracotta across the app: the tint the reference pages use, its pressed shade,
     and the 10% wash they fill a quiet tinted control with. Translucent so it composites
     over the cream desktop ground and the white phone card alike. */
  --terra:#C4502B; --terra-deep:#A8431F;
  --terra-tint:rgba(196,80,43,.1); --terra-soft:rgba(196,80,43,.16);
  --sage:#5F7F5B; --sage-tint:#E7EFE4;
  --gold:#B8862E; --gold-tint:#F7EEDA;
  --r:8px; --ease:cubic-bezier(.2,.7,.2,1);
  --shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);
  --serif:Georgia,'Times New Roman',serif;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  background:#FBF9F6;color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;
}
.polx *{box-sizing:border-box}
.polx button,.polx input{font:inherit;color:inherit}
.polx input::placeholder{color:var(--ink-3)}
.polx .mono{font-family:var(--mono);font-feature-settings:"tnum";font-variant-numeric:tabular-nums}
.polx .page{max-width:100%;margin:0 auto;padding:26px 32px 80px}
.polx .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.polx h1{font:600 28px/1.1 var(--serif);margin:0;letter-spacing:-.01em}
.polx .top .count{font:500 13px var(--mono);color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:5px 9px;border-radius:6px}
.polx .figs{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:18px}
.polx .figs>div{padding:14px 20px 12px;border-right:1px solid var(--line-2);position:relative;cursor:pointer;transition:background .15s}
.polx .figs>div:hover{background:var(--paper-2)}
.polx .figs>div:last-child{border-right:0}
.polx .figs>div::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--line-2)}
.polx .figs .terra::before{background:var(--terra)}.polx .figs .gold::before{background:var(--gold)}.polx .figs .sage::before{background:var(--sage)}
.polx .figs small{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:4px}
.polx .figs .mono{font-size:22px;font-weight:500;letter-spacing:-.01em}
.polx .figs .sub{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.polx .figs .terra .mono{color:var(--terra)}
.polx .tools{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.polx .search{position:relative;flex:1;min-width:240px;max-width:380px}
.polx .search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--ink-3);fill:none;stroke-width:1.8}
.polx .search input{width:100%;height:38px;border:1px solid var(--line);border-radius:var(--r);background:var(--paper);padding:0 12px 0 34px;outline:none;transition:border-color .15s,box-shadow .15s}
.polx .search input:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.polx .chips{display:flex;gap:6px;flex-wrap:wrap}
.polx .chip{height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--ink-2);cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;transition:background .15s,color .15s,border-color .15s,transform .12s}
.polx .chip:hover{background:var(--paper-2);border-color:var(--ink-3)}
.polx .chip:active{transform:scale(.96)}
.polx .chip .n{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.polx .chip.on{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.polx .chip.on .n{color:rgba(255,253,249,.6)}
.polx .chip.on.warn{background:var(--terra);border-color:var(--terra)}
.polx .btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:var(--r);border:1px solid var(--terra);background:var(--terra);color:#fff;font-weight:500;cursor:pointer;transition:background .16s,transform .12s var(--ease),box-shadow .16s}
.polx .btn:hover{background:var(--terra-deep);border-color:var(--terra-deep);transform:translateY(-1px);box-shadow:0 6px 16px -8px rgba(196,80,43,.7)}
.polx .btn:active{transform:translateY(0) scale(.97);box-shadow:none;background:#93441F}
.polx .btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2}
.polx .btn.ghost{background:transparent;border-color:var(--line);color:var(--ink-2);margin-right:8px}
.polx .btn.ghost:hover{background:var(--paper-2);border-color:var(--terra);color:var(--terra);box-shadow:none}
.polx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
.polx table{width:100%;border-collapse:collapse;table-layout:fixed}
.polx thead th{position:sticky;top:0;z-index:2;font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:10px 12px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap;cursor:pointer;user-select:none;transition:color .15s}
.polx thead th:hover{color:var(--ink)}
.polx thead th .arr{display:inline-block;width:0;margin-left:4px;opacity:0;transition:opacity .15s;font-size:10px}
.polx thead th.sorted .arr{opacity:1}
.polx thead th.num,.polx td.num{text-align:right}
.polx tbody tr{cursor:pointer;transition:background .12s}
.polx tbody tr:hover td{background:var(--paper-2)}
.polx td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle;height:58px}
.polx tbody tr:last-child td{border-bottom:0}
.polx .po b{display:block;font-weight:600;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .po .mono{font-size:12px;color:var(--ink-3)}
.polx .items{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:0}
.polx .items span.t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.polx .items .more{display:inline-block;font:500 11px/1 var(--mono);color:var(--ink-2);background:var(--paper-2);border:1px solid var(--line-2);padding:3px 6px;border-radius:4px;margin-left:6px;vertical-align:1px;cursor:help}
.polx .items .more:hover{background:var(--terra-tint);border-color:transparent;color:var(--terra)}
.polx .site{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .when{white-space:nowrap}.polx .when small{display:block;color:var(--ink-3);font-size:12px}
.polx .dim{color:var(--ink-3)}
.polx .val{font-weight:500}
/* Bill column: a link to the attached bill (number + amount), or a quiet "not attached". */
.polx td.bill{white-space:nowrap}
.polx .billlink{display:inline-block;font-family:inherit;font-weight:500;color:var(--terra);cursor:pointer;border-bottom:1px solid transparent;transition:border-color .15s}
.polx .billlink:hover{border-bottom-color:color-mix(in srgb,var(--terra) 45%,transparent)}
/* An attached bill is a "done" tick — green like Received / paid, so a finished row reads three ticks. */
.polx .billlink.ok{color:var(--sage)}
.polx .billlink.ok:hover{border-bottom-color:color-mix(in srgb,var(--sage) 45%,transparent)}
.polx .billlink small{display:block;font-size:11.5px;font-family:var(--sans);font-weight:400;color:var(--ink-3)}
.polx .nobill{color:var(--ink-3);font-size:12.5px}
.polx .val small{display:block;font-size:11.5px;font-family:var(--sans);font-weight:400;color:var(--ink-3)}
.polx .val small.over{color:var(--terra)}
.polx .bal.owe{color:var(--terra);font-weight:500}.polx .bal.adv{color:var(--sage);font-weight:500}.polx .bal.nil{color:var(--sage)}.polx .bal.paid{color:var(--sage);font-weight:500}.polx .bal small{font-size:10.5px;font-weight:600;opacity:.72;margin-left:1px}
.polx .dlv{white-space:nowrap;display:flex;flex-direction:column;align-items:flex-start;gap:1px}
.polx .dlv .late{color:var(--terra);font-weight:500}
.polx .dlv .due{color:var(--gold);font-weight:500}
.polx .dlv .ok{display:inline-flex;align-items:center;gap:5px;color:var(--sage);font-weight:500}
/* Delivery colour system: gold = underway (sent / partial / awaiting), sage = done,
   terracotta = needs your action, muted ink = dormant. One meaning per hue. */
.polx .dlv .sent{display:inline-flex;align-items:center;gap:5px;color:var(--gold);font-weight:500}
.polx .dlv .sent svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.polx .dlv .none{color:var(--ink-2)}
.polx .dlv small{display:block;color:var(--ink-3);font-size:12px;max-width:210px;overflow:hidden;text-overflow:ellipsis}
.polx .dlv .send-link{display:inline-flex;align-items:center;gap:5px;margin-top:5px;background:none;border:0;padding:0;font-family:inherit;font-size:12px;font-weight:500;color:var(--terra);cursor:pointer;transition:color .15s}
.polx .dlv .send-link svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .28s cubic-bezier(.34,1.56,.64,1)}
.polx .dlv .send-link:hover{color:var(--terra-deep)}
.polx .dlv .send-link:hover svg{transform:translate(2px,-2px) rotate(8deg)}
.polx .dlv .send-link:active svg{transform:translate(5px,-5px) rotate(12deg) scale(.9)}
@media(prefers-reduced-motion:reduce){.polx .dlv .send-link svg{transition:none}}
.polx .dlv small b{font-weight:500}
.polx .dlv .partial{display:inline-flex;align-items:center;gap:8px;font-weight:500;color:var(--gold)}
.polx .dlv .partial i{width:44px;height:6px;border-radius:3px;background:var(--line-2);position:relative;overflow:hidden}
.polx .dlv .partial i::after{content:"";position:absolute;left:0;top:0;bottom:0;width:var(--w);background:var(--gold);border-radius:3px}
.polx .dlv[data-tip]{cursor:help}
.polx tr.cancelled td{color:var(--ink-3)}.polx tr.cancelled .po b{text-decoration:line-through;color:var(--ink-3)}
.polx td.act{width:150px;text-align:right}
.polx .next{height:30px;padding:0 10px;border-radius:6px;border:1px solid var(--line);background:var(--paper);font-size:13px;font-weight:500;color:var(--ink);cursor:pointer;opacity:0;transform:translateX(4px);transition:opacity .15s,transform .2s var(--ease),background .15s,border-color .15s}
.polx tbody tr:hover .next{opacity:1;transform:none}
.polx .next:hover{background:var(--terra-tint);border-color:transparent;color:var(--terra)}
.polx .next:active{transform:scale(.96)}
.polx .next.primary{background:var(--terra);border-color:var(--terra);color:#fff}
.polx .next.primary:hover{background:var(--terra-deep)}
.polx .next.soft{opacity:.7;transform:none;background:transparent;border-color:transparent;color:var(--ink-2)}
.polx .next.soft:hover{opacity:1}
.polx .empty{padding:48px 20px;text-align:center;color:var(--ink-3)}
.polx .foot{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--paper-2);border-top:1px solid var(--line);font-size:13px;color:var(--ink-2)}
.polx .foot .mono{color:var(--ink)}
.polx .tip{position:fixed;z-index:80;background:var(--ink);color:var(--paper);border-radius:8px;padding:8px 4px;min-width:220px;max-width:300px;font-size:13px;box-shadow:0 12px 30px -10px rgba(47,38,34,.5);pointer-events:none}
.polx .tip h4{margin:0 0 4px;padding:2px 10px;font:500 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,253,249,.55)}
.polx .tip ul{list-style:none;margin:0;padding:0}
.polx .tip li{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:5px}
.polx .tip li .q{font-family:var(--mono);color:rgba(255,253,249,.7);font-size:12px;white-space:nowrap}
.polx .tip li.r{color:rgba(255,253,249,.45)}.polx .tip li.r .q{color:rgba(255,253,249,.35)}
.polx .tip li .g{width:14px;flex:none;text-align:center}.polx .tip li .nm{flex:1}
.polx .tip li.r .g::before{content:"✓";color:#9DBB98}
.polx .tip li.p .g::before{content:"○";color:#E0B45B}
.polx .tip::after{content:"";position:absolute;left:18px;top:-5px;width:10px;height:10px;background:var(--ink);transform:rotate(45deg);border-radius:2px}
/* pending-approval PO: amber left accent + a badge, with an inline Approve for approvers */
.polx tbody tr.pending td:first-child{box-shadow:inset 3px 0 0 var(--gold)}
.polx .po .pend{display:inline-block;margin-top:3px;font-size:10.5px;font-weight:600;letter-spacing:.02em;color:var(--gold);background:var(--gold-tint);border-radius:5px;padding:1px 7px}
.polx .dlv .approve-btn{display:inline-block;margin-top:5px;background:var(--terra);color:#fff;border:0;border-radius:7px;padding:5px 12px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}
.polx .dlv .approve-btn:hover:not(:disabled){background:var(--terra-deep)}
.polx .dlv .approve-btn:disabled{opacity:.6;cursor:default}
.polx tbody tr.rfq td{background:var(--paper-2)}
.polx tbody tr.rfq:hover td{background:var(--gold-tint)}
.polx tbody tr.rfq td:first-child{box-shadow:inset 3px 0 0 var(--terra)}
.polx tbody tr.rfq .po .mono{color:var(--gold)}
.polx .chip.quote{color:var(--gold);border-color:#EBD9B4}
.polx .chip.quote .n{color:var(--gold)}
.polx .chip.quote.on{background:var(--gold);border-color:var(--gold);color:#fff}
.polx .chip.quote.on .n{color:rgba(255,255,255,.65)}
@media (max-width:980px){
  .polx .page{padding:16px 14px 60px}
  .polx .figs{grid-template-columns:1fr 1fr}
  .polx .sheet{overflow-x:auto}.polx table{min-width:1080px}
}
@media (prefers-reduced-motion:reduce){.polx *{animation-duration:.01ms !important;transition-duration:.01ms !important}}

/* ============ MOBILE (app-native, ported from po-mobile.html) ============ */
/* The ground and the cards are the app's, not this page's. Every other mobile page — the
   transactions list, For review, Payables, a transaction — sits on #F8F6F3 with white cards;
   this one sat on a cream two shades warmer (#F5F0E7) with off-white cards (#FFFCF7), which
   next to the others reads as a different app rather than a different page. Only the surfaces
   move: the walnut text, the terracotta and the status colours are untouched. */
.polx.m{background:var(--cream);min-height:100dvh;display:flex;flex-direction:column;
  --cream:#F8F6F3;--paper:#FFFFFF;--line:rgba(50,42,35,.1);--line-soft:rgba(50,42,35,.06);
  --walnut:#33251B;--walnut-2:#6A5A4C;--walnut-3:#9A8B7B;
  --sage:#5F7F5C;--gold:#8A6A1F;--gold-soft:#F3EAD2;}
.polx.m *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.polx .m-mast{padding:18px 18px 0}
.polx .m-mast .r1{display:flex;align-items:center;gap:10px}
.polx .m-mast h1{font:500 25px/1.1 var(--serif);margin:0;color:var(--walnut);letter-spacing:-.01em}
.polx .m-mast .count{font:500 12px var(--mono);color:var(--walnut-3);border:1px solid var(--line);border-radius:7px;padding:2px 7px}
.polx .m-mast .ico{margin-left:auto;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--paper);display:grid;place-items:center;color:var(--walnut-2)}
.polx .m-mast .ico svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2}
.polx .m-mast .ico.on{background:var(--walnut);border-color:var(--walnut);color:var(--paper)}
.polx .m-money{margin-top:8px;font-size:13px;color:var(--walnut-3)}
.polx .m-money b{font-family:var(--mono);font-weight:500;color:var(--walnut)}
.polx .m-search{margin:12px 18px 0;position:relative}
.polx .m-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--walnut-3);fill:none;stroke-width:1.8}
.polx .m-search input{width:100%;height:42px;border:1px solid var(--line);border-radius:12px;background:var(--paper);padding:0 12px 0 34px;outline:none;font-size:15px;color:var(--walnut)}
.polx .m-search input:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-soft)}
.polx .m-chips{display:flex;gap:8px;overflow-x:auto;padding:14px 18px 10px;scrollbar-width:none}
.polx .m-chips::-webkit-scrollbar{display:none}
.polx .m-chip{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--line);background:var(--paper);font-size:13.5px;font-weight:500;color:var(--walnut-2);transition:transform .12s}
.polx .m-chip em{font-style:normal;font-family:var(--mono);font-size:12px;color:var(--walnut-3)}
.polx .m-chip.on{background:var(--walnut);border-color:var(--walnut);color:var(--paper)}
.polx .m-chip.on em{color:rgba(255,252,247,.6)}
.polx .m-chip.gold{background:var(--gold-soft);border-color:#E4D5A8;color:var(--gold)}
.polx .m-chip.gold em{color:var(--gold)}
.polx .m-chip.gold.on{background:var(--gold);border-color:var(--gold);color:#fff}
.polx .m-chip.gold.on em{color:rgba(255,255,255,.7)}
/* Money owed is the one thing on this row that earns a colour of its own. */
.polx .m-chip.terra{background:var(--terra-tint);border-color:#E8C5B4;color:var(--terra)}
.polx .m-chip.terra em{color:var(--terra)}
.polx .m-chip.terra.on{background:var(--terra);border-color:var(--terra);color:#fff}
.polx .m-chip.terra.on em{color:rgba(255,255,255,.72)}

/* "not sent" is a nudge, not an alarm: a small grey tag beside the PO number. It used to be the
   whole status line, in red, above the bill and the money it was hiding. */
.polx .m-unsent{flex-shrink:0;font-size:10.5px;font-weight:600;letter-spacing:.02em;
  color:var(--walnut-3);background:var(--paper-2);border:1px solid var(--line-2);
  border-radius:5px;padding:0 5px;line-height:15px}
.polx .m-pcard.dim-s .m-dot{background:var(--walnut-3)}
.polx .m-pcard.dim-s .m-st{color:var(--walnut-3)}
.polx .m-chip:active{transform:scale(.97)}
.polx .m-list{flex:1;overflow-y:auto;padding:2px 14px 108px}
.polx .m-pcard{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:14px 15px;margin-bottom:10px;transition:transform .12s,background .12s;width:100%;text-align:left;display:block}
.polx .m-pcard:active{transform:scale(.985);background:#F4F0EB}
.polx .m-pcard.pofresh{animation:polxFresh 2s ease-out}
@keyframes polxFresh{0%,22%{background:#E7F0E6;border-color:#CFE0CE}100%{background:var(--paper);border-color:var(--line)}}
.polx .m-pcard .r1{display:flex;align-items:baseline;gap:8px}
.polx .m-pcard .v{font-weight:600;font-size:15.5px;color:var(--walnut);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .m-pcard .amt{font-family:var(--mono);font-size:15px;color:var(--walnut);flex-shrink:0}
.polx .m-pcard .amt.pay{color:var(--terra)}
.polx .m-pcard .amt.zero{color:var(--walnut-3)}
.polx .m-pcard .r2{display:flex;align-items:center;gap:8px;margin-top:5px;font-size:12.5px;color:var(--walnut-3);min-width:0}
.polx .m-pcard .r2 .po{font-family:var(--mono);font-size:11px;flex-shrink:0}
.polx .m-pcard .r2 .st-site{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .m-pcard .items{margin-top:6px;font-size:13px;color:var(--walnut-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .m-pcard .r3{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:13px}
.polx .m-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.polx .m-st{font-weight:500}
.polx .m-pcard.needs .m-dot{background:var(--terra)} .polx .m-pcard.needs .m-st{color:var(--terra)}
.polx .m-pcard.gold-s .m-dot{background:var(--gold)} .polx .m-pcard.gold-s .m-st{color:var(--gold)}
.polx .m-pcard.motion .m-dot{background:var(--walnut-3)} .polx .m-pcard.motion .m-st{color:var(--walnut-2)}
.polx .m-pcard.landed .m-dot{background:var(--sage)} .polx .m-pcard.landed .m-st{color:var(--sage)}
.polx .m-pcard .r3 .sub{color:var(--walnut-3);font-size:12.5px}
.polx .m-pcard .r3 .chev{margin-left:auto;color:var(--walnut-3);width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2}
.polx .m-empty{text-align:center;color:var(--walnut-3);font-size:14px;padding:48px 20px}
/* A quote request is not an order — it wears the gold the desktop table gives its enquiry rows,
   through the same dot-and-status the other card states use. */
.polx .m-pcard.m-quote .m-dot{background:var(--gold)}
.polx .m-pcard.m-quote .m-st{color:var(--gold)}
.polx .m-pcard.m-quote .po{color:var(--gold)}
/* The workflow counts the trade chips displaced — small, tappable, in the money line. */
.polx .m-wf{display:inline-flex;align-items:center;margin-left:8px;padding:1px 8px;border-radius:999px;
  border:1px solid var(--line);background:var(--paper);color:var(--ink-2);font:inherit;font-size:11.5px;
  font-weight:600;cursor:pointer;vertical-align:1px}
.polx .m-wf.gold{border-color:#E4CE9A;background:var(--gold-tint);color:var(--gold)}
.polx .m-wf.on{background:var(--terra);border-color:var(--terra);color:#fff}
/* Two ways to start: place an order, or ask what it would cost. */
.polx .m-cscrim{position:fixed;inset:0;background:rgba(30,26,21,.34);opacity:0;pointer-events:none;transition:opacity .24s var(--ease);z-index:40}
.polx .m-cscrim.show{opacity:1;pointer-events:auto}
.polx .m-csheet{position:fixed;left:0;right:0;bottom:0;z-index:41;background:var(--paper);border-radius:20px 20px 0 0;
  padding:8px 14px calc(18px + env(safe-area-inset-bottom));transform:translateY(101%);transition:transform .3s var(--ease);
  box-shadow:0 -14px 40px -18px rgba(47,38,34,.4)}
.polx .m-csheet.show{transform:none}
.polx .m-csheet .grab{width:38px;height:4px;border-radius:2px;background:var(--line);margin:6px auto 10px}
.polx .m-csheet button{display:block;width:100%;text-align:left;background:none;border:0;padding:14px 8px;border-bottom:1px solid var(--line-2);cursor:pointer}
.polx .m-csheet button:last-child{border-bottom:0}
.polx .m-csheet button:active{background:var(--paper-2)}
.polx .m-csheet b{display:block;font-size:16px;font-weight:600;color:var(--ink)}
.polx .m-csheet small{display:block;font-size:13.5px;color:var(--ink-2);margin-top:2px}
/* held state — the button stays pressed and spins for as long as the page is coming */
.polx .btn.busy{opacity:1;cursor:default}
.polx .btn.busy{color:var(--walnut-3)}
.polx .m-spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.42);border-top-color:#fff;animation:polxspin .68s linear infinite;flex:none}
.polx .btn .m-spin{border-color:rgba(51,37,27,.25);border-top-color:var(--walnut)}
@keyframes polxspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.polx .m-spin{animation-duration:1.6s}}
/* the chip row and the search button are deliberately compact; .tap44 keeps the look and
   gives the finger the full 44px it needs */
.polx .m-chip,.polx .m-mast .ico{position:relative}
.polx .m-chip::after,.polx .m-mast .ico::after{content:"";position:absolute;top:50%;left:50%;width:max(100%,44px);height:44px;transform:translate(-50%,-50%)}
`;

export interface POItem { n: string; q: string; r: boolean }
export interface PORow {
  id: string; vendor: string; stakeholderId: string; vendorContact: string | null;
  site: string; by: string; ordered: string; createdAt: string; approvalStatus: string;
  items: POItem[]; value: number; billed: number; paid: number;
  due: string | null; recv: string | null; sent: string | null; cancelled: boolean; rfq: boolean;
  bills: { id: string; no: string | null; docUrl: string | null }[];   // first-class bill entities linked to this PO
}

const fmt = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const D = (s: string | null) => (s ? new Date(s) : new Date(NaN));
const dstr = (d: Date) => (isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

export function usePOListData(projectId?: string) {
  const posQ = useQuery({
    queryKey: ['po_list_sheet', projectId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select('po_id, status, approval_status, date_issued, created_at, ordered_by, expected_delivery, total_value, order_value, vendor_bill_amount, received_at_site, sent_to_vendor_at, stakeholder_id, project_id, items, projects(name), stakeholders(name, contact), po_line_items(id, item_name, unit, quantity_ordered)')
        .order('created_at', { ascending: false });
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw error;
      // Pending-approval POs are shown (with a badge + inline Approve), not hidden — otherwise a
      // management-created PO would vanish with no way to release it. Cancelled POs ARE hidden.
      return (data ?? []).filter((po: any) => String(po.status).toUpperCase() !== 'CANCELLED');
    },
  });
  const pos = posQ.data ?? [];
  const poIds = pos.map((p: any) => p.po_id);

  const receiptQ = useQuery({
    queryKey: ['po_list_receipt', projectId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('po_receipt_summary').select('po_id, receipt_pct, last_receipt_date');
      if (error) throw error;
      const m: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { m[r.po_id] = r; });
      return m;
    },
  });

  const paidQ = useQuery({
    queryKey: ['po_list_paid', projectId ?? 'all'],
    queryFn: async () => {
      // A PO's paid = payments against its BILLS (bill_id → bills.po_id) PLUS payments made against the PO
      // itself (order_type='PO', no bill_id) — the latter auto-apply to the PO's bills. Each allocation is
      // one row → counted once (its bill's PO if bill-tagged, else the PO it names), no double count.
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('order_type, order_ref, bill_id, allocated_amount, transactions!inner(status), bills(po_id)')
        .or('order_type.eq.PO,bill_id.not.is.null')
        .neq('transactions.status', 'Voided');
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => {
        const poId = r.bill_id ? (r.bills?.po_id ?? null) : (r.order_type === 'PO' ? r.order_ref : null);
        if (poId) m[poId] = (m[poId] || 0) + (Number(r.allocated_amount) || 0);
      });
      return m;
    },
  });

  // Billed per PO = Σ of its first-class bill entities (a PO can carry several). Falls back to the
  // legacy vendor_bill_amount column only for POs with no entity yet.
  const billsQ = useQuery({
    queryKey: ['po_list_bills', poIds],
    enabled: poIds.length > 0,
    queryFn: () => billedByPO(poIds),
  });

  // The bill ENTITIES on each PO (id / number / doc) — so the list can link straight to the bill.
  const billEntitiesQ = useQuery({
    queryKey: ['po_list_bill_entities', poIds],
    enabled: poIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('bills')
        .select('id, po_id, bill_no, doc_url, bill_date, created_at').in('po_id', poIds)
        .order('bill_date', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw error;
      const m: Record<string, { id: string; no: string | null; docUrl: string | null }[]> = {};
      (data ?? []).forEach((b: any) => { if (!b.po_id) return; (m[b.po_id] ??= []).push({ id: b.id, no: b.bill_no || null, docUrl: b.doc_url || null }); });
      return m;
    },
  });

  // Per-line received quantities (drives the accurate got/pending counts + tooltip).
  const grnQ = useQuery({
    queryKey: ['po_list_grn', poIds],
    enabled: poIds.length > 0,
    queryFn: async () => {
      const { data: grns, error: gErr } = await supabase.from('po_grn').select('grn_id, po_id').in('po_id', poIds);
      if (gErr) throw gErr;
      const grnIds = (grns ?? []).map((g: any) => g.grn_id);
      const byGrn: Record<string, string> = {};
      (grns ?? []).forEach((g: any) => { byGrn[g.grn_id] = g.po_id; });
      if (!grnIds.length) return {} as Record<string, number>;
      const { data: items, error: iErr } = await supabase.from('po_grn_items').select('grn_id, po_line_item_id, qty_received').in('grn_id', grnIds);
      if (iErr) throw iErr;
      const recvByLine: Record<string, number> = {};
      (items ?? []).forEach((it: any) => {
        if (!it.po_line_item_id) return;
        recvByLine[it.po_line_item_id] = (recvByLine[it.po_line_item_id] || 0) + (Number(it.qty_received) || 0);
      });
      return recvByLine;
    },
  });

  const rows: PORow[] = useMemo(() => {
    const receipt = receiptQ.data ?? {};
    const paid = paidQ.data ?? {};
    const recvByLine = grnQ.data ?? {};
    const billsByPo = billsQ.data ?? {};
    const billEntitiesByPo = billEntitiesQ.data ?? {};
    return pos.map((po: any): PORow => {
      const cancelled = po.status === 'CANCELLED';
      const value = Number(po.total_value || po.order_value) || 0;
      const billed = billsByPo[po.po_id] != null ? billsByPo[po.po_id] : (Number(po.vendor_bill_amount) || 0);
      // A quote request, read from the one thing that marks one: status 'RFQ' (added to the status
      // CHECK by 20260522000000_add_rfq_status_to_po; useProcurement reads the same). It used to be
      // guessed as "value is zero and nothing billed" — but a zero total is a rate nobody typed, not
      // an enquiry, and this screen's own New order invites exactly that ("Leave the rate empty — the
      // price is confirmed against the vendor before the order goes out"). Every such order was filed
      // under Quotes, dressed in enquiry gold, labelled "Not ordered yet", and — because Active, Open,
      // To send and On the way all exclude a quote — dropped out of the working list altogether.
      const rfq = String(po.status || '').toUpperCase() === 'RFQ';
      const pct = Number(receipt[po.po_id]?.receipt_pct ?? 0);
      const fullyReceived = pct >= 100 || !!po.received_at_site;

      // Build items — prefer real line items; fall back to the legacy items json.
      const lineItems = (po.po_line_items ?? []) as any[];
      let items: POItem[];
      if (lineItems.length) {
        items = lineItems.map((li: any) => {
          const ordered = Number(li.quantity_ordered) || 0;
          const rec = recvByLine[li.id] || 0;
          const r = fullyReceived || (ordered > 0 && rec + 1e-6 >= ordered);
          return { n: li.item_name || 'Item', q: `${li.quantity_ordered ?? ''}${li.unit ? ' ' + li.unit : ''}`.trim(), r };
        });
      } else {
        const jsonItems = (po.items ?? []) as any[];
        const n = jsonItems.length;
        const recvCount = fullyReceived ? n : Math.round((pct / 100) * n);
        items = jsonItems.map((it: any, i: number) => ({ n: it.description || 'Item', q: `${it.qty ?? ''}${it.unit ? ' ' + it.unit : ''}`.trim(), r: i < recvCount }));
      }
      return {
        id: po.po_id,
        vendor: po.stakeholders?.name || 'Vendor',
        stakeholderId: po.stakeholder_id,
        vendorContact: po.stakeholders?.contact ?? null,
        site: po.projects?.name || '',
        by: po.ordered_by || '',
        ordered: po.date_issued || po.created_at,
        createdAt: po.created_at,
        approvalStatus: (po.approval_status ?? 'APPROVED') as string,
        items,
        value, billed,
        bills: billEntitiesByPo[po.po_id] ?? [],
        paid: paid[po.po_id] || 0,
        due: po.expected_delivery || null,
        recv: po.received_at_site || receipt[po.po_id]?.last_receipt_date || null,
        sent: po.sent_to_vendor_at || null,
        cancelled, rfq,
      };
    });
  }, [pos, receiptQ.data, paidQ.data, grnQ.data, billsQ.data, billEntitiesQ.data]);

  return { rows, isLoading: posQ.isLoading };
}

export interface PendingPR {
  id: string; title: string; imageUrl: string | null; pages: number;
  site: string; supplier: string; from: string; when: string; said: string;
  items: { name: string; qty: string }[];
}
/** "today, 9:41 am" · "yesterday, 5:12 pm" · "12 Sept, 8:03 am" — the reference's own phrasing. */
function whenOf(iso: string): string {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const gap = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const head = gap === 0 ? 'today' : gap === 1 ? 'yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return head + ', ' + time;
}
/** Draft purchase requests (materials lists captured from WhatsApp, not yet promoted to a PO) — the review
 *  buffer shown as the "From WhatsApp" inbox atop the list. Rich enough for the desktop inbox cards:
 *  items, the supplier + site we resolved, who sent it and when, and the message it came with. */
export function usePendingPRs(projectId?: string) {
  return useQuery({
    queryKey: ['po_list_pending_prs', projectId ?? 'all'],
    queryFn: async (): Promise<PendingPR[]> => {
      let q = supabase.from('purchase_requests')
        .select('id, title, image_url, site_id, site_raw, vendor_id, vendor_raw, sender_name, sender_number, wa_message_id, org_id, created_at, projects(name), stakeholders(name), purchase_request_items(item_index, item_name, quantity, unit)')
        .eq('status', 'draft').is('converted_po_id', null)
        .not('sender_number', 'is', null)   // WhatsApp-sourced drafts (the ones that need a review nudge)
        .order('created_at', { ascending: false });
      if (projectId) q = q.eq('site_id', projectId);
      const { data } = await q;
      const rows = (data ?? []) as any[];
      // The message the request came with lives on the WhatsApp row it was read from — fetch them in one go.
      const wamids = rows.map((r) => r.wa_message_id).filter(Boolean);
      const saidBy: Record<string, string> = {};
      if (wamids.length) {
        const { data: re } = await supabase.from('rough_entries').select('wa_message_id, raw_text').in('wa_message_id', wamids);
        (re ?? []).forEach((x: any) => { if (x.wa_message_id && x.raw_text && !saidBy[x.wa_message_id]) saidBy[x.wa_message_id] = x.raw_text; });
      }
      return rows.map((r) => ({
        id: r.id, title: r.title || 'Materials request', imageUrl: r.image_url, pages: r.image_url ? 1 : 0,
        site: r.projects?.name || '',                       // a REAL site (site_id matched) counts as set
        supplier: r.stakeholders?.name || '',               // a REAL vendor (vendor_id matched) counts as set
        from: r.sender_name || 'WhatsApp',
        when: whenOf(r.created_at),
        said: (r.wa_message_id && saidBy[r.wa_message_id]) || '',
        items: [...(r.purchase_request_items ?? [])]
          .sort((a: any, b: any) => (a.item_index ?? 0) - (b.item_index ?? 0))
          .map((it: any) => ({ name: it.item_name || '', qty: [it.quantity ?? '', it.unit || 'Nos'].filter((x) => x !== '').join(' ').trim() })),
      }));
    },
  });
}

export interface RfqRow { rfq_id: string; created_at: string; site: string; summary: string; itemCount: number; sent: number; replied: number; best: number | null }
export function useOpenRfqs(projectId?: string) {
  return useQuery({
    queryKey: ['open_rfqs', projectId ?? 'all'],
    queryFn: async (): Promise<RfqRow[]> => {
      // NB: rfqs has no FK to projects, so we can't embed projects(name) — fetch names separately.
      let q = supabase.from('rfqs').select('rfq_id, created_at, items, status, project_id').eq('status', 'open').order('created_at', { ascending: false });
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const ids = rows.map((r) => r.rfq_id);
      const agg: Record<string, { sent: number; replied: number; best: number | null }> = {};
      if (ids.length) {
        const { data: rc } = await supabase.from('rfq_recipients').select('rfq_id, status, quoted_total').in('rfq_id', ids);
        (rc ?? []).forEach((r: any) => {
          const c = agg[r.rfq_id] ?? (agg[r.rfq_id] = { sent: 0, replied: 0, best: null });
          c.sent++;
          if (r.status === 'quoted') { c.replied++; const t = Number(r.quoted_total) || 0; if (t > 0 && (c.best == null || t < c.best)) c.best = t; }
        });
      }
      const pids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
      const nameById: Record<string, string> = {};
      if (pids.length) {
        const { data: pj } = await supabase.from('projects').select('project_id, name').in('project_id', pids);
        (pj ?? []).forEach((p: any) => { nameById[p.project_id] = p.name; });
      }
      return rows.map((r) => {
        const names = ((r.items ?? []) as any[]).map((it) => it.item_name).filter(Boolean);
        const summary = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
        return { rfq_id: r.rfq_id, created_at: r.created_at, site: nameById[r.project_id] || '', summary, itemCount: (r.items ?? []).length, sent: agg[r.rfq_id]?.sent || 0, replied: agg[r.rfq_id]?.replied || 0, best: agg[r.rfq_id]?.best ?? null };
      });
    },
  });
}

export default function POListSheet({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const { rows } = usePOListData(projectId);
  const { data: openRfqs = [] } = useOpenRfqs(projectId);
  const { data: pendingPRs = [] } = usePendingPRs(projectId);
  const [filter, setFilter] = useState<'all' | 'active' | 'fulfilled' | 'mine' | 'late' | 'open' | 'vendor' | 'done' | 'quotes' | 'approvals' | 'tosend' | 'onway' | 'live' | 'archive' | 'nobill' | 'topay' | 'atsite'>('active');
  const [sortK] = useState<'vendor' | 'site' | 'ordered' | 'delivery' | 'value' | 'balance'>('ordered');
  const [sortDir] = useState(-1);
  const [q, setQ] = useState('');
  const { openSearch } = useSearch();
  // ?party=<id> — arriving from the search's "Orders" row for one vendor. A filter, not a search:
  // it survives typing in the bar, and the chip says whose list this is.
  const [searchParams] = useSearchParams();
  const partyId = searchParams.get('party');
  // The PO whose "Send PO to vendor" link was tapped — opens the send dialog over the list.
  const isMobile = useIsMobile();
  // /purchase-orders/new is a lazily-loaded chunk, so between the tap and the form there is a
  // real wait. Inside a transition React keeps this list on screen and reports the wait through
  // isPending, so the button that was pressed is the thing that shows it is working — instead of
  // the tap seeming to do nothing and then the whole page being replaced by a skeleton.
  const [, startOpening] = useTransition();
  // Creating is reached from the nav bar's "+ PO" action (mobile) or the header button (desktop);
  // both land in the same chooser, so "Request quotes" keeps a way in.
  const openNewPO = (mode?: 'rfq') => startOpening(() => navigate(
    mode === 'rfq' ? '/purchase-orders/new?mode=rfq' : '/purchase-orders/new',
    projectId ? { state: { projectId } } : undefined,
  ));
  const [createOpen, setCreateOpen] = useState(false);
  // The nav bar's "+ PO" action lands here as ?new=1 and opens this same chooser — so the page keeps
  // one create path (new PO / request quotes) and no longer needs a FAB of its own.
  const [, setSp] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const t = setTimeout(() => { setCreateOpen(true); setSp((sp) => { const n = new URLSearchParams(sp); n.delete('new'); return n; }, { replace: true }); }, 0);
    return () => clearTimeout(t);
  }, [searchParams, setSp]);

  // A PO just made from a request lands here (from the phone PR screen) with its id in location.state —
  // highlight that row briefly and glide it into view, instead of opening the PO.
  const location = useLocation();
  const [freshPoId, setFreshPoId] = useState<string | undefined>((location.state as { freshPoId?: string } | null)?.freshPoId);
  useEffect(() => {
    if (!freshPoId) return;
    const t1 = setTimeout(() => document.querySelector(`[data-search-row="${freshPoId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 160);
    const t2 = setTimeout(() => setFreshPoId(undefined), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [freshPoId]);

  const qc = useQueryClient();
  // Pull the list down on a phone to read the orders again.
  const { wrapRef: pullRef, view: pullView } = usePullToRefresh({
    enabled: isMobile, noun: 'order', count: useLiveCount(rows.length),
    onRefresh: () => qc.refetchQueries({ type: 'active' }),
  });
  const TODAY = useMemo(() => new Date(), []);
  const balance = (p: PORow) => (p.billed || p.value) - p.paid;
  const got = (p: PORow) => p.items.filter(i => i.r).length;
  const full = (p: PORow) => !p.cancelled && !p.rfq && p.items.length > 0 && got(p) === p.items.length;
  const late = (p: PORow) => !p.cancelled && !full(p) && !!p.due && D(p.due) < TODAY;
  // full() is about GOODS only — every item at site. A purchase order is finished when the goods
  // arrived, a bill was recorded against it, and nothing is left to pay. Those are three different
  // facts and only all three together mean there is nothing more to do with it.
  const settled = (p: PORow) => !p.cancelled && full(p) && p.billed > 0 && balance(p) <= 0.5;
  const mine = (p: PORow) => !p.cancelled && !p.rfq && !full(p) && (late(p) || got(p) > 0 || (!!p.due && days(TODAY, D(p.due)) <= 0));

  const FILTERS: Record<string, (p: PORow) => boolean> = {
    all: () => true,
    // ── the three the list now shows ──
    // Active: an order still in motion — placed/sent/partly-or-fully received but not yet fully billed
    //   AND paid. Everything between a quote and a finished order. (Cancelled never reaches here.)
    active: (p) => !p.cancelled && !p.rfq && !settled(p),
    // Fulfilled: received in full, billed, and nothing left to pay — nothing more to do with it.
    fulfilled: settled,
    // Quotes: a quotation/enquiry (a PO whose status is RFQ); open RFQ entities are merged in alongside.
    quotes: (p) => p.rfq,
    mine,
    late,
    open: (p) => !p.cancelled && !p.rfq && !full(p),
    vendor: (p) => p.rfq || (!p.cancelled && !full(p) && !late(p) && got(p) === 0),
    done: full,
    // Mobile chip set (po-mobile.html): Approvals / All / To send / On the way / Received.
    approvals: (p) => p.approvalStatus === 'PENDING' && !p.cancelled,
    tosend: (p) => !p.cancelled && !p.rfq && !full(p) && !p.sent && p.approvalStatus !== 'PENDING',
    onway: (p) => !p.cancelled && !p.rfq && !full(p) && !!p.sent,
    // Everything with something still outstanding — the phone's default list.
    live: (p) => !p.cancelled && !settled(p),
    archive: settled,
    // The two the money hangs on, in the order it happens: a bill you have not been given, then
    // money you still owe against one you have.
    nobill: (p) => !p.cancelled && p.approvalStatus !== 'PENDING' && p.billed <= 0,
    topay: (p) => !p.cancelled && p.approvalStatus !== 'PENDING' && p.billed > 0 && balance(p) > 0.5,
    // Goods, once the money is not the question.
    atsite: (p) => !p.cancelled && full(p),
  };
  const KEY: Record<string, (p: PORow) => number | string> = {
    vendor: (p) => p.vendor,
    site: (p) => p.site,
    ordered: (p) => D(p.ordered).getTime(),
    delivery: (p) => (full(p) ? 2 : got(p) > 0 ? 1 : 0),
    value: (p) => p.value,
    balance: (p) => balance(p),
  };

  const list = useMemo(() => {
    let l = rows.filter(FILTERS[filter] ?? (() => false));   // 'quotes' shows no POs
    if (partyId) l = l.filter(p => p.stakeholderId === partyId);
    if (q) l = l.filter(p => (p.vendor + p.id + p.site + p.items.map(i => i.n).join(' ')).toLowerCase().includes(q));
    l = l.slice().sort((a, b) => { const x = KEY[sortK](a), y = KEY[sortK](b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    return l;
  }, [rows, filter, q, sortK, sortDir, partyId]);

  // RFQs awaiting quotes, interleaved with POs by date (only in All / Quotes).
  // Open RFQ entities show only under the Quotes chip (quotations are their own bucket now, not
  // interleaved into Active). They merge with any value-0 RFQ-style POs there.
  const rfqShown = useMemo(() => (filter === 'quotes')
    ? openRfqs.filter(r => !q || ('quote request enquiry ' + r.site + ' ' + r.summary + ' ' + r.rfq_id).toLowerCase().includes(q))
    : [], [openRfqs, filter, q]);
  type MergedRow = { kind: 'po'; po: PORow } | { kind: 'rfq'; rfq: RfqRow };
  const live = useMemo(() => rows.filter(p => !p.cancelled && !p.rfq), [rows]);
  const fOpen = live.filter(p => !full(p)).reduce((a, p) => a + p.value, 0);
  const fBal = live.reduce((a, p) => a + Math.max(0, balance(p)), 0);
  const cToSend = rows.filter(FILTERS.tosend).length;

  const openPO = useCallback((id: string) => navigate(`/purchase-orders/${id}`, { state: projectId ? { from: 'project', projectId } : { from: 'list' } }), [navigate, projectId]);

  // Lend the list to the search. `q` is stored lowercased here, so lowercase on the way in.
  useSearchScope('Purchase orders', useMemo(() => list.map(p => ({
    id: p.id, title: p.vendor, sub: `${p.id}${p.site ? ' · ' + p.site : ''}`,
    onPick: () => openPO(p.id),
  })), [list, openPO]), (v) => setQ(v.trim().toLowerCase()));
  // Plain-text delivery-date label (mobile cards, no markup).
  const dueLabelText = (p: PORow): string => {
    if (!p.due) return 'no date from vendor';
    const d = days(TODAY, D(p.due));
    if (d < 0) return `${-d} day${-d > 1 ? 's' : ''} late`;
    if (d === 0) return 'due today';
    return `vendor gave ${dstr(D(p.due))}`;
  };
  // ---- Mobile card list (po-mobile.html) ----------------------------------
  if (isMobile) {
    // What is holding this order up, read from the money backwards: a bill you have not been
    // given, then money you still owe, and only then goods still on the road. "Awaiting price"
    // is gone — it was shown for any zero-value PO, which is a rate nobody typed, not a quote.
    // The goods position is never lost: it rides along on the sub-line.
    const cardOf = (p: PORow) => {
      const n = p.items.length, g = got(p), b = balance(p);
      const goodsSub = n > 0 && g < n ? (g > 0 ? `· ${g} of ${n} at site` : `· ${dueLabelText(p)}`) : '';
      let tone: string, st: string, sub = '';
      // Not sent is no longer a status. It was the loudest thing on the card — red, and the whole
      // line — for what is a small nudge, and it pushed the bill and the payment out of the way.
      // It rides as a quiet tag beside the PO number instead, and the status says what it always
      // should have: the bill, then the money, then the goods. Red is reserved for money owed.
      if (p.cancelled) { tone = 'dim-s'; st = 'Cancelled'; }
      else if (p.approvalStatus === 'PENDING') { tone = 'gold-s'; st = 'Awaiting approval'; sub = `· ${dstr(D(p.createdAt))}${p.by ? ', ' + p.by : ''}`; }
      else if (p.billed <= 0) { tone = 'motion'; st = 'Awaiting bill'; sub = goodsSub || (full(p) ? `· all at site ${dstr(D(p.recv))}` : ''); }
      else {
        // Payment is the ONLY three states, derived from paid vs billed. Delivery rides the sub-line.
        const ps = poPayState(p.paid, p.billed);
        if (ps === 'unpaid') { tone = 'needs'; st = `Unpaid · ${fmt(b)}`; sub = goodsSub; }
        else if (ps === 'partial') { tone = 'needs'; st = `Partially paid · ${fmt(b)} pending`; sub = goodsSub; }
        else { tone = 'landed'; st = 'Paid'; sub = full(p) ? `· all at site ${dstr(D(p.recv))}` : (goodsSub || ''); }
      }
      const notSent = !p.cancelled && !p.sent && p.approvalStatus !== 'PENDING';
      // Amount: red "to pay" once there's a real bill / it's landed; plain ordered value in transit; — when nothing owed.
      let amtNode: React.ReactNode = <span className="amt zero">—</span>;
      if (b > 0.5) amtNode = <span className={`amt${p.billed || full(p) ? ' pay' : ''}`}>{fmt(b)}</span>;
      const shown = p.items.slice(0, 1).map(i => i.n).join(', ');
      const more = p.items.length - 1;
      return { tone, st, sub, amtNode, notSent, itemsText: shown + (more > 0 ? ` · +${more} item${more > 1 ? 's' : ''}` : '') };
    };
    // Chips are states again — a trade per chip made a row nobody could scan. They are ordered the
    // way the money moves: what has no bill, then what is owed, and only then the goods. Approvals
    // and Quotes lead when they exist because they are somebody waiting on you.
    const mFilter = FILTERS[filter] ? filter : 'active';
    const mChips: { k: typeof filter; label: string; n: number; tone?: 'gold' | 'terra' }[] = [
      { k: 'active', label: 'Active', n: rows.filter(FILTERS.active).length },
      { k: 'fulfilled', label: 'Fulfilled', n: rows.filter(settled).length },
      { k: 'quotes', label: 'Quotes', n: openRfqs.length + rows.filter(p => p.rfq).length, tone: 'gold' as const },
    ];
    // A quote request is not a PO — it lives in its own table and has no vendor, value or
    // delivery — so the desktop merges the two lists by date rather than joining them. The phone
    // was iterating POs alone, which is why enquiries were nowhere to be seen here.
    const mList: MergedRow[] = (() => {
      const pos = rows.filter(FILTERS[mFilter])
        .filter(p => !q || (p.vendor + p.id + p.site + p.items.map(i => i.n).join(' ')).toLowerCase().includes(q))
        .map(p => ({ kind: 'po' as const, po: p }));
      // On Quotes, the value-0 quote POs (pos, via FILTERS.quotes) merge with the open RFQ entities.
      const quotes = (mFilter === 'quotes')
        ? rfqShown
            .filter(r => !q || (r.site + r.summary).toLowerCase().includes(q))
            .map(r => ({ kind: 'rfq' as const, rfq: r }))
        : [];
      return [...pos, ...quotes].sort((a, b) =>
        D(b.kind === 'po' ? b.po.createdAt : b.rfq.created_at).getTime()
        - D(a.kind === 'po' ? a.po.createdAt : a.rfq.created_at).getTime());
    })();
    return (
      <div className="polx m" ref={pullRef}>
        {pullView}
        <style>{POLX_CSS}</style>
        <div className="m-mast">
          <div className="r1">
            <h1>Purchase orders</h1>
            <span className="count">{rows.length}</span>
            <button className="ico" onClick={openSearch} aria-label="Search">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </button>
          </div>
          <div className="m-money">
            <PartyFilterChip what="Orders" />
            <b>{fmt(fBal)}</b> open with vendors · <b>{fmt(fOpen)}</b> on the way
            {cToSend > 0 && (
              <button type="button" className={`m-wf${mFilter === 'tosend' ? ' on' : ''}`}
                onClick={() => setFilter(mFilter === 'tosend' ? 'active' : 'tosend')}>{cToSend} to send</button>
            )}
          </div>
        </div>

        <div className="m-chips">
          {mChips.map(c => (
            <button key={c.k} className={`m-chip${c.tone ? ' ' + c.tone : ''}${mFilter === c.k ? ' on' : ''}`}
              onClick={() => setFilter(mFilter === c.k && c.k !== 'active' ? 'active' : c.k)}>
              {c.label}<em>{c.n}</em>
            </button>
          ))}
        </div>

        {pendingPRs.length > 0 && (
          <div className="wadrafts m">
            <div className="wd-h"><WhatsAppGlyph size={12} color="#1FA855" /> From WhatsApp <em>{pendingPRs.length}</em></div>
            {pendingPRs.map((pr) => (
              <button key={pr.id} type="button" className="wd-row" onClick={() => navigate(`/purchase-orders/pr/${pr.id}`)}>
                {pr.imageUrl ? <img className="wd-thumb" src={pr.imageUrl} alt="" /> : <span className="wd-thumb ph" aria-hidden="true">🧾</span>}
                <span className="wd-t"><b>{pr.title || 'Materials request'}</b><small>{[pr.items.length ? `${pr.items.length} item${pr.items.length !== 1 ? 's' : ''}` : '', pr.site].filter(Boolean).join(' · ') || 'draft'}</small></span>
                <span className="wd-go">›</span>
              </button>
            ))}
          </div>
        )}

        <div className="m-list mo-stagger">
          {mList.length === 0 ? (
            <div className="m-empty">{q ? 'No orders match your search.' : filter === 'approvals' ? 'Nothing waiting on you.' : 'Nothing here yet.'}</div>
          ) : mList.map(row => {
            if (row.kind === 'rfq') {
              const r = row.rfq;
              const ref = 'ENQ-' + r.rfq_id.slice(0, 6).toUpperCase();
              return (
                <button key={'rfq-' + r.rfq_id} className="m-pcard m-quote" onClick={() => navigate(`/rfq/${r.rfq_id}`)}>
                  <div className="r1"><span className="v">{r.sent} vendor{r.sent !== 1 ? 's' : ''} asked</span><span className="amt zero">—</span></div>
                  <div className="r2"><span className="po">{ref}</span><span>·</span><span className="st-site">{r.site}</span></div>
                  {(r.summary || r.itemCount > 0) && <div className="items">{r.summary || `${r.itemCount} items`}</div>}
                  <div className="r3">
                    <span className="m-dot" />
                    <span className="m-st">{r.replied > 0 ? `${r.replied} of ${r.sent} quoted` : 'Awaiting quotes'}</span>
                    <span className="sub">{r.replied > 0 ? (r.best != null ? `· best ${fmt(r.best)}` : '· tap to compare') : `· ${dstr(D(r.created_at))}`}</span>
                    <svg className="chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
                  </div>
                </button>
              );
            }
            const p = row.po;
            const c = cardOf(p);
            return (
              <button key={p.id} data-search-row={p.id} className={`m-pcard ${c.tone}${p.id === freshPoId ? ' pofresh' : ''}`} onClick={() => openPO(p.id)}>
                <div className="r1"><span className="v">{p.vendor}</span>{c.amtNode}</div>
                <div className="r2">
                  <span className="po">{p.id}</span>
                  {c.notSent && <span className="m-unsent">not sent</span>}
                  <span>·</span><span className="st-site">{p.site}</span>
                </div>
                {c.itemsText && <div className="items">{c.itemsText}</div>}
                <div className="r3">
                  <span className="m-dot" /><span className="m-st">{c.st}</span>
                  {c.sub && <span className="sub">{c.sub}</span>}
                  <svg className="chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
                </div>
              </button>
            );
          })}
        </div>

        <div className={`m-cscrim${createOpen ? ' show' : ''}`} onClick={() => setCreateOpen(false)} />
        <DragSheet open={createOpen} onDismiss={() => setCreateOpen(false)}
          className={`m-csheet${createOpen ? ' show' : ''}`} role="dialog" aria-label="Create">
          <div className="grab" />
          <button type="button" onClick={() => { setCreateOpen(false); openNewPO(); }}>
            <b>New purchase order</b>
            <small>You know the vendor and the price</small>
          </button>
          <button type="button" onClick={() => { setCreateOpen(false); openNewPO('rfq'); }}>
            <b>Request quotes</b>
            <small>Ask vendors what they would charge</small>
          </button>
        </DragSheet>
      </div>
    );
  }

  return <POListDesktop projectId={projectId} />;
}
