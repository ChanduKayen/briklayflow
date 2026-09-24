// Exact styles from the desktop Purchase-orders reference, scoped under `.pox` so nothing leaks into the
// rest of the app (the reference used bare .top/.btn/.inbox/.req/.tbl/.tr/.st/.amt/… that WOULD collide).
// The app already owns the left rail + page chrome, so the reference's .shell/.rail/.main are dropped;
// `.pox` IS the reference's scrollable main content. Everything else is verbatim.
export const PO_LIST_DESKTOP_CSS = `
.pox{
  --ground:#FAF8F3; --paper:#FFFFFF; --ink:#2B211A; --ink-2:#5C4F45; --ink-3:#8A7B6E; --line:#E9E1D6; --line-2:#DCD2C4; --rule:#F0E9DF; --wash:#F3EEE5;
  --night:#15100C; --cream:250,248,243; --clay:#B5472A; --clay-hi:#D4633E; --clay-wash:#FBEDE6; --sage:#2F5D3A; --sage-hi:#8FC79A; --sage-wash:#E7F0E6; --sheet:#F4EFE6; --wa:#25A65B;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif; --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'DM Mono',ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,.8,.24,1);
  background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:14.5px;line-height:1.4;-webkit-font-smoothing:antialiased;
  min-height:100vh;padding:28px 40px 60px;
}
.pox *{box-sizing:border-box}
.pox button,.pox input{font:inherit;color:inherit}
.pox button{cursor:pointer}
.pox :focus-visible{outline:2px solid var(--clay-hi);outline-offset:3px;border-radius:8px}
.pox [hidden]{display:none!important}
.pox .wrap{max-width:1240px;margin:0 auto}
.pox .top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
.pox .top h1{margin:0;font-family:var(--serif);font-weight:600;font-size:34px;letter-spacing:-.01em;line-height:1.1}
.pox .top p{margin:8px 0 0;font-size:15px;color:var(--ink-2)}
.pox .top p b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.pox .top p .ok{color:var(--sage)}
.pox .acts{display:flex;gap:8px}
.pox .btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line-2);background:var(--paper);font-size:14px;font-weight:600;color:var(--ink);transition:background .2s,transform .12s}
.pox .btn:active{transform:scale(.98)}
.pox .btn.pri{background:var(--clay);border-color:var(--clay);color:#fff;box-shadow:0 10px 20px -12px rgba(181,71,42,.9)}
.pox .btn.ink{background:var(--ink);border-color:var(--ink);color:var(--ground)}
.pox .btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

/* the inbox */
.pox .inbox{margin:26px -16px 0;padding:6px 16px 4px;border-radius:24px;background:linear-gradient(180deg,#F6EFE2 0%,#EFE7D7 55%,#EAE0CE 100%);box-shadow:inset 0 0 0 1px rgba(43,33,26,.05)}
.pox .inbox .hd{display:flex;align-items:center;gap:10px;padding:10px 8px 6px}
.pox .inbox .hd .mark{width:22px;height:22px;display:grid;place-items:center}
.pox .inbox .hd .mark svg{width:15px;height:15px;fill:var(--wa)}
.pox .inbox .hd h2{margin:0;font-family:var(--sans);font-weight:600;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.pox .inbox .hd h2 b{font-family:var(--mono);font-weight:500;color:var(--ink-2);margin-left:6px;letter-spacing:0}
.pox .inbox .hd .n{margin-left:auto;font-size:12.5px;color:var(--ink-3)}
.pox .req{display:grid;grid-template-columns:72px 1.4fr 1.1fr .9fr 1.3fr 190px;gap:20px;align-items:center;padding:14px 8px;border-top:1px dashed var(--line-2);border-radius:14px;color:var(--ink-2);transition:background .2s,transform .5s var(--ease),opacity .4s}
.pox .req:first-of-type{border-top:0}
.pox .req:hover{background:rgba(255,255,255,.55)}
.pox .req.filing{opacity:0;transform:translateY(60px) scale(.98)}
.pox .req > *{min-width:0}
.pox .paper{position:relative;width:52px;height:68px;border-radius:5px;background:var(--sheet);overflow:hidden;box-shadow:0 10px 18px -12px rgba(43,33,26,.65),0 0 0 1px rgba(43,33,26,.07);transform:rotate(-3deg);cursor:zoom-in;transition:transform .4s var(--ease)}
.pox .req:nth-of-type(odd) .paper{transform:rotate(2.5deg)}
.pox .paper img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
.pox .paper .pg{position:absolute;left:4px;bottom:4px;height:14px;padding:0 4px;border-radius:7px;background:rgba(21,16,12,.72);color:rgb(var(--cream));font-family:var(--mono);font-size:9.5px;display:flex;align-items:center}
.pox .req .what b{display:block;font-size:15.5px;font-weight:600;color:var(--ink)}
.pox .req .what span{display:block;margin-top:2px;font-size:13px;color:var(--ink-3)}
.pox .req .what i{display:block;margin-top:6px;font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px}
.pox .req .who{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink-2)}
.pox .req .who .av{width:30px;height:30px;border-radius:15px;background:rgba(43,33,26,.07);display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--ink-2)}
.pox .req .who span{display:block;font-size:12.5px;color:var(--ink-3)}
.pox .req .who div{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pox .req .site{font-size:14px;color:var(--ink-2)}
.pox .req .site i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}
.pox .req .site.none{color:var(--ink-3)}
.pox .needs{display:flex;flex-direction:column;gap:5px}
.pox .need{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-2);min-width:0}
.pox .need i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay);display:grid;place-items:center;flex:none}
.pox .need.ok i{background:var(--sage);box-shadow:none}
.pox .need.ok i svg{width:9px;height:9px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pox .need.ok{color:var(--ink-3)}
.pox .need.ok b{color:var(--ink-2);font-weight:500}
.pox .need b{font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;display:inline-block;vertical-align:bottom}
.pox .req .go{display:flex;gap:6px;justify-content:flex-end;min-width:0}
.pox .req .btn{height:36px;padding:0 14px;white-space:nowrap;background:none;border-color:transparent;color:var(--ink);font-weight:600}
.pox .req .btn.ink{background:none;color:var(--ink);border:1px solid var(--line-2)}
.pox .req .btn.pri{background:var(--clay);border-color:var(--clay);color:#fff}
.pox .inbox.clear{padding:0 16px}
.pox .inbox.clear .hd{padding:13px 8px}
.pox .inbox.clear .hd h2{color:var(--ink-3)}
.pox .inbox.clear .hd .n{font-size:13px;color:var(--ink-3)}
.pox .inbox.clear .hd .n b{font-weight:600;color:var(--ink-2)}
.pox .inbox.clear .hd .n a{color:var(--clay);font-weight:600;text-decoration:none;margin-left:14px;cursor:pointer}
.pox .empty{padding:36px 24px;border-top:1px solid var(--rule);text-align:center;color:var(--ink-2);font-size:14.5px}
.pox .empty b{display:block;font-family:var(--serif);font-weight:600;font-size:19px;color:var(--ink);margin-bottom:4px}

/* the table */
.pox .tools{display:flex;align-items:center;gap:16px;margin-top:30px}
.pox .find{display:flex;align-items:center;gap:10px;height:40px;width:340px;padding:0 14px;border-radius:20px;background:var(--paper);border:1px solid var(--line)}
.pox .find svg{width:16px;height:16px;fill:none;stroke:var(--ink-3);stroke-width:2;stroke-linecap:round}
.pox .find input{flex:1;min-width:0;border:0;background:none;outline:none;font-size:14px}
.pox .find input::placeholder{color:var(--ink-3)}
.pox .find:focus-within{border-color:var(--ink)}
.pox .tabs{display:flex;gap:26px;margin-left:auto}
.pox .tabs button{position:relative;height:40px;padding:0 2px;border:0;background:none;font-size:14.5px;font-weight:600;color:var(--ink-3)}
.pox .tabs button em{font-style:normal;font-family:var(--mono);font-size:12px;font-weight:400;margin-left:6px}
.pox .tabs button[aria-selected="true"]{color:var(--ink)}
.pox .tabs button[aria-selected="true"]::after{content:'';position:absolute;left:50%;bottom:2px;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:var(--clay-hi)}
.pox .result{font-size:13px;color:var(--ink-2)}
.pox .result b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.pox .result button{margin-left:6px;border:0;background:none;color:var(--clay);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.pox .grp{display:flex;align-items:baseline;justify-content:space-between;padding:14px 24px 8px;border-top:1px solid var(--rule);background:#FCFAF6}
.pox .th + .grp{border-top:0}
.pox .grp h4{margin:0;font-family:var(--serif);font-weight:500;font-size:16px;color:var(--ink)}
.pox .grp h4 small{font-family:var(--mono);font-size:12.5px;color:var(--ink-3);margin-left:8px}
.pox .grp span{font-size:13px;color:var(--ink-3)}
.pox .grp span b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.pox .tbl{margin-top:14px;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.pox .tr{display:grid;grid-template-columns:1.6fr 1.6fr 1fr .8fr 1.5fr .7fr;gap:18px;align-items:center;padding:0 24px;min-height:66px;border-top:1px solid var(--rule);cursor:pointer;transition:background .15s}
.pox .tr > *{min-width:0}
.pox .tr:hover{background:#FCFAF6}
.pox .tr.fresh{animation:poxFresh 1.8s ease-out}
@keyframes poxFresh{0%,25%{background:var(--sage-wash)}100%{background:var(--paper)}}
.pox .th{min-height:44px;border-top:0;border-bottom:1px solid var(--rule);cursor:default;font-size:12.5px;font-weight:600;color:var(--ink-3)}
.pox .th:hover{background:none}
.pox .th .r,.pox .tr .r{text-align:right}
.pox .v b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pox .v span{display:block;font-family:var(--mono);font-size:11.5px;color:var(--ink-3);margin-top:1px}
.pox .items{display:flex;align-items:center;gap:8px;min-width:0}
.pox .items span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)}
.pox .items em{flex:none;font-style:normal;font-family:var(--mono);font-size:11px;height:20px;padding:0 6px;border-radius:10px;background:var(--wash);color:var(--ink-2);display:grid;place-items:center}
.pox .site{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pox .site i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}
.pox .when{color:var(--ink-2)}
.pox .when span{display:block;font-size:12px;color:var(--ink-3)}
.pox .st{display:flex;align-items:center;gap:10px;min-width:0}
.pox .st .dot{flex:none;width:8px;height:8px;border-radius:50%}
.pox .st .ring{flex:none;width:9px;height:9px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay)}
.pox .st .tick{flex:none;width:16px;height:16px;border-radius:8px;background:var(--sage);display:grid;place-items:center}
.pox .st .tick svg{width:9px;height:9px;fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round}
.pox .st b{font-weight:600;white-space:nowrap}
.pox .st span{display:block;font-size:12.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pox .st span u{cursor:pointer}
.pox .st .quiet{color:var(--ink-3);font-weight:500}
.pox .act{height:32px;padding:0 12px;border-radius:16px;border:0;background:var(--clay);color:#fff;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;box-shadow:0 8px 16px -10px rgba(181,71,42,.9)}
.pox .act svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pox .act.ghost{background:none;border:1px solid var(--line-2);color:var(--ink);box-shadow:none}
.pox .amt{font-family:var(--mono);font-size:14.5px;text-align:right}
.pox .amt small{display:block;font-family:var(--sans);font-size:11.5px;color:var(--ink-3)}
.pox .amt.none{color:var(--line-2)}
.pox .amt.paid{color:var(--ink-3)}
.pox .foot{display:flex;justify-content:space-between;padding:14px 24px;border-top:1px solid var(--rule);font-size:13px;color:var(--ink-3)}
.pox .foot b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}

/* side peek */
.pox-scrim{position:fixed;inset:0;z-index:60;background:rgba(21,16,12,.28);opacity:0;pointer-events:none;transition:opacity .3s}
.pox-scrim.on{opacity:1;pointer-events:auto}
.pox-peek{position:fixed;top:12px;right:12px;bottom:12px;width:760px;max-width:calc(100vw - 24px);z-index:61;background:var(--night);color:rgb(var(--cream));border-radius:28px;box-shadow:0 30px 60px -24px rgba(21,16,12,.8);transform:translateX(40px);opacity:0;visibility:hidden;overflow:auto;padding:22px 26px 26px;transition:transform .42s var(--ease),opacity .28s,visibility 0s .42s;
  --clay:#B5472A;--clay-hi:#D4633E;--sage:#2F5D3A;--cream:250,248,243;--sheet:#F4EFE6;--serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,sans-serif;--mono:'DM Mono',ui-monospace,monospace}
.pox-peek.on{transform:none;opacity:1;visibility:visible;transition:transform .48s var(--ease),opacity .3s,visibility 0s}
.pox-peek *{box-sizing:border-box}
.pox-peek .ph{display:flex;align-items:flex-start;gap:12px}
.pox-peek .ph .t{flex:1;min-width:0}
.pox-peek h2{margin:0;font-family:var(--serif);font-weight:600;font-size:24px;line-height:1.15}
.pox-peek .ph span{display:block;margin-top:4px;font-size:13.5px;color:rgba(var(--cream),.6)}
.pox-peek .x{width:40px;height:40px;border:0;border-radius:20px;background:rgba(var(--cream),.08);color:rgb(var(--cream));display:grid;place-items:center;flex:none}
.pox-peek .x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.pox-peek .came{display:flex;gap:18px;align-items:center;margin-top:22px;padding:16px;border-radius:18px;background:rgba(var(--cream),.06)}
.pox-peek .paper{position:relative;width:76px;height:98px;border-radius:6px;background:var(--sheet);overflow:hidden;transform:rotate(-1.5deg);box-shadow:0 14px 28px -14px rgba(0,0,0,.8);flex:none;border:0;padding:0;cursor:zoom-in}
.pox-peek .paper img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
.pox-peek .came .n{font-family:var(--mono);font-size:30px}
.pox-peek .came .n small{font-family:var(--sans);font-size:13.5px;color:rgba(var(--cream),.55);margin-left:6px}
.pox-peek .came p{margin:6px 0 0;font-size:13.5px;color:rgba(var(--cream),.65)}
.pox-peek .said{margin:14px 0 0;font-family:var(--mono);font-size:13px;line-height:1.5;color:rgba(var(--cream),.85);padding:12px 14px;border-radius:14px;background:rgba(var(--cream),.06)}
.pox-peek h3{margin:22px 0 8px;font-size:13px;font-weight:600;color:rgba(var(--cream),.5)}
.pox-peek .prow{display:flex;align-items:center;gap:12px;min-height:52px;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pox-peek .prow .mk{flex:none;width:20px;height:20px;border-radius:10px;box-shadow:inset 0 0 0 1.5px var(--clay-hi);display:grid;place-items:center}
.pox-peek .prow.ok .mk{background:var(--sage);box-shadow:none}
.pox-peek .prow.ok .mk svg{width:11px;height:11px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pox-peek .prow .l{flex:none;width:90px;font-size:14px;color:rgba(var(--cream),.55)}
.pox-peek .prow .v{flex:1;font-size:15px;font-weight:600}
.pox-peek .prow .v.ask{color:var(--clay-hi)}
.pox-peek .irow{display:flex;align-items:center;gap:12px;min-height:50px;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pox-peek .irow .no{flex:none;width:26px;height:26px;border-radius:13px;background:rgba(var(--cream),.1);font-family:var(--mono);font-size:11.5px;display:grid;place-items:center}
.pox-peek .irow .m{flex:1;min-width:0}
.pox-peek .irow b{display:block;font-size:15px;font-weight:600}
.pox-peek .irow em{font-style:normal;font-family:var(--mono);font-size:14px}
/* editable peek — fields on the dark card */
.pox-peek .title-in{width:100%;background:none;border:0;border-bottom:1px dashed rgba(var(--cream),.22);color:rgb(var(--cream));font-family:var(--serif);font-weight:600;font-size:24px;line-height:1.15;outline:none;padding:2px 0}
.pox-peek .title-in:focus{border-bottom-color:var(--clay-hi)}
.pox-peek .two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px}
.pox-peek .fld label{display:block;font-size:12px;font-weight:600;color:rgba(var(--cream),.5);margin:0 0 6px}
.pox-peek .in{width:100%;height:42px;padding:0 12px;border-radius:12px;border:1px solid rgba(var(--cream),.15);background:rgba(var(--cream),.06);color:rgb(var(--cream));font:inherit;font-size:14.5px;outline:none}
.pox-peek .in::placeholder{color:rgba(var(--cream),.4)}
.pox-peek .in:focus{border-color:var(--clay-hi)}
.pox-peek .rz{position:relative}
.pox-peek .rzwrap{position:relative}
.pox-peek .rzwrap .in{padding-right:38px}
.pox-peek .rz-x{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:8px;background:rgba(var(--cream),.1);color:rgba(var(--cream),.7);display:grid;place-items:center;cursor:pointer}
.pox-peek .rz-x:hover{background:rgba(var(--cream),.18);color:rgb(var(--cream))}
.pox-peek .rz-x svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.pox-peek .rz.ok .in{border-color:rgba(143,199,154,.5)}
.pox-peek .rz-hint{display:block;margin-top:6px;font-size:12px;color:var(--clay-hi)}
.pox-peek .rz-drop{position:absolute;z-index:6;top:46px;left:0;right:0;background:#241a13;border:1px solid rgba(var(--cream),.16);border-radius:12px;overflow:auto;max-height:230px;box-shadow:0 22px 44px -18px rgba(0,0,0,.75)}
.pox-peek .rz-opt{display:block;width:100%;text-align:left;border:0;border-top:1px solid rgba(var(--cream),.08);background:none;color:rgb(var(--cream));padding:10px 12px;font:inherit;font-size:14px;cursor:pointer}
.pox-peek .rz-opt:first-child{border-top:0}
.pox-peek .rz-opt:hover{background:rgba(var(--cream),.08)}
.pox-peek .rz-opt small{color:rgba(var(--cream),.5);margin-left:6px}
.pox-peek .rz-add{color:var(--clay-hi);font-weight:600}
.pox-peek .ihd{display:flex;align-items:center;justify-content:space-between;margin:22px 0 8px}
.pox-peek .ihd h3{margin:0}
.pox-peek .iedit{padding:10px 0;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pox-peek .iline{display:grid;grid-template-columns:24px 1fr 64px 74px 26px;gap:8px;align-items:center}
.pox-peek .iedit .no{width:24px;height:24px;border-radius:12px;background:rgba(var(--cream),.1);font-family:var(--mono);font-size:11px;display:grid;place-items:center;color:rgba(var(--cream),.7)}
.pox-peek .iedit input{height:38px;padding:0 10px;border-radius:9px;border:1px solid rgba(var(--cream),.14);background:rgba(var(--cream),.05);color:rgb(var(--cream));font:inherit;font-size:14px;outline:none;min-width:0}
.pox-peek .iedit input:focus{border-color:var(--clay-hi)}
.pox-peek .iedit input.mono{font-family:var(--mono)}
.pox-peek .iedit .rm{width:26px;height:26px;border:0;background:none;color:rgba(var(--cream),.45);border-radius:7px;font-size:13px;cursor:pointer}
.pox-peek .iedit .rm:hover{background:rgba(var(--cream),.1);color:var(--clay-hi)}
.pox-peek .ispec{display:grid;grid-template-columns:60px 60px 1fr 1fr 1.4fr;gap:8px;margin:8px 0 0 32px}
.pox-peek .ispec input::placeholder{color:rgba(var(--cream),.35);font-size:12.5px}
.pox-peek .addi{width:100%;height:44px;margin-top:10px;border:1px dashed rgba(var(--cream),.22);border-radius:12px;background:none;color:rgba(var(--cream),.8);font:inherit;font-weight:600;cursor:pointer}
.pox-peek .addi:hover{border-color:var(--clay-hi);color:var(--clay-hi)}
.pox-peek .pmsg{margin:12px 0 0;font-size:13px;color:var(--clay-hi)}
.pox-peek .pfoot{display:flex;gap:8px;margin-top:24px;position:sticky;bottom:-26px;background:linear-gradient(180deg,rgba(21,16,12,0),var(--night) 40%);padding:14px 0 0}
.pox-peek .pfoot .btn:disabled{opacity:.55;cursor:default}
.pox-peek .pfoot .btn .spin{display:inline-block;width:14px;height:14px;margin-right:8px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;vertical-align:-2px;animation:poxSpin .7s linear infinite}
@keyframes poxSpin{to{transform:rotate(360deg)}}
.pox-peek .pfoot .btn{flex:1;height:48px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;background:rgba(var(--cream),.1);color:rgb(var(--cream));border-radius:16px;font-size:14px;font-weight:600}
.pox-peek .pfoot .btn.pri{background:var(--clay);color:#fff}
.pox-toast{position:fixed;left:50%;top:22px;z-index:70;transform:translate(-50%,-16px);opacity:0;pointer-events:none;padding:11px 16px;border-radius:14px;background:#15100C;color:#FAF8F3;font-size:14px;box-shadow:0 18px 40px -16px rgba(21,16,12,.6);transition:transform .4s cubic-bezier(.22,.8,.24,1),opacity .3s}
.pox-toast.on{transform:translate(-50%,0);opacity:1}
.pox-viewer{position:fixed;inset:0;z-index:80;background:rgba(12,9,7,.94);display:grid;place-items:center;opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s}
.pox-viewer.on{opacity:1;visibility:visible;transition:opacity .3s,visibility 0s}
.pox-viewer img{max-width:min(90vw,520px);max-height:88vh;border-radius:14px;object-fit:contain;background:var(--sheet)}
@media (prefers-reduced-motion:reduce){.pox *,.pox-peek,.pox-toast{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
