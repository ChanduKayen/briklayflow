// Exact styles from the contracts-mobile reference, scoped under `.cmx` so nothing leaks into the rest
// of the app (the reference used bare .btn/.search/.sec/.tag/.bar/.money/.appbar/.fab class names that
// WOULD collide). The in-app frame differs in one way from the standalone mockup: no phone bezel /
// desktop centering — this fills the mobile viewport within the app shell. Everything else is verbatim.
export const CONTRACTS_MOBILE_CSS = `
.cmx{
  --paper:#f6f1e9; --card:#fffdf9; --card-2:#fbf7f0; --well:#f1ebe1;
  --border:#e7ded1; --border-2:#efe7dc;
  --text:#2a1f17; --text-2:#76675a; --text-3:#a49585;
  --clay:#c65a2e; --clay-hi:#d46a3c; --clay-soft:#f7e6dc;
  --green:#56784f; --green-soft:#bfd2b8; --green-bg:#e7efe3;
  --amber:#a2711d; --amber-bg:#f4ead6;
  --ink:#1c130c; --cream:#f3e9dc; --err:#c2462a;
  --serif:'Newsreader',Georgia,serif;
  --sans:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  --mono:'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace;
  --ease:cubic-bezier(.22,1,.36,1); --spring:cubic-bezier(.34,1.5,.64,1);
  position:relative;background:var(--paper);color:var(--text);
  font-family:var(--sans);-webkit-font-smoothing:antialiased;
}
.cmx *,.cmx *::before,.cmx *::after{box-sizing:border-box}
.cmx button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.cmx input{font:inherit;color:inherit}
.cmx :focus-visible{outline:2px solid var(--clay-hi);outline-offset:2px;border-radius:8px}
.cmx .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.cmx .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* In-app: the document scrolls (the page lives inside <main>), not an internal frame. */
.cmx .view{position:relative;background:var(--paper);min-height:100dvh}
.cmx .v-list{padding-bottom:calc(120px + env(safe-area-inset-bottom))}
.cmx .in-r{animation:cmxInR .36s var(--ease) both}.cmx .out-l{animation:cmxOutL .3s var(--ease) both;pointer-events:none}
.cmx .in-l{animation:cmxInL .36s var(--ease) both}.cmx .out-r{animation:cmxOutR .3s var(--ease) both;pointer-events:none}
@keyframes cmxInR{from{transform:translateX(40px);opacity:0}}
@keyframes cmxOutL{to{transform:translateX(-30px);opacity:0}}
@keyframes cmxInL{from{transform:translateX(-30px);opacity:0}}
@keyframes cmxOutR{to{transform:translateX(40px);opacity:0}}
@keyframes cmxRise{from{opacity:0;transform:translateY(8px)}}
@keyframes cmxGrow{from{width:0}}
@keyframes cmxShake{20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
.cmx .shake{animation:cmxShake .4s}

/* shared bits */
.cmx .eyebrow{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--text-2)}
.cmx .pill{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:99px;font-size:12px;font-weight:500;white-space:nowrap}
.cmx .pill::before{content:"";width:6px;height:6px;border-radius:99px;background:currentColor}
.cmx .p-progress{background:var(--green-bg);color:var(--green)}
.cmx .p-new{background:var(--amber-bg);color:var(--amber)}
.cmx .p-closed{background:#eee8df;color:var(--text-3)}
.cmx .bar{position:relative;height:6px;border-radius:99px;background:var(--well);overflow:hidden}
.cmx .bar i{position:absolute;top:0;bottom:0;left:0;border-radius:99px;animation:cmxGrow .9s var(--ease) both}
.cmx .bar .done{background:var(--green-soft)}
.cmx .bar .paid{background:var(--green)}
.cmx .btn{height:52px;border-radius:14px;border:0;font-size:16px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 20px;transition:transform .2s var(--spring),background .2s,opacity .2s}
.cmx .btn:active{transform:scale(.97)}
.cmx .btn-primary{background:var(--clay);color:#fff;box-shadow:0 8px 20px rgba(198,90,46,.25)}
.cmx .btn-primary:hover{background:var(--clay-hi)}
.cmx .btn-primary.off{background:#dcd2c5;color:#8b7c6e;box-shadow:none}
.cmx .btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.cmx .btn-ghost.confirm{border-color:var(--err);color:var(--err)}
.cmx .badge-n{font-size:12px;font-weight:500;padding:2px 8px;border-radius:99px;background:rgba(0,0,0,.08)}
.cmx .icon-btn{width:44px;height:44px;border:0;border-radius:12px;background:transparent;display:grid;place-items:center;color:var(--text-2);flex-shrink:0}
.cmx .icon-btn:active{background:var(--well)}
.cmx .appbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:6px;height:56px;padding:0 8px;padding-top:env(safe-area-inset-top);background:rgba(246,241,233,.88);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid transparent;transition:border-color .2s}
.cmx .appbar.scrolled{border-bottom-color:var(--border)}
.cmx .ab-title{flex:1;min-width:0;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transform:translateY(4px);transition:opacity .2s,transform .3s var(--ease)}
.cmx .appbar.scrolled .ab-title,.cmx .appbar.always .ab-title{opacity:1;transform:none}
.cmx .sec{display:flex;align-items:center;gap:10px;margin:28px 20px 12px}
.cmx .sec .eyebrow{color:var(--text)}
.cmx .sec::after{content:"";flex:1;height:1px;background:var(--border)}
.cmx .sec .n{font-family:var(--mono);font-size:11.5px;color:var(--text-3)}

/* fab (kept; routes to New). The reference tab bar is dropped — the app's own nav is used. */
.cmx .fab{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:19;height:54px;padding:0 20px 0 16px;border:0;border-radius:99px;background:var(--clay);color:#fff;font-size:15.5px;font-weight:600;display:flex;align-items:center;gap:8px;box-shadow:0 10px 26px rgba(198,90,46,.4);transition:padding .35s var(--ease),transform .35s var(--spring),opacity .2s}
.cmx .fab .lbl{max-width:130px;overflow:hidden;white-space:nowrap;transition:max-width .35s var(--ease),opacity .2s}
.cmx .fab.mini{padding:0 15px}
.cmx .fab.mini .lbl{max-width:0;opacity:0}
.cmx .fab.hide{transform:scale(.6);opacity:0;pointer-events:none}
.cmx .fab:active{transform:scale(.95)}

/* LIST */
.cmx .l-head{display:flex;align-items:center;gap:10px;padding:calc(22px + env(safe-area-inset-top)) 20px 0}
.cmx .t1{margin:0;font-family:var(--serif);font-weight:600;font-size:34px;line-height:1;letter-spacing:-.01em}
.cmx .count{font-family:var(--mono);font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text-2)}
.cmx .sum{margin:18px 20px 0;padding:18px 18px 16px;border-radius:22px;background:var(--ink);color:var(--cream);animation:cmxRise .5s var(--ease) both}
.cmx .sum .eyebrow{color:#bda994}
.cmx .sum-top{display:flex;justify-content:space-between;align-items:center}
.cmx .sum-live{font-size:12.5px;color:#bda994}
.cmx .sum-amt{margin-top:8px;font-family:var(--mono);font-size:36px;letter-spacing:-.03em;line-height:1}
.cmx .sum-cap{margin-top:6px;font-size:13.5px;color:#b9a592}
.cmx .sum .bar{margin-top:16px;height:8px;background:rgba(243,233,220,.14)}
.cmx .sum .bar i{background:#9fbf95}
.cmx .sum-legend{display:flex;justify-content:space-between;margin-top:10px;font-size:13px;color:#b9a592}
.cmx .sum-legend b{font-family:var(--mono);font-weight:500;color:var(--cream)}
.cmx .l-sticky{position:sticky;top:0;z-index:6;padding:14px 20px 10px;padding-top:calc(14px + env(safe-area-inset-top));background:linear-gradient(var(--paper) 82%,rgba(246,241,233,0))}
.cmx .search{display:flex;align-items:center;gap:10px;height:48px;padding:0 6px 0 14px;border:1px solid var(--border);border-radius:14px;background:var(--card);transition:border-color .2s,box-shadow .2s}
.cmx .search:focus-within{border-color:#dcb49d;box-shadow:0 0 0 4px rgba(198,90,46,.08)}
.cmx .search input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;font-size:16px}
.cmx .search input::placeholder{color:var(--text-3)}
.cmx .search .icon-btn{width:36px;height:36px;display:none}
.cmx .search.has .icon-btn{display:grid}
.cmx .filters{display:flex;gap:8px;margin:10px -20px 0;padding:0 20px;overflow-x:auto;scrollbar-width:none}
.cmx .filters::-webkit-scrollbar{display:none}
.cmx .fchip{flex-shrink:0;height:36px;padding:0 14px;border-radius:99px;border:1px solid var(--border);background:var(--card);color:var(--text-2);font-size:14px;display:inline-flex;align-items:center;gap:7px;transition:background .2s,color .2s,border-color .2s,transform .2s var(--spring)}
.cmx .fchip:active{transform:scale(.95)}
.cmx .fchip span{font-family:var(--mono);font-size:11.5px;opacity:.65}
.cmx .fchip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--cream)}
.cmx .l-list{display:flex;flex-direction:column;gap:10px;padding:4px 20px 0}
.cmx .cc{display:block;width:100%;padding:16px;border:1px solid var(--border);border-radius:18px;background:var(--card);text-align:left;animation:cmxRise .45s var(--ease) both;animation-delay:calc(var(--i,0) * 28ms);transition:transform .2s var(--spring),box-shadow .2s}
.cmx .cc:active{transform:scale(.985);box-shadow:0 2px 10px rgba(40,25,10,.06)}
.cmx .cc-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.cmx .cc-name{font-size:17px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmx .cc-meta{margin-top:4px;font-size:13px;color:var(--text-2);display:flex;gap:6px;align-items:center;min-width:0;white-space:nowrap}
.cmx .cc-meta .mono{font-size:12px;color:var(--text-3)}
.cmx .cc-stages{margin-top:10px;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cmx .cc-stages .more{font-family:var(--mono);font-size:11.5px;margin-left:6px;padding:2px 7px;border:1px solid var(--border);border-radius:6px;color:var(--text-2)}
.cmx .cc .bar{margin-top:14px}
.cmx .cc-money{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:10px;font-size:13px;color:var(--text-2)}
.cmx .cc-money b{font-family:var(--mono);font-weight:500;color:var(--text)}
.cmx .cc-money .due b{color:var(--clay);font-size:15px}
.cmx .cc.closed{background:var(--card-2)}
.cmx .cc.closed .cc-name,.cmx .cc.closed .cc-stages{color:var(--text-2)}
.cmx .cc-money .settled{color:var(--green);font-weight:500}
.cmx .l-foot{margin:18px 20px 0;text-align:center;font-size:13px;color:var(--text-3)}
.cmx .empty{padding:40px 20px;text-align:center;color:var(--text-2);font-size:15px}

/* DETAIL */
.cmx .v-detail{padding-bottom:0}
.cmx .d-hero{padding:4px 20px 0;animation:cmxRise .45s var(--ease) both}
.cmx .crumb{font-family:var(--mono);font-size:12px;color:var(--text-3);display:flex;gap:8px;align-items:center}
.cmx .d-name{margin:12px 0 0;font-family:var(--serif);font-weight:600;font-size:32px;line-height:1.05;letter-spacing:-.01em}
.cmx .d-trade{font-family:var(--sans);font-size:15px;font-weight:400;color:var(--text-2);margin-left:6px;letter-spacing:0}
.cmx .d-meta{margin-top:8px;font-size:14px;color:var(--text-2);line-height:1.5}
.cmx .d-meta b{font-weight:500;color:var(--text)}
.cmx .d-scope{margin:12px 0 0;padding:12px 14px;border-radius:12px;background:var(--well);font-size:14.5px;line-height:1.45}
.cmx .d-scope span{display:block;font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-2);margin-bottom:4px}
.cmx .money{margin:16px 20px 0;padding:18px;border-radius:22px;background:var(--card);border:1px solid var(--border);animation:cmxRise .5s .05s var(--ease) both}
.cmx .m-row{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.cmx .m-big{margin-top:6px;font-family:var(--mono);font-size:34px;letter-spacing:-.03em;line-height:1;color:var(--amber)}
.cmx .m-big.zero{color:var(--green)}
.cmx .m-agreed{text-align:right}
.cmx .m-agreed .mono{display:block;margin-top:6px;font-size:17px}
.cmx .money .bar{margin-top:18px;height:10px}
.cmx .m-leg{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.cmx .m-leg div{font-size:12.5px;color:var(--text-2)}
.cmx .m-leg b{display:block;margin-top:3px;font-family:var(--mono);font-weight:500;font-size:15px;color:var(--text)}
.cmx .m-leg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:0}
.cmx .m-note{margin-top:14px;padding:10px 12px;border-radius:12px;font-size:13.5px;line-height:1.4;display:flex;gap:10px;align-items:flex-start}
.cmx .m-note.ok{background:var(--green-bg);color:#3f5c39}
.cmx .m-note.warn{background:var(--amber-bg);color:#7a5412}
.cmx .m-note.due{background:var(--clay-soft);color:#8f3a17}
.cmx .m-note svg{flex-shrink:0;margin-top:1px}
.cmx .stg-list,.cmx .pay-list{display:flex;flex-direction:column;gap:10px;padding:0 20px}
.cmx .sc{padding:14px 16px;border:1px solid var(--border);border-radius:16px;background:var(--card);animation:cmxRise .4s var(--ease) both}
.cmx .sc-top{display:flex;gap:12px;align-items:flex-start}
.cmx .s-num{flex-shrink:0;width:26px;height:26px;border-radius:8px;background:var(--well);display:grid;place-items:center;font-family:var(--mono);font-size:12px;color:var(--text-2)}
.cmx .sc-name{flex:1;min-width:0;font-size:15.5px;font-weight:600;line-height:1.3}
.cmx .sc-name small{display:block;margin-top:2px;font-size:12.5px;font-weight:400;color:var(--text-2)}
.cmx .sc-bal{text-align:right;font-family:var(--mono);font-size:15px;white-space:nowrap}
.cmx .sc-bal small{display:block;font-family:var(--sans);font-size:11.5px;color:var(--text-3)}
.cmx .sc-bal.done{color:var(--green)}
.cmx .sc .bar{margin:12px 0 0 38px}
.cmx .sc-nums{display:flex;gap:14px;margin:10px 0 0 38px;font-size:12.5px;color:var(--text-2);flex-wrap:wrap}
.cmx .sc-nums b{font-family:var(--mono);font-weight:500;color:var(--text)}
.cmx .more-btn{margin:0 20px;height:46px;border:1px dashed var(--border);border-radius:14px;background:transparent;color:var(--text-2);font-size:14.5px;width:calc(100% - 40px)}
.cmx .pay{padding:14px 16px;border:1px solid var(--border);border-radius:16px;background:var(--card);animation:cmxRise .4s var(--ease) both}
.cmx .pay.new{animation:cmxRise .4s var(--ease) both,cmxPayFlash 2.4s ease-out}
@keyframes cmxPayFlash{0%,30%{background:#fbeadf}100%{background:var(--card)}}
.cmx .pay-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.cmx .pay-amt{font-family:var(--mono);font-size:19px;font-weight:500}
.cmx .pay-date{font-size:13px;color:var(--text-2)}
.cmx .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cmx .tag{height:24px;padding:0 9px;border-radius:7px;background:var(--well);font-size:12px;color:var(--text-2);display:inline-flex;align-items:center;gap:6px}
.cmx .tag.g{background:var(--green-bg);color:var(--green)}
.cmx .tag.g b{font-family:var(--mono);font-weight:500}
.cmx .pay-note{margin:10px 0 0;font-size:13.5px;line-height:1.45;color:var(--text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cmx .pay.open .pay-note{-webkit-line-clamp:unset;display:block}
.cmx .pay-foot{display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px}
.cmx .linkbtn{height:36px;padding:0 4px;border:0;background:none;color:var(--clay);font-size:13.5px;font-weight:500}
.cmx .ref{font-size:11.5px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmx .tl{list-style:none;margin:0;padding:0 20px 0 20px}
.cmx .tl li{position:relative;padding:0 0 18px 26px;font-size:14px;line-height:1.45}
.cmx .tl li::before{content:"";position:absolute;left:5px;top:6px;width:9px;height:9px;border-radius:99px;border:2px solid var(--text-3);background:var(--paper)}
.cmx .tl li:first-child::before{border-color:var(--clay);background:var(--clay)}
.cmx .tl li::after{content:"";position:absolute;left:9.5px;top:18px;bottom:0;width:1px;background:var(--border)}
.cmx .tl li:last-child::after{display:none}
.cmx .tl time{display:block;font-family:var(--mono);font-size:11.5px;color:var(--text-3);margin-bottom:2px}
.cmx .tl b{font-weight:600}
.cmx .actbar{position:sticky;bottom:0;z-index:8;display:grid;grid-template-columns:auto 1fr;gap:10px;margin-top:24px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(246,241,233,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid var(--border)}
.cmx .actbar .btn-ghost{padding:0 16px}
.cmx .nopay{margin:0 20px;padding:18px;border:1px dashed var(--border);border-radius:16px;text-align:center;font-size:14px;color:var(--text-2)}

/* SHEET — fixed to the viewport (the page is normal-flow inside the app shell), above the app nav. */
.cmx .sb{position:fixed;inset:0;z-index:120;background:rgba(28,19,12,.45);opacity:0;transition:opacity .35s var(--ease)}
.cmx .sb.show{opacity:1}
.cmx .sb[hidden],.cmx .sheet[hidden]{display:none}
.cmx .sheet{position:fixed;left:0;right:0;bottom:0;z-index:130;max-height:calc(100dvh - 24px);display:flex;flex-direction:column;background:var(--paper);border-radius:24px 24px 0 0;box-shadow:0 -20px 50px rgba(28,19,12,.25);transform:translateY(105%);transition:transform .42s var(--ease)}
.cmx .sheet.open{transform:none}
.cmx .sheet.drag{transition:none}
.cmx .sh-handle{display:flex;justify-content:center;padding:10px 0 2px;touch-action:none;cursor:grab}
.cmx .sh-handle span{width:40px;height:5px;border-radius:99px;background:#d8cdbf}
.cmx .sh-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:6px 12px 10px 20px}
.cmx .sh-title{margin:0;font-family:var(--serif);font-weight:600;font-size:26px;line-height:1.1}
.cmx .sh-sub{margin:4px 0 0;font-size:13.5px;color:var(--text-2)}
.cmx .sh-body{flex:1;min-height:0;overflow-y:auto;scrollbar-width:none;padding:6px 20px 18px}
.cmx .sh-body::-webkit-scrollbar{display:none}
.cmx .sh-foot{padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--border)}
.cmx .sh-foot .btn{width:100%}
.cmx .big-amt{display:flex;align-items:center;gap:8px;height:68px;padding:0 16px;border:1px solid var(--border);border-radius:16px;background:#fff;transition:border-color .2s,box-shadow .2s}
.cmx .big-amt:focus-within{border-color:#dcb49d;box-shadow:0 0 0 4px rgba(198,90,46,.08)}
.cmx .big-amt span{font-family:var(--mono);font-size:26px;color:var(--text-3)}
.cmx .big-amt input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-family:var(--mono);font-size:32px;letter-spacing:-.02em}
.cmx .amt-hint{min-height:20px;margin-top:8px;font-size:13px;color:var(--text-2)}
.cmx .amt-hint.warn{color:var(--amber)}
.cmx .flabel{display:block;margin:18px 0 8px;font-size:13px;font-weight:500;color:var(--text-2)}
.cmx .ochips{display:flex;flex-wrap:wrap;gap:8px}
.cmx .oc{height:40px;padding:0 14px;border-radius:99px;border:1px solid var(--border);background:#fff;font-size:14.5px;color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:background .2s,color .2s,border-color .2s,transform .2s var(--spring)}
.cmx .oc:active{transform:scale(.95)}
.cmx .oc[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--cream)}
.cmx .oc small{font-family:var(--mono);font-size:11.5px;opacity:.7}
.cmx .qc{flex-shrink:0;white-space:nowrap;height:34px;padding:0 12px;border-radius:99px;border:1px dashed #d9c7b5;background:transparent;font-size:13px;color:var(--text-2)}
.cmx .inp{width:100%;height:50px;padding:0 14px;border:1px solid var(--border);border-radius:12px;background:#fff;font-size:16.5px;outline:0;transition:border-color .2s,box-shadow .2s}
.cmx .inp:focus{border-color:#dcb49d;box-shadow:0 0 0 4px rgba(198,90,46,.08)}
.cmx .inp::placeholder{color:var(--text-3)}
.cmx .menu{display:flex;flex-direction:column;padding:0 12px 12px}
.cmx .menu button{display:flex;align-items:center;gap:14px;height:56px;padding:0 12px;border:0;border-radius:12px;background:transparent;font-size:16px;text-align:left}
.cmx .menu button:active{background:var(--well)}
.cmx .menu .danger{color:var(--err)}
.cmx .menu small{display:block;font-size:12.5px;color:var(--text-2)}

/* TOAST */
.cmx .toast{position:fixed;left:50%;width:max-content;top:calc(14px + env(safe-area-inset-top));z-index:140;display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:12px 16px;border-radius:14px;background:var(--ink);color:var(--cream);font-size:14.5px;box-shadow:0 14px 36px rgba(28,19,12,.3);opacity:0;visibility:hidden;transform:translate(-50%,-12px);transition:opacity .25s,transform .35s var(--ease),visibility 0s linear .35s}
.cmx .toast.show{opacity:1;visibility:visible;transform:translate(-50%,0);transition-delay:0s}
.cmx .toast svg{color:#9fd3a8;flex-shrink:0}

@media (prefers-reduced-motion:reduce){.cmx *,.cmx *::before,.cmx *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;
