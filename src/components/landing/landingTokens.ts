/**
 * Landing-page design tokens + global CSS. Lifted VERBATIM from the reference
 * (docs/reference/BriklayLanding.jsx). The keyframe percentages, durations
 * (8s / 9s / 20s / 26s clocks), and class names are choreographed — do not edit.
 */
import type { CSSProperties } from 'react';

export const V = {
  ink: '#1E1A15', inkSoft: '#3D3830',
  sys: '#6B6258', faint: '#9A9186',
  terra: '#BC4B27', terraDeep: '#8F3318', terraWash: '#FBEFE9',
  ask: '#8A5A0B', askWash: '#FBF3E0', askLine: '#E5C98F',
  sage: '#2F5D34', sageWash: '#E9F2E7',
  page: '#FBF9F6', surface: '#FFFFFF', field: '#F4F2EE', line: '#EAE6E0',
} as const;

export const SEG = ['#A0826D', '#B79E89', '#CDB7A4'] as const;
export const terraGrad = 'linear-gradient(180deg, #C75530 0%, #B2441F 100%)';
export const inkGrad = 'linear-gradient(180deg, #2A251E 0%, #17130F 100%)';
export const bandGrad = 'linear-gradient(160deg, #26211B 0%, #1B1712 100%)';

export const font: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif" };
export const serif: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
export const nums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

export const CSS = `
@keyframes rise { from { opacity:0; transform:translateY(14px);} to { opacity:1; transform:none;} }
@keyframes railfill { 0%,12% {transform:scaleX(0);} 38%,100% {transform:scaleX(1);} }
@keyframes chipin { 0%,30% {opacity:.35;} 45%,100% {opacity:1;} }
@keyframes allocgrow { 0%,10% {width:0;} 45%,100% {width:var(--w);} }
@keyframes amberout { 0%,45% {opacity:1;} 70%,100% {opacity:0;} }
@keyframes captionswap { 0%,60% {opacity:0;} 75%,100% {opacity:1;} }
@keyframes ledger { 0%,8% {opacity:0; transform:translateY(8px);} 16%,86% {opacity:1; transform:none;} 94%,100% {opacity:0;} }
@keyframes ph12 { 0%,44% {opacity:1;} 48%,96% {opacity:0;} 100% {opacity:1;} }
@keyframes ph3 { 0%,48% {opacity:0; transform:translateY(6px);} 51%,71% {opacity:1; transform:none;} 75%,100% {opacity:0;} }
@keyframes ph4 { 0%,74% {opacity:0; transform:translateY(6px);} 77%,97% {opacity:1; transform:none;} 100% {opacity:0;} }
.loop-ph12 { animation: ph12 20s ease-in-out infinite; }
.loop-ph3 { animation: ph3 20s ease-in-out infinite; }
.loop-ph4 { animation: ph4 20s ease-in-out infinite; }
@keyframes rawT { 0%,22% {opacity:1; filter:blur(0);} 26%,100% {opacity:0; filter:blur(3px);} }
.rawT { animation: rawT 20s ease-in-out infinite; }
@keyframes skuT { 0%,23% {opacity:0; filter:blur(3px); transform:scale(.985);} 27%,100% {opacity:1; filter:blur(0); transform:none;} }
.skuT { animation: skuT 20s ease-in-out infinite; }
@keyframes apprT { 0%,28% {opacity:0;} 31%,100% {opacity:1;} }
.apprT { animation: apprT 20s ease-in-out infinite; }
@keyframes typeT { 0% {max-width:0;} 6% {max-width:16ch;} 100% {max-width:16ch;} }
.typeT { display:inline-block; overflow:hidden; white-space:nowrap; vertical-align:bottom; animation: typeT 20s steps(15,end) infinite; }
@keyframes blinkc { 0%,49% {opacity:1;} 50%,100% {opacity:0;} }
.blinkc { animation: blinkc 1s step-end infinite; }
@keyframes askT { 0%,7% {opacity:0; transform:translateY(3px);} 9%,19% {opacity:1; transform:none;} 23%,100% {opacity:0; transform:none;} }
.askT { animation: askT 20s ease-in-out infinite; }
@keyframes chip20 { 0%,18% {background:transparent;} 20%,22% {background:#F2DFAE;} 25%,100% {background:transparent;} }
.chip20 { animation: chip20 20s ease-in-out infinite; border-radius:4px; padding:0 3px; }
@keyframes pillpop { 0%,23% {transform:scale(.7);} 27.5%,100% {transform:scale(1);} }
.pillpop { animation: pillpop 20s cubic-bezier(.2,.9,.3,1.35) infinite; }
@keyframes btnQ { 0%,32% {opacity:0; transform:translateY(3px);} 35%,41.5% {opacity:1; transform:none;} 42.5% {opacity:1; transform:scale(.95);} 44%,100% {opacity:1; transform:scale(1);} }
.btnQ { animation: btnQ 20s ease-in-out infinite; }
@keyframes vSel { 0%,61% {transform:scale(1); border-color:#EAE6E0;} 63.5%,65% {transform:scale(.965); border-color:#BC4B27;} 67%,100% {transform:scale(1); border-color:#BC4B27;} }
.vSel { animation: vSel 20s ease-in-out infinite; }
@keyframes lab1 { 0%,21% {color:#8F3318;} 25%,100% {color:#9A9186;} }
@keyframes lab2 { 0%,24% {color:#9A9186;} 27%,45% {color:#8F3318;} 49%,100% {color:#9A9186;} }
@keyframes lab3 { 0%,48% {color:#9A9186;} 51%,71% {color:#8F3318;} 75%,100% {color:#9A9186;} }
@keyframes lab4 { 0%,74% {color:#9A9186;} 77%,97% {color:#8F3318;} 100% {color:#9A9186;} }
.lab1 { animation: lab1 20s ease-in-out infinite; }
.lab2 { animation: lab2 20s ease-in-out infinite; }
.lab3 { animation: lab3 20s ease-in-out infinite; }
.lab4 { animation: lab4 20s ease-in-out infinite; }
@keyframes sk1 { 0%,13% {opacity:0;} 14%,16% {opacity:1;} 17.5%,100% {opacity:0;} }
@keyframes sk2 { 0%,17.5% {opacity:0;} 18.5%,20.5% {opacity:1;} 22%,100% {opacity:0;} }
@keyframes sk3 { 0%,22% {opacity:0;} 23%,25% {opacity:1;} 26.5%,100% {opacity:0;} }
@keyframes sk4 { 0%,26.5% {opacity:0;} 27.5%,29.5% {opacity:1;} 31%,100% {opacity:0;} }
@keyframes sk5 { 0%,31% {opacity:0;} 32%,34% {opacity:1;} 35.5%,100% {opacity:0;} }
@keyframes typeP { 0%,1.5% {max-width:0;} 7.5% {max-width:34ch;} 100% {max-width:34ch;} }
.typeP { display:inline-block; overflow:hidden; white-space:nowrap; vertical-align:bottom; animation: typeP 26s steps(33,end) infinite; }
@keyframes cursW { 0%,8.5% {opacity:1;} 9.5%,100% {opacity:0;} }
.cursW { animation: cursW 26s ease-in-out infinite; }
@keyframes digA { 0%,8% {opacity:0;} 9%,11.5% {opacity:1;} 12.5%,100% {opacity:0;} }
.digA { animation: digA 26s ease-in-out infinite; }
@keyframes digB { 0%,13% {opacity:0;} 14.5%,35% {opacity:1;} 37.5%,100% {opacity:0;} }
.digB { animation: digB 26s ease-in-out infinite; }
@keyframes pdot { 0%,100% {opacity:0.25; transform:scale(0.8);} 50% {opacity:1; transform:scale(1);} }
.pdot { animation: pdot 1s ease-in-out infinite; }
.sk1 { animation: sk1 26s ease-in-out infinite; }
.sk2 { animation: sk2 26s ease-in-out infinite; }
.sk3 { animation: sk3 26s ease-in-out infinite; }
.sk4 { animation: sk4 26s ease-in-out infinite; }
.sk5 { animation: sk5 26s ease-in-out infinite; }
@keyframes shim { 0% {background-position: 100% 0;} 100% {background-position: 0 0;} }
.shimmer { background: linear-gradient(90deg, #EFECE7 25%, #E2DDD5 37%, #EFECE7 63%); background-size: 400% 100%; animation: shim 1.3s ease infinite; }
@keyframes tk1 { 0%,16% {opacity:0; transform:translateY(3px);} 18%,96% {opacity:1; transform:none;} 100% {opacity:0;} }
@keyframes tk2 { 0%,20.5% {opacity:0; transform:translateY(3px);} 22.5%,96% {opacity:1; transform:none;} 100% {opacity:0;} }
@keyframes tk3 { 0%,25% {opacity:0; transform:translateY(3px);} 27%,96% {opacity:1; transform:none;} 100% {opacity:0;} }
@keyframes tk4 { 0%,29.5% {opacity:0; transform:translateY(3px);} 31.5%,96% {opacity:1; transform:none;} 100% {opacity:0;} }
@keyframes tk5 { 0%,34% {opacity:0; transform:translateY(3px);} 36%,96% {opacity:1; transform:none;} 100% {opacity:0;} }
@keyframes tkC { 0%,36.5% {opacity:0;} 38.5%,96% {opacity:1;} 100% {opacity:0;} }
.tk1 { animation: tk1 26s ease-in-out infinite; }
.tk2 { animation: tk2 26s ease-in-out infinite; }
.tk3 { animation: tk3 26s ease-in-out infinite; }
.tk4 { animation: tk4 26s ease-in-out infinite; }
.tk5 { animation: tk5 26s ease-in-out infinite; }
.tkC { animation: tkC 26s ease-in-out infinite; }
@keyframes st1 { 0%,25.5% {opacity:0;} 27%,34% {opacity:1;} 36%,100% {opacity:0;} }
@keyframes st2 { 0%,47.5% {opacity:0;} 49.5%,84% {opacity:1;} 86.5%,100% {opacity:0;} }
@keyframes st3 { 0%,90% {opacity:0;} 92%,96% {opacity:1;} 100% {opacity:0;} }
.st1 { animation: st1 26s ease-in-out infinite; }
.st2 { animation: st2 26s ease-in-out infinite; }
.st3 { animation: st3 26s ease-in-out infinite; }
@keyframes nar1 { 0%,38% {opacity:0;} 40%,46% {opacity:1;} 48%,100% {opacity:0;} }
@keyframes nar2 { 0%,47.5% {opacity:0;} 49.5%,62% {opacity:1;} 64%,100% {opacity:0;} }
@keyframes nar3 { 0%,65% {opacity:0;} 67%,95% {opacity:1;} 100% {opacity:0;} }
.nar1 { animation: nar1 26s ease-in-out infinite; }
.nar2 { animation: nar2 26s ease-in-out infinite; }
.nar3 { animation: nar3 26s ease-in-out infinite; }
@keyframes pE { 0%,49% {opacity:1;} 53%,100% {opacity:0;} }
.pE { animation: pE 26s ease-in-out infinite; }
@keyframes pMsg1 { 0%,54.5% {opacity:0; transform:translateY(5px);} 57%,95% {opacity:1; transform:none;} 100% {opacity:0;} }
.pMsg1 { animation: pMsg1 26s ease-in-out infinite; }
@keyframes optSel { 0%,60.5% {transform:scale(1); background:#FFFFFF;} 62.5%,64% {transform:scale(.94); background:#E3F3FB;} 66%,100% {transform:scale(1); background:#E3F3FB;} }
.optSel { animation: optSel 26s ease-in-out infinite; }
@keyframes pSel { 0%,65% {opacity:0; transform:translateY(5px);} 67.5%,95% {opacity:1; transform:none;} 100% {opacity:0;} }
.pSel { animation: pSel 26s ease-in-out infinite; }
@keyframes pMsg2 { 0%,71% {opacity:0; transform:translateY(5px);} 73.5%,95% {opacity:1; transform:none;} 100% {opacity:0;} }
.pMsg2 { animation: pMsg2 26s ease-in-out infinite; }
@keyframes pPhoto { 0%,78.5% {opacity:0; transform:translateY(5px);} 81%,95% {opacity:1; transform:none;} 100% {opacity:0;} }
.pPhoto { animation: pPhoto 26s ease-in-out infinite; }
@keyframes beamOut {
  0%,49% { left:-52px; transform:scaleX(.4); animation-timing-function: cubic-bezier(.85,0,.2,1); }
  50.5% { transform:scaleX(2.8); }
  52% { left:80px; transform:scaleX(.6); }
  52.1%,100% { left:80px; transform:scaleX(.6); }
}
.beamOut { animation: beamOut 26s ease-in-out infinite; }
@keyframes beamBack {
  0%,86% { left:80px; transform:scaleX(.4); animation-timing-function: cubic-bezier(.85,0,.2,1); }
  87.5% { transform:scaleX(2.8); }
  89% { left:-52px; transform:scaleX(.6); }
  89.1%,100% { left:-52px; transform:scaleX(.6); }
}
.beamBack { animation: beamBack 26s ease-in-out infinite; }
@keyframes txnA { 0%,38% {opacity:1;} 46%,92% {opacity:0;} 100% {opacity:1;} }
@keyframes txnB { 0%,42% {opacity:0; transform:translateY(6px);} 50%,92% {opacity:1; transform:none;} 100% {opacity:0;} }
.loop-txnA { animation: txnA 9s ease-in-out infinite; }
.loop-txnB { animation: txnB 9s ease-in-out infinite; }
.rise { animation: rise .7s cubic-bezier(.2,.7,.2,1) both; }
.loop-rail { transform-origin:left; animation: railfill 6s ease-in-out infinite; }
.loop-chip { animation: chipin 6s ease-in-out infinite; }
.loop-alloc { animation: allocgrow 7s ease-in-out infinite; }
.loop-amber { animation: amberout 7s ease-in-out infinite; }
.loop-caption { animation: captionswap 7s ease-in-out infinite; }
.loop-ledger { animation: ledger 9s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .rise, .loop-rail, .loop-chip, .loop-alloc, .loop-amber, .loop-caption, .loop-ledger, .loop-ph12, .loop-ph3, .loop-ph4, .lab1, .lab2, .lab3, .lab4, .tk1, .tk2, .tk3, .tk4, .tk5, .tkC, .sk1, .sk2, .sk3, .sk4, .sk5, .shimmer, .typeP, .cursW, .digA, .digB, .pdot, .st1, .st2, .st3, .nar1, .nar2, .nar3, .pE, .pMsg1, .optSel, .pSel, .pMsg2, .pPhoto, .beamOut, .beamBack, .loop-txnA, .loop-txnB { animation: none !important; }
  .loop-rail { transform:none; } .loop-alloc { width:var(--w) !important; }
  .loop-amber { opacity:0; } .loop-caption { opacity:1; } .loop-ledger { opacity:1; }
  .loop-ph12, .loop-ph3 { opacity:0; } .loop-ph4 { opacity:1; transform:none; }
  .lab4 { color:#8F3318; }
  .typeT, .blinkc, .askT, .chip20, .pillpop, .rawT, .skuT, .apprT, .loop-ph12, .btnQ, .vSel { animation: none !important; }
  .typeT { max-width:none; } .pillpop { transform:none; }
  .rawT { opacity:0; } .skuT { opacity:1; filter:none; transform:none; }
  .askT { opacity:0; } .apprT { opacity:1; }
  .btnQ { opacity:1; transform:none; } .vSel { transform:none; }
  .tk1, .tk2, .tk3, .tk4, .tk5, .tkC { opacity:1; transform:none; }
  .sk1, .sk2, .sk3, .sk4, .sk5 { opacity:0; }
  .typeP { max-width:none; } .cursW { opacity:0; } .digA { opacity:0; } .digB { opacity:1; }
  .st1, .st2 { opacity:0; } .st3 { opacity:1; }
  .nar1, .nar2 { opacity:0; } .nar3 { opacity:1; }
  .pE { opacity:0; } .pMsg1, .pSel, .pMsg2, .pPhoto { opacity:1; transform:none; }
  .beamOut, .beamBack { display:none; }
  .optSel { transform:none; background:#E3F3FB !important; }
  .loop-txnA { opacity:0; } .loop-txnB { opacity:1; transform:none; }
}
.btnp { transition: transform .25s cubic-bezier(.2,.7,.2,1), box-shadow .25s; }
.btnp:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(143,51,24,.22); }
.btnp:active { transform: translateY(0) scale(.98); }
.btnp .arr { transition: transform .25s cubic-bezier(.2,.7,.2,1); }
.btnp:hover .arr { transform: translateX(4px); }
.btng { transition: background .2s, transform .25s cubic-bezier(.2,.7,.2,1); }
.btng:hover { background: #F4F2EE; transform: translateY(-2px); }
.animgate * { animation-play-state: paused !important; }
.animgate.inview * { animation-play-state: running !important; }
.vcard { position: relative; overflow: hidden; box-shadow: 0 1px 2px rgba(30,26,21,0.04); transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s, border-color .35s; }
.vcard::after { content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit; background: linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 26%, rgba(160,130,109,0.045) 100%); }
.vcard:hover { transform: translateY(-5px); box-shadow: 0 16px 36px rgba(30,26,21,.08); border-color: #DCD6CE !important; }
.navlink { position: relative; }
.navlink::after { content:''; position:absolute; left:0; right:100%; bottom:-3px; height:1.5px; background:#BC4B27; transition: right .25s cubic-bezier(.2,.7,.2,1); }
.navlink:hover::after { right:0; }
.tlink { transition: color .2s; }
.tlink:hover { color:#BC4B27 !important; }
@media (hover:none), (prefers-reduced-motion: reduce) {
  .btnp:hover, .btng:hover, .vcard:hover { transform:none; box-shadow:none; }
  .navlink::after { display:none; }
  .heroglow { display:none; }
  .herobricks { display:none; }
}
html { scroll-behavior: smooth; }
`;
