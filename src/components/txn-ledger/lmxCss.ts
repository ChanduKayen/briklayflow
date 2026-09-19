/**
 * The phone's Transactions — the reference's own values, scoped under `.lmx`.
 * (claude.ai/artifact/NwLbqWpJbQbMpzduWJSPGV)
 */
export const LMX_CSS = `
.lmx{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;
  --night:#15100C;--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif;--sans:'DM Sans',system-ui,-apple-system,sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;
  --ease:cubic-bezier(.22,.8,.24,1);--nav-h:64px;--nav-gap:12px;
  background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.4;
  padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom))}
.lmx *{box-sizing:border-box}
.lmx button,.lmx input{font:inherit;color:inherit}
.lmx button{cursor:pointer}

/* =====================================================================
   TRANSACTIONS. The header answers one question: how much went out, lately.
   ===================================================================== */
.lmx .hero{background:var(--night);color:rgb(var(--cream));padding:20px 20px 18px}
.lmx .hero-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lmx .hero h1{margin:0;font-family:var(--serif);font-weight:600;font-size:32px;letter-spacing:-.01em;line-height:1.1}
.lmx .icb{width:40px;height:40px;border:0;border-radius:20px;background:rgba(var(--cream),.07);color:rgba(var(--cream),.85);display:grid;place-items:center}
.lmx .icb svg{width:20px;height:20px;fill:currentColor}
.lmx .period{display:inline-grid;grid-auto-flow:column;gap:0;margin-top:16px;padding:3px;border-radius:14px;background:rgba(var(--cream),.07)}
.lmx .period button{height:30px;padding:0 12px;border:0;border-radius:11px;background:none;font-size:12.5px;font-weight:600;color:rgba(var(--cream),.6);transition:background .25s,color .25s}
.lmx .period button[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.lmx .out{display:flex;align-items:baseline;gap:8px;margin-top:14px;font-family:var(--mono);font-size:31px;letter-spacing:-.01em}
.lmx .out small{font-family:var(--sans);font-size:14px;color:rgba(var(--cream),.55)}
.lmx .out .in{margin-left:auto;font-size:14px;color:#8FC79A}
.lmx .sub{margin:4px 0 0;min-height:19px;font-size:13px;color:rgba(var(--cream),.55)}
.lmx .bars{display:grid;grid-template-columns:repeat(14,1fr);align-items:end;gap:5px;height:64px;margin:14px 0 0}
.lmx .bars button{position:relative;height:100%;border:0;padding:0;background:none}
.lmx .bars i{position:absolute;left:0;right:0;bottom:0;border-radius:4px;background:rgba(var(--cream),.2);min-height:3px;transition:background .25s,height .6s var(--ease)}
.lmx .bars button[aria-pressed="true"] i{background:var(--clay-hi)}
.lmx .bars button.today i{background:rgba(var(--cream),.55)}
.lmx .pills{display:flex;gap:8px;margin-top:16px;overflow-x:auto;scrollbar-width:none}
.lmx .pills::-webkit-scrollbar{display:none}
.lmx .pill{flex:none;display:flex;align-items:center;gap:8px;height:38px;padding:0 14px 0 12px;border-radius:19px;border:1px solid rgba(var(--cream),.14);background:none;
  font-size:13.5px;font-weight:600;color:rgba(var(--cream),.85);white-space:nowrap}
.lmx .pill b{font-family:var(--mono);font-weight:500}
.lmx .pill .ring{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.lmx .pill svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:.8}
.lmx .pill[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night);border-color:transparent}

.lmx-compact{position:fixed;left:0;right:0;top:0;z-index:12;max-width:430px;margin:0 auto;height:52px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:#15100C;color:rgb(250,248,243);font-family:'DM Sans',system-ui,sans-serif;transform:translateY(-100%);transition:transform .35s cubic-bezier(.22,.8,.24,1)}
.lmx-compact.on{transform:none}
.lmx-compact b{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:19px}
.lmx-compact span{font-family:'DM Mono',ui-monospace,monospace;font-size:14px;color:rgba(250,248,243,.85)}
.lmx-compact small{font-family:'DM Sans',system-ui,sans-serif;font-size:12px;color:rgba(250,248,243,.5);margin-left:6px}
.lmx-compact small.f{color:#D4633E}

.lmx .tools{position:sticky;top:52px;z-index:6;padding:12px 16px 8px;background:linear-gradient(var(--ground) 88%,rgba(250,248,243,0));
  transition:transform .34s var(--ease),opacity .25s ease}
.lmx.selecting .tools{top:56px}
.lmx .tools.tuck{transform:translateY(-120%);opacity:0;pointer-events:none}
.lmx .find{display:flex;align-items:center;gap:10px;height:48px;padding:0 6px 0 16px;border-radius:24px;background:var(--paper);border:1px solid var(--line)}
.lmx .find > svg{flex:none;width:18px;height:18px;fill:none;stroke:var(--ink-3);stroke-width:2;stroke-linecap:round}
.lmx .find input{flex:1;min-width:0;height:100%;border:0;background:none;outline:none;font-size:16px}
.lmx .find input::placeholder{color:var(--ink-3)}
.lmx .find:focus-within{border-color:var(--ink)}
.lmx .flt{position:relative;flex:none;display:flex;align-items:center;gap:6px;height:36px;padding:0 12px;border:0;border-radius:18px;background:#F3EEE5;font-size:13px;font-weight:600;color:var(--ink-2)}
.lmx .flt svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.lmx .flt.on{background:var(--ink);color:var(--ground)}
.lmx .clr{width:36px;height:36px;border:0;border-radius:18px;background:none;color:var(--ink-3);display:grid;place-items:center}
.lmx .chips{display:flex;gap:6px;margin:10px 0 0}
.lmx .chip{flex:1 1 auto;height:36px;padding:0 10px;border-radius:17px;border:1px solid var(--line-2);background:none;font-size:13.5px;font-weight:600;color:var(--ink-2);white-space:nowrap;
  transition:background .25s,color .25s,border-color .25s}
.lmx .chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--ground)}
.lmx .result{margin:10px 8px 0;font-size:13px;color:var(--ink-2)}
.lmx .result b{font-family:var(--mono);font-weight:500;color:var(--ink)}

.lmx .day{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 24px 9px;scroll-margin-top:150px}
.lmx .day h2{margin:0;font-family:var(--serif);font-weight:500;font-size:18px}
.lmx .day h2 span{font-family:var(--sans);font-size:13.5px;color:var(--ink-3)}
.lmx .dayall{height:32px;padding:0 12px;border:0;border-radius:16px;background:none;font-size:13px;font-weight:600;color:var(--clay);opacity:0;pointer-events:none;transition:opacity .25s}
.lmx.selecting .dayall{opacity:1;pointer-events:auto}
.lmx .card{margin:0 16px;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.lmx .row{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:68px;padding:11px 16px;border:0;border-top:1px solid var(--rule);background:none;text-align:left;max-height:90px;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:pan-y;
  transition:background-color .25s ease,opacity .3s,max-height .4s var(--ease) .1s,min-height .4s var(--ease) .1s,padding .4s var(--ease) .1s,transform .2s var(--ease)}
.lmx .row:first-child{border-top:0}
.lmx .row.press{transform:scale(.985);background:#F7F2EA}
.lmx .row.sel{background:var(--clay-wash)}
.lmx .row.gone{opacity:0;max-height:0;min-height:0;padding-top:0;padding-bottom:0;border-top-width:0}
.lmx .row.voided .t1 b,.lmx .row.voided .amt{text-decoration:line-through;color:var(--ink-3)}
.lmx .mark{position:relative;flex:none;width:38px;height:38px}
.lmx .mark .f,.lmx .mark .k{position:absolute;inset:0;border-radius:50%;display:grid;place-items:center;backface-visibility:hidden;transition:transform .42s var(--ease),opacity .2s}
.lmx .mark .f{background:#F3EEE5;color:var(--ink-2);font-size:12.5px;font-weight:700}
.lmx .mark .f.none{background:none;color:var(--ink-3)}
.lmx .mark .f.none::after{content:'';position:absolute;inset:0;border-radius:50%;border:1.5px dashed var(--line-2)}
.lmx .mark .f.move{background:none;color:var(--ink-3)}
.lmx .mark .f svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.lmx .mark .k{background:none;box-shadow:inset 0 0 0 1.5px var(--line-2);transform:rotateY(180deg);opacity:0}
.lmx .mark .k svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0}
.lmx.selecting .mark .f{transform:rotateY(180deg);opacity:0}
.lmx.selecting .mark .k{transform:none;opacity:1}
.lmx .row.sel .mark .k{background:var(--clay);box-shadow:none}
.lmx .row.sel .mark .k svg{opacity:1}
.lmx .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.lmx .t1{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.lmx .t1 b{min-width:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lmx .t1 .amt{flex:none;font-family:var(--mono);font-size:15.5px;font-weight:500}
.lmx .t1 .amt.in{color:var(--sage)}
.lmx .t1 .amt.move{color:var(--ink-3)}
.lmx .t2{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:20px}
.lmx .t2 .meta{min-width:0;font-size:13px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lmx .tags{flex:none;display:flex;align-items:center;gap:8px;color:var(--ink-3)}
.lmx .tags svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.lmx .wtag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border:0;border-radius:11px;background:#F3EEE5;font-size:12px;font-weight:600;color:var(--ink-2)}
.lmx .wtag svg{width:13px;height:13px}
.lmx .bal{flex:none;font-family:var(--mono);font-size:12px;color:var(--ink-3)}

/* THE PAPER AN ENTRY CARRIES. Not a clip you cannot press — the sheet itself, folded corner and all,
   with a second sheet behind it when there are two. Small enough to ignore, plain enough to press. */
.lmx .clipx{flex:none;position:relative;width:28px;height:28px;margin:-4px -2px;display:grid;place-items:center;cursor:pointer}
.lmx .clipx:active{transform:scale(.9)}
.lmx .sheet{position:absolute;width:17px;height:21px;border-radius:3px 0 3px 3px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line-2);
  transition:transform .2s var(--ease)}
.lmx .sheet::after{content:'';position:absolute;top:0;right:0;width:7px;height:7px;background:var(--ground);
  border-left:1px solid var(--line-2);border-bottom:1px solid var(--line-2);border-bottom-left-radius:2px}
/* two faint rules: enough for the eye to read "a page" at 17px */
.lmx .sheet::before{content:'';position:absolute;left:3px;right:3px;top:11px;height:1px;background:var(--line-2);
  box-shadow:0 3px 0 0 var(--line-2)}
.lmx .sheet.back{transform:translate(-3px,-2px) rotate(-6deg);background:#F7F2EA}
.lmx .sheet.back::before,.lmx .sheet.back::after{display:none}
.lmx .clipx:active .sheet.back{transform:translate(-4px,-3px) rotate(-9deg)}
.lmx .row.sel .sheet{box-shadow:inset 0 0 0 1px rgba(181,71,42,.35)}
.lmx .row.sel .sheet::after{background:var(--clay-wash)}

/* THE PEEK. The paper, on the night ground, the only thing on screen. */
.lmx-peek{position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:22px 16px;
  background:rgba(12,9,7,.94);font-family:'DM Sans',system-ui,sans-serif;color:rgb(250,248,243);opacity:0;transition:opacity .22s ease}
.lmx-peek.on{opacity:1}
.lmx-peek .pk-x{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;width:44px;height:44px;border:0;border-radius:22px;
  background:rgba(250,248,243,.12);color:rgb(250,248,243);display:grid;place-items:center}
.lmx-peek .pk-x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.lmx-peek .pk-paper{position:relative;flex:0 1 auto;width:min(100% - 40px,340px);max-height:62vh;aspect-ratio:3/4;border-radius:14px;background:#F4EFE6;overflow:hidden;
  box-shadow:0 30px 60px -20px rgba(0,0,0,.8);display:grid;place-items:center;transition:transform .3s cubic-bezier(.22,.8,.24,1),opacity .3s ease;touch-action:none}
.lmx-peek .pk-paper img,.lmx-peek .pk-paper object{width:100%;height:100%;object-fit:contain;border:0}
.lmx-peek .pk-wait{display:flex;gap:6px}
.lmx-peek .pk-wait i{width:7px;height:7px;border-radius:50%;background:#2B211A;opacity:.25;animation:pkWait 1.1s ease-in-out infinite}
.lmx-peek .pk-wait i:nth-child(2){animation-delay:.14s}
.lmx-peek .pk-wait i:nth-child(3){animation-delay:.28s}
@keyframes pkWait{0%,100%{opacity:.18;transform:translateY(0)}50%{opacity:.5;transform:translateY(-3px)}}
.lmx-peek .pk-gone{padding:0 24px;text-align:center;font-size:14.5px;line-height:1.5;color:#5C4F45}
.lmx-peek .pk-foot{flex:none;width:min(100%,360px);display:flex;flex-direction:column;align-items:center;gap:10px}
.lmx-peek .pk-seg{display:flex;padding:3px;border-radius:16px;background:rgba(250,248,243,.08)}
.lmx-peek .pk-seg button{height:32px;padding:0 16px;border:0;border-radius:13px;background:none;color:rgba(250,248,243,.7);font:inherit;font-size:13.5px;font-weight:600;
  transition:background .25s,color .25s}
.lmx-peek .pk-seg button[aria-pressed="true"]{background:rgb(250,248,243);color:#15100C}
.lmx-peek .pk-cap{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}
.lmx-peek .pk-cap .what{font-size:14.5px;color:rgba(250,248,243,.9);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lmx-peek .pk-cap .what b{font-weight:600}
.lmx-peek .pk-cap .when{font-family:'DM Mono',ui-monospace,monospace;font-size:12.5px;color:rgba(250,248,243,.5)}
.lmx-peek .pk-acts{display:flex;gap:8px;width:100%}
.lmx-peek .pk-acts button,.lmx-peek .pk-acts a{flex:1;height:48px;border:0;border-radius:16px;background:rgba(250,248,243,.1);color:rgb(250,248,243);
  font:inherit;font-size:14.5px;font-weight:600;display:grid;place-items:center;text-decoration:none}
.lmx-peek .pk-acts a{background:rgb(250,248,243);color:#15100C}
.lmx .close{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:13px 18px 15px;border-top:1px solid var(--rule)}
.lmx .close em{font-family:var(--serif);font-style:italic;font-size:15.5px;color:var(--ink-2)}
.lmx .close b{font-family:var(--mono);font-weight:500;font-size:15px;padding:0 0 5px 28px;border-bottom:3px double var(--ink)}
.lmx .empty{margin:20px 16px 0;padding:26px 20px;border:1.5px dashed var(--line-2);border-radius:22px;text-align:center;font-size:14.5px;color:var(--ink-2)}
.lmx .empty b{display:block;font-size:16.5px;color:var(--ink);margin-bottom:4px}

/* a wallet as its own ledger */
.lmx .hero.wl-hero .period,.lmx .hero.wl-hero .bars,.lmx .hero.wl-hero .pills,.lmx .hero.wl-hero .out,.lmx .hero.wl-hero .icb{display:none}
.lmx .wback{display:inline-flex;align-items:center;gap:6px;height:36px;margin:-4px 0 10px -8px;padding:0 12px 0 6px;border:0;border-radius:18px;background:none;
  font-size:13.5px;font-weight:600;color:rgba(var(--cream),.75)}
.lmx .wback svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.lmx .wbal{display:flex;align-items:baseline;gap:8px;margin-top:14px;font-family:var(--mono);font-size:31px}
.lmx .wbal small{font-family:var(--sans);font-size:14px;color:rgba(var(--cream),.55)}
.lmx .wacts{display:flex;gap:8px;margin-top:16px}
.lmx .wacts button{height:40px;padding:0 16px;border-radius:20px;border:1px solid rgba(var(--cream),.16);background:none;font-size:13.5px;font-weight:600;color:rgba(var(--cream),.9)}
.lmx .wacts .pri{background:rgb(var(--cream));color:var(--night);border-color:transparent}

/* select mode: the top counts and sums */
.lmx-selbar{position:fixed;left:0;right:0;top:0;z-index:30;max-width:430px;margin:0 auto;height:56px;padding:0 8px 0 6px;display:flex;align-items:center;gap:4px;
  background:#15100C;color:rgb(250,248,243);font-family:'DM Sans',system-ui,sans-serif;transform:translateY(-100%);transition:transform .38s cubic-bezier(.22,.8,.24,1)}
.lmx-selbar.on{transform:none}
.lmx-selbar .x{width:44px;height:44px;border:0;border-radius:22px;background:none;color:rgb(250,248,243);display:grid;place-items:center}
.lmx-selbar .n{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px;font-size:16px;font-weight:600}
.lmx-selbar .n span{font-family:'DM Mono',ui-monospace,monospace;font-weight:500;font-size:14px;color:rgba(250,248,243,.65)}
.lmx-selbar .all{height:36px;padding:0 12px;border:0;border-radius:18px;background:rgba(250,248,243,.1);font-size:13px;font-weight:600;color:rgb(250,248,243)}

/* the void action, in the bar the page borrowed. Held, never tapped. */
.mnav .nav .acts .tab.void{color:#D4633E;touch-action:none}
.mnav .nav .acts .tab.void::before{content:'';position:absolute;inset:6px 8px;border-radius:22px;background:rgba(212,99,62,.22);transform:scaleX(0);transform-origin:left;transition:transform .15s ease}
.mnav .nav .acts .tab.void.hold::before{transform:scaleX(1);transition:transform .9s linear}
.mnav .nav .acts .tab span{position:relative}

/* toast, panel */
.lmx-toast{position:fixed;left:16px;right:16px;top:66px;z-index:70;width:fit-content;max-width:calc(100% - 32px);margin-inline:auto;transform:translateY(-16px);opacity:0;pointer-events:none;
  display:flex;align-items:center;gap:10px;padding:11px 8px 11px 16px;border-radius:16px;background:#15100C;color:rgb(250,248,243);font-family:'DM Sans',system-ui,sans-serif;font-size:14px;
  box-shadow:0 18px 40px -16px rgba(21,16,12,.6);transition:transform .4s cubic-bezier(.22,.8,.24,1),opacity .3s}
.lmx-toast.on{transform:none;opacity:1;pointer-events:auto}
.lmx-toast button{min-height:34px;padding:0 12px;border:0;border-radius:10px;background:rgba(250,248,243,.14);color:#fff;font-size:13.5px;font-weight:600}
.lmx-scrim{position:fixed;inset:0;z-index:57;background:rgba(21,16,12,.38);opacity:0;transition:opacity .35s}
.lmx-scrim.on{opacity:1}
.lmx-panel{--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--night:#15100C;--ease:cubic-bezier(.22,.8,.24,1);--nav-h:64px;--nav-gap:12px;
  position:fixed;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom));z-index:58;max-width:406px;margin:0 auto;
  max-height:calc(100dvh - 24px);padding:8px 16px calc(var(--nav-h) + 14px);display:flex;flex-direction:column;border-radius:32px;background:var(--night);color:rgb(var(--cream));
  font-family:'DM Sans',system-ui,sans-serif;box-shadow:0 24px 50px -16px rgba(21,16,12,.7);
  transform:translateY(24px) scale(.96);transform-origin:50% 100%;opacity:0;overflow:auto;transition:transform .46s var(--ease),opacity .28s}
.lmx-panel *{box-sizing:border-box}
.lmx-panel.on{transform:none;opacity:1;transition:transform .5s var(--ease),opacity .3s}
.lmx-panel .grab{flex:none;display:grid;place-items:center;height:20px}
.lmx-panel .grab i{width:36px;height:4px;border-radius:2px;background:rgba(var(--cream),.18)}
.lmx-panel .p-head{display:flex;align-items:flex-start;gap:10px;margin:6px 0 12px}
.lmx-panel .p-head .t{flex:1;min-width:0}
.lmx-panel .p-head h2{margin:0;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:21px;line-height:1.2}
.lmx-panel .p-head > .t > span{font-size:13px;color:rgba(var(--cream),.55)}
.lmx-panel .x{flex:none;width:40px;height:40px;margin:-6px -8px 0 0;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.7);display:grid;place-items:center}
.lmx-panel .x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.lmx-panel .figure{display:flex;align-items:baseline;gap:6px;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:40px;line-height:1.05;font-variant-numeric:lining-nums;margin-bottom:8px}
.lmx-panel .figure span{font-size:26px;color:var(--clay-hi)}
.lmx-panel .s{display:flex;align-items:baseline;gap:12px;min-height:44px;padding:11px 0;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.lmx-panel .s > span{flex:none;width:86px;font-size:14px;color:rgba(var(--cream),.55)}
.lmx-panel .s b{flex:1;min-width:0;text-align:right;font-size:15px;font-weight:600}
.lmx-panel .s b.warn{color:var(--clay-hi)}
/* WHAT THIS ENTRY CARRIES. A line of its own, which opens onto the papers themselves. */
.lmx-panel .s.sx{width:100%;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;gap:12px}
.lmx-panel .s.sx:disabled{cursor:default}
.lmx-panel .s.sx b.none{color:rgba(var(--cream),.45);font-weight:500}
.lmx-panel .s.sx .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;
  transition:transform .35s var(--ease)}
.lmx-panel .s.sx.open{box-shadow:none}
.lmx-panel .s.sx.open .c{transform:rotate(90deg)}
.lmx-panel .thumbs{display:flex;gap:12px;padding:2px 0 16px;box-shadow:0 1px 0 0 rgba(var(--cream),.08);
  animation:lmxOpen .38s var(--ease) both}
@keyframes lmxOpen{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.lmx-panel .th{display:flex;flex-direction:column;align-items:center;gap:7px;border:0;background:none;padding:0;cursor:pointer}
.lmx-panel .th em{font-style:normal;font-size:12px;font-weight:600;color:rgba(var(--cream),.55)}
.lmx-panel .th:active .sh{transform:scale(.96)}
/* the paper again, at reading size: a sheet with its corner turned */
.lmx-panel .sh{position:relative;display:grid;place-items:center;width:74px;height:94px;border-radius:8px 0 8px 8px;background:#F4EFE6;overflow:hidden;
  box-shadow:0 8px 20px -10px rgba(0,0,0,.6),inset 0 0 0 1px rgba(21,16,12,.12);transition:transform .18s var(--ease)}
.lmx-panel .sh::after{content:'';position:absolute;top:0;right:0;width:16px;height:16px;background:var(--night);
  border-left:1px solid rgba(21,16,12,.12);border-bottom:1px solid rgba(21,16,12,.12);border-bottom-left-radius:3px;z-index:1}
.lmx-panel .sh img{width:100%;height:100%;object-fit:cover}
.lmx-panel .sh .pdf{font-family:'DM Mono',ui-monospace,monospace;font-size:12px;font-weight:500;color:#8A7B6E;letter-spacing:.06em}
.lmx-panel .sh .load{width:22px;height:2px;border-radius:1px;background:rgba(21,16,12,.12);overflow:hidden;position:relative}
.lmx-panel .sh .load::after{content:'';position:absolute;inset:0;border-radius:1px;background:rgba(21,16,12,.3);animation:lmxLoad 1.1s ease-in-out infinite}
@keyframes lmxLoad{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}

.lmx-panel .quote{margin:12px 0 0;padding:11px 13px;border-radius:14px;background:rgba(var(--cream),.06);font-family:'DM Mono',ui-monospace,monospace;font-size:13px;line-height:1.45;color:rgba(var(--cream),.85)}
.lmx-panel .p-acts{display:flex;gap:8px;margin-top:16px}
.lmx-panel .p-acts button{flex:1;height:50px;border:0;border-radius:16px;font-size:15px;font-weight:600}
.lmx-panel .p-acts .pri{background:var(--clay);color:#fff}
.lmx-panel .p-acts .sec{background:rgba(var(--cream),.08);color:rgb(var(--cream))}
.lmx-panel .wl{display:flex;align-items:center;gap:12px;width:100%;min-height:60px;border:0;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.lmx-panel .wl .av{flex:none;width:38px;height:38px;border-radius:19px;background:rgba(var(--cream),.09);display:grid;place-items:center;font-size:12.5px;font-weight:700}
.lmx-panel .wl .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.lmx-panel .wl b{font-size:15.5px;font-weight:600}
.lmx-panel .wl .bar{display:block;height:4px;border-radius:2px;background:rgba(var(--cream),.1);overflow:hidden}
.lmx-panel .wl .bar i{display:block;height:100%;border-radius:2px;background:var(--clay-hi)}
.lmx-panel .wl em{flex:none;font-style:normal;font-family:'DM Mono',ui-monospace,monospace;font-size:15px}
.lmx-panel .wl .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.lmx-panel .fsec{margin:14px 0 8px;font-size:12.5px;font-weight:600;color:rgba(var(--cream),.5)}
.lmx-panel .fchips{display:flex;flex-wrap:wrap;gap:6px}
.lmx-panel .fchip{height:38px;padding:0 14px;border-radius:19px;border:0;background:rgba(var(--cream),.07);color:rgba(var(--cream),.85);font-size:13.5px;font-weight:600}
.lmx-panel .fchip[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.lmx-panel .menu button{display:flex;align-items:center;gap:14px;width:100%;min-height:54px;border:0;background:none;color:rgb(var(--cream));font-size:15.5px;font-weight:600;text-align:left;
  box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.lmx-panel .menu svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.8}
@media (prefers-reduced-motion:reduce){.lmx *,.lmx-panel *{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
