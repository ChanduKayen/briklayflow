// Bills — vendor-bill register (list + detail), a port of bills-module-mock.html scoped under .blx.
// Frontend-first over existing data (see billsApi). /bills is the list; /bills/:billId the detail.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadBills, loadBillDetail, deleteBill, extractBill, type BillRow, type BillStatus, type ExtractedBill } from '../lib/billsApi';
import { DocThumb } from '../components/DocThumb';
import { ImageLightbox } from '../components/ImageLightbox';
import { openDoc, resolveDocUrl } from '../lib/storage';
import { useSnackbar } from '../components/Snackbar';
import { type BillDraft } from '../components/bills/NewBillModal';
import { useSearchScope } from '../components/search/searchScope';
import { useCursorLamp } from '../components/nav/useCursorLamp';
import BillsMobile from '../components/bills/BillsMobile';
import { useMintBill } from '../components/bills/useMintBill';
import { useIsMobile } from '../lib/useIsMobile';
import { supabase } from '../lib/supabase';
import { useOrgId } from '../lib/auth/AuthProvider';
import { createParty } from '../components/day-book/fileEntry';

const BLX_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
.blx{
  --espresso:#171008;--cream:#F7F3EA;--paper:#FFFDF9;--card:#FFFDF9;
  --walnut:#1B1813;--walnut-60:#5A544A;--walnut-soft:#948C7C;
  --line:#E9E1D1;--rule-soft:#F1EADC;--line-strong:#DCD2BE;
  --terracotta:#B4552E;--terra-lo:#C4633B;--terra-hi:#8B3F1E;--terra-wash:#FAEFE7;
  --on-dark:#F5EFE4;--on-dark-2:#B7AA97;--on-dark-3:#7C7062;
  --sage:#6E7F5E;--sage-tint:#EEF1E8;--terra-tint:#F6E8E0;--amber-tint:#F3ECD9;
  --serif:'Newsreader',Georgia,serif;--sans:'Instrument Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;
  --page:#FBF9F6;
  background:var(--page);color:var(--walnut);font-family:var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh}
.blx *{box-sizing:border-box}
/* ===== bills header — bills-header-v5.html, scoped under .bh so its generic class names
   (.seg .chip .btn .amt) can't collide with the register's body classes ===== */
.blx .bh .hwrap{max-width:1180px;margin:0 auto;padding:0 40px}
/* the whole hero is a FIXED height; its inner wrap is a flex column and the stage flex-fills, so the
   header never resizes as the title row (the sub only shows at rest) or the stage content changes. */
.blx .bh .hero{position:relative;overflow:hidden;background:var(--espresso);color:var(--on-dark);padding:38px 0 34px;height:352px;--mx:50%;--my:50%}
.blx .bh .hero>*{position:relative;z-index:1}
.blx .bh .hero .hwrap{display:flex;flex-direction:column;height:100%}
/* the transactions page's cursor lamp — a warm glow + revealed grid that follow the pointer on the dark band */
.blx .bh .hero .fx{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity .45s ease}
.blx .bh .hero.lit .fx{opacity:1}
.blx .bh .hero .fx.glow{background:radial-gradient(220px circle at var(--mx) var(--my),rgba(196,99,59,.15),rgba(196,99,59,.05) 55%,transparent 75%),radial-gradient(360px circle at var(--mx) var(--my),rgba(245,239,228,.05),transparent 74%)}
.blx .bh .hero .fx.grid{background:repeating-linear-gradient(0deg,rgba(255,220,180,.055) 0 1px,transparent 1px 26px),repeating-linear-gradient(90deg,rgba(255,220,180,.055) 0 1px,transparent 1px 26px);-webkit-mask-image:radial-gradient(200px circle at var(--mx) var(--my),#000 0%,rgba(0,0,0,.55) 55%,transparent 82%);mask-image:radial-gradient(200px circle at var(--mx) var(--my),#000 0%,rgba(0,0,0,.55) 55%,transparent 82%)}
.blx .bh .hero .hwrap{z-index:1}
/* Add-bill button — exactly the transactions page's "New transaction" pill, keeping the upload states */
.blx .bh .tb-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border-radius:9px;font-family:inherit;font-weight:500;font-size:13.5px;line-height:1;white-space:nowrap;color:rgba(245,240,231,.72);background:rgba(245,240,231,.07);box-shadow:inset 0 0 0 1px rgba(245,240,231,.14);border:0;cursor:pointer;transition:background .15s,color .15s}
.blx .bh .tb-btn svg{flex-shrink:0;width:15px;height:15px}
.blx .bh .tb-btn:hover{color:#F5F0E7;background:rgba(245,240,231,.11)}
/* Add bill is the page's primary act — a longer, weightier pill that earns its place */
.blx .bh .tb-btn.primary{height:44px;min-width:156px;padding:0 26px;gap:10px;font-size:15px;font-weight:600;border-radius:11px;background:#B4532F;color:#fff;box-shadow:0 2px 0 #8B3F1E,0 10px 22px -10px rgba(150,68,32,.85)}
.blx .bh .tb-btn.primary svg{width:17px;height:17px}
.blx .bh .tb-btn.primary:hover{background:#9C4526;transform:translateY(-1px);box-shadow:0 2px 0 #8B3F1E,0 14px 28px -10px rgba(150,68,32,.9)}
.blx .bh .tb-btn.primary:active{transform:translateY(1px);box-shadow:0 1px 0 #8B3F1E}
.blx .bh .tb-btn.primary.busy{cursor:progress}
.blx .bh .tb-btn.primary.done{background:#5F7F5B}
/* in-header bill capture — catch zone + reading/confirm surface (briklay-bill-capture-v5.html) */
/* the stage is a FIXED height so the header never resizes as the content morphs between states */
.blx .bh .hero-stage{position:relative;flex:1;min-height:0;margin-top:10px;display:flex;flex-direction:column;justify-content:center}
/* the animated "Uploading…" title dots — a synced wave while the extractor reads */
.blx .bh h1 .dots{display:inline-flex;gap:5px;margin-left:9px;vertical-align:middle}
.blx .bh h1 .dots i{width:6px;height:6px;border-radius:50%;background:currentColor;display:block;animation:bh-jump 1s ease-in-out infinite}
.blx .bh h1 .dots i:nth-child(2){animation-delay:.16s}
.blx .bh h1 .dots i:nth-child(3){animation-delay:.32s}
@keyframes bh-jump{0%,62%,100%{transform:translateY(0);opacity:.45}31%{transform:translateY(-7px);opacity:1}}
@keyframes bh-morphin{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.blx .bh .catch,.blx .bh .read{animation:bh-morphin .34s cubic-bezier(.2,.8,.3,1)}
.blx .bh .catch{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(245,239,228,.035);border-radius:16px}
.blx .bh .catch .rule{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.blx .bh .catch .rule rect{fill:none;stroke:rgba(196,99,59,.75);stroke-width:1.4;stroke-dasharray:5 8;stroke-linecap:round;animation:bh-march 26s linear infinite}
@keyframes bh-march{to{stroke-dashoffset:-260}}
.blx .bh .catch .c-arrow{font-size:22px;color:var(--terra-lo);animation:bh-drift 2.6s ease-in-out infinite}
@keyframes bh-drift{0%,100%{transform:translateY(0);opacity:.85}50%{transform:translateY(-3px);opacity:1}}
.blx .bh .catch .c-big{font-family:var(--serif);font-size:23px;color:var(--on-dark)}
.blx .bh .catch .c-up{font:inherit;font-size:23px;background:none;border:0;color:var(--terra-lo);cursor:pointer;text-decoration:underline;text-underline-offset:4px}
.blx .bh .catch .c-up:hover{color:#E8875A}
.blx .bh .catch .c-sm{font-size:13.5px;color:rgba(245,239,228,.55)}
.blx .bh .catch .c-alt{margin-top:8px}
.blx .bh .catch .c-alt button{background:none;border:0;color:rgba(245,239,228,.55);font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.blx .bh .catch .c-alt button:hover{color:var(--on-dark)}
.blx .bh .read{position:relative}
.blx .bh .read .filed{position:absolute;right:0;top:-6px;font-size:13px;color:#A7C08F}
.blx .bh .doc-row{display:flex;gap:22px;align-items:flex-start;margin-top:4px}
.blx .bh .doc-thumb{width:82px;height:106px;border-radius:8px;background:#FCF9F2;flex-shrink:0;position:relative;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.blx .bh .doc-thumb .lines{position:absolute;inset:14px 12px;display:flex;flex-direction:column;gap:7px}
.blx .bh .doc-thumb .lines i{display:block;height:5px;border-radius:3px;background:#E7DECB}
.blx .bh .doc-thumb .lines i:nth-child(1){width:60%}.blx .bh .doc-thumb .lines i:nth-child(3){width:80%}.blx .bh .doc-thumb .lines i:nth-child(5){width:45%;background:#E8C9B4}
.blx .bh .doc-thumb .scanline{position:absolute;left:0;right:0;height:26px;top:-30px;background:linear-gradient(to bottom,rgba(196,99,59,0),rgba(196,99,59,.3),rgba(196,99,59,0));animation:bh-scan 1.5s infinite ease-in-out}
@keyframes bh-scan{0%{top:-30px}55%{top:104px}100%{top:104px}}
.blx .bh .doc-name{margin-top:8px;font-size:11.5px;color:rgba(245,239,228,.45);max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blx .bh .read-main{flex:1;min-width:0}
.blx .bh .read-status{font-size:14px;color:rgba(245,239,228,.6);margin-bottom:15px;display:flex;align-items:center;gap:10px;min-height:20px}
.blx .bh .read-status .pulse{width:7px;height:7px;border-radius:50%;background:var(--terra-lo);animation:bh-pulse 1.4s infinite;flex-shrink:0}
@keyframes bh-pulse{0%,100%{opacity:1}50%{opacity:.25}}
.blx .bh .read-status.ok{color:#B5C79E}
.blx .bh .read-status.ok .pulse{animation:none;background:#8FA576}
.blx .bh .fields{display:grid;grid-template-columns:1.5fr 1fr .9fr 1fr;gap:20px 34px;max-width:840px}
.blx .bh .vfield{position:relative}
.blx .bh .vmenu2{position:absolute;top:calc(100% + 5px);left:0;min-width:250px;max-width:340px;z-index:20;background:#FCF9F2;border:1px solid #E5DCCC;border-radius:9px;overflow:hidden;box-shadow:0 18px 44px -14px rgba(0,0,0,.5);max-height:216px;overflow-y:auto}
.blx .bh .vmenu2 button{display:block;width:100%;text-align:left;padding:9px 13px;background:none;border:0;font:inherit;font-size:14px;color:#2B2118;cursor:pointer}
.blx .bh .vmenu2 button:hover{background:#F1E9DB}
.blx .bh .vmenu2 .vadd{color:var(--terracotta);font-weight:600;border-top:1px solid #EFE7D8}
.blx .bh .field label{display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:rgba(245,239,228,.42);margin-bottom:5px;font-weight:600}
.blx .bh .field .tick{color:#8FA576;font-size:12px}
.blx .bh .field input{width:100%;background:transparent;border:0;outline:none;border-bottom:1px solid rgba(245,239,228,.22);color:var(--on-dark);font:inherit;font-size:17px;padding:4px 0 7px;transition:border-color .15s}
.blx .bh .field input:focus{border-color:var(--terra-lo)}
.blx .bh .field.amount input{font-family:var(--mono);font-size:22px;color:#F0C9AE}
.blx .bh .field.weak input{border-bottom:1.5px dashed var(--terra-lo)}
.blx .bh .field.weak label{color:var(--terra-lo)}
.blx .bh .field .why{font-size:11.5px;color:rgba(196,99,59,.9);margin-top:5px}
.blx .bh .field.site{grid-column:1/-1}
.blx .bh .site-chips{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.blx .bh .site-chips::-webkit-scrollbar{display:none}
.blx .bh .site-chips button{flex:none}
.blx .bh .site-chips button{background:rgba(245,239,228,.07);border:1px solid rgba(245,239,228,.22);color:rgba(245,239,228,.75);border-radius:99px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer;transition:all .15s}
.blx .bh .site-chips button:hover{background:rgba(245,239,228,.14)}
.blx .bh .site-chips button.on{background:rgba(196,99,59,.2);border-color:rgba(196,99,59,.7);color:var(--on-dark);font-weight:500}
.blx .bh .confirm-foot{display:flex;justify-content:space-between;align-items:center;margin-top:20px;max-width:820px;gap:16px}
.blx .bh .ledger-line{font-size:13.5px;color:rgba(245,239,228,.55);max-width:440px}
.blx .bh .ledger-line b{color:rgba(245,239,228,.9);font-weight:500;font-family:var(--mono)}
.blx .bh .confirm-actions{display:flex;gap:10px;flex:none}
.blx .bh .btn-back{background:none;border:1px solid rgba(245,239,228,.3);color:rgba(245,239,228,.75);border-radius:9px;padding:9px 16px;font:inherit;font-size:14px;cursor:pointer}
.blx .bh .btn-back:hover{border-color:rgba(245,239,228,.6);color:var(--on-dark)}
.blx .bh .btn-file{background:var(--terra);border:0;color:#fff;border-radius:9px;padding:9px 18px;font:inherit;font-size:14px;font-weight:600;opacity:.45;cursor:pointer;transition:all .18s}
.blx .bh .btn-file.ready{opacity:1}
.blx .bh .btn-file.ready:hover{background:#C2521F}
.blx .bh .btn-file:disabled{cursor:default}
@media(max-width:760px){.blx .bh .fields{grid-template-columns:1fr 1fr}}
.blx .bh .hero-top{display:flex;align-items:flex-start;justify-content:space-between;gap:40px;min-height:66px}
.blx .bh .hero h1{font-family:var(--serif);font-weight:400;font-size:40px;letter-spacing:-.02em;line-height:1;color:var(--on-dark);margin:0}
.blx .bh .hero .sub{font-size:14.5px;color:var(--on-dark-2);margin-top:10px;max-width:46ch;line-height:1.5}
.blx .bh .actions{display:flex;align-items:center;gap:10px;justify-content:flex-end}
.blx .bh .hint{font-size:12px;color:var(--on-dark-3);margin-top:9px;display:flex;align-items:center;gap:6px;justify-content:flex-end}
.blx .bh .hint svg{width:11px;height:11px}
.blx .bh .figure{margin-top:34px;display:flex;align-items:flex-end;justify-content:space-between;gap:60px;flex-wrap:wrap}
.blx .bh .amount{font-family:var(--mono);font-size:44px;line-height:1;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--on-dark)}
.blx .bh .amount .cap{font-family:var(--sans);font-size:15px;color:var(--on-dark-2);margin-left:12px}
.blx .bh .under{font-size:13.5px;color:var(--on-dark-2);margin-top:12px;min-height:20px}
.blx .bh .under b{color:var(--on-dark);font-weight:400;font-family:var(--mono);font-size:13px}
.blx .bh .sites{flex:1;min-width:420px;max-width:660px}
.blx .bh .sites .cap-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.blx .bh .sites .cap-row .t{font-size:12.5px;color:var(--on-dark-2)}
.blx .bh .sites .cap-row .r{font-size:11.5px;color:var(--on-dark-3)}
.blx .bh .sbar{display:flex;height:11px;border-radius:2px;overflow:hidden;gap:2px}
.blx .bh .sbar .seg{cursor:pointer;transition:opacity .18s,transform .18s;transform-origin:bottom;border:0;padding:0}
.blx .bh .sbar .seg:hover{transform:scaleY(1.45)}
.blx .bh .sites.dim .sbar .seg:not(.hot){opacity:.32}
.blx .bh .c1{background:#C4633B}.blx .bh .c2{background:#96613C}.blx .bh .c3{background:#6B523A}.blx .bh .c4{background:#453A2C}
.blx .bh .legend{display:flex;gap:26px;margin-top:16px;flex-wrap:wrap}
.blx .bh .li{background:none;border:none;padding:0;text-align:left;cursor:pointer;font:inherit;display:block;transition:opacity .18s}
.blx .bh .sites.dim .li:not(.hot){opacity:.4}
.blx .bh .li .amt{font-family:var(--mono);font-size:14px;color:var(--on-dark);font-variant-numeric:tabular-nums}
.blx .bh .li .nm{font-size:11.5px;color:var(--on-dark-3);margin-top:4px;display:flex;align-items:center;gap:6px}
.blx .bh .li .nm i{width:7px;height:7px;border-radius:1px;display:block;flex:none}
.blx .bh .li .ct{font-size:11px;color:var(--on-dark-3);opacity:.75;margin-top:2px;padding-left:13px}
.blx .bh .li:hover .nm{color:var(--on-dark-2)}
.blx .bh .controls{background:var(--page);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.blx .bh .bar{display:flex;align-items:center;gap:18px;padding:15px 0;flex-wrap:wrap}
.blx .bh .rightgrp{margin-left:auto;display:flex;align-items:center;gap:14px}
.blx .bh .search{flex:1;min-width:220px;max-width:420px;display:flex;align-items:center;gap:11px;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:10px 14px;transition:border-color .15s,box-shadow .15s}
.blx .bh .search:focus-within{border-color:var(--terracotta);box-shadow:0 0 0 3px rgba(180,85,46,.12)}
.blx .bh .search svg{color:var(--walnut-soft);flex:none}
.blx .bh .search input{flex:1;font:inherit;font-size:14.5px;border:none;outline:none;background:none;color:var(--walnut)}
.blx .bh .search input::placeholder{color:var(--walnut-soft)}
.blx .bh .kbd{font-family:var(--mono);font-size:11px;color:var(--walnut-soft);border:1px solid var(--line);border-radius:4px;padding:2px 6px}
.blx .bh .search .clear{background:none;border:none;color:var(--walnut-soft);cursor:pointer;padding:2px;line-height:0;display:flex}
.blx .bh .cnt{font-size:13.5px;color:var(--walnut-soft);font-variant-numeric:tabular-nums;white-space:nowrap}
.blx .bh .cnt b{color:var(--walnut);font-weight:500}
.blx .bh .find .right{margin-left:auto;display:flex;align-items:center;gap:10px}
.blx .bh .narrow{display:flex;align-items:center;padding:14px 0 16px;flex-wrap:wrap}
.blx .bh .grp{display:flex;align-items:center;gap:9px}
.blx .bh .grp-label{font-size:12.5px;color:var(--walnut-soft)}
.blx .bh .seg{display:flex;background:#EFE8DA;border-radius:8px;padding:3px;gap:2px}
.blx .bh .seg button{font:inherit;font-size:13.5px;color:var(--walnut-60);background:none;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:all .15s;text-transform:capitalize}
.blx .bh .seg button:hover{color:var(--walnut)}
.blx .bh .seg button.on{background:var(--card);color:var(--walnut);font-weight:500;box-shadow:0 1px 2px rgba(80,60,30,.14),inset 0 1px 0 #fff}
.blx .bh .chip{margin-left:18px;font:inherit;font-size:13.5px;color:var(--terracotta);background:var(--terra-wash);border:1px solid rgba(180,85,46,.35);border-radius:99px;padding:7px 12px 7px 14px;display:inline-flex;align-items:center;gap:9px;cursor:pointer;transition:background .15s,border-color .15s}
.blx .bh .chip:hover{background:#F6E3D7;border-color:var(--terracotta)}
.blx .bh .scope{margin-left:auto;display:inline-flex;align-items:center;gap:10px}
.blx .bh .scope button{font:inherit;font-size:12.5px;background:none;border:0;color:var(--walnut-soft);cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line-strong)}
.blx .bh .scope button:hover{color:var(--terracotta);text-decoration-color:var(--terracotta)}
.blx .bh .scope button.on{color:var(--walnut);text-decoration:none;font-weight:500;cursor:default}
.blx .bh .scope .sep{color:var(--line-strong)}
.blx .bh .btn{font:inherit;font-size:14px;font-weight:500;border:none;border-radius:8px;padding:10px 18px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .08s,box-shadow .12s,background .15s}
.blx .bh .btn svg{flex:none}
.blx .bh .btn-primary{color:#fff;background:linear-gradient(180deg,var(--terra-lo),var(--terracotta));box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 2px 0 var(--terra-hi),0 8px 18px -8px rgba(150,68,32,.8)}
.blx .bh .btn-primary:hover{background:linear-gradient(180deg,#CE6C44,#BB5B33)}
.blx .bh .btn-primary:active{transform:translateY(2px)}
.blx .bh .btn-primary.busy{cursor:progress}
.blx .bh .btn-primary.done{background:linear-gradient(180deg,#7f9068,var(--sage))}
.blx .bh .btn-onDark{color:var(--on-dark);background:rgba(245,239,228,.07);box-shadow:inset 0 0 0 1px rgba(245,239,228,.16)}
.blx .bh .btn-onDark:hover{background:rgba(245,239,228,.12)}
.blx .bh .btn-ghost{color:var(--walnut-60);background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.blx .bh .btn-ghost:hover{color:var(--walnut);box-shadow:inset 0 0 0 1px var(--line-strong)}
.blx .bh .adderr{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;color:#E9C4A6;margin-top:9px;justify-content:flex-end}
.blx .bh .adderr button{background:none;border:none;color:#E9C4A6;text-decoration:underline;cursor:pointer;font-size:.76rem;padding:0}
@media (max-width:1080px){.blx .bh .hwrap{padding:0 20px}.blx .bh .sites{min-width:100%}.blx .bh .narrow{gap:12px}}
.blx .shell{max-width:1180px;margin:0 auto;padding:26px 40px 96px}
.blx .mono{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.blx .pagehead{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:8px;gap:20px;flex-wrap:wrap}
.blx .pagehead h1{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:2rem;letter-spacing:-.01em;margin:0}
.blx .pagehead .lede{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
.blx .headwrap{display:flex;align-items:flex-end;gap:28px}
.blx .headfigure{text-align:right}
.blx .headfigure .num{font-family:'IBM Plex Mono',monospace;font-size:1.3rem;font-weight:500}
.blx .headfigure .cap{font-size:.78rem;color:var(--walnut-60);margin-top:2px}
.blx .addwrap{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.blx .btn-add{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-width:158px;background:var(--terracotta);color:#fff;border:none;border-radius:12px;font-family:inherit;font-size:.95rem;font-weight:600;letter-spacing:.004em;padding:13px 22px;cursor:pointer;box-shadow:0 7px 20px -9px rgba(184,92,56,.75);transition:transform .18s cubic-bezier(.2,.85,.3,1),box-shadow .18s,background .18s}
.blx .btn-add:hover{background:#a44f2f;transform:translateY(-2px);box-shadow:0 14px 30px -10px rgba(184,92,56,.8)}
.blx .btn-add:active{transform:translateY(0) scale(.985);box-shadow:0 4px 12px -8px rgba(184,92,56,.7)}
.blx .btn-add:focus-visible{outline:2px solid var(--terracotta);outline-offset:3px}
.blx .btn-add svg{width:18px;height:18px;flex-shrink:0}
.blx .btn-add.busy{background:#a44f2f;cursor:progress}
.blx .btn-add.busy:hover{transform:none;box-shadow:0 7px 20px -9px rgba(184,92,56,.75)}
.blx .btn-add.done{background:var(--sage);box-shadow:0 7px 20px -9px rgba(110,127,94,.75)}
.blx .btn-add.done:hover{background:#5f6f50}
.blx .aspin{width:15px;height:15px;border:2px solid rgba(255,255,255,.38);border-top-color:#fff;border-radius:50%;animation:qspin .7s linear infinite}
.blx .addhint{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;color:var(--walnut-soft);user-select:none;transition:color .15s}
.blx .addwrap:hover .addhint{color:var(--walnut-60)}
.blx .addhint svg{width:13px;height:13px;opacity:.75;animation:hintbob 2.4s ease-in-out infinite}
@keyframes hintbob{0%,100%{transform:translateY(0);opacity:.55}50%{transform:translateY(2px);opacity:.9}}
.blx .adderr{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;color:var(--terracotta)}
.blx .adderr button{background:none;border:none;color:var(--terracotta);text-decoration:underline;text-underline-offset:2px;cursor:pointer;font-size:.76rem;padding:0}
.blx .filters{display:flex;gap:10px;align-items:center;margin:26px 0 14px;flex-wrap:wrap}
.blx .filters select{appearance:none;background:var(--paper);border:1px solid var(--line-strong);border-radius:6px;padding:7px 30px 7px 12px;font-family:inherit;font-size:.82rem;color:var(--walnut);cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg width='9' height='6' viewBox='0 0 9 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l3.5 3.5L8 1' stroke='%237A6E61' stroke-width='1.4' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center}
.blx .filters .count{margin-left:auto;font-size:.8rem;color:var(--walnut-60)}
/* segmented controls (grouping · scope) — the ledger's grammar, in the bill register's palette */
.blx .seg{display:inline-flex;background:var(--paper);border:1px solid var(--line-strong);border-radius:8px;padding:2px}
.blx .seg button{appearance:none;background:none;border:0;border-radius:6px;padding:6px 13px;font-family:inherit;font-size:.8rem;font-weight:500;color:var(--walnut-60);cursor:pointer;transition:background .14s,color .14s}
.blx .seg button.on{background:var(--terracotta);color:#fff}
.blx .seg button:not(.on):hover{color:var(--walnut)}
.blx .seglbl{font-size:.72rem;color:var(--walnut-soft);text-transform:uppercase;letter-spacing:.06em}
/* grouped sections — a header + subtotal per date / site / vendor, like the ledger's day cards */
.blx tr.secrow td{padding:0;border:0}
.blx .sechead{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:13px 16px 9px;background:#FAF6EE;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.blx tr.secrow:first-child .sechead{border-top:0}
.blx .sechead .sh-t{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:1.02rem;color:var(--walnut)}
.blx .sechead .sh-t .wk{font-family:'Instrument Sans',sans-serif;font-size:.76rem;color:var(--walnut-soft);margin-left:8px}
.blx .sechead .sh-sub{font-family:'IBM Plex Mono',monospace;font-size:.78rem;color:var(--walnut-60);white-space:nowrap}
.blx .sechead .sh-sub b{color:var(--terracotta);font-weight:500}
.blx .sechead .sh-sub .settled{color:var(--sage)}
/* the transactions-page grammar: each group is a CARD, its label above it, a "closed" subtotal foot */
.blx .billstack{display:flex;flex-direction:column;gap:22px}
.blx .billday .dhead{padding:0 4px 9px;font-family:'Newsreader',Georgia,serif;font-size:1.05rem;color:var(--walnut)}
.blx .billday .dhead .wd{font-family:'Instrument Sans',sans-serif;font-size:.82rem;color:var(--walnut-soft);margin-left:8px}
.blx .daycard{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.blx .brow{display:grid;grid-template-columns:42px minmax(0,1fr) auto minmax(120px,auto);gap:16px;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .13s}
.blx .brow:hover{background:#FBF7EF}
.blx .bmain{min-width:0;display:flex;flex-direction:column;gap:3px}
.blx .bmain .bv{font-weight:500;font-size:.92rem;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--walnut)}
.blx .bmain .bctx{font-size:.8rem;line-height:1.3;color:var(--walnut-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* document thumbnail in place of the initials bubble: an image thumb (hover to preview), a PDF glyph, or a paper icon */
.blx .bthumb{width:42px;height:42px;border-radius:8px;flex:none;display:grid;place-items:center;overflow:hidden;border:1px solid var(--line);background:var(--cream);position:relative}
.blx .bthumb img{width:100%;height:100%;object-fit:cover;display:block}
.blx .bthumb .ph{width:100%;height:100%;background:linear-gradient(135deg,#F3EDE1,#EAE2D2)}
.blx .bthumb.img{cursor:zoom-in}
.blx .bthumb.pdf{background:none;border:0;overflow:visible}
.blx .bthumb.pdf svg{width:100%;height:100%;display:block}
.blx .bthumb.none svg{width:19px;height:19px;color:var(--walnut-soft)}
.blx .bpreview{position:fixed;z-index:90;width:240px;max-height:320px;padding:5px;background:var(--card);border:1px solid var(--line-strong);border-radius:11px;box-shadow:0 20px 46px -18px rgba(43,29,19,.5);pointer-events:none}
.blx .bpreview img{width:100%;height:auto;max-height:310px;object-fit:contain;border-radius:7px;display:block}
.blx .bref{justify-self:start}
.blx .bamt{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.blx .bamt .amt{font-family:'IBM Plex Mono',monospace;font-size:.92rem}
/* the bookkeeper rules off the group — the transactions page's "Day closed" line + its double-rule bar */
.blx .dfoot{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:12px 18px;background:none}
.blx .dfoot .closed{font-family:'Newsreader',Georgia,serif;font-style:italic;font-size:.96rem;color:#3D3830}
.blx .dfoot .dclose{text-align:right}
.blx .dfoot .dtot{font-family:'Newsreader',Georgia,serif;font-size:.92rem;color:#3D3830;font-variant-numeric:tabular-nums;white-space:nowrap}
.blx .dfoot .dtot b{color:#8F3318;font-weight:400}
.blx .dfoot .dtot .settled{color:#2F5D34}
.blx .dfoot .drule{margin-top:6px;margin-left:auto;width:148px;height:4px;border-top:1px solid #3D3830;border-bottom:1px solid #3D3830}
.blx .billempty{padding:56px 20px;text-align:center;color:var(--walnut-60);font-size:.9rem;background:var(--paper);border:1px solid var(--line);border-radius:14px}
.blx .ledger{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.blx table{width:100%;border-collapse:collapse}
.blx thead th{text-align:left;font-size:.75rem;font-weight:500;color:var(--walnut-60);padding:12px 16px;border-bottom:1px solid var(--line);background:#FAF6EE}
.blx thead th.r,.blx td.r{text-align:right}
.blx tbody td{padding:14px 16px;font-size:.88rem;border-bottom:1px solid var(--line);vertical-align:middle}
.blx tbody tr:last-child td{border-bottom:none}
.blx tbody tr.clk{cursor:pointer}
.blx tbody tr.clk:hover{background:#FBF7EF}
.blx .vendor{font-weight:500}
.blx .billno{font-family:'IBM Plex Mono',monospace;font-size:.8rem}
.blx .billdate{color:var(--walnut-60);font-size:.8rem;margin-top:2px}
.blx .site{color:var(--walnut-60);font-size:.83rem}
.blx .amt{font-family:'IBM Plex Mono',monospace;font-size:.88rem}
.blx .chip{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:.72rem;border:1px solid var(--line-strong);border-radius:5px;padding:3px 8px;background:var(--cream);color:var(--walnut);white-space:nowrap}
.blx .chip.consol{background:var(--amber-tint);border-color:#E0D3AC}
.blx .noref{color:var(--walnut-soft);font-size:.85rem}
.blx .status{font-size:.8rem;font-weight:500}
.blx .status.settled{color:var(--sage)}
.blx .status.part{color:var(--walnut-60)}
.blx .status.unpaid{color:var(--terracotta)}
.blx .status .sub{display:block;font-weight:400;font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:var(--walnut-soft);margin-top:2px}
.blx .empty{padding:56px 20px;text-align:center;color:var(--walnut-60);font-size:.9rem}
/* detail */
.blx .backline{display:inline-flex;align-items:center;gap:8px;font-size:.83rem;color:var(--walnut-60);text-decoration:none;margin-bottom:22px;background:none;border:none;padding:0;cursor:pointer}
.blx .backline:hover{color:var(--walnut)}
.blx .dethead{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:26px;gap:20px;flex-wrap:wrap}
.blx .dethead h1{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:1.7rem;margin:0}
.blx .dethead .meta{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
.blx .dethead .meta .m{font-family:'IBM Plex Mono',monospace;font-size:.8rem;color:var(--walnut)}
.blx .detamount{text-align:right}
.blx .detamount .num{font-family:'IBM Plex Mono',monospace;font-size:1.6rem;font-weight:500}
.blx .detamount .state{font-size:.82rem;margin-top:4px}
.blx .delbill{margin-top:10px;font-size:.78rem;color:var(--walnut-60);background:none;border:1px solid var(--line-strong);border-radius:7px;padding:5px 12px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.blx .delbill:hover{color:var(--terracotta);border-color:var(--terracotta);background:var(--terra-tint)}
.blx .delbill:disabled{opacity:.5;cursor:default}
.blx .detgrid{display:grid;grid-template-columns:380px 1fr;gap:28px;align-items:start}
.blx .docpane{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:18px}
.blx .docempty{min-height:200px;display:grid;place-items:center;color:var(--walnut-soft);font-size:.85rem;text-align:center;border:1px dashed var(--line-strong);border-radius:6px}
.blx .docactions{display:flex;gap:14px;margin-top:14px}
.blx .docactions button{background:none;border:none;font-size:.8rem;color:var(--walnut-60);text-decoration:underline;text-underline-offset:3px;padding:0;cursor:pointer}
.blx .docactions button:hover{color:var(--walnut)}
.blx .datapane{display:flex;flex-direction:column;gap:22px}
.blx .card{background:var(--paper);border:1px solid var(--line);border-radius:10px}
.blx .card .cardhead{padding:13px 18px;border-bottom:1px solid var(--line);font-size:.82rem;font-weight:600;display:flex;justify-content:space-between;align-items:baseline}
.blx .cardhead .aside{font-weight:400;font-size:.78rem;color:var(--walnut-60)}
.blx .lines td{padding:11px 18px;font-size:.85rem;border-bottom:1px solid var(--line)}
.blx .lines tr:last-child td{border-bottom:none}
.blx .lines .qty{font-family:'IBM Plex Mono',monospace;font-size:.8rem;color:var(--walnut-60);white-space:nowrap}
.blx .lines .lr{font-family:'IBM Plex Mono',monospace;font-size:.83rem;text-align:right;white-space:nowrap}
.blx .refrow{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid var(--line);font-size:.85rem;gap:12px}
.blx .refrow:last-child{border-bottom:none}
.blx .refrow .what{display:flex;align-items:center;gap:12px;min-width:0}
.blx .refrow .kind{color:var(--walnut-60);font-size:.78rem;width:64px;flex-shrink:0}
.blx .refrow .lr{font-family:'IBM Plex Mono',monospace;font-size:.83rem;flex-shrink:0}
.blx .refrow button.lnk{font-size:.78rem;color:var(--walnut-60);background:none;border:none;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.blx .refrow button.lnk:hover{color:var(--walnut)}
.blx .settlebar{padding:16px 18px}
.blx .settlebar .track{height:6px;border-radius:3px;background:var(--terra-tint);overflow:hidden;margin-top:10px}
.blx .settlebar .fill{height:100%;background:var(--sage);border-radius:3px}
.blx .settlebar .legend{display:flex;justify-content:space-between;font-size:.76rem;color:var(--walnut-60);margin-top:8px}
.blx .settlebar .legend .m{font-family:'IBM Plex Mono',monospace;color:var(--walnut)}
@media (max-width:900px){.blx .shell{padding:20px 16px 72px}.blx .detgrid{grid-template-columns:1fr}}
/* drag-drop overlay */
.blx .dropveil{position:fixed;inset:0;z-index:80;background:rgba(59,49,40,.45);display:grid;place-items:center;pointer-events:none}
.blx .dropveil .card{background:var(--paper);border:2px dashed var(--terracotta);border-radius:16px;padding:38px 54px;text-align:center;box-shadow:0 24px 60px -20px rgba(43,29,19,.5)}
.blx .dropveil .big{font-family:'Newsreader',Georgia,serif;font-size:1.4rem;color:var(--walnut)}
.blx .dropveil .sub{font-size:.85rem;color:var(--walnut-60);margin-top:6px}
/* upload queue */
.blx .queue{position:fixed;right:20px;bottom:20px;z-index:70;width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px}
.blx .qcard{background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px -14px rgba(43,29,19,.4);padding:12px 14px;font-size:.83rem;animation:qin .2s ease}
@keyframes qin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.blx .qcard .qtop{display:flex;align-items:center;gap:8px}
.blx .qcard .qname{font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blx .qcard .qx{background:none;border:none;color:var(--walnut-soft);cursor:pointer;font-size:1rem;line-height:1}
.blx .qcard .qstate{color:var(--walnut-60);margin-top:4px;font-size:.78rem}
.blx .qcard .qstate.err{color:var(--terracotta)}
.blx .qspin{width:13px;height:13px;border:2px solid var(--terra-tint);border-top-color:var(--terracotta);border-radius:50%;animation:qspin .7s linear infinite;flex-shrink:0}
@keyframes qspin{to{transform:rotate(360deg)}}
/* confirm sheet */
.blx .scrim{position:fixed;inset:0;z-index:90;background:rgba(59,49,40,.42);display:grid;place-items:center;padding:16px}
.blx .sheet-m{width:min(560px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 60px -20px rgba(43,29,19,.5)}
.blx .sheet-m .sh{padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between}
.blx .sheet-m .sh h3{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:1.25rem;margin:0}
.blx .sheet-m .sh .qn{font-size:.78rem;color:var(--walnut-60)}
.blx .sheet-m .sb{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.blx .fld label{display:block;font-size:.78rem;font-weight:500;color:var(--walnut-60);margin-bottom:6px}
.blx .fld input,.blx .fld select{width:100%;height:42px;border:1px solid var(--line-strong);border-radius:8px;background:var(--paper);padding:0 12px;font-family:inherit;font-size:.9rem;color:var(--walnut);outline:none}
.blx .fld input:focus,.blx .fld select:focus{border-color:var(--terracotta)}
.blx .fld input.mono{font-family:'IBM Plex Mono',monospace}
.blx .row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.blx .vsearch{position:relative}
.blx .vmenu{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:5;background:var(--paper);border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 12px 30px -14px rgba(43,29,19,.4);max-height:220px;overflow-y:auto}
.blx .vmenu button{display:block;width:100%;text-align:left;padding:9px 12px;background:none;border:none;font-size:.86rem;color:var(--walnut);cursor:pointer}
.blx .vmenu button:hover{background:var(--cream)}
.blx .dupwarn{display:flex;gap:10px;align-items:flex-start;background:var(--terra-tint);border:1px solid #E0BBA8;border-radius:10px;padding:11px 13px;font-size:.82rem;color:#7E3A20}
.blx .dupwarn b{font-weight:600}
.blx .sheet-m .sf{padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}
.blx .sheet-m .sf .amt-tot{font-family:'IBM Plex Mono',monospace;font-size:1.05rem;font-weight:500}
.blx .sheet-m .sf .acts{display:flex;gap:10px}
.blx .btn-ghost{background:none;border:1px solid var(--line-strong);border-radius:8px;padding:9px 16px;font-size:.85rem;color:var(--walnut-60);cursor:pointer}
.blx .btn-prim{background:var(--terracotta);border:none;border-radius:8px;padding:9px 18px;font-size:.85rem;font-weight:600;color:#fff;cursor:pointer}
.blx .btn-prim:disabled{opacity:.5;cursor:default}
`;

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
// The bill's own document, shown in place of the initials bubble: an image thumbnail (hover to preview),
// the classic red PDF glyph for a PDF, or a paper icon when there's no document on file.
const PdfGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M5.5 1.5h8.3L20 7.4V21a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 21V3A1.5 1.5 0 0 1 5.5 1.5Z" fill="#E7452B" />
    <path d="M13.8 1.6V7.6H20" fill="#B8371F" />
    <text x="11.9" y="17.9" textAnchor="middle" fontSize="6.4" fontWeight="800" fill="#fff" fontFamily="Instrument Sans, system-ui, sans-serif" letterSpacing="-.3">PDF</text>
  </svg>
);
const PaperGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12.5h6M9 16h4" /></svg>
);

function BillThumb({ docUrl, vendor }: { docUrl: string | null; vendor: string }) {
  const isPdf = !!docUrl && /\.pdf(\?|#|$)/i.test(docUrl);
  const [signed, setSigned] = useState<string | null>(null);
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!docUrl || isPdf) { setSigned(null); return; }
    let live = true;
    void resolveDocUrl(docUrl).then(u => { if (live) setSigned(u || null); });
    return () => { live = false; };
  }, [docUrl, isPdf]);

  if (isPdf) return <span className="bthumb pdf" title="PDF bill" aria-label={`${vendor} — PDF bill`}><PdfGlyph /></span>;
  if (!docUrl) return <span className="bthumb none" title="No bill document" aria-label={vendor}><PaperGlyph /></span>;
  return (
    <span className="bthumb img" aria-label={`${vendor} — bill image`}
      onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setBox({ x: Math.min(window.innerWidth - 252, r.right + 10), y: Math.max(10, Math.min(window.innerHeight - 330, r.top - 8)) }); }}
      onMouseLeave={() => setBox(null)}>
      {signed ? <img src={signed} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : <span className="ph" />}
      {box && signed && createPortal(<span className="bpreview" style={{ left: box.x, top: box.y }}><img src={signed} alt={`${vendor} bill`} /></span>, document.body)}
    </span>
  );
}
const STATUS_LABEL: Record<BillStatus, string> = { settled: 'Settled', part: 'Part-paid', unpaid: 'Unpaid' };

function StatusCell({ s, left }: { s: BillStatus; left: number }) {
  return (
    <span className={`status ${s}`}>{STATUS_LABEL[s]}
      {s === 'part' && left > 0.5 && <span className="sub">{inr(left)} left</span>}
    </span>
  );
}

// The /bills/:billId route — a SEPARATE component from the list so React never reuses one instance
// across the two routes (which changed the hook count and crashed with "fewer hooks than expected").
export function BillDetailPage() {
  const { billId } = useParams();
  return <BillDetailView id={decodeURIComponent(billId ?? '')} />;
}

// Small inline glyphs for the Add-bill control (no icon dep; stroke follows currentColor).
const IconUpload = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>);
const IconDrop = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" /><path d="M12 9v6M9 12h6" /></svg>);

// ── list ───────────────────────────────────────────────────────────────────
// Two surfaces over the same register: the desktop ledger table, and the phone's one column. Both
// read through billsApi, so a bill paid on either shows up on the other.
export default function Bills() {
  const isMobile = useIsMobile();
  // Two surfaces over one register: the phone's drawer of paper, and the desktop table. Both read and
  // write through billsApi, so a bill linked on either shows up on the other.
  return isMobile ? <BillsMobile /> : <BillsDesktop />;
}

function BillsDesktop() {
  const navigate = useNavigate();
  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: loadBills });
  const [site, setSite] = useState('');
  // Like the ledger: a grouping (by date / site / vendor, default date) and a scope (outstanding by
  // default — the bills that still owe money — or all). Newest-added is always first.
  const [group, setGroup] = useState<'date' | 'site' | 'vendor'>('date');
  const [scope, setScope] = useState<'outstanding' | 'all'>('outstanding');
  const [peekSite, setPeekSite] = useState<string | null>(null);   // hero: hovering a site's slice/legend

  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const mintBill = useMintBill();

  // Known vendors (to resolve a read name to a party) + active sites (the confirm's site chips).
  const { data: vendorParties = [] } = useQuery({
    queryKey: ['bill_vendor_parties'],
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name').eq('type', 'Vendor').is('merged_into', null).order('name')).data ?? [],
  });
  const { data: projectOpts = [] } = useQuery({
    queryKey: ['bill_projects_active'],
    queryFn: async () => (await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')).data ?? [],
  });

  // ── in-header bill capture (briklay-bill-capture-v5.html) ──────────────────────────────────────────
  // The hero IS the door: 'rest' shows the figures; 'catch' is the drop zone (opened by Add bill or a
  // drag); 'read' is the reading + confirm surface — fields fill from the real extractor, Enter files it
  // through the same pipeline the modal used, and the header then invites the next drop.
  type Cap = 'rest' | 'catch' | 'read';
  const EMPTY_RD = { vendor: '', billNo: '', billDate: '', amount: '', lines: [] as ExtractedBill['lines'], file: null as File | null, fileName: '', weak: false };
  const [cap, setCap] = useState<Cap>('rest');
  const [reading, setReading] = useState(false);
  const [rd, setRd] = useState(EMPTY_RD);
  const [rdSite, setRdSite] = useState<{ id: string; name: string } | null>(null);
  const [filed, setFiled] = useState(false);     // the "✓ Filed" flash
  const [filing, setFiling] = useState(false);
  const [vOpen, setVOpen] = useState(false);     // the vendor typeahead menu
  const dragDepth = useRef(0);
  const captureFileRef = useRef<HTMLInputElement>(null);

  const startRead = useCallback(async (file: File | null) => {
    setCap('read'); setFiled(false); setRdSite(null);
    if (!file) { setRd({ ...EMPTY_RD, fileName: 'typed manually' }); setReading(false); return; }
    setRd({ ...EMPTY_RD, file, fileName: file.name }); setReading(true);
    try {
      const ex = await extractBill(file);
      const match = ex.vendor ? vendorParties.find((v: any) => v.name.toLowerCase() === ex.vendor!.trim().toLowerCase()) : null;
      setRd({ vendor: match?.name ?? ex.vendor ?? '', billNo: ex.billNo ?? '', billDate: ex.billDate ?? '', amount: ex.amount ? String(Math.round(ex.amount)) : '', lines: ex.lines, file, fileName: file.name, weak: !!(ex.vendor && !match) });
      setReading(false);
    } catch { setReading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorParties]);

  const fileBill = useCallback(async () => {
    const vName = rd.vendor.trim();
    const amt = Number((rd.amount || '').replace(/[^\d]/g, '')) || 0;
    if (!vName || !amt || !rdSite || filing) return;   // site is required — a bill belongs to a project
    setFiling(true);
    try {
      let vendorId = vendorParties.find((v: any) => v.name.toLowerCase() === vName.toLowerCase())?.stakeholder_id ?? '';
      if (!vendorId) { const p = await createParty(vName, 'Vendor', orgId); vendorId = p.id; }
      const draft: BillDraft = { file: rd.file, vendorId, vendorName: vName, billNo: rd.billNo.trim() || null, billDate: rd.billDate.trim() || null, amount: amt, projectId: rdSite?.id ?? null, lines: rd.lines, allowDuplicate: false };
      const res = await mintBill(draft);
      if (res && 'duplicate' in res && res.duplicate) await mintBill({ ...draft, allowDuplicate: true });
      setFiled(true);
      window.setTimeout(() => { setFiled(false); setCap('catch'); window.setTimeout(() => setCap(c => c === 'catch' ? 'rest' : c), 4000); }, 950);
    } catch (e) { showSnackbar((e as Error)?.message || 'Could not add the bill', { type: 'error' }); }
    finally { setFiling(false); }
  }, [rd, rdSite, vendorParties, orgId, mintBill, showSnackbar, filing]);

  // Page-wide drag-and-drop + Enter/Esc drive the capture state (refs keep the window listeners stable).
  const capRef = useRef(cap); capRef.current = cap;
  const startReadRef = useRef(startRead); startReadRef.current = startRead;
  const fileBillRef = useRef(fileBill); fileBillRef.current = fileBill;
  useEffect(() => {
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    const onEnter = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth.current++; if (capRef.current === 'rest') setCap('catch'); } };
    const onLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0 && capRef.current === 'catch') setCap('rest'); };
    const onDrop = (e: DragEvent) => { e.preventDefault(); dragDepth.current = 0; const f = e.dataTransfer?.files?.[0]; if (f && /^image\/|application\/pdf/.test(f.type)) void startReadRef.current(f); else if (capRef.current === 'catch') setCap('rest'); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && capRef.current !== 'rest') setCap('rest');
      if (e.key === 'Enter' && capRef.current === 'read' && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); void fileBillRef.current(); }
    };
    window.addEventListener('dragover', onOver); window.addEventListener('dragenter', onEnter); window.addEventListener('dragleave', onLeave); window.addEventListener('drop', onDrop);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('dragover', onOver); window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); document.removeEventListener('keydown', onKey); };
  }, []);

  const [q, setQ] = useState('');
  // ?party=<id> — arriving from the search's "Bills" row for one vendor.
  const [searchParams] = useSearchParams();
  const partyId = searchParams.get('party');
  // ?new=1 — the mobile nav FAB opens the capture straight into type-it-in.
  useEffect(() => { if (searchParams.get('new') === '1') void startReadRef.current(null); }, [searchParams]);
  const shown = useMemo(() => bills.filter(b =>
    (!partyId || b.vendorId === partyId) &&
    (!site || b.site === site) &&
    (scope === 'all' || b.status !== 'settled') &&
    (!q || `${b.vendor} ${b.billNo ?? ''} ${b.site ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [bills, site, scope, q, partyId]);

  // Group the (newest-added-first) rows into sections with a subtotal, exactly like the ledger's day cards.
  const sections = useMemo(() => {
    const sorted = [...shown].sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
    const keyOf = (b: BillRow) => group === 'date' ? (b.addedAt ? String(b.addedAt).slice(0, 10) : 'undated')
      : group === 'site' ? (b.site || 'No site')
        : (b.vendor || 'Vendor');
    const map = new Map<string, BillRow[]>();
    for (const b of sorted) { const k = keyOf(b); (map.get(k) ?? map.set(k, []).get(k)!).push(b); }
    const entries = [...map.entries()];
    if (group === 'date') entries.sort((a, b) => b[0].localeCompare(a[0]));                                   // newest day first
    else entries.sort((a, b) => String(b[1][0]?.addedAt || '').localeCompare(String(a[1][0]?.addedAt || ''))); // group with newest activity first
    return entries.map(([key, rows]) => ({
      key,
      label: group === 'date' ? (key === 'undated' ? 'Undated' : new Date(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) : key,
      weekday: group === 'date' && key !== 'undated' ? new Date(key).toLocaleDateString('en-IN', { weekday: 'long' }) : null,
      rows,
      due: rows.reduce((s, r) => s + Math.max(0, r.amount - r.paid), 0),
      count: rows.length,
    }));
  }, [shown, group]);
  useSearchScope('Bills', useMemo(() => shown.map(b => ({
    id: b.id, title: b.vendor, sub: `${b.billNo || 'No number'}${b.site ? ' · ' + b.site : ''}`, right: inr(b.amount),
    onPick: () => navigate(`/bills/${encodeURIComponent(b.id)}`),
  })), [shown, navigate]), setQ);

  const unpaidTotal = useMemo(() => bills.filter(b => b.status !== 'settled').reduce((s, b) => s + (b.amount - b.paid), 0), [bills]);
  // The hero's outstanding picture: total dues, how they're spread across sites (top 4, biggest first),
  // and the vendor/site counts. Everything is about the OUTSTANDING money — that is what the page opens on.
  const hero = useMemo(() => {
    const open = bills.filter(b => b.status !== 'settled');
    const bySite = new Map<string, { due: number; count: number }>();
    const vendorSet = new Set<string>();
    for (const b of open) {
      vendorSet.add(b.vendorId || b.vendor);
      const k = b.site || 'No site'; const e = bySite.get(k) ?? { due: 0, count: 0 };
      e.due += Math.max(0, b.amount - b.paid); e.count++; bySite.set(k, e);
    }
    const list = [...bySite.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.due - a.due).slice(0, 4);
    return { total: unpaidTotal, bills: open.length, vendors: vendorSet.size, sites: bySite.size, list };
  }, [bills, unpaidTotal]);
  const focusSite = peekSite ?? (site || null);
  const focus = focusSite ? hero.list.find(s => s.name === focusSite) : null;

  // The hero wears the transactions page's cursor lamp (a warm glow that follows the pointer on the dark band).
  const heroRef = useCursorLamp<HTMLElement>();

  // "/" focuses the search from anywhere on the page.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement !== searchRef.current) { e.preventDefault(); searchRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Vendor typeahead (the read surface): matches on the typed name + an "add new" when it's not one yet.
  const vq = rd.vendor.trim().toLowerCase();
  const vMatches = vq ? (vendorParties as any[]).filter((v) => v.name.toLowerCase().includes(vq)).slice(0, 6) : (vendorParties as any[]).slice(0, 6);
  const vExact = (vendorParties as any[]).some((v) => v.name.toLowerCase() === vq);
  const readReady = !!(rd.vendor.trim() && rd.amount.trim() && rdSite);   // vendor + amount + site (site is required)

  return (
    <div className="blx">
      <style>{BLX_CSS}</style>
      <div className="bh">
        <header className="hero" ref={heroRef}>
          <div className="fx glow" aria-hidden="true" />
          <div className="fx grid" aria-hidden="true" />
          <div className="hwrap">
          <div className="hero-top">
            <div>
              <h1>{cap === 'rest' ? 'Vendor Bills' : (cap === 'read' && reading) ? <>Uploading<span className="dots"><i /><i /><i /></span></> : 'New bill'}</h1>
              {cap === 'rest' && <p className="sub">Every bill recorded across your sites. Purchase orders, payments and ledgers all point back here.</p>}
            </div>
            <div>
              <div className="actions">
                <button className="tb-btn primary" onClick={() => setCap(cap === 'rest' ? 'catch' : 'rest')}
                  title="Add a bill — drop the paper and we'll read it, or type it in. You can also drop files anywhere on this page.">
                  <IconUpload /><span>{cap === 'rest' ? 'Add bill' : 'Close'}</span>
                </button>
              </div>
              {cap === 'rest' && <div className="hint"><IconDrop />or drop a bill anywhere on this page</div>}
            </div>
          </div>

          <div className="hero-stage">
          {/* REST — the figures */}
          {cap === 'rest' && (
          <div className="figure">
            <div>
              <div className="amount">{inr(focus ? focus.due : hero.total)}<span className="cap">{scope === 'all' ? 'due' : 'unpaid'}</span></div>
              <div className="under">{focus
                ? <>on <b>{focus.name}</b> · {focus.count} bill{focus.count !== 1 ? 's' : ''}</>
                : <>across <b>{hero.bills}</b> bill{hero.bills !== 1 ? 's' : ''} from <b>{hero.vendors}</b> vendor{hero.vendors !== 1 ? 's' : ''}, on <b>{hero.sites}</b> site{hero.sites !== 1 ? 's' : ''}</>}</div>
            </div>

            {hero.list.length > 0 && (
              <div className={`sites${focusSite ? ' dim' : ''}`}>
                <div className="cap-row"><span className="t">Which site the unpaid money sits on</span><span className="r">click a site to filter</span></div>
                <div className="sbar">
                  {hero.list.map((s, i) => (
                    <div key={s.name} className={`seg c${i + 1}${focusSite === s.name ? ' hot' : ''}`} style={{ flex: Math.max(1, Math.round(s.due)) }}
                      onMouseEnter={() => setPeekSite(s.name)} onMouseLeave={() => setPeekSite(null)}
                      onClick={() => setSite(site === s.name ? '' : s.name)} title={s.name} />
                  ))}
                </div>
                <div className="legend">
                  {hero.list.map((s, i) => (
                    <button key={s.name} className={`li${focusSite === s.name ? ' hot' : ''}`}
                      onMouseEnter={() => setPeekSite(s.name)} onMouseLeave={() => setPeekSite(null)}
                      onClick={() => setSite(site === s.name ? '' : s.name)}>
                      <div className="amt">{inr(s.due)}</div>
                      <div className="nm"><i className={`c${i + 1}`} />{s.name}</div>
                      <div className="ct">{s.count} bill{s.count !== 1 ? 's' : ''} · {hero.total > 0 ? Math.round(s.due / hero.total * 100) : 0}%</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          {/* CATCH — the drop zone */}
          {cap === 'catch' && (
          <div className="catch">
            <svg className="rule" preserveAspectRatio="none"><rect x="1" y="1" width="99.5%" height="96%" rx="15" /></svg>
            <div className="c-arrow">⤒</div>
            <div className="c-big">Drop it here — or <button className="c-up" onClick={() => captureFileRef.current?.click()}>upload</button></div>
            <div className="c-sm">Photo or PDF · vendor, number, date and amount fill themselves</div>
            <div className="c-alt"><button onClick={() => void startRead(null)}>or type it in manually</button></div>
          </div>
          )}

          {/* READ / CONFIRM */}
          {cap === 'read' && (
          <div className="read">
            {filed && <div className="filed">✓ Filed — it&apos;s on the vendor&apos;s ledger</div>}
            <div className="doc-row">
              <div>
                <div className={`doc-thumb${!reading ? ' done' : ''}`}>
                  <div className="lines"><i /><i /><i /><i /><i /></div>
                  {reading && <div className="scanline" />}
                </div>
                <div className="doc-name">{rd.fileName}</div>
              </div>
              <div className="read-main">
                <div className="fields">
                  <div className={`field vfield${rd.weak ? ' weak' : ''}`}>
                    <label>{!rd.weak && rd.vendor.trim() ? <span className="tick">✓</span> : null} Vendor</label>
                    <input value={rd.vendor} autoComplete="off"
                      onChange={e => { setRd(r => ({ ...r, vendor: e.target.value, weak: false })); setVOpen(true); }}
                      onFocus={() => setVOpen(true)} onBlur={() => window.setTimeout(() => setVOpen(false), 150)} />
                    {rd.weak && <div className="why">Read off the bill — pick the right vendor, or add it as a new one.</div>}
                    {vOpen && (vMatches.length > 0 || (vq && !vExact)) && (
                      <div className="vmenu2">
                        {vMatches.map((v: any) => (
                          <button key={v.stakeholder_id} type="button" onMouseDown={e => e.preventDefault()}
                            onClick={() => { setRd(r => ({ ...r, vendor: v.name, weak: false })); setVOpen(false); }}>{v.name}</button>
                        ))}
                        {vq && !vExact && (
                          <button type="button" className="vadd" onMouseDown={e => e.preventDefault()}
                            onClick={() => { setRd(r => ({ ...r, weak: false })); setVOpen(false); }}>+ Add “{rd.vendor.trim()}” as a new vendor</button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="field"><label>{rd.billNo.trim() ? <span className="tick">✓</span> : null} Bill / invoice no</label><input value={rd.billNo} onChange={e => setRd(r => ({ ...r, billNo: e.target.value }))} /></div>
                  <div className="field"><label>{rd.billDate.trim() ? <span className="tick">✓</span> : null} Bill date</label><input value={rd.billDate} placeholder="dd-mm-yyyy" onChange={e => setRd(r => ({ ...r, billDate: e.target.value }))} /></div>
                  <div className="field amount"><label>{rd.amount.trim() ? <span className="tick">✓</span> : null} Amount</label><input value={rd.amount} onChange={e => setRd(r => ({ ...r, amount: e.target.value }))} /></div>
                  <div className={`field site${!rdSite ? ' weak' : ''}`}>
                    <label>{rdSite ? <span className="tick">✓</span> : null} Site — which project</label>
                    <div className="site-chips">
                      {(projectOpts as any[]).map((p) => (
                        <button key={p.project_id} type="button" className={rdSite?.id === p.project_id ? 'on' : ''}
                          onClick={() => setRdSite(s => s?.id === p.project_id ? null : { id: p.project_id, name: p.name })}>
                          {p.name.replace(' Residence', '').replace(' Apartments', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="confirm-foot">
                  <div className="ledger-line">{readReady
                    ? <><b>{inr(Number(rd.amount.replace(/[^\d]/g, '')) || 0)}</b> lands on {rd.vendor.trim()}&apos;s ledger · {rdSite!.name} — raises what you owe.</>
                    : !rd.vendor.trim() ? (rd.amount.trim() ? 'Name the vendor and it lands on their ledger.' : '')
                      : !rdSite ? 'Pick the site this bill is for.' : 'Enter the amount.'}</div>
                  <div className="confirm-actions">
                    <button className="btn-back" onClick={() => setCap('rest')}>Discard</button>
                    <button className={`btn-file${readReady ? ' ready' : ''}`} disabled={filing || !readReady} onClick={() => void fileBill()}>{filing ? 'Filing…' : 'Add bill · Enter'}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
          </div>
        </div></header>
        <input ref={captureFileRef} type="file" accept="image/*,application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) void startRead(f); }} />

        <div className="controls"><div className="hwrap">
          <div className="bar">
            <label className={`search${q ? ' has' : ''}`}>
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none"><circle cx="6.2" cy="6.2" r="4.4" stroke="currentColor" strokeWidth="1.4" /><path d="M9.6 9.6L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
              <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor, bill number, site or amount" />
              {q
                ? <button className="clear" aria-label="Clear search" onClick={(e) => { e.preventDefault(); setQ(''); }}><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg></button>
                : <span className="kbd">/</span>}
            </label>
            <span className="cnt"><b>{shown.length}</b> of {bills.length} bill{bills.length !== 1 ? 's' : ''}</span>
            <div className="grp">
              <span className="grp-label">Group by</span>
              <div className="seg">
                {(['date', 'site', 'vendor'] as const).map(g => (
                  <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g}</button>
                ))}
              </div>
            </div>
            <div className="rightgrp">
              {site && <button className="chip" onClick={() => setSite('')}>{site}<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>}
              <div className="scope" title="Bills that still owe money, or every bill">
                <button className={scope === 'outstanding' ? 'on' : ''} onClick={() => setScope('outstanding')}>Outstanding</button>
                <span className="sep">·</span>
                <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Paid too</button>
              </div>
            </div>
          </div>
        </div></div>
      </div>

      <div className="shell">
        {isLoading ? (
          <div className="billempty">Loading bills…</div>
        ) : shown.length === 0 ? (
          <div className="billempty">{bills.length === 0 ? 'No bills recorded yet. A vendor bill on a PO, or a consolidated bill, appears here.' : scope === 'outstanding' ? 'Nothing outstanding — every bill here is settled. Switch to All to see them.' : 'No bills match these filters.'}</div>
        ) : (
          <div className="billstack">
            {sections.map(s => (
              <section className="billday" key={s.key}>
                <div className="dhead">{s.label}{s.weekday ? <span className="wd">· {s.weekday}</span> : null}</div>
                <div className="daycard">
                  {s.rows.map(b => {
                    const ctx = [b.billNo ? `Bill ${b.billNo}` : null, fmtDate(b.billDate), group !== 'site' ? b.site : null].filter(Boolean).join(' · ');
                    return (
                      <div key={b.id} data-search-row={b.id} className="brow" role="button" tabIndex={0}
                        onClick={() => navigate(`/bills/${encodeURIComponent(b.id)}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/bills/${encodeURIComponent(b.id)}`); }}>
                        <BillThumb docUrl={b.docUrl} vendor={b.vendor} />
                        <span className="bmain"><span className="bv">{b.vendor}</span><span className="bctx">{ctx || '—'}</span></span>
                        <span className="bref"><RefCell row={b} /></span>
                        <span className="bamt"><span className="amt">{inr(b.amount)}</span><StatusCell s={b.status} left={b.amount - b.paid} /></span>
                      </div>
                    );
                  })}
                  <div className="dfoot">
                    <span className="closed">{group === 'date' ? 'Day closed' : group === 'site' ? 'Site subtotal' : 'Vendor subtotal'}</span>
                    <div className="dclose">
                      <span className="dtot">{s.due > 0.5 ? <><b>{inr(s.due)}</b> due</> : <span className="settled">all settled</span>} · {s.count} bill{s.count !== 1 ? 's' : ''}</span>
                      <div className="drule" aria-hidden />
                    </div>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function RefCell({ row }: { row: BillRow }) {
  if (row.ref.kind === 'po') return <span className="chip">{row.ref.poId}</span>;
  if (row.ref.kind === 'consolidated') return <span className="chip consol">{row.ref.label}</span>;
  return <span className="noref">No PO</span>;
}

// ── detail ─────────────────────────────────────────────────────────────────
function BillDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show } = useSnackbar();
  const { data: b, isLoading } = useQuery({ queryKey: ['bill', id], queryFn: () => loadBillDetail(id) });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Back goes where you came FROM. Opening a bill from a PO and being returned to the bills register
  // loses the thread you were pulling — you were reading that order, not the register.
  const { state } = useLocation();
  const from = (state ?? null) as { backTo?: string; backLabel?: string } | null;
  const backTo = from?.backTo ?? '/bills';
  const backLabel = from?.backLabel ?? 'Bills';
  const goBack = () => navigate(backTo);

  if (isLoading) return <div className="blx"><style>{BLX_CSS}</style><div className="shell"><div className="empty">Loading…</div></div></div>;
  if (!b) return <div className="blx"><style>{BLX_CSS}</style><div className="shell"><button className="backline" onClick={goBack}>← {backLabel}</button><div className="empty">Bill not found.</div></div></div>;

  const remaining = Math.max(0, b.amount - b.paid);
  const pct = b.amount > 0 ? Math.min(100, Math.round((b.paid / b.amount) * 100)) : 0;
  const preview = (url: string) => { if (/\.pdf(\?|$)/i.test(url)) void openDoc(url); else setLightbox(url); };

  const onDelete = async () => {
    const msg = b.paid > 0.5
      ? `Delete this bill? ${inr(b.paid)} was paid against it — that payment reverts to an unallocated advance. This can't be undone.`
      : `Delete this bill? This can't be undone.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      await deleteBill(id);
      show('Bill deleted');
      qc.invalidateQueries({ queryKey: ['bills'] });
      qc.invalidateQueries({ queryKey: ['party_ledger'] });
      qc.invalidateQueries({ queryKey: ['weekly_payments'] });
      qc.invalidateQueries({ queryKey: ['po_detail'] });
      qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
      goBack();
    } catch (e) { show((e as Error)?.message || 'Could not delete the bill', { type: 'error' }); setDeleting(false); }
  };

  return (
    <div className="blx">
      <style>{BLX_CSS}</style>
      <div className="shell">
        <button className="backline" onClick={goBack}>← {backLabel}</button>

        <header className="dethead">
          <div>
            <h1>{b.vendor}</h1>
            <p className="meta">
              {b.ref.kind === 'consolidated'
                ? <>Consolidated bill · {fmtDate(b.periodFrom ?? null)} – {fmtDate(b.periodTo ?? null)}</>
                : <>Bill <span className="m">{b.billNo || '—'}</span> · {fmtDate(b.billDate)}{b.site ? <> · {b.site}</> : null}</>}
            </p>
          </div>
          <div className="detamount">
            <div className="num">{inr(b.amount)}</div>
            <div className={`state status ${b.status}`}>
              {b.status === 'settled' ? 'Settled' : b.status === 'part' ? `Part-paid — ${inr(remaining)} remaining` : `Unpaid — ${inr(b.amount)} due`}
            </div>
            <button className="delbill" disabled={deleting} onClick={onDelete}>{deleting ? 'Deleting…' : 'Delete bill'}</button>
          </div>
        </header>

        <div className="detgrid">
          {/* document */}
          <aside className="docpane">
            {b.docUrl ? (
              <>
                <DocThumb stored={b.docUrl} onImageClick={setLightbox} w={340} h={430} label="Bill document" />
                <div className="docactions">
                  <button onClick={() => preview(b.docUrl!)}>Open full size</button>
                </div>
              </>
            ) : (
              <div className="docempty">No bill document attached.</div>
            )}
          </aside>

          {/* data */}
          <div className="datapane">
            {b.lines.length > 0 && (
              <div className="card">
                <div className="cardhead">Lines <span className="aside">as on the bill</span></div>
                <table className="lines"><tbody>
                  {b.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.name}{l.spec ? <div className="qty" style={{ marginTop: 3 }}>{l.spec}</div> : null}</td>
                      <td className="qty">{l.qty ? `${l.qty}${l.unit ? ' ' + l.unit : ''} × ${inr(l.rate)}` : ''}</td>
                      <td className="lr">{inr(l.amount)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}

            <div className="card">
              <div className="cardhead">Referenced by</div>
              {b.poId && (
                <div className="refrow">
                  <div className="what"><span className="kind">Order</span><span className="chip">{b.poId}</span></div>
                  <button className="lnk" onClick={() => navigate(`/purchase-orders/${b.poId}`)}>Open</button>
                </div>
              )}
              {b.payments.map(p => (
                <div className="refrow" key={p.txnId}>
                  <div className="what"><span className="kind">Payment</span><span>{p.mode || 'Payment'} · {fmtDate(p.date)}</span></div>
                  <span className="lr">{inr(p.amount)}</span>
                </div>
              ))}
              {!b.poId && b.payments.length === 0 && <div className="refrow"><span className="site">Nothing points here yet.</span></div>}
            </div>

            <div className="card settlebar">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '.82rem', fontWeight: 600 }}>Settlement</span>
                <span style={{ fontSize: '.78rem', color: 'var(--walnut-60)' }}>derived from allocations</span>
              </div>
              <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
              <div className="legend">
                <span><span className="m">{inr(b.paid)}</span> allocated</span>
                <span><span className="m">{inr(remaining)}</span> remaining</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ImageLightbox url={lightbox} title="Bill document" onClose={() => setLightbox(null)} />
    </div>
  );
}
