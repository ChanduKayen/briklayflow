/**
 * Briklay — Landing + Auth (visual reference, v1)
 *
 * One page, two jobs: the story, and the door.
 *
 * SIGNATURE: live miniature vignettes of the product's own UI — the PO
 * lifecycle rail, the work-order allocation bar, the transaction ledger
 * line — animating on loop. The landing shows the actual product soul,
 * not screenshots. No other construction SaaS can copy this section,
 * because these elements are Briklay's design language.
 *
 * AUTH: slide-in panel (right sheet on desktop, full-screen on mobile),
 * sign-in / sign-up toggle. IMPLEMENTATION: bind the form to the EXISTING
 * Supabase auth handlers — this file is presentational; /login route
 * renders the same page with the panel open (deep-links survive).
 *
 * Voices, tokens, serif moments per the established Briklay system.
 * All motion respects prefers-reduced-motion (animations simply rest in
 * their final state).
 */

import { useState, useEffect, useRef } from "react";
import {
  ArrowRight, ArrowUpRight, ArrowDownLeft, Check, X, Mail, Lock,
  Truck, FileText, Camera, ChevronDown,
} from "lucide-react";

/* --------------------------------- tokens ----------------------------------- */

const V = {
  ink: "#1E1A15", inkSoft: "#3D3830",
  sys: "#6B6258", faint: "#9A9186",
  terra: "#BC4B27", terraDeep: "#8F3318", terraWash: "#FBEFE9",
  ask: "#8A5A0B", askWash: "#FBF3E0", askLine: "#E5C98F",
  sage: "#2F5D34", sageWash: "#E9F2E7",
  page: "#FBF9F6", surface: "#FFFFFF", field: "#F4F2EE", line: "#EAE6E0",
};
const SEG = ["#A0826D", "#B79E89", "#CDB7A4"];
const terraGrad = "linear-gradient(180deg, #C75530 0%, #B2441F 100%)";
const inkGrad = "linear-gradient(180deg, #2A251E 0%, #17130F 100%)";
const bandGrad = "linear-gradient(160deg, #26211B 0%, #1B1712 100%)";

function Gate({ children, className = "", ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const vh = window.innerHeight || 800;
          const h = e.boundingClientRect.height || 1;
          const needed = Math.min(0.6, (vh * 0.65) / h);
          if (e.intersectionRatio >= needed) el.classList.add("inview");
          else if (e.intersectionRatio <= needed * 0.25) el.classList.remove("inview");
        });
      },
      { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9, 1] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`animgate ${className}`} {...rest}>
      {children}
    </div>
  );
}
const font = { fontFamily: "'DM Sans', system-ui, sans-serif" };
const serif = { fontFamily: "Georgia, 'Times New Roman', serif" };
const nums = { fontVariantNumeric: "tabular-nums" };

/* ------------------------------ global styles -------------------------------- */

const CSS = `
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

/* ------------------------------ vignette pieces ------------------------------ */

function VignetteCapture() {
  return (
    <div className="vcard rounded-2xl p-5 sm:p-6" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", ...font }}>
          <b style={{ color: V.terraDeep }}>01</b> Create order
        </span>
        {/* synced stepper — the map for the loop */}
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", ...font }}>
          <span className="lab1" style={{ color: V.faint }}>Said</span>
          <span style={{ color: V.line }}>→</span>
          <span className="lab2" style={{ color: V.faint }}>Approved</span>
          <span style={{ color: V.line }}>→</span>
          <span className="lab3" style={{ color: V.faint }}>Quoted</span>
          <span style={{ color: V.line }}>→</span>
          <span className="lab4" style={{ color: V.faint }}>Awarded</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 mb-4">
        <span className="text-xs font-medium uppercase" style={{ color: V.terraDeep, letterSpacing: "0.1em", ...font }}>
          Say it. It's filed.
        </span>
      </div>

      <div className="relative" style={{ minHeight: 136 }}>

        {/* phases 1+2 — one scene: typed words resolve into the SKU, in place */}
        <div className="loop-ph12 absolute inset-0">
          <div className="relative" style={{ height: 32 }}>
            {/* the raw words, typed live, dissolve out */}
            <div className="rawT absolute inset-x-0 top-0">
              <p className="text-lg font-medium" style={{ color: V.ink, ...font }}>
                <span className="typeT">kankara 2 lorry</span><span className="blinkc" style={{ color: V.terra }}>|</span>
              </p>
            </div>
            {/* the SKU sharpens in, same position */}
            <div className="skuT absolute inset-x-0 top-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="pillpop inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: V.field, color: V.inkSoft, ...font }}>
                  <Check size={11} strokeWidth={3} /> linked
                </span>
                <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>Coarse aggregate · 20mm</p>
                <p className="text-sm" style={{ color: V.sys, ...font, ...nums }}>2 lorry → 14 MT</p>
              </div>
            </div>
          </div>
          <div className="relative mt-3" style={{ minHeight: 64 }}>
            {/* the question occupies the slot, then leaves */}
            <div className="askT absolute inset-x-0 top-0">
              <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl" style={{ background: V.askWash, border: `1px solid ${V.askLine}` }}>
                <p className="text-sm" style={{ color: "#6B4407", ...font }}>
                  Found coarse aggregate. Which size? <b className="chip20">20mm</b> · 12mm · 40mm
                </p>
              </div>
            </div>
            {/* approval arrives quietly, then the next action presents itself */}
            <div className="apprT absolute inset-x-0 top-0">
              <p className="text-xs" style={{ color: V.faint, ...font, ...nums }}>
                ✓ approved by you · 14:32
              </p>
              <button
                className="btnQ mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg"
                style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink, ...font, pointerEvents: "none" }}
                tabIndex={-1}
                aria-hidden="true"
              >
                Get quotes · 3 vendors <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* phase 3 — quotes */}
        <div className="loop-ph3 absolute inset-0">
          <p className="text-xs mb-2" style={{ color: V.sys, ...font }}>
            Quotes requested · your 3 aggregate vendors
          </p>
          <div className="space-y-1.5">
            <div className="vSel flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
              <span className="text-xs font-medium" style={{ color: V.ink, ...font }}>Sri Surya Lorry Transport</span>
              <span className="text-xs font-medium" style={{ color: V.ink, ...font, ...nums }}>₹30,400 <span style={{ color: V.terraDeep }}>· best price</span></span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: V.field }}>
              <span className="text-xs" style={{ color: V.sys, ...font }}>Godavari Aggregates</span>
              <span className="text-xs" style={{ color: V.sys, ...font, ...nums }}>₹31,850</span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: V.field }}>
              <span className="text-xs" style={{ color: V.sys, ...font }}>Coastal Sands</span>
              <span className="text-xs" style={{ color: V.sys, ...font, ...nums }}>₹32,100</span>
            </div>
          </div>
          <p className="text-xs mt-2" style={{ color: V.faint, ...font }}>
            checked against what you last paid. No quiet rate creep
          </p>
        </div>

        {/* phase 4 — awarded */}
        <div className="loop-ph4 absolute inset-0">
          <div className="rounded-xl px-4 py-3" style={{ background: V.sageWash }}>
            <p className="text-sm font-medium" style={{ color: V.sage, ...font, ...nums }}>
              PO-0152 awarded · Sri Surya Lorry Transport · ₹30,400
            </p>
            <p className="text-xs mt-1" style={{ color: V.sage, ...font }}>
              vendor notified · order open for goods receival
            </p>
          </div>
          <p className="text-xs mt-2.5" style={{ color: V.faint, ...font }}>
            One typed line became an approved order, at the best price
          </p>
        </div>

      </div>
    </div>
  );
}

function VignettePO() {
  return (
    <div className="vcard rounded-2xl p-5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", ...font }}>
        <b style={{ color: V.terraDeep }}>02</b> Track order
      </span>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium" style={{ color: V.ink, ...font }}>Sri Surya Lorry Transport</p>
          <p className="text-xs" style={{ color: V.sys, ...font }}>PO-0152 · coarse aggregate 20mm · 14 MT</p>
        </div>
        <p className="text-sm font-medium" style={{ color: V.ink, ...font, ...nums }}>₹30,400</p>
      </div>
      <div className="flex gap-1 my-3.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: V.line }}>
            <div className="h-full rounded-full loop-rail" style={{ background: V.userSoft, animationDelay: `${i * 1.1}s` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {[
          { Icon: Truck, label: "Goods received", d: "1.1s" },
          { Icon: FileText, label: "Bill entered", d: "2.2s" },
          { Icon: Camera, label: "Photo on file", d: "3.3s" },
        ].map(({ Icon, label, d }) => (
          <span
            key={label}
            className="loop-chip inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ background: V.field, color: V.inkSoft, animationDelay: d, ...font }}
          >
            <Check size={11} strokeWidth={3} /> {label}
          </span>
        ))}
      </div>
      <p className="text-xs mt-3.5" style={{ color: V.faint, ...font }}>
        the order knows its own next step
      </p>
    </div>
  );
}

function VignetteWO() {
  const widths = [36, 28, 36];
  return (
    <div className="vcard rounded-2xl p-5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", ...font }}>
        <b style={{ color: V.terraDeep }}>04</b> Assign &amp; track work
      </span>
      <p className="text-sm leading-relaxed" style={{ color: V.inkSoft, ...serif }}>
        Hiring <b>Harish K</b> for <b>The Pride</b>, worth{" "}
        <b style={nums}>₹5,00,000</b>, paid in <b>3 stages</b>.
      </p>
      <div className="relative flex h-3 rounded-full overflow-hidden mt-4" style={{ background: V.askWash }}>
        {widths.map((w, i) => (
          <div key={i} className="h-full loop-alloc" style={{ "--w": `${w}%`, background: SEG[i], animationDelay: `${i * 0.9}s` }} />
        ))}
        <div className="absolute inset-0 loop-amber" style={{ background: "transparent", border: `1px solid ${V.askLine}`, borderRadius: 999 }} />
      </div>
      <div className="relative mt-2" style={{ height: 18 }}>
        <p className="absolute inset-0 text-xs loop-amber" style={{ color: V.ask, ...font, ...nums }}>
          ₹1,80,000 not yet staged…
        </p>
        <p className="absolute inset-0 text-xs loop-caption" style={{ color: V.sage, ...font, ...nums }}>
          the full ₹5,00,000 is allocated. Reconciled
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mt-3" style={{ background: V.field }}>
        <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>✓ stage 1 paid · ₹1,80,000</p>
        <p className="text-xs" style={{ color: V.sys, ...font, ...nums }}>stage 2 due 5 Jul</p>
      </div>
      <p className="text-xs mt-3" style={{ color: V.faint, ...font }}>
        work is paid stage by stage, against the order. No loose payments
      </p>
    </div>
  );
}

function VignetteTxn() {
  return (
    <div className="vcard rounded-2xl p-5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", ...font }}>
        <b style={{ color: V.terraDeep }}>03</b> Pay against it
      </span>
      <div className="relative" style={{ minHeight: 150 }}>

        {/* phase 1 — you say the payment */}
        <div className="loop-txnA absolute inset-0">
          <p className="text-xs mb-2" style={{ color: V.faint, ...font }}>you said</p>
          <p className="text-base font-medium" style={{ color: V.ink, ...font }}>
            paid 14,000 to Sri Surya<span style={{ color: V.terra }}>|</span>
          </p>
          <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: V.sys, ...font }}>
            <ArrowUpRight size={12} color={V.terraDeep} /> money out · finding its order…
          </p>
        </div>

        {/* phase 2 — matched to THE order, balance updated, guard stated */}
        <div className="loop-txnB absolute inset-0">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: V.terraWash }}>
              <ArrowUpRight size={13} color={V.terraDeep} />
            </span>
            <p className="text-xs flex-1" style={{ color: V.inkSoft, ...font }}>
              Sri Surya · <b>against PO-0152</b>
            </p>
            <p className="text-sm font-medium" style={{ color: V.terraDeep, ...font, ...nums }}>− ₹14,000</p>
          </div>
          <div className="rounded-xl px-3 py-2.5 mt-3" style={{ background: V.field }}>
            <p className="text-xs" style={{ color: V.sage, ...font, ...nums }}>
              ✓ matched to your open order with this vendor
            </p>
            <p className="text-xs mt-1" style={{ color: V.inkSoft, ...font, ...nums }}>
              PO-0152: ₹14,000 paid · ₹16,400 remaining
            </p>
          </div>
          <p className="text-xs mt-2.5" style={{ color: V.faint, ...font }}>
            a payment above the order's balance gets flagged, not filed
          </p>
        </div>

      </div>
    </div>
  );
}

/* --------------------------------- auth panel -------------------------------- */

function AuthPanel({ open, mode, setMode, onClose }) {
  if (!open) return null;
  const signin = mode === "signin";
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={font}>
      <div className="absolute inset-0" style={{ background: "rgba(30,26,21,0.45)" }} onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md h-full overflow-y-auto p-7 sm:p-10 flex flex-col"
        style={{ background: V.page }}
        role="dialog" aria-modal="true" aria-label={signin ? "Sign in" : "Create account"}
      >
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold" style={{ color: V.ink }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </p>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full" style={{ color: V.faint }}>
            <X size={18} />
          </button>
        </div>

        <div className="mt-10">
          <h2 className="text-2xl" style={{ color: V.ink, ...serif }}>
            {signin ? "Welcome back." : "Start building."}
          </h2>
          <p className="text-sm mt-1.5" style={{ color: V.sys }}>
            {signin ? "Your sites are where you left them." : "Free to start. Set up your first project in minutes."}
          </p>
        </div>

        <div className="mt-8 space-y-3">
          {!signin && (
            <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
              <span className="text-xs" style={{ color: V.faint }}>Aa</span>
              <input placeholder="Your name" aria-label="Your name" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
            </div>
          )}
          <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
            <Mail size={15} style={{ color: V.faint }} />
            <input placeholder="Email address" type="email" aria-label="Email address" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
          </div>
          <div className="flex items-center gap-2.5 px-4 rounded-xl" style={{ background: V.surface, border: `1px solid ${V.line}`, height: 50 }}>
            <Lock size={15} style={{ color: V.faint }} />
            <input placeholder="Password" type="password" aria-label="Password" className="flex-1 bg-transparent text-sm outline-none" style={{ color: V.ink }} />
          </div>
          {signin && (
            <div className="text-right">
              <button className="text-xs" style={{ color: V.sys }}>Forgot password?</button>
            </div>
          )}
        </div>

        <button
          className="btnp mt-6 w-full py-3.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2"
          style={{ background: terraGrad, color: "#fff" }}
        >
          {signin ? "Sign in" : "Create account"} <ArrowRight size={15} className="arr" />
        </button>

        <p className="text-sm mt-6 text-center" style={{ color: V.sys }}>
          {signin ? "New to Briklay? " : "Already have an account? "}
          <button onClick={() => setMode(signin ? "signup" : "signin")} className="font-medium underline" style={{ color: V.ink }}>
            {signin ? "Create an account" : "Sign in"}
          </button>
        </p>

        <p className="text-xs mt-auto pt-10 text-center" style={{ color: V.faint }}>
          Built by builders, for builders · your data stays yours
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------ page ----------------------------------- */

export default function BriklayLanding() {
  const [auth, setAuth] = useState(false);
  const [mode, setMode] = useState("signin");
  const open = (m) => { setMode(m); setAuth(true); };

  const heroRef = useRef(null);
  const heroPos = useRef({ x: 440, y: 220, tx: 440, ty: 220 });
  useEffect(() => {
    let raf;
    const tick = () => {
      const p = heroPos.current;
      p.x += (p.tx - p.x) * 0.12;
      p.y += (p.ty - p.y) * 0.12;
      if (heroRef.current) {
        heroRef.current.style.setProperty("--mx", `${p.x}px`);
        heroRef.current.style.setProperty("--my", `${p.y}px`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location?.pathname === "/login") setAuth(true);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: V.page, ...font }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet" />
      <style>{CSS}</style>

      {/* nav */}
      <nav className="sticky top-0 z-40" style={{ background: "rgba(251,249,246,0.85)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${V.line}` }}>
        <div className="mx-auto px-5 sm:px-8 h-16 flex items-center gap-6" style={{ maxWidth: 1080 }}>
          <p className="text-lg font-semibold" style={{ color: V.ink }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </p>
          <div className="hidden sm:flex gap-5 text-sm" style={{ color: V.sys }}>
            <a href="#magic" className="navlink" style={{ color: "inherit", textDecoration: "none" }}>Product</a>
            <a href="#why" className="navlink" style={{ color: "inherit", textDecoration: "none" }}>Why Briklay</a>
            <a href="#builder" className="navlink" style={{ color: "inherit", textDecoration: "none" }}>Our story</a>
          </div>
          <span className="flex-1" />
          <button onClick={() => open("signin")} className="tlink text-sm font-medium" style={{ color: V.ink }}>
            Sign in
          </button>
          <button
            onClick={() => open("signup")}
            className="btnp text-sm font-medium px-4 py-2.5 rounded-xl hidden sm:inline-flex items-center gap-1.5"
            style={{ background: inkGrad, color: "#fff" }}
          >
            Start free <ArrowRight size={14} className="arr" />
          </button>
        </div>
      </nav>

      {/* hero */}
      <section
        ref={heroRef}
        className="relative mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-14 text-center"
        style={{ maxWidth: 880, "--reveal": 0 }}
        onMouseEnter={(e) => e.currentTarget.style.setProperty("--reveal", 1)}
        onMouseLeave={(e) => e.currentTarget.style.setProperty("--reveal", 0)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          heroPos.current.tx = e.clientX - r.left;
          heroPos.current.ty = e.clientY - r.top;
        }}
      >
        <div
          className="heroglow absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background: "radial-gradient(300px circle at var(--mx, 50%) var(--my, 35%), rgba(188,75,39,0.035), transparent 70%)",
            opacity: "var(--reveal, 0)",
            transition: "opacity .6s ease",
          }}
        />
        <div
          className="herobricks absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='32'%3E%3Cpath d='M0 0H56M0 16H56M28 0V16M14 16V32M42 16V32' stroke='%23BC4B27' stroke-opacity='0.16' stroke-width='1'/%3E%3C/svg%3E")`,
            WebkitMaskImage: "radial-gradient(200px circle at var(--mx, 50%) var(--my, 40%), rgba(0,0,0,0.55), rgba(0,0,0,0.18) 55%, transparent 80%)",
            maskImage: "radial-gradient(200px circle at var(--mx, 50%) var(--my, 40%), rgba(0,0,0,0.55), rgba(0,0,0,0.18) 55%, transparent 80%)",
            opacity: "var(--reveal, 0)",
            transition: "opacity .6s ease",
          }}
        />
        <p className="rise text-xs font-medium uppercase" style={{ color: V.terraDeep, letterSpacing: "0.14em", animationDelay: ".05s" }}>
          Built on real sites
        </p>
        <h1
          className="rise mt-5 leading-tight"
          style={{ color: V.ink, fontSize: "clamp(2.2rem, 5.5vw, 4rem)", animationDelay: ".15s", ...serif }}
        >
          Construction software your
          <br />
          supervisor will actually use.
        </h1>
        <p className="rise text-base sm:text-lg mt-6 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 560, animationDelay: ".3s" }}>
          No forms to learn. No evening data entry. Your team says it the way
          they'd say it on site. A payment, a material need, a work order.
          Briklay files it as clean, verifiable records.
        </p>
        <div className="rise mt-8 flex items-center justify-center gap-3 flex-wrap" style={{ animationDelay: ".45s" }}>
          <button
            onClick={() => open("signup")}
            className="btnp text-sm font-medium px-6 py-3.5 rounded-xl inline-flex items-center gap-2"
            style={{ background: terraGrad, color: "#fff" }}
          >
            Start free <ArrowRight size={15} className="arr" />
          </button>
          <a
            href="#magic"
            className="btng text-sm font-medium px-6 py-3.5 rounded-xl inline-flex items-center gap-2"
            style={{ border: `1px solid ${V.line}`, color: V.ink, textDecoration: "none" }}
          >
            See it work <ChevronDown size={15} />
          </a>
        </div>
        <p className="rise text-xs mt-5" style={{ color: V.faint, animationDelay: ".55s" }}>
          no card needed · works in Telugu and English
        </p>
      </section>

      {/* manifesto */}
      <section className="mx-auto px-5 sm:px-8 py-16 text-center" style={{ maxWidth: 680 }}>
        <p className="text-2xl sm:text-3xl leading-snug" style={{ color: V.ink, ...serif }}>
          You don't need great technology.
        </p>
        <p className="text-2xl sm:text-3xl leading-snug mt-1" style={{ color: V.terra, ...serif }}>
          You need the right data.
        </p>
        <p className="text-sm sm:text-base mt-6 leading-relaxed" style={{ color: V.sys }}>
          Briklay doesn't wait for your site to report. It chases your
          supervisor on WhatsApp until the information actually arrives. Then
          it cleans it, standardizes it, and files it so anything can be found
          in one search. That's how the books stay true without anyone
          learning software.
        </p>
      </section>

      {/* the magic — live vignettes */}
      <section id="magic" className="mx-auto px-5 sm:px-8 py-14" style={{ maxWidth: 1080 }}>
        <p className="text-center text-2xl sm:text-3xl" style={{ color: V.ink, ...serif }}>
          Construction <span style={{ color: V.terra, borderBottom: `2px dashed ${V.askLine}` }}>Magic</span>, shown, not told.
        </p>
        <p className="text-center text-sm mt-3" style={{ color: V.sys }}>
          These aren't screenshots. This is the product, running. Watch one
          order travel: created, tracked, paid. Then the same discipline for
          assigned work.
        </p>
        <Gate className="mt-10">
          <VignetteCapture />
        </Gate>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <Gate><VignettePO /></Gate>
          <Gate><VignetteTxn /></Gate>
          <Gate><VignetteWO /></Gate>
        </div>
      </section>

      {/* site management — the star chapter: board and WhatsApp, side by side */}
      <section style={{ background: V.field }}>
        <div className="mx-auto px-5 sm:px-8 py-20" style={{ maxWidth: 1080 }}>
          <p className="text-center text-xs font-medium uppercase" style={{ color: V.terraDeep, letterSpacing: "0.14em" }}>
            Site management
          </p>
          <h2 className="text-center text-3xl sm:text-4xl mt-4 leading-snug" style={{ color: V.ink, ...serif }}>
            We don't rely on what's provided.
            <br />
            We ask for what's needed.
          </h2>
          <p className="text-center text-sm sm:text-base mt-5 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 620 }}>
            Tell Briklay the scope. It sets up the project itself: the tasks,
            and the quality checks under each one. Then it doesn't wait for
            reports. It asks your supervisor on WhatsApp, and keeps asking,
            until the data is whole.
          </p>

          <Gate className="relative grid sm:grid-cols-2 gap-8 sm:gap-10 mt-12 mx-auto items-start" style={{ maxWidth: 920 }}>

            {/* the cause-and-effect wire between the two worlds */}
            <div className="hidden sm:block absolute" aria-hidden="true" style={{ left: "50%", top: 260, width: 72, transform: "translateX(-50%)", zIndex: 1 }}>
              <div className="relative overflow-hidden" style={{ height: 14 }}>
                <span className="beamOut absolute" style={{ left: -52, top: 5.5, width: 48, height: 3, borderRadius: 3, background: "linear-gradient(90deg, transparent, rgba(188,75,39,0.55) 40%, rgba(199,85,48,0.95) 62%, rgba(255,224,205,0.95) 74%, rgba(188,75,39,0.9) 84%, transparent)", boxShadow: "0 0 7px rgba(188,75,39,0.45)" }} />
                <span className="beamBack absolute" style={{ left: 80, top: 5.5, width: 48, height: 3, borderRadius: 3, background: "linear-gradient(270deg, transparent, rgba(47,93,52,0.55) 40%, rgba(63,115,69,0.95) 62%, rgba(214,238,216,0.95) 74%, rgba(47,93,52,0.9) 84%, transparent)", boxShadow: "0 0 7px rgba(47,93,52,0.45)" }} />
              </div>
            </div>

            {/* demo 1 — the Briklay board */}
            <div>
              <p className="text-center text-xs font-medium uppercase mb-3" style={{ color: V.faint, letterSpacing: "0.12em", ...font }}>
                in Briklay · your task board
              </p>
              <div className="vcard rounded-2xl p-5 sm:p-6" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-xs" style={{ color: V.faint, ...font }}>Describe your project</p>
                <p className="text-sm font-medium mt-1.5" style={{ color: V.ink, ...font }}>
                  <span className="typeP">G+2 residence, 1550 sft each floor</span><span className="cursW"><span className="blinkc" style={{ color: V.terra }}>|</span></span>
                </p>
                <div className="relative mt-2 mb-4" style={{ height: 18, overflow: "hidden" }}>
                  <div className="digA absolute inset-0 flex items-center gap-1.5">
                    <span className="pdot w-1.5 h-1.5 rounded-full" style={{ background: V.terra }} />
                    <span className="pdot w-1.5 h-1.5 rounded-full" style={{ background: V.terra, animationDelay: ".18s" }} />
                    <span className="pdot w-1.5 h-1.5 rounded-full" style={{ background: V.terra, animationDelay: ".36s" }} />
                    <span className="text-xs ml-1" style={{ color: V.faint, fontStyle: "italic", ...font }}>reading your project&#8230;</span>
                  </div>
                  <div className="digB absolute inset-0">
                    <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>
                      &#10003; understood · 3 floors · 1,550 sft each · structure &amp; finishing
                    </p>
                  </div>
                  <p className="nar1 absolute inset-0 text-xs font-medium leading-snug" style={{ color: V.terraDeep, ...font }}>
                    Tasks and quality checks created automatically.
                  </p>
                  <p className="nar2 absolute inset-0 text-xs font-medium leading-snug" style={{ color: V.terraDeep, ...font }}>
                    It asks your supervisor when information is missing.
                  </p>
                  <p className="nar3 absolute inset-0 text-xs font-medium leading-snug" style={{ color: V.terraDeep, ...font }}>
                    Every reply gets saved against the right task.
                  </p>
                </div>
                <div className="space-y-3.5">
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk1 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: "58%" }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: "italic", ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: "72%" }} />
                    </div>
                    <div className="tk1 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[0] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>Footings &amp; plinth</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: rebar cover · pour photos · level check</p>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk2 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: "58%" }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: "italic", ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: "72%" }} />
                    </div>
                    <div className="tk2 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[1] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>GF brickwork</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: line &amp; level · joint thickness</p>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk3 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: "58%" }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: "italic", ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: "72%" }} />
                    </div>
                    <div className="tk3 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[2] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>2nd floor slab · curing</p>
                        <span className="relative shrink-0" style={{ width: 104, height: 16 }}>
                          <span className="st1 absolute inset-0 text-xs text-right" style={{ color: V.faint, ...font }}>created</span>
                          <span className="st2 absolute inset-0 text-xs text-right" style={{ color: "#6B4407", ...font }}>follow-up sent</span>
                          <span className="st3 absolute inset-0 text-xs text-right" style={{ color: V.sage, ...font }}>&#10003; QC passed</span>
                        </span>
                      </div>
                      <div className="relative ml-5 mt-0.5" style={{ height: 16 }}>
                        <p className="st1 absolute inset-0 text-xs" style={{ color: V.faint, ...font }}>QC: day-3 photos · surface check</p>
                        <p className="st2 absolute inset-0 text-xs" style={{ color: "#854F0B", ...font }}>asked the supervisor for photos · just now</p>
                        <p className="st3 absolute inset-0 text-xs" style={{ color: V.sage, ...font }}>2 photos verified · answered in 40 min</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk4 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: "58%" }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: "italic", ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: "72%" }} />
                    </div>
                    <div className="tk4 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[0] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>1st floor columns</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: verticality · cover blocks · pour photos</p>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk5 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: "58%" }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: "italic", ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: "72%" }} />
                    </div>
                    <div className="tk5 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[1] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>Bathroom waterproofing</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: slope check · pond test photos</p>
                    </div>
                  </div>
                </div>
                <div className="tkC rounded-xl px-3.5 py-2.5 mt-4" style={{ background: V.field }}>
                  <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>
                    &#10003; 5 tasks · 13 quality checks created from one line
                  </p>
                </div>
              </div>
            </div>

            {/* demo 2 — the supervisor's WhatsApp */}
            <div>
              <p className="text-center text-xs font-medium uppercase mb-3" style={{ color: V.faint, letterSpacing: "0.12em", ...font }}>
                on WhatsApp · no app for him to learn
              </p>
              <div
                className="mx-auto rounded-2xl overflow-hidden"
                style={{
                  maxWidth: 300,
                  background: "#ECE5DD",
                  backgroundImage: "radial-gradient(circle at 8px 8px, rgba(69,57,42,0.05) 1.3px, transparent 1.6px), radial-gradient(circle at 21px 22px, rgba(69,57,42,0.04) 1px, transparent 1.3px)",
                  backgroundSize: "28px 28px",
                  border: `1px solid ${V.line}`,
                  boxShadow: "0 6px 20px rgba(30,26,21,0.08)",
                }}
              >
                <div className="relative px-3 py-3" style={{ minHeight: 332 }}>
                  {/* date chip — mid-chat crop */}
                  <div className="flex justify-center mb-3">
                    <span className="rounded-lg px-2 py-1" style={{ background: "rgba(255,255,255,0.92)", color: "#54656F", fontSize: 10, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)", ...font }}>TODAY</span>
                  </div>
                  <p className="pE absolute inset-x-0 text-center text-xs" style={{ color: "#8696A0", top: 156, ...font }}>
                    nothing pending today
                  </p>

                  {/* Briklay asks — incoming, left, with reply buttons */}
                  <div className="pMsg1">
                    <div className="mr-auto relative rounded-lg px-2 py-1.5" style={{ background: "#FFFFFF", maxWidth: 228, borderTopLeftRadius: 0, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>
                      <span aria-hidden="true" style={{ position: "absolute", top: 0, left: -7, width: 0, height: 0, borderTop: "0 solid transparent", borderBottom: "10px solid transparent", borderRight: "8px solid #FFFFFF" }} />
                      <p className="text-xs leading-snug" style={{ color: "#111B21", ...font }}>
                        Suresh garu, 2nd floor slab &#183; day-3 curing. Status?
                      </p>
                      <p className="text-right" style={{ color: "#667781", fontSize: 10, marginTop: 2, ...font }}>9:02 am</p>
                    </div>
                    <div className="mr-auto mt-1 space-y-1" style={{ maxWidth: 228 }}>
                      <div className="optSel text-center py-1.5 rounded-lg" style={{ color: "#00A5F4", fontSize: 12, fontWeight: 500, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)", ...font }}>
                        Curing done
                      </div>
                      <div className="text-center py-1.5 rounded-lg" style={{ background: "#FFFFFF", color: "#00A5F4", fontSize: 12, fontWeight: 500, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)", ...font }}>
                        Still in progress
                      </div>
                      <div className="text-center py-1.5 rounded-lg" style={{ background: "#FFFFFF", color: "#00A5F4", fontSize: 12, fontWeight: 500, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)", ...font }}>
                        Issue on site
                      </div>
                    </div>
                  </div>

                  {/* Suresh selects — outgoing, right */}
                  <div className="pSel mt-2.5">
                    <div className="ml-auto relative rounded-lg px-2 py-1.5" style={{ background: "#D9FDD3", maxWidth: 160, borderTopRightRadius: 0, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>
                      <span aria-hidden="true" style={{ position: "absolute", top: 0, right: -7, width: 0, height: 0, borderBottom: "10px solid transparent", borderLeft: "8px solid #D9FDD3" }} />
                      <p className="text-xs leading-snug" style={{ color: "#111B21", ...font }}>
                        Curing done
                        <span style={{ color: "#667781", fontSize: 10, marginLeft: 8 }}>9:38 am <span style={{ color: "#53BDEB" }}>&#10003;&#10003;</span></span>
                      </p>
                    </div>
                  </div>

                  {/* Briklay asks for proof — incoming, left */}
                  <div className="pMsg2 mt-2.5">
                    <div className="mr-auto relative rounded-lg px-2 py-1.5" style={{ background: "#FFFFFF", maxWidth: 228, borderTopLeftRadius: 0, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>
                      <span aria-hidden="true" style={{ position: "absolute", top: 0, left: -7, width: 0, height: 0, borderBottom: "10px solid transparent", borderRight: "8px solid #FFFFFF" }} />
                      <p className="text-xs leading-snug" style={{ color: "#111B21", ...font }}>
                        Super. 2 photos of the slab surface please?
                        <span style={{ color: "#667781", fontSize: 10, marginLeft: 8 }}>9:38 am</span>
                      </p>
                    </div>
                  </div>

                  {/* Suresh sends the site photo — outgoing, right, time on image */}
                  <div className="pPhoto mt-2.5">
                    <div className="ml-auto relative rounded-lg" style={{ background: "#D9FDD3", maxWidth: 178, padding: 3, borderTopRightRadius: 0, boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>
                      <span aria-hidden="true" style={{ position: "absolute", top: 0, right: -7, width: 0, height: 0, borderBottom: "10px solid transparent", borderLeft: "8px solid #D9FDD3" }} />
                      <div className="relative rounded-md overflow-hidden">
                        <svg viewBox="0 0 172 96" width="100%" height="92" preserveAspectRatio="none" aria-hidden="true">
                          <rect width="172" height="96" fill="#A8A296" />
                          <rect y="62" width="172" height="34" fill="#98917f" />
                          <ellipse cx="66" cy="47" rx="50" ry="17" fill="#7E7869" opacity="0.85" />
                          <ellipse cx="58" cy="42" rx="24" ry="7" fill="#C9C4B6" opacity="0.5" />
                          <rect y="80" width="172" height="16" fill="#8A6B49" />
                          <rect y="80" width="172" height="2.5" fill="#6E5439" />
                          <line x1="0" y1="62" x2="172" y2="62" stroke="#6F6A5D" strokeWidth="1" opacity="0.6" />
                          <circle cx="126" cy="32" r="2" fill="#6F6A5D" /><circle cx="142" cy="52" r="1.6" fill="#6F6A5D" /><circle cx="26" cy="24" r="1.8" fill="#6F6A5D" /><circle cx="102" cy="68" r="1.5" fill="#7E7869" />
                        </svg>
                        <span className="absolute top-1 left-1 rounded px-1" style={{ background: "rgba(17,27,33,0.5)", color: "#fff", fontSize: 9, ...font }}>1 of 2</span>
                        <span className="absolute bottom-1 right-1.5" style={{ color: "#fff", fontSize: 10, textShadow: "0 1px 2px rgba(0,0,0,0.6)", ...font }}>
                          9:41 am <span style={{ color: "#53BDEB" }}>&#10003;&#10003;</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </Gate>

          <p className="text-center text-lg sm:text-xl mt-10" style={{ color: V.inkSoft, ...serif }}>
            You set up nothing. You get the honest picture.
          </p>
        </div>
      </section>

      {/* why — questions */}
      <section id="why" className="py-16" style={{ background: V.surface, borderTop: `1px solid ${V.line}`, borderBottom: `1px solid ${V.line}` }}>
        <div className="mx-auto px-5 sm:px-8 grid sm:grid-cols-3 gap-10" style={{ maxWidth: 1080 }}>
          {[
            ["Where did the money go?", "Every payment answers a question before it settles: against which purchase order, which work order, which stage? A rupee with no parent gets flagged, never quietly filed. That's where leaks used to live."],
            ["What's pending on site?", "Every purchase order shows its own next step: goods, bill, photo. Nothing waits in someone's memory."],
            ["Will my site team actually use it?", "They won't be typing. The AI is. Pages read like sentences, questions come in plain Telugu and English, and a bill photo files itself."],
          ].map(([q, a]) => (
            <div key={q}>
              <h3 className="text-lg" style={{ color: V.ink, ...serif }}>{q}</h3>
              <p className="text-sm mt-2.5 leading-relaxed" style={{ color: V.sys }}>{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* the colleague — vision, honestly marked */}
      <section className="mx-auto px-5 sm:px-8 py-20" style={{ maxWidth: 1080 }}>
        <div className="grid sm:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-medium uppercase" style={{ color: V.faint, letterSpacing: "0.14em" }}>
              Coming next
            </p>
            <h2 className="text-2xl sm:text-3xl mt-4 leading-snug" style={{ color: V.ink, ...serif }}>
              You don't change where you work.
              <br />
              We come to where you work.
            </h2>
            <p className="text-sm mt-4 leading-relaxed" style={{ color: V.sys }}>
              Say it on WhatsApp. You stay there. Briklay runs the complete
              back office behind it: files it, checks the rate against what
              you last paid, chases the supervisor for photos, flags what
              doesn't add up. Then it brings you the site's honest story, the
              way a good site engineer would.
            </p>
            <p className="text-base mt-5" style={{ color: V.inkSoft, ...serif }}>
              A site engineer + an assistant = <b>Briklay</b>.
            </p>
            <button
              onClick={() => open("signup")}
              className="btnp mt-6 text-sm font-medium px-5 py-3 rounded-xl inline-flex items-center gap-2"
              style={{ border: `1px solid ${V.line}`, color: V.ink, background: V.surface }}
            >
              Join the early list <ArrowRight size={14} className="arr" />
            </button>
          </div>

          {/* chat mock */}
          <div className="vcard rounded-3xl p-4 sm:p-5" style={{ background: V.field, border: `1px solid ${V.line}` }}>
            <div className="space-y-2.5">
              <div className="ml-auto max-w-xs rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: V.sageWash }}>
                <p className="text-sm" style={{ color: V.ink }}>paid 20,000 to A Raju for Sunshine Residence</p>
              </div>
              <div className="mr-auto max-w-xs rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-sm" style={{ color: V.ink }}>
                  Recorded. <b style={nums}>− ₹20,000</b> to A Raju · Sunshine
                  Residence. He has an open work order here: brickwork, stage
                  2 of 4 (<span style={nums}>₹65,000</span> milestone). Link
                  this payment there, or is it separate?
                </p>
              </div>
              <div className="ml-auto max-w-xs rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: V.sageWash }}>
                <p className="text-sm" style={{ color: V.ink }}>need kankara 20mm, 2 lorry</p>
              </div>
              <div className="mr-auto max-w-xs rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-sm" style={{ color: V.ink }}>
                  Drafted PO: coarse aggregate · 20mm · 14 MT. Want me to get
                  quotes from your 3 aggregate vendors first?
                </p>
              </div>
              <div className="ml-auto max-w-xs rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: V.sageWash }}>
                <p className="text-sm" style={{ color: V.ink }}>how's quality at The Pride?</p>
              </div>
              <div className="mr-auto max-w-xs rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-sm" style={{ color: V.ink }}>
                  2nd-floor plastering passed QC yesterday (photos on file).
                  One flag: bathroom waterproofing. Supervisor's photos show
                  curing started a day early. I've asked him about it.
                </p>
              </div>
            </div>
            <p className="text-xs mt-4 text-center" style={{ color: V.faint }}>
              in development · shown as designed
            </p>
          </div>
        </div>
      </section>

      {/* the builder */}
      <section id="builder" className="mx-auto px-5 sm:px-8 py-20 text-center" style={{ maxWidth: 760 }}>
        <p className="text-xs font-medium uppercase" style={{ color: V.faint, letterSpacing: "0.14em" }}>
          The Briklay story
        </p>
        <p className="text-2xl sm:text-3xl mt-5" style={{ color: V.ink, ...serif }}>
          Built by builders, for builders.
        </p>
        <p className="text-lg sm:text-xl mt-5 leading-relaxed" style={{ color: V.inkSoft, ...serif }}>
          “Briklay wasn't designed in a boardroom. It comes from 200,000+ sq ft
          of delivered work, turned into software by a passionate group of
          engineers who know exactly where money and time leak on a site.”
        </p>
        <p className="text-sm mt-5" style={{ color: V.sys }}>
          Briklay Engineering
        </p>
      </section>

      {/* final CTA */}
      <section className="mx-auto px-5 sm:px-8 pb-24 text-center" style={{ maxWidth: 760 }}>
        <div className="rounded-3xl px-6 py-12" style={{ background: bandGrad }}>
          <p className="text-2xl sm:text-3xl" style={{ color: "#fff", ...serif }}>
            Run your next project on Briklay.
          </p>
          <p className="text-sm mt-3" style={{ color: "rgba(255,255,255,0.65)" }}>
            Free to start. Honest pricing when you grow. Your data stays yours.
          </p>
          <button
            onClick={() => open("signup")}
            className="btnp mt-7 text-sm font-medium px-7 py-3.5 rounded-xl inline-flex items-center gap-2"
            style={{ background: terraGrad, color: "#fff" }}
          >
            Start free <ArrowRight size={15} className="arr" />
          </button>
        </div>
      </section>

      {/* footer */}
      <footer style={{ borderTop: `1px solid ${V.line}` }}>
        <div className="mx-auto px-5 sm:px-8 py-8 flex items-center gap-3 flex-wrap text-xs" style={{ maxWidth: 1080, color: V.faint }}>
          <p className="font-semibold text-sm" style={{ color: V.ink }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </p>
          <span>· built by builders, for builders</span>
          <span className="flex-1" />
          <span>© 2026 Briklay Engineering</span>
          <button onClick={() => open("signin")} className="tlink" style={{ color: V.sys }}>Sign in</button>
        </div>
      </footer>

      <AuthPanel open={auth} mode={mode} setMode={setMode} onClose={() => setAuth(false)} />
    </div>
  );
}
