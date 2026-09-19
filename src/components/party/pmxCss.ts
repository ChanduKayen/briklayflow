/**
 * Parties on a phone — the "Briklay · Parties" reference, scoped under `.pmx` and wired to the
 * directory itself. Every value in the artifact's stylesheet is kept; three things are adapted,
 * none of them visual:
 *
 *  · the artifact is a whole document (`.app` fills the viewport, `.view` scrolls inside it). Here it
 *    is a page in the app's own shell, so the root scrolls in normal flow and the overlays — the
 *    slim header, the letter rail, the scrim, the card and the capsule — are fixed to the viewport.
 *  · the artifact draws its own bottom bar; the app's real MobileNavBar floats over every page, so
 *    that copy is dropped. Its bottom padding stays, reserving the strip the capsule sits in.
 *  · the dark ground is the app's night binding (a gradient over a warm keyline), not a flat fill,
 *    and the card carries the app's rim so it never lands invisibly on the slim header.
 *
 * Its @keyframes are namespaced so they cannot collide with another page's.
 */
export const PMX_CSS = `.pmx{
  --ground:#FAF8F3; --paper:#FFFFFF; --ink:#2B211A; --ink-2:#5C4F45; --ink-3:#8A7B6E; --line:#E9E1D6; --line-2:#DCD2C4; --rule:#F0E9DF;
  --night:#170E08;--night-bg:linear-gradient(180deg,#191009,#140D07);--night-edge:#302014;--lift:0 24px 50px -16px rgba(20,13,7,.72),0 0 0 1px rgba(245,240,231,.10),inset 0 1px 0 rgba(245,240,231,.34); --cream:250,248,243; --clay:#B5472A; --clay-hi:#D4633E; --clay-wash:#FBEDE6; --sage:#2F5D3A; --sage-hi:#8FC79A; --sage-wash:#E7F0E6;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif; --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'DM Mono',ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,.8,.24,1); --nav-h:64px; --nav-gap:12px;
}
.pmx,.pmx *{box-sizing:border-box}
.pmx{background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;
  padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom))}
.pmx button,.pmx input{font:inherit;color:inherit}
.pmx button{cursor:pointer}
.pmx :focus-visible{outline:2px solid var(--clay-hi);outline-offset:3px;border-radius:10px}
.pmx [hidden]{display:none!important}
.pmx .view{}

/* =====================================================================
   PARTIES.  It is the phone book of the business, with money in it. So it behaves like a phone book:
     find      search first, A to Z underneath, always. A letter rail on the edge to jump. 184 names should take one gesture.
               The order never changes, so a name is always where it was yesterday. Money is a filter (tap the header), never a re-sort.
     money     the header says what you owe, to how many. "Paid ahead of bills" is not a boast, it is a flag: payments with no bill behind them.
     rows      two lines. Name, then what they are. On the right only the number that matters for THAT party:
               what you owe · or what they are paid ahead · or, quietly, what they have been paid. Nothing when there is nothing.
               "Active" is the normal state, so it is not printed 120 times. Only "pending" gets a mark.
     tap       the row opens the ledger. The small ⋯ opens the party itself: call, WhatsApp, and every detail, edited in place.
     add       from your contacts first (nobody types a phone number they already have). As you type a name, it tells you if they are already here.
   ===================================================================== */
.pmx .hero{background:var(--night-bg);color:rgb(var(--cream));padding:20px 20px 18px}
.pmx .hero-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pmx .hero h1{margin:0;font-family:var(--serif);font-weight:600;font-size:32px;letter-spacing:-.01em;line-height:1.1}
.pmx .icb{width:40px;height:40px;border:0;border-radius:20px;background:rgba(var(--cream),.07);color:rgba(var(--cream),.85);display:grid;place-items:center}
.pmx .icb svg{width:20px;height:20px;fill:currentColor}
.pmx .owed{display:flex;align-items:baseline;gap:8px;margin-top:16px;padding:0;border:0;background:none;color:inherit;font-family:var(--mono);font-size:31px;letter-spacing:-.01em;text-align:left}
.pmx .owed small{font-family:var(--sans);font-size:14px;color:rgba(var(--cream),.55)}
.pmx .sub{margin:4px 0 0;font-size:13px;color:rgba(var(--cream),.55)}
.pmx .pills{display:flex;gap:8px;margin-top:16px;overflow-x:auto;scrollbar-width:none;user-select:none;-webkit-user-select:none}
.pmx .pills::-webkit-scrollbar{display:none}
.pmx .pill{flex:none;display:flex;align-items:center;gap:8px;height:38px;padding:0 14px 0 12px;border-radius:19px;border:1px solid rgba(var(--cream),.14);background:none;font-size:13.5px;font-weight:600;color:rgba(var(--cream),.85);white-space:nowrap}
.pmx .pill b{font-family:var(--mono);font-weight:500}
.pmx .pill .ring{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pmx .pill[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night);border-color:transparent}
.pmx .compact{position:fixed;left:0;right:0;top:0;max-width:430px;margin:0 auto;z-index:12;height:52px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--night-bg);color:rgb(var(--cream));transform:translateY(-100%);transition:transform .35s var(--ease)}
.pmx .compact.on{transform:none}
.pmx .compact b{font-family:var(--serif);font-weight:600;font-size:19px}
.pmx .compact span{font-family:var(--mono);font-size:14px;color:rgba(var(--cream),.85)}
.pmx .compact small{font-family:var(--sans);font-size:12px;color:rgba(var(--cream),.5);margin-left:6px}

.pmx .tools{position:-webkit-sticky;position:sticky;top:52px;z-index:6;padding:12px 16px 10px;background:var(--ground);box-shadow:0 8px 10px -8px rgba(43,33,26,.14);transition:transform .34s var(--ease),opacity .25s}
.pmx .tools.tuck{transform:translateY(-120%);opacity:0;pointer-events:none}
.pmx .find{display:flex;align-items:center;gap:10px;height:48px;padding:0 16px;border-radius:24px;background:var(--paper);border:1px solid var(--line)}
.pmx .find > svg{flex:none;width:18px;height:18px;fill:none;stroke:var(--ink-3);stroke-width:2;stroke-linecap:round}
.pmx .find input{flex:1;min-width:0;height:100%;border:0;background:none;outline:none;font-size:16px}
.pmx .find input::placeholder{color:var(--ink-3)}
.pmx .find:focus-within{border-color:var(--ink)}
.pmx .sortb{flex:none;display:flex;align-items:center;gap:6px;height:36px;padding:0 12px;border:0;border-radius:18px;background:#F3EEE5;font-size:13px;font-weight:600;color:var(--ink-2)}
.pmx .sortb svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pmx .chips{display:flex;gap:6px;margin-top:10px;user-select:none;-webkit-user-select:none}
.pmx .chip{flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:5px;height:36px;padding:0 6px;border-radius:18px;border:1px solid var(--line-2);background:none;font-size:13.5px;font-weight:600;color:var(--ink-2);white-space:nowrap;transition:background .25s,color .25s,border-color .25s}
.pmx .chip em{font-style:normal;font-family:var(--mono);font-size:11.5px;font-weight:400;opacity:.65}
.pmx .chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--ground)}
.pmx .result{margin:10px 8px 0;font-size:13px;color:var(--ink-2);text-wrap:pretty}
.pmx .result b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.pmx .result button{margin-left:6px;padding:0;border:0;background:none;font-size:13px;font-weight:600;color:var(--clay);text-decoration:underline;text-underline-offset:2px}

.pmx .sec{display:flex;align-items:baseline;justify-content:space-between;padding:20px 24px 9px;scroll-margin-top:170px}
.pmx .sec h2{margin:0;font-family:var(--serif);font-weight:500;font-size:18px}
.pmx .sec span{font-size:13px;color:var(--ink-3)}
.pmx .sec span b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.pmx .card{margin:0 24px 0 16px;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.pmx .card.wide{margin-right:16px}
.pmx .row{display:flex;align-items:center;width:100%;border-top:1px solid var(--rule)}
.pmx .row:first-child{border-top:0}
.pmx .row.lit{animation:pmx-lit 2.2s ease-out}
@keyframes pmx-lit{0%,30%{background:var(--sage-wash)}100%{background:var(--paper)}}
.pmx .go{flex:1;min-width:0;display:flex;align-items:center;gap:11px;min-height:68px;padding:10px 0 10px 14px;border:0;background:none;text-align:left}
.pmx .go:active{background:#F7F2EA}
.pmx .av{flex:none;width:38px;height:38px;border-radius:19px;background:#F3EEE5;color:var(--ink-2);display:grid;place-items:center;font-size:12.5px;font-weight:700}
.pmx .av.w{background:var(--sage-wash);color:var(--sage)}
.pmx .nm{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pmx .nm b{font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pmx .nm span{font-size:13px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pmx .ring{display:inline-block;width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay);margin:0 5px -1px 0}
.pmx .fig{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px;padding-left:4px}
.pmx .fig b{font-family:var(--mono);font-weight:500;font-size:14px}
.pmx .fig small{font-size:11.5px;font-weight:600;color:var(--clay)}
.pmx .fig.ahead b{color:var(--ink-2)}.pmx .fig.ahead small{color:var(--ink-3)}
.pmx .fig.paid b{font-size:13px;color:var(--ink-3)}.pmx .fig.paid small{color:var(--ink-3);font-weight:400}
.pmx .dots{flex:none;width:36px;height:68px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center}
.pmx .dots svg{width:18px;height:18px;fill:currentColor}
.pmx .dots:active{color:var(--ink)}
.pmx .rail{position:fixed;right:max(2px,calc(50vw - 213px));top:50%;z-index:8;transform:translateY(-46%);display:flex;flex-direction:column;align-items:center;padding:6px 0;border-radius:12px;touch-action:none;user-select:none;-webkit-user-select:none;transition:opacity .25s}
.pmx .rail button{width:22px;height:17px;padding:0;border:0;background:none;font-size:10.5px;font-weight:700;color:var(--ink-3);line-height:17px}
.pmx .rail button.on{color:var(--clay)}
.pmx .rail.hide{opacity:0;pointer-events:none}
.pmx .letter{position:fixed;left:50%;top:42%;z-index:30;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:24px;background:rgba(21,16,12,.88);color:rgb(var(--cream));display:grid;place-items:center;font-family:var(--serif);font-size:40px;font-weight:600;opacity:0;transform:scale(.9);transition:opacity .2s,transform .25s var(--ease);pointer-events:none}
.pmx .letter.on{opacity:1;transform:none}
.pmx .empty{margin:20px 16px 0;padding:26px 20px;border:1.5px dashed var(--line-2);border-radius:22px;text-align:center;font-size:14.5px;color:var(--ink-2);text-wrap:pretty}
.pmx .empty b{display:block;font-size:16.5px;color:var(--ink);margin-bottom:4px}
.pmx .empty button{margin-top:12px;height:42px;padding:0 18px;border:0;border-radius:21px;background:var(--clay);color:#fff;font-size:14.5px;font-weight:600}

/* bar, capsule, toast, panel */
.pmx .fab{position:fixed;right:max(16px,calc(50vw - 199px));bottom:calc(var(--nav-gap) + var(--nav-h) + 14px + env(safe-area-inset-bottom));z-index:19;height:54px;width:126px;padding:0;border:0;border-radius:27px;background:var(--clay);color:#fff;display:flex;align-items:center;overflow:hidden;white-space:nowrap;user-select:none;-webkit-user-select:none;
  box-shadow:0 16px 28px -14px rgba(181,71,42,.95),0 4px 10px -6px rgba(21,16,12,.4);transition:width .42s var(--ease),transform .38s var(--ease),opacity .25s}
.pmx .fab .ic{flex:none;width:54px;height:54px;display:grid;place-items:center}
.pmx .fab .ic svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.pmx .fab .lbl{font-size:16px;font-weight:600;margin-left:-6px;transition:opacity .22s}
.pmx .fab.folded{width:54px}.pmx .fab.folded .lbl{opacity:0}
.pmx .fab.away{transform:translateY(16px) scale(.7);opacity:0;pointer-events:none}
.pmx .toast{position:fixed;left:16px;right:16px;top:62px;z-index:70;width:fit-content;max-width:calc(100% - 32px);margin-inline:auto;transform:translateY(-16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:11px 8px 11px 16px;border-radius:16px;background:var(--night-bg);color:rgb(var(--cream));font-size:14px;box-shadow:0 18px 40px -16px rgba(21,16,12,.6);transition:transform .4s var(--ease),opacity .3s}
.pmx .toast.on{transform:none;opacity:1;pointer-events:auto}
.pmx .toast button{min-height:34px;padding:0 12px;border:0;border-radius:10px;background:rgba(var(--cream),.14);color:#fff;font-size:13.5px;font-weight:600}
.pmx .scrim{position:fixed;inset:0;z-index:17;background:rgba(9,6,3,.52);backdrop-filter:saturate(.8) blur(1.5px);-webkit-backdrop-filter:saturate(.8) blur(1.5px);opacity:0;pointer-events:none;transition:opacity .35s}
.pmx .scrim.on{opacity:1;pointer-events:auto}
.pmx .panel{position:fixed;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom) + var(--kb,0px));z-index:18;max-width:406px;margin:0 auto;max-height:calc(100dvh - 24px);padding:8px 16px calc(var(--nav-h) + 14px);border-radius:32px;background:var(--night-bg);color:rgb(var(--cream));box-shadow:var(--lift);
  transform:translateY(24px) scale(.96);transform-origin:50% 100%;opacity:0;visibility:hidden;overflow:auto;scrollbar-width:none;transition:transform .46s var(--ease),opacity .28s,visibility 0s .46s,bottom .25s,padding-bottom .25s;-webkit-touch-callout:none}
.pmx .panel::-webkit-scrollbar{display:none}
.pmx.kb .panel{padding-bottom:16px}
.pmx .panel.on{transform:none;opacity:1;visibility:visible;transition:transform .5s var(--ease),opacity .3s,visibility 0s,bottom .25s,padding-bottom .25s}
.pmx .grab{display:grid;place-items:center;height:20px}.pmx .grab i{width:36px;height:4px;border-radius:2px;background:rgba(var(--cream),.18)}
.pmx .p-head{display:flex;align-items:center;gap:12px;margin:6px 0 12px}
.pmx .p-head .av{width:46px;height:46px;border-radius:23px;background:rgba(var(--cream),.1);color:rgb(var(--cream));font-size:14px}
.pmx .p-head .t{flex:1;min-width:0}
.pmx .p-head h2{margin:0;font-family:var(--serif);font-weight:600;font-size:21px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pmx .p-head span{font-size:13px;color:rgba(var(--cream),.55)}
.pmx .p-head .x{flex:none;width:40px;height:40px;margin-right:-8px;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.7);display:grid;place-items:center}
.pmx .two{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.pmx .two div{padding:12px 14px;border-radius:16px;background:rgba(var(--cream),.06);display:flex;flex-direction:column;gap:2px}
.pmx .two small{font-size:12px;color:rgba(var(--cream),.5)}
.pmx .two b{font-family:var(--mono);font-weight:500;font-size:17px}
.pmx .two b.owe{color:#F0A58A}
.pmx .acts{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px;margin-bottom:6px}
.pmx .acts a,.pmx .acts button{display:flex;align-items:center;justify-content:center;gap:8px;height:50px;border:0;border-radius:16px;background:rgba(var(--cream),.08);color:rgb(var(--cream));font-size:14.5px;font-weight:600;text-decoration:none}
.pmx .acts .pri{background:var(--clay);color:#fff}
.pmx .acts svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.pmx .acts .wa svg{fill:#3DBB6C;stroke:none}
.pmx .rowS{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:0 4px;border:0;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pmx .rowS .l{flex:none;width:104px;font-size:14px;color:rgba(var(--cream),.55)}
.pmx .rowS .v{flex:1;min-width:0;text-align:right;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pmx .rowS .v.none{color:rgba(var(--cream),.4);font-weight:400}
.pmx .rowS .v.mono{font-family:var(--mono);font-weight:500}
.pmx .rowS .v.chg{animation:pmx-chg .9s ease-out}
@keyframes pmx-chg{0%,25%{color:var(--clay-hi)}100%{color:rgb(var(--cream))}}
.pmx .rowS .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .35s var(--ease)}
.pmx .rowS.open{box-shadow:none}.pmx .rowS.open .c{transform:rotate(90deg)}
.pmx .pick{padding:2px 4px 14px;box-shadow:0 1px 0 0 rgba(var(--cream),.08);animation:pmx-pickIn .38s var(--ease) both}
@keyframes pmx-pickIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.pmx .seg{display:grid;grid-template-columns:repeat(3,1fr);padding:3px;border-radius:16px;background:rgba(var(--cream),.07)}
.pmx .seg button{height:42px;border:0;border-radius:13px;background:none;color:rgba(var(--cream),.75);font-size:14px;font-weight:600;transition:background .25s,color .25s}
.pmx .seg button[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.pmx .inp{display:block;width:100%;height:48px;border:0;border-radius:14px;background:rgba(var(--cream),.07);padding:0 14px;font-size:16px;color:rgb(var(--cream));outline:none}
.pmx .inp::placeholder{color:rgba(var(--cream),.4)}
.pmx .inp:focus{box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pmx .hint{margin:8px 2px 0;font-size:12.5px;color:rgba(var(--cream),.5);text-wrap:pretty}
.pmx .foot{display:flex;gap:8px;margin-top:14px}
.pmx .big{flex:1;height:52px;border:0;border-radius:16px;background:var(--clay);color:#fff;font-size:16px;font-weight:600;transition:opacity .25s,background-color .35s}
.pmx .big[disabled]{opacity:.32}
.pmx .big.ok{background:var(--sage)}
.pmx .del{position:relative;display:block;width:100%;height:44px;margin-top:6px;border:0;border-radius:14px;background:none;color:rgba(240,165,138,.85);font-size:13.5px;font-weight:600;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.pmx .del::before{content:'';position:absolute;inset:0;border-radius:14px;background:rgba(212,99,62,.2);transform:scaleX(0);transform-origin:left;transition:transform .15s}
.pmx .del.hold::before{transform:scaleX(1);transition:transform 1s linear}
.pmx .del span{position:relative}
.pmx .menu button{display:flex;align-items:center;gap:14px;width:100%;min-height:54px;border:0;background:none;color:rgb(var(--cream));font-size:15.5px;font-weight:600;text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pmx .menu svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.8}
.pmx .menu button[aria-pressed="true"]{color:var(--clay-hi)}
.pmx .from{display:flex;align-items:center;gap:14px;width:100%;min-height:62px;padding:0 6px;border:0;border-radius:16px;background:rgba(var(--cream),.06);color:rgb(var(--cream));text-align:left;margin-bottom:12px}
.pmx .from i{flex:none;width:40px;height:40px;border-radius:20px;background:var(--clay);display:grid;place-items:center}
.pmx .from i svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pmx .from span{flex:1;display:flex;flex-direction:column;gap:1px;font-size:12.5px;color:rgba(var(--cream),.5)}
.pmx .from b{font-size:15.5px;font-weight:600;color:rgb(var(--cream))}
.pmx .lab{display:block;margin:12px 4px 6px;font-size:12.5px;font-weight:600;color:rgba(var(--cream),.5)}
.pmx .tel{display:flex;align-items:center;height:48px;border-radius:14px;background:rgba(var(--cream),.07);padding-left:14px}
.pmx .tel span{font-family:var(--mono);font-size:15px;color:rgba(var(--cream),.55)}
.pmx .tel input{flex:1;min-width:0;height:100%;border:0;background:none;outline:none;padding:0 12px 0 8px;font-family:var(--mono);font-size:16px;color:rgb(var(--cream))}
.pmx .tel:focus-within{box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pmx .twin{margin-top:10px;padding:12px 14px;border-radius:16px;box-shadow:inset 0 0 0 1.5px rgba(212,99,62,.7);font-size:13.5px;color:rgba(var(--cream),.8);animation:pmx-pickIn .38s var(--ease) both;text-wrap:pretty}
.pmx .twin b{color:rgb(var(--cream))}
.pmx .twin button{display:block;margin-top:8px;height:36px;padding:0 14px;border:0;border-radius:18px;background:rgba(var(--cream),.1);font-size:13px;font-weight:600;color:rgb(var(--cream))}
@media (prefers-reduced-motion:reduce){.pmx,.pmx *{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
