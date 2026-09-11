/**
 * The payment run's stylesheet — the paymentsrunredesign reference, verbatim, with every selector
 * scoped under `.pyr` so it cannot touch the rest of the app. Rule order, and so the cascade, is
 * exactly the reference's, its @media blocks included.
 *
 * Two adaptations, neither visual: `:root`, `html` and `body` fold into `.pyr` (the page is a div
 * here, not a document), and the two keyframes are namespaced so they cannot collide.
 *
 * After the reference come the rules it had no need for, written in its own tokens: the
 * why-is-this-different popover, the rate card, and the add / recurring forms. The reference is a
 * run of rows; Briklay's run also carries the machinery that PRODUCES those rows, and that
 * machinery has to live somewhere.
 */
export const PYR_CSS = `
.pyr{--paper:#F3EFE6; --card:#FBF9F3; --card2:#F7F3EA;
  --ink:#27221B; --ink2:#79705F; --ink3:#A99F8C;
  --line:#E7E0D1; --line2:#EFE9DB;
  --terra:#C2553B; --red:#BA4B32; --sage:#7C8B72; --gold:#B9892C;
  --cell:#E4E9DF; --today:#F6EEDE;
  --asm:#BA4B32; --chak:#7C8B72; --shyam:#B9892C; --sound:#5D7183;
  --serif:"Source Serif 4", Georgia, serif;
  --mono:"IBM Plex Mono", ui-monospace, monospace;
  --sans:"Karla", system-ui, sans-serif;}
.pyr *{box-sizing:border-box;margin:0;padding:0}
.pyr{-webkit-font-smoothing:antialiased}
.pyr{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:14px;padding:46px clamp(18px,4vw,64px) 100px}
.pyr .wrap{max-width:1240px;margin:0 auto}
/* ================= masthead — attendance proportions ================= */
.pyr .masthead{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;flex-wrap:wrap;margin-bottom:24px}
.pyr h1{font-family:var(--serif);font-weight:700;font-size:42px;letter-spacing:-.01em}
.pyr .stats{display:flex;gap:46px;align-items:flex-end;flex-wrap:wrap}
.pyr .stat{text-align:right}
.pyr .stat b{display:block;font-family:var(--mono);font-weight:600;font-size:23px;letter-spacing:-.02em}
.pyr .stat span{display:block;margin-top:5px;font-size:10.5px;letter-spacing:.15em;color:var(--ink2);text-transform:uppercase}
.pyr .stat.pd b{color:var(--sage)}
.pyr .stat.due b{color:var(--red)}
/* ================= nav row ================= */
.pyr .nav{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.pyr .wk{display:flex;align-items:center;gap:9px}
.pyr .wk .arrow{width:28px;height:28px;border:1px solid var(--line);border-radius:50%;background:var(--card);display:grid;place-items:center;color:var(--ink2);cursor:pointer;font-size:12px;transition:all .14s ease}
.pyr .wk .arrow:hover{color:var(--ink);border-color:var(--ink2)}
.pyr .wk .arrow:active{transform:scale(.92)}
.pyr .wk b{font-family:var(--serif);font-size:19px;font-weight:600}
.pyr .nav a{color:var(--ink2);text-decoration:none;font-size:13.5px}
.pyr .nav a:hover{color:var(--ink)}
.pyr .toggle{margin-left:auto;display:flex;gap:8px}
.pyr .toggle button{border:1px solid var(--line);background:var(--card);font:500 13.5px var(--sans);color:var(--ink);padding:8px 18px;border-radius:999px;cursor:pointer;transition:all .14s ease}
.pyr .toggle button:hover{border-color:var(--ink2)}
.pyr .toggle button.on{background:var(--ink);border-color:var(--ink);color:var(--card)}
.pyr .toggle button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
/* ================= search — pill, as the product has ================= */
.pyr .searchrow{display:flex;align-items:center;gap:16px;margin-bottom:20px}
.pyr .search{display:flex;align-items:center;gap:11px;border:1px solid var(--line);border-radius:999px;background:var(--card);padding:11px 18px;flex:0 1 420px;min-width:0;transition:border-color .16s ease}
.pyr .search:focus-within{border-color:var(--ink2)}
.pyr .search input{flex:1;min-width:0;border:0;background:none;outline:none;font:400 14px var(--sans);color:var(--ink)}
.pyr .search input::placeholder{color:var(--ink3)}
.pyr .search kbd{font:400 10px var(--mono);color:var(--ink3);border:1px solid var(--line);border-radius:6px;padding:2px 8px;flex:none}
.pyr .search .glass{color:var(--ink3);font-size:14px;flex:none}
.pyr .s-count{font:400 12px var(--mono);color:var(--ink3)}
/* ================= section cards — attendance card grammar ================= */
.pyr .card-sec{border:1px solid var(--line);border-radius:14px;background:var(--card);margin-bottom:22px;overflow:hidden}
.pyr .card-sec.s-hide{display:none}
.pyr .sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:17px 22px 15px;border-bottom:1px solid var(--line);box-shadow:0 1px 0 rgba(185,137,44,.14)}
.pyr .sec-head h2{font-family:var(--serif);font-weight:600;font-size:20px}
.pyr .sec-head .tot{font-family:var(--mono);font-size:13px;color:var(--ink)}
.pyr .sec-head .tot small{color:var(--ink2);font-family:var(--sans);font-size:12.5px;margin-left:4px}
/* column key strip */
.pyr .colkey{display:grid;grid-template-columns:minmax(230px,1fr) 128px 150px 122px 116px;gap:0 18px;padding:11px 22px 9px;font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--ink2);background:var(--card2);border-bottom:1px solid var(--line2)}
.pyr .colkey span:nth-child(n+2){text-align:right}
.pyr .colkey span:last-child{text-align:center}
/* ================= rows ================= */
.pyr .prow{border-bottom:1px solid var(--line2)}
.pyr .prow:last-of-type{border-bottom:0}
.pyr .prow-main{display:grid;grid-template-columns:minmax(230px,1fr) 128px 150px 122px 116px;gap:0 18px;align-items:center;padding:15px 22px;cursor:pointer;transition:background .15s ease}
.pyr .prow-main:hover{background:rgba(120,104,76,.03)}
.pyr .prow.open .prow-main{background:rgba(120,104,76,.03)}
.pyr .pwho{display:flex;align-items:center;gap:13px;min-width:0}
.pyr .pwho .avatar{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-family:var(--serif);font-size:15px;color:var(--ink2);flex:none;background:var(--card2)}
.pyr .pwho .id{min-width:0}
.pyr .pwho .nm{font-weight:700;font-size:14.5px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.pyr .pwho .nm .site{display:inline-flex;align-items:center;gap:6px;font-weight:400;font-size:11.5px;color:var(--ink2)}
.pyr .pwho .nm .site::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--site-c)}
.pyr .pwho .why{font-size:12px;color:var(--ink2);margin-top:3px}
.pyr .pwho .why a{color:var(--terra);text-decoration:underline;text-underline-offset:2px}
.pyr .bf{font-family:var(--mono);font-size:13px;text-align:right;color:var(--ink)}
.pyr .bf small{display:block;font-family:var(--sans);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin-top:3px}
.pyr .bf.none{color:var(--ink3)}
/* amount — underlined ledger entry */
.pyr .amt-wrap{display:flex;align-items:baseline;justify-content:flex-end;gap:6px;border-bottom:1px solid var(--line);padding-bottom:4px;transition:border-color .15s ease}
.pyr .amt-wrap:focus-within{border-bottom-color:var(--terra)}
.pyr .amt-wrap .cur{font-family:var(--mono);font-size:12px;color:var(--ink3)}
.pyr .amt-wrap input{width:100%;border:0;background:none;outline:none;text-align:right;font:500 16px var(--mono);color:var(--ink);letter-spacing:-.01em}
.pyr .amt-wrap input::placeholder{color:var(--ink3)}
.pyr .prow.zero .amt-wrap{border-bottom-color:transparent}
.pyr .prow.zero .amt-wrap input{color:var(--ink3);font-size:13px}
.pyr .after{font-family:var(--mono);font-size:13px;text-align:right;color:var(--ink)}
.pyr .after small{display:block;font-family:var(--sans);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin-top:3px}
.pyr .after.none{color:var(--ink3)}
.pyr .act{text-align:center}
.pyr .paybtn{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 18px;font:600 12.5px var(--sans);color:var(--ink);cursor:pointer;min-width:100px;transition:background .16s ease,color .16s ease,border-color .16s ease,transform .08s ease}
.pyr .paybtn:hover:not(:disabled){border-color:var(--ink);background:var(--ink);color:var(--card)}
.pyr .paybtn:active:not(:disabled){transform:scale(.96)}
.pyr .paybtn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.pyr .paybtn:disabled{color:var(--ink3);border-color:var(--line2);cursor:default;background:none}
.pyr .paybtn.working{color:var(--ink3);border-color:var(--line2);background:none;pointer-events:none}
.pyr .paybtn.working::after{content:"…";animation:pyr-dots .7s steps(3) infinite}
@keyframes pyr-dots{to{content:""}}
.pyr .prow.paid .paybtn{border:0;color:var(--sage);background:none;font-weight:700}
.pyr .prow.paid .paybtn:hover{color:var(--ink2);background:none}
.pyr .prow.paid .paybtn:hover::after{content:" · undo";font-weight:500}
.pyr .prow.paid .prow-main{opacity:.68}
.pyr .prow.paid .amt-wrap{border-bottom-color:transparent}
.pyr .prow.paid .amt-wrap input{color:var(--sage);pointer-events:none}
@media (prefers-reduced-motion:no-preference){
  .pyr .prow.paid .paybtn{animation:pyr-settle .32s ease}
  @keyframes pyr-settle{0%{transform:scale(.9);opacity:.4}60%{transform:scale(1.05)}100%{transform:scale(1)}}
}
/* anchored amount question */
.pyr .ask{grid-column:2 / span 4;justify-self:end;padding:2px 0 10px;display:none;align-items:center;gap:10px;font-size:12.5px;color:var(--ink2)}
.pyr .ask.show{display:flex}
.pyr .ask b{font-family:var(--mono);font-weight:500;color:var(--terra)}
.pyr .ask button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 13px;font:500 12px var(--sans);color:var(--ink2);cursor:pointer;transition:all .14s ease}
.pyr .ask button:hover{color:var(--ink);border-color:var(--ink2)}
.pyr .ask button:active{transform:scale(.96)}
.pyr .ask button.picked{background:var(--ink);border-color:var(--ink);color:var(--card)}
.pyr .ask .noted{font-style:italic;font-weight:500;font-size:12.5px;color:var(--sage)}
/* row expansion */
.pyr .detail{display:none;padding:2px 22px 18px 71px;font-size:12.5px;color:var(--ink2)}
.pyr .prow.open .detail{display:block}
.pyr .detail .dline{display:flex;gap:24px;flex-wrap:wrap;align-items:baseline}
.pyr .detail .dline span{font-family:var(--mono);font-size:12px}
.pyr .detail .dline em{font-style:normal;color:var(--ink3);font-family:var(--sans);font-size:11px;margin-right:6px}
.pyr .detail .note{margin-top:11px;display:flex;align-items:baseline;gap:8px}
.pyr .detail .note input{flex:1;max-width:520px;border:0;border-bottom:1px dashed var(--line);background:none;outline:none;font:italic 400 12.5px var(--sans);color:var(--ink2);padding:3px 1px}
.pyr .detail .note input:focus{border-bottom-style:solid;border-bottom-color:var(--ink2)}
.pyr .detail a{color:var(--terra)}
/* card footer strip — like the ON SITE strip */
.pyr .sec-foot{display:flex;justify-content:space-between;align-items:center;padding:12px 22px;border-top:1px solid var(--line);background:var(--card);font-size:10.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--ink2)}
.pyr .sec-foot b{font-family:var(--mono);font-size:13px;letter-spacing:0;text-transform:none;color:var(--ink);font-weight:600}
/* add request */
.pyr .addreq-wrap{padding:14px 22px 18px;background:var(--card2);border-top:1px solid var(--line2)}
.pyr .addreq{border:1px dashed #D8B08C;background:none;border-radius:10px;padding:9px 20px;font:600 13px var(--sans);color:var(--terra);cursor:pointer;transition:all .14s ease}
.pyr .addreq:hover{border-color:var(--terra);background:rgba(194,85,59,.05)}
.pyr .addreq:active{transform:scale(.98)}
/* closing */
.pyr .closing{margin-top:8px;display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:10px;padding:0 4px}
.pyr .closing .l{font-family:var(--serif);font-style:italic;font-size:14.5px;color:var(--ink2)}
.pyr .closing .r{font-family:var(--mono);font-size:12.5px;color:var(--ink2);display:flex;gap:22px}
.pyr .closing .r b{font-weight:600;color:var(--red);font-size:14.5px}
/* ================= mobile ================= */
@media (max-width:720px){
  .pyr{padding:28px 16px 80px}
  .pyr .masthead{align-items:flex-start;flex-direction:column;gap:18px;margin-bottom:18px}
  .pyr h1{font-size:34px}
  .pyr .stats{gap:26px}
  .pyr .stat{text-align:left}
  .pyr .stat b{font-size:20px}
  .pyr .nav{gap:10px}
  .pyr .wk b{font-size:17px}
  .pyr .toggle{margin-left:0;width:100%}
  .pyr .searchrow{margin-bottom:16px}
  .pyr .search{flex:1}
  .pyr .search kbd{display:none}
  .pyr .search input{font-size:16px}
  .pyr .colkey{display:none}
  .pyr .sec-head{padding:15px 16px 13px}
  .pyr .prow-main{grid-template-columns:1fr 132px;grid-template-areas:"who amt" "who act" "bf after";gap:8px 14px;padding:14px 16px}
  .pyr .pwho{grid-area:who;align-items:flex-start}
  .pyr .amt-wrap{grid-area:amt;align-self:start}
  .pyr .amt-wrap input{font-size:17px}
  .pyr .act{grid-area:act;text-align:right}
  .pyr .paybtn{padding:9px 18px;min-height:38px}
  .pyr .bf{grid-area:bf;text-align:left;display:flex;gap:6px;align-items:baseline;font-size:12px}
  .pyr .bf small{margin:0}
  .pyr .after{grid-area:after;display:flex;gap:6px;align-items:baseline;justify-content:flex-end;font-size:12px}
  .pyr .after small{margin:0}
  .pyr .bf.none, .pyr .after.none{display:none}
  .pyr .ask{grid-column:1 / -1;grid-row:auto;justify-self:stretch;flex-wrap:wrap}
  .pyr .detail{padding:2px 16px 16px 16px}
  .pyr .closing{flex-direction:column;gap:6px}
}
@media (hover:none){
  .pyr .prow.paid .paybtn::after{content:" · undo";font-weight:500;color:var(--ink2)}
  .pyr .paybtn:hover:not(:disabled){background:var(--card);color:var(--ink);border-color:var(--line)}
}
.pyr .prow.s-hide{display:none}
/* ── the difference question ───────────────────────────────────────────────────
   The reference asks inline, with two answers and no note. Briklay keeps its popover: paying more
   than planned is an advance (a third answer the inline strip has no room for), and the reason is
   written onto the transaction, so there is a sentence to read months later. Same tokens, so it
   reads as part of the same page. */
.pyr .amt-wrap{position:relative}
.pyr .pop{position:absolute;right:0;top:34px;z-index:30;width:352px;text-align:left;cursor:default;
  background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 17px;
  box-shadow:0 18px 44px -20px rgba(39,34,27,.45)}
.pyr .pop .h{color:var(--ink2);margin-bottom:11px;font-size:12.5px}
.pyr .pop .h b{color:var(--terra);font-family:var(--mono);font-weight:500}
.pyr .pop label{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border:1px solid var(--line);
  border-radius:10px;margin-bottom:7px;cursor:pointer;transition:border-color .14s ease,background .14s ease}
.pyr .pop label:hover{border-color:var(--ink2)}
.pyr .pop label.on{border-color:var(--ink);background:var(--card2)}
.pyr .pop label input[type=radio]{accent-color:var(--ink);margin-top:2px;flex:none}
.pyr .pop label .t{font-weight:600;font-size:13px;line-height:1.35}
.pyr .pop label .d{font-size:12px;color:var(--ink3);margin-top:2px}
.pyr .pop .why{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--paper);
  font:400 13px var(--sans);padding:8px 10px;margin-top:4px;color:var(--ink);resize:none}
.pyr .pop .why:focus{outline:none;border-color:var(--ink2)}
.pyr .pop .acts{display:flex;justify-content:flex-end;gap:14px;margin-top:13px;align-items:center}
.pyr .pop .acts .cancel{background:none;border:0;color:var(--ink3);font:400 12.5px var(--sans);cursor:pointer}
.pyr .pop .acts .cancel:hover{color:var(--ink2)}
.pyr .pop .acts .ok{background:var(--ink);color:var(--card);border:0;border-radius:999px;padding:8px 16px;
  font:600 12.5px var(--sans);cursor:pointer}
.pyr .pop .acts .ok:disabled{background:var(--line);color:var(--ink3);cursor:default}

/* the panels wear the reference's own card */
.pyr .ratecard,.pyr .panel{border:1px solid var(--line);border-radius:14px;background:var(--card);
  margin-bottom:22px;overflow:hidden}

/* ── the rate card, the recurring manager, the forms ──────────────────────────
   All of it in the reference's card grammar: a .card-sec shell, a .sec-head, and the reference's
   own dashed-terracotta affordance for anything that adds a line. */
.pyr .rc-head{width:100%;display:flex;align-items:center;gap:11px;padding:16px 22px;background:none;border:0;
  cursor:pointer;text-align:left;font:inherit}
.pyr .rc-head:hover{background:rgba(120,104,76,.03)}
.pyr .rc-t{font:600 17px var(--serif);flex-shrink:0}
.pyr .rc-s{font-size:12.5px;color:var(--ink2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pyr .rc-chev{color:var(--ink3);font-size:15px;transition:transform .18s ease;flex-shrink:0}
.pyr .rc-chev.on{transform:rotate(90deg);color:var(--ink2)}
.pyr .rc-body{border-top:1px solid var(--line);padding:4px 22px 14px;background:var(--card2)}
.pyr .rc-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line2);font-size:13.5px}
.pyr .rc-row:last-of-type{border-bottom:0}
.pyr .rc-n{flex:1;min-width:0;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pyr .rc-v{border:0;background:none;font:500 14px var(--mono);color:var(--ink);padding:6px 2px;cursor:default}
.pyr .rc-v.edit{cursor:pointer;border-bottom:1px solid var(--line)}
.pyr .rc-v.edit:hover{border-bottom-color:var(--terra)}
.pyr .rc-per{color:var(--ink3);font:400 11px var(--sans);margin-left:3px}
.pyr .rc-in{width:112px;text-align:right;border:0;border-bottom:1px solid var(--terra);background:none;
  font:500 16px var(--mono);color:var(--ink);padding:6px 2px;outline:none}
.pyr .rc-foot{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--ink3)}

.pyr .recbody{padding:8px 22px 18px}
.pyr .recitem{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line2);font-size:13.5px}
.pyr .recitem:last-of-type{border-bottom:0}
.pyr .recitem b{font-weight:700}
.pyr .recitem .rm-proj{color:var(--ink3);font-size:12.5px}
.pyr .recitem .mono{margin-left:auto;font-family:var(--mono);font-size:13px}
.pyr .rm-x{width:24px;height:24px;border-radius:8px;font-size:16px;line-height:1;color:var(--ink3);
  background:none;border:0;cursor:pointer;flex:none}
.pyr .rm-x:hover{color:var(--red);background:rgba(186,75,50,.08)}

.pyr .addform,.pyr .recform{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
.pyr .addform select,.pyr .addform input,.pyr .recform select,.pyr .recform input{height:38px;
  border:1px solid var(--line);border-radius:10px;background:var(--card);padding:0 12px;
  font:400 13.5px var(--sans);color:var(--ink)}
.pyr .addform input:focus,.pyr .addform select:focus,.pyr .recform input:focus,.pyr .recform select:focus{
  outline:none;border-color:var(--ink2)}
.pyr .addform input.amt,.pyr .recform input.amt{width:126px;text-align:right;font-family:var(--mono)}
.pyr .addform input.note{flex:1;min-width:170px}
.pyr .addform .go,.pyr .recform .go{background:var(--ink);color:var(--card);border:0;border-radius:999px;
  padding:9px 18px;font:600 12.5px var(--sans);cursor:pointer;height:38px}
.pyr .addform .go:disabled,.pyr .recform .go:disabled{background:var(--line);color:var(--ink3);cursor:default}
.pyr .addform .x,.pyr .recform .x{color:var(--ink3);font:400 12.5px var(--sans);background:none;border:0;cursor:pointer}
.pyr .addform .x:hover,.pyr .recform .x:hover{color:var(--ink2)}

.pyr .psrch{position:relative;display:inline-block}
.pyr .psrch>input{height:38px;border:1px solid var(--line);border-radius:10px;background:var(--card);
  padding:0 12px;font:400 13.5px var(--sans);color:var(--ink);width:228px}
.pyr .psrch>input:focus{outline:none;border-color:var(--ink2)}
.pyr .psrch-menu{position:absolute;left:0;top:calc(100% + 5px);z-index:25;min-width:266px;background:var(--card);
  border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 38px -18px rgba(39,34,27,.4);
  padding:5px;max-height:286px;overflow:auto}
.pyr .psrch-item{display:block;width:100%;text-align:left;padding:9px 11px;border:0;background:none;
  border-radius:8px;font:400 13.5px var(--sans);color:var(--ink);cursor:pointer}
.pyr .psrch-item:hover{background:var(--card2)}
.pyr .psrch-item small{color:var(--ink3)}
.pyr .psrch-item.psrch-create{color:var(--ink2);border-top:1px solid var(--line2);margin-top:3px;font-weight:600}
.pyr .psrch-item.psrch-create b{color:var(--terra)}
.pyr .psrch-empty{padding:9px 11px;color:var(--ink3);font-size:13px}

/* the global search, wearing the reference's pill — the page keeps the app's search bar (space to
   focus, the cross-page panel, the run's rows lent to it) and the reference keeps its design */
.pyr .searchrow .csx-rest{flex:0 1 420px;min-width:0;display:block}
.pyr .searchrow .csx-rest .bar{display:flex;align-items:center;gap:11px;border:1px solid var(--line);
  border-radius:999px;background:var(--card);padding:11px 18px;box-shadow:none;transition:border-color .16s ease}
.pyr .searchrow .csx-rest .bar:focus-within{border-color:var(--ink2)}
.pyr .searchrow .csx-rest .bar .ic{color:var(--ink3);font-size:14px;flex:none}
.pyr .searchrow .csx-rest .bar input{flex:1;min-width:0;border:0;background:none;outline:none;
  font:400 14px var(--sans);color:var(--ink)}
.pyr .searchrow .csx-rest .bar input::placeholder{color:var(--ink3)}
.pyr .searchrow .csx-rest .bar .kbd,.pyr .searchrow .csx-rest .bar .clr{font:400 10px var(--mono);
  color:var(--ink3);border:1px solid var(--line);border-radius:6px;padding:2px 8px;flex:none;background:none}

/* ── the run's own furniture ──────────────────────────────────────────────── */
.pyr .state{padding:72px 18px;text-align:center;color:var(--ink2);font-size:14px}
.pyr .emptyrow{padding:16px 22px;color:var(--ink3);font-size:13px;border-bottom:1px solid var(--line2)}
.pyr .cutover{font-size:12px;line-height:1.5;color:var(--ink3);margin-bottom:14px}
.pyr .readonly{font-size:12.5px;color:var(--gold);margin-bottom:14px}
/* pay-by rides in the closing line — the run has to name a method, and this is where it closes.
   Written as part of the sentence rather than as a control, so the line keeps the reference's
   height and reads "pay by UPI" instead of growing a pill. */
.pyr .closing .paybyc{display:inline-flex;align-items:baseline;gap:6px;color:var(--ink2)}
.pyr .closing select{appearance:none;-webkit-appearance:none;border:0;border-bottom:1px solid var(--line);
  background:none;padding:0 2px 1px;font:500 12.5px var(--mono);color:var(--ink);cursor:pointer;line-height:1.2}
.pyr .closing select:hover{border-bottom-color:var(--ink2)}
.pyr .closing select:focus{outline:none;border-bottom-color:var(--terra)}
/* the panels the reference has no row for, in its card */
.pyr .pcerts{padding:4px 22px 16px}

@media (max-width:720px){
  .pyr .pop{right:auto;left:0;width:min(320px,calc(100vw - 44px))}
  .pyr .rc-head{padding:15px 16px}
  .pyr .searchrow .csx-rest{flex:1}
  .pyr .searchrow .csx-rest .bar .kbd{display:none}
  .pyr .searchrow .csx-rest .bar input{font-size:16px}
  .pyr .rc-body,.pyr .recbody,.pyr .pcerts{padding-left:16px;padding-right:16px}
  .pyr .addform,.pyr .recform{flex-direction:column;align-items:stretch}
  .pyr .addform input,.pyr .addform select,.pyr .addform input.amt,.pyr .addform input.note,
  .pyr .recform input,.pyr .recform select,.pyr .recform input.amt{width:100%;height:44px;font-size:16px}
  .pyr .addform .go,.pyr .recform .go{height:44px;width:100%}
  .pyr .psrch,.pyr .psrch>input{width:100%}
  .pyr .psrch>input{height:44px;font-size:16px}
  .pyr .rc-in{height:44px;font-size:17px}
  .pyr .state{padding:52px 16px}
  .pyr .emptyrow{padding:14px 16px}
}

/* ================= the week matrix's company on this page =================
   The matrix draws itself under .wkm and brings its own sheet; what it needs from here is the
   band filter above it, and the door to the rate card in the nav. Both are written in the
   reference's tokens so the run and the matrix share one page, not two. */
.pyr .ratelink{text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}
.pyr .ratelink:hover{text-decoration-color:var(--ink2)}
.pyr .chips{display:flex;gap:8px;flex-wrap:wrap;margin:-4px 0 20px}
.pyr .chip-f{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 16px;
  font:500 13px var(--sans);color:var(--ink2);cursor:pointer;transition:all .14s ease}
.pyr .chip-f:hover{border-color:var(--ink2);color:var(--ink)}
.pyr .chip-f.on{background:var(--ink);border-color:var(--ink);color:var(--card)}
.pyr .chip-f:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
/* the rate card, opened over the run */
.pyr .rate-ov{position:fixed;inset:0;z-index:90;background:rgba(39,34,27,.34);backdrop-filter:blur(2px);
  display:flex;align-items:flex-start;justify-content:center;padding:24px;animation:pyr-rateov .16s ease}
@keyframes pyr-rateov{from{opacity:0}to{opacity:1}}
.pyr .rate-modal{position:relative;background:var(--card);border:1px solid var(--line);border-radius:18px;
  box-shadow:0 24px 60px rgba(39,34,27,.22);width:100%;max-width:660px;margin-top:6vh;max-height:82vh;overflow:auto}
.pyr .rate-x{position:absolute;top:12px;right:12px;width:30px;height:30px;border:0;background:none;border-radius:9px;
  color:var(--ink2);cursor:pointer;font-size:14px;z-index:1}
.pyr .rate-x:hover{background:var(--card2);color:var(--ink)}
/* inside the overlay the card IS the overlay — one border, not two, and the body stays open */
.pyr .rate-modal .ratecard{border:0;border-radius:18px;background:none;margin:0}
.pyr .rate-modal .rc-head{padding-right:52px}

/* The app's <main> reserves its own clearance for the bottom tab bar under this page. That room
   sits below the .pyr box, so paint the page's ground behind it — otherwise a seam of a different
   colour shows under the closing line. */
.pyr-page{background:#F3EFE6;min-height:100vh}
`;
