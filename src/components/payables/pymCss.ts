/**
 * The phone's Payables — the reference's own values, scoped under `.pym`.
 * (claude.ai/artifact/FnHwFKvEjCHFDSme2NmL8E)
 */
export const PYM_CSS = `
.pym{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;
  --night:#15100C;--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--sage:#2F5D3A;--sage-hi:#8FC79A;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif;--sans:'DM Sans',system-ui,-apple-system,sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;
  --ease:cubic-bezier(.22,.8,.24,1);--nav-h:64px;--nav-gap:12px;
  position:relative;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.4;
  padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom))}
.pym *{box-sizing:border-box}
.pym button,.pym input{font:inherit;color:inherit}
.pym button{cursor:pointer}
.pym [hidden]{display:none!important}

/* =====================================================================
   PAYABLES.  A weekly run is a pipeline, so the page is one: approve → pay → paid
   ===================================================================== */
.pym .hero{background:var(--night);color:rgb(var(--cream));padding:24px 20px 22px}
.pym .hero-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pym .hero h1{margin:0;font-family:var(--serif);font-weight:600;font-size:34px;letter-spacing:-.01em;line-height:1.1}
.pym .week{display:flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:18px;border:1px solid rgba(var(--cream),.16);background:none;
  font-size:13.5px;font-weight:600;color:rgba(var(--cream),.85);white-space:nowrap}
.pym .week svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:.6}
.pym .sum{margin-top:20px;font-family:var(--mono);font-size:32px;letter-spacing:-.01em}
.pym .sum small{font-family:var(--sans);font-size:14px;color:rgba(var(--cream),.55);margin-left:8px}
.pym .run{display:flex;gap:3px;height:6px;margin:16px 0 10px;border-radius:3px;overflow:hidden;background:rgba(var(--cream),.12)}
.pym .run i{display:block;height:100%;min-width:0;transition:flex-grow .7s var(--ease);flex:0 0 0}
.pym .run .p{background:var(--sage-hi)}.pym .run .a{background:rgb(var(--cream))}.pym .run .w{background:transparent}
.pym .legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:rgba(var(--cream),.6)}
.pym .legend span{display:flex;align-items:center;gap:6px}
.pym .legend i{width:7px;height:7px;border-radius:50%}
.pym .legend b{font-family:var(--mono);font-weight:500;color:rgba(var(--cream),.9)}

.pym .stages{position:sticky;top:0;z-index:5;padding:12px 16px 10px;background:linear-gradient(var(--ground) 82%,rgba(250,248,243,0))}
.pym .seg3{position:relative;display:grid;grid-template-columns:repeat(4,1fr);padding:4px;border-radius:18px;background:#EFE9DF}
.pym .thumb3{position:absolute;top:4px;bottom:4px;left:4px;width:calc((100% - 8px) / 4);border-radius:14px;background:var(--paper);
  box-shadow:0 2px 8px -3px rgba(43,33,26,.25);transition:transform .45s cubic-bezier(.3,1.25,.5,1)}
.pym .seg3 button{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:5px;height:40px;padding:0;border:0;background:none;
  font-size:13.5px;font-weight:600;color:var(--ink-3);transition:color .3s}
.pym .seg3 button[aria-pressed="true"]{color:var(--ink)}
.pym .seg3 em{font-style:normal;font-family:var(--mono);font-size:11px;min-width:18px;height:18px;padding:0 5px;border-radius:10px;background:rgba(43,33,26,.07);
  display:grid;place-items:center;transition:background .3s,color .3s}
.pym .seg3 button[aria-pressed="true"] em{background:var(--clay);color:#fff}
.pym .seg3 em.bump{animation:pymBump .5s var(--ease)}
@keyframes pymBump{40%{transform:scale(1.3)}}

.pym .sec{display:flex;align-items:baseline;justify-content:space-between;padding:16px 24px 8px}
.pym .sec b{font-family:var(--serif);font-weight:600;font-size:19px}
.pym .sec span{font-family:var(--mono);font-size:13px;color:var(--ink-2)}
.pym .card{margin:0 16px;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.pym .row{display:flex;gap:12px;padding:14px 14px 14px 16px;border-top:1px solid var(--rule);max-height:120px;
  transition:opacity .3s ease,transform .38s var(--ease),max-height .38s var(--ease) .1s,padding .38s var(--ease) .1s}
.pym .row:first-child{border-top:0}
.pym .row.leave{opacity:0;transform:translateX(28px);max-height:0;padding-top:0;padding-bottom:0;border-top-width:0}
.pym .row.back{animation:pymArrive .5s var(--ease) both}
@keyframes pymArrive{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
.pym .av{flex:none;width:40px;height:40px;border-radius:20px;background:#F3EEE5;color:var(--ink-2);display:grid;place-items:center;font-family:var(--serif);font-size:17px}
.pym .body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;border:0;padding:0;background:none;text-align:left}
.pym .l1{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.pym .l1 b{min-width:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pym .l1 .amt{flex:none;font-family:var(--mono);font-size:16px;font-weight:500}
.pym .l1 .amt.zero{color:var(--ink-3)}
.pym .l2{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:34px}
.pym .meta{min-width:0;font-size:13px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pym .meta .site{display:inline-block;width:7px;height:7px;border-radius:50%;margin:0 5px 1px 2px}
.pym .meta .ring{display:inline-block;width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay);margin:0 5px -1px 0}
.pym .meta .warn{color:var(--clay)}
.pym .meta .earlier{color:var(--ink-2)}
/* the stage's verb. Same capsule, same place, every stage. */
.pym .act{flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--line-2);background:var(--paper);
  font-size:13.5px;font-weight:600;color:var(--ink);white-space:nowrap;transition:background-color .3s ease,color .3s ease,border-color .3s ease,transform .15s ease}
.pym .act:active{transform:scale(.95)}
.pym .act:disabled{opacity:.5}
.pym .act.pay{background:var(--ink);border-color:var(--ink);color:var(--ground)}
.pym .act svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22}
.pym .act.done{background:var(--sage);border-color:var(--sage);color:#fff}
.pym .act.done svg{animation:pymTick .4s ease-out forwards}
@keyframes pymTick{to{stroke-dashoffset:0}}
.pym .act.morph{animation:pymMorph .45s var(--ease) both}
@keyframes pymMorph{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}
.pym .row.ispaid .l1 b,.pym .row.ispaid .l1 .amt{color:var(--ink-3);transition:color .5s ease}
.pym .row.ispaid .av{opacity:.6}
.pym .paidtag{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--sage);background:none;border:0;padding:0}
.pym .paidtag svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dashoffset:0}
.pym .fold{display:flex;align-items:center;gap:12px;width:100%;padding:16px;border:0;border-top:1px solid var(--rule);background:none;text-align:left}
.pym .fold:first-child{border-top:0}
.pym .fold .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pym .fold b{font-size:15px;font-weight:600}
.pym .fold span{font-size:13px;color:var(--ink-3)}
.pym .fold svg{flex:none;width:16px;height:16px;fill:none;stroke:var(--ink-3);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .35s var(--ease)}
.pym .fold[aria-expanded="true"] svg{transform:rotate(90deg)}
.pym .addreq{display:flex;align-items:center;justify-content:center;gap:8px;margin:14px 16px 0;height:52px;width:calc(100% - 32px);border-radius:18px;
  border:1.5px dashed var(--line-2);background:none;font-size:14.5px;font-weight:600;color:var(--clay)}
.pym .empty{margin:18px 16px 0;padding:26px 20px;border:1.5px dashed var(--line-2);border-radius:22px;text-align:center}
.pym .empty b{display:block;font-size:16.5px;margin-bottom:4px}
.pym .empty span{font-size:14px;color:var(--ink-2);text-wrap:pretty}
.pym .loading{margin:18px 16px 0;padding:26px 20px;text-align:center;color:var(--ink-3);font-size:14px}

/* the action capsule — one press approves everything proposed */
.pym-fab{--w:170px;position:fixed;right:16px;bottom:calc(12px + 64px + 14px + env(safe-area-inset-bottom));z-index:19;height:54px;width:var(--w);padding:0;border:0;
  border-radius:27px;background:#B5472A;color:#fff;display:flex;align-items:center;overflow:hidden;white-space:nowrap;cursor:pointer;
  font-family:'DM Sans',system-ui,sans-serif;
  box-shadow:0 16px 28px -14px rgba(181,71,42,.95),0 4px 10px -6px rgba(21,16,12,.4);
  transition:width .42s cubic-bezier(.22,.8,.24,1),transform .38s cubic-bezier(.22,.8,.24,1),opacity .25s ease,background-color .4s ease,box-shadow .4s ease}
.pym-fab:active{transform:scale(.96)}
.pym-fab .ic{position:relative;flex:none;width:54px;height:54px;display:grid;place-items:center}
.pym-fab .ic svg{position:absolute;inset:0;margin:auto;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;
  transition:opacity .25s,transform .4s cubic-bezier(.22,.8,.24,1)}
.pym-fab .pip{position:absolute;inset:0;margin:auto;width:8px;height:8px;border-radius:50%;background:#fff;opacity:0}
.pym-fab .pip::after{content:'';position:absolute;inset:0;border-radius:50%;border:1px solid #fff;opacity:0}
.pym-fab .lbl{font-size:16px;font-weight:600;margin-left:-6px;padding-right:22px;transition:opacity .22s}
.pym-fab.folded{width:54px}.pym-fab.folded .lbl{opacity:0}
.pym-fab.away{transform:translateY(16px) scale(.7);opacity:0;pointer-events:none}
.pym-fab.working .ic svg{opacity:0;transform:scale(.5)}
.pym-fab.working .pip{opacity:1;animation:pymBreath 1.5s ease-in-out infinite}
.pym-fab.working .pip::after{animation:pymPing 1.5s cubic-bezier(.22,.8,.24,1) infinite}
.pym-fab.done{background:#2F5D3A;box-shadow:0 16px 28px -14px rgba(47,93,58,.9)}
@keyframes pymBreath{50%{transform:scale(.72)}}
@keyframes pymPing{0%{transform:scale(1);opacity:.5}100%{transform:scale(3);opacity:0}}
.pym-measure{position:fixed;visibility:hidden;white-space:nowrap;font-size:16px;font-weight:600;font-family:'DM Sans',system-ui,sans-serif}

/* toast, with the undo that every move earns */
.pym-toast{position:fixed;left:16px;right:16px;top:14px;z-index:70;width:fit-content;max-width:calc(100% - 32px);margin-inline:auto;
  transform:translateY(-16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:11px 8px 11px 16px;border-radius:16px;
  background:#15100C;color:rgb(250,248,243);font-family:'DM Sans',system-ui,sans-serif;font-size:14px;
  box-shadow:0 18px 40px -16px rgba(21,16,12,.6);transition:transform .4s cubic-bezier(.22,.8,.24,1),opacity .3s}
.pym-toast.on{transform:none;opacity:1;pointer-events:auto}
.pym-toast button{min-height:34px;padding:0 12px;border:0;border-radius:10px;background:rgba(250,248,243,.14);color:#fff;font-size:13.5px;font-weight:600;cursor:pointer}

/* the panel: the bar opens, as everywhere else */
.pym-scrim{position:fixed;inset:0;z-index:57;background:rgba(21,16,12,.38);opacity:0;transition:opacity .35s}
.pym-scrim.on{opacity:1}
.pym-panel{--ease:cubic-bezier(.22,.8,.24,1);--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--sage:#2F5D3A;--night:#15100C;--nav-h:64px;--nav-gap:12px;
  position:fixed;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom));z-index:58;max-width:406px;margin:0 auto;
  height:var(--h,520px);max-height:calc(100dvh - 24px);padding:8px 14px calc(var(--nav-h) + 12px);display:flex;flex-direction:column;border-radius:32px;
  background:var(--night);color:rgb(var(--cream));font-family:'DM Sans',system-ui,sans-serif;box-shadow:0 24px 50px -16px rgba(21,16,12,.7);
  transform:translateY(24px) scale(.96);transform-origin:50% 100%;opacity:0;overflow:hidden;
  transition:transform .46s var(--ease),opacity .28s,height .5s var(--ease)}
.pym-panel *{box-sizing:border-box}
.pym-panel.on{transform:none;opacity:1;transition:transform .5s var(--ease),opacity .3s,height .5s var(--ease)}
.pym-panel .grab{flex:none;display:grid;place-items:center;height:20px}
.pym-panel .grab i{width:36px;height:4px;border-radius:2px;background:rgba(var(--cream),.18)}
.pym-panel .p-head{flex:none;display:flex;align-items:center;gap:6px;min-height:52px;margin:2px -4px 8px}
.pym-panel .p-head .ico{flex:none;width:40px;height:40px;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.7);display:grid;place-items:center;cursor:pointer}
.pym-panel .p-head .ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pym-panel .p-head .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pym-panel h2{margin:0;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:21px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pym-panel .p-head > .t > span{font-size:13px;color:rgba(var(--cream),.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pym-panel .p-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 2px;overflow:auto;scrollbar-width:none;animation:pymStepIn .42s var(--ease) both}
.pym-panel .p-body::-webkit-scrollbar{display:none}
.pym-panel .p-body.back{animation-name:pymStepBack}
@keyframes pymStepIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes pymStepBack{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
.pym-panel .owes{display:flex;flex-direction:column}
.pym-panel .owes > div{display:flex;align-items:baseline;gap:10px;min-height:42px;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pym-panel .owes span{flex:none;font-size:14px;color:rgba(var(--cream),.55)}
.pym-panel .owes em{flex:1;min-width:0;font-style:normal;font-size:13px;color:rgba(var(--cream),.4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pym-panel .owes b{flex:none;font-family:'DM Mono',ui-monospace,monospace;font-weight:500;font-size:15px}
.pym-panel .owes .tot span,.pym-panel .owes .tot b{color:rgb(var(--cream));font-weight:600}
.pym-panel .owes .tot{box-shadow:none}
.pym-panel .payamt{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.pym-panel .payamt small{font-size:12.5px;font-weight:600;color:rgba(var(--cream),.5)}
.pym-panel .payamt .fig{display:flex;align-items:baseline;gap:6px;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:42px;line-height:1.05;font-variant-numeric:lining-nums}
.pym-panel .payamt .fig span{font-size:27px;color:var(--clay-hi)}
.pym-panel .chips{display:flex;gap:6px;flex-wrap:wrap}
.pym-panel .chip{height:36px;padding:0 13px;border-radius:18px;border:0;background:rgba(var(--cream),.07);color:rgba(var(--cream),.85);font:inherit;font-size:13.5px;
  font-weight:600;cursor:pointer;transition:background .25s,color .25s}
.pym-panel .chip[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.pym-panel .flag{margin-top:14px;padding:12px 14px;border-radius:16px;box-shadow:inset 0 0 0 1.5px rgba(212,99,62,.7);font-size:13.5px;line-height:1.45;
  color:rgba(var(--cream),.8);text-wrap:pretty}
.pym-panel .flag b{display:block;color:rgb(var(--cream));margin-bottom:2px}
.pym-panel .flag button{margin-top:8px;height:34px;padding:0 12px;border:0;border-radius:17px;background:rgba(var(--cream),.1);font:inherit;font-size:13px;font-weight:600;color:rgb(var(--cream))}
.pym-panel .foot{flex:none;margin-top:auto;padding-top:14px;display:flex;flex-direction:column;gap:2px}
.pym-panel .big{width:100%;height:54px;border:0;border-radius:16px;background:var(--clay);color:#fff;font:inherit;font-size:16.5px;font-weight:600;
  display:flex;align-items:center;justify-content:center;gap:8px;transition:background-color .35s ease}
.pym-panel .big.ok{background:var(--sage)}
.pym-panel .big:disabled{opacity:.6}
.pym-panel .big svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22}
.pym-panel .big.ok svg{animation:pymTick .4s ease-out forwards}
.pym-panel .linkb{align-self:center;height:38px;padding:0 12px;border:0;background:none;color:rgba(var(--cream),.6);font:inherit;font-size:13.5px;font-weight:600;
  text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.pym-panel .rowS{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:0 4px;border:0;background:none;color:rgb(var(--cream));font:inherit;
  text-align:left;cursor:pointer;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pym-panel .rowS .l{flex:none;width:92px;font-size:14px;color:rgba(var(--cream),.55)}
.pym-panel .rowS .v{flex:1;min-width:0;text-align:right;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pym-panel .rowS .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .35s var(--ease)}
.pym-panel .rowS.open{box-shadow:none}.pym-panel .rowS.open .c{transform:rotate(90deg)}
.pym-panel .pick{padding:2px 4px 14px;box-shadow:0 1px 0 0 rgba(var(--cream),.08);animation:pymPickIn .38s var(--ease) both}
@keyframes pymPickIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.pym-panel .seg{display:grid;grid-template-columns:repeat(4,1fr);padding:3px;border-radius:16px;background:rgba(var(--cream),.07)}
.pym-panel .seg button{height:42px;border:0;border-radius:13px;background:none;color:rgba(var(--cream),.75);font:inherit;font-size:14px;font-weight:600;cursor:pointer;
  transition:background .25s,color .25s}
.pym-panel .seg button[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.pym-panel .xtra{position:relative;display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 14px 0 11px;border-radius:19px;
  border:1px solid rgba(var(--cream),.16);color:rgba(var(--cream),.8);font-size:13.5px;font-weight:600;overflow:hidden;cursor:pointer}
.pym-panel .xtra svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.pym-panel .xtra input{position:absolute;inset:0;opacity:0;cursor:pointer}
.pym-panel .xtra.has{border-color:rgba(143,199,154,.5);color:#A9D6B1}
.pym-panel .amt2{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0 6px;text-align:center}
.pym-panel .amt2 .line{display:flex;align-items:center;justify-content:center;width:100%;position:relative;min-height:58px}
.pym-panel .amt2 .fig{display:flex;align-items:baseline;gap:6px;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:46px;line-height:1.1;font-variant-numeric:lining-nums}
.pym-panel .amt2 .fig span{font-size:29px;color:var(--clay-hi)}
.pym-panel .amt2 .fig b{font-weight:600}
.pym-panel .amt2 .fig b.zero{color:rgba(var(--cream),.28)}
.pym-panel .amt2 .del{position:absolute;right:0;top:50%;margin-top:-24px;width:48px;height:48px;border:0;border-radius:24px;background:none;color:rgba(var(--cream),.6);
  display:grid;place-items:center;cursor:pointer}
.pym-panel .amt2 .del svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pym-panel .amt2 p{margin:0;min-height:18px;font-size:13px;color:rgba(var(--cream),.55)}
.pym-panel .pad3{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:2px 8px;user-select:none;-webkit-user-select:none}
.pym-panel .k3{border:0;border-radius:20px;background:none;color:rgb(var(--cream));font:inherit;font-size:28px;font-weight:500;display:grid;place-items:center;
  cursor:pointer;touch-action:manipulation}
.pym-panel .k3.z{font-size:22px;letter-spacing:.04em;color:rgba(var(--cream),.85)}
.pym-panel .k3.hit{background:rgba(var(--cream),.13)}
.pym-panel .k3.go{background:var(--clay);font-size:16px;font-weight:600}
.pym-panel .k3.go[disabled]{opacity:.32}
.pym-panel .weeks{display:flex;flex-direction:column}
.pym-panel .weeks button{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px;padding:0 4px;border:0;background:none;
  color:rgb(var(--cream));font:inherit;font-size:15.5px;font-weight:600;text-align:left;cursor:pointer;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pym-panel .weeks button em{font-style:normal;font-size:13px;font-weight:500;color:rgba(var(--cream),.45)}
.pym-panel .weeks button[aria-pressed="true"] em{color:var(--clay-hi)}
@media (prefers-reduced-motion:reduce){.pym *,.pym-panel *{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
