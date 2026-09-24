/**
 * PQR_CSS - the purchase-request page's stylesheet, the reference's own values, unchanged.
 *
 * Every selector is scoped under .pqr (and the keyframes renamed pqr_*) because the reference is a
 * whole document: it styles body, .card, .it, .chip, .inp, .big, .ghost, .opt - names this app
 * already uses elsewhere. The scoping is mechanical; no value, length, colour, easing or duration is
 * changed. The only rules NOT under .pqr are the toolbar this page lends the nav bar, which by
 * definition renders inside the bar (see MobileNavBar's lent set).
 */
export const PQR_CSS = `
.pqr{
  --ground:#FAF8F3; --paper:#FFFFFF; --ink:#2B211A; --ink-2:#5C4F45; --ink-3:#8A7B6E; --line:#E9E1D6; --line-2:#DCD2C4; --rule:#F0E9DF;
  --night:#15100C; --cream:250,248,243; --clay:#B5472A; --clay-hi:#D4633E; --clay-wash:#FBEDE6; --sage:#2F5D3A; --sage-hi:#8FC79A; --sage-wash:#E7F0E6; --sheet:#F4EFE6;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif; --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'DM Mono',ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,.8,.24,1); --nav-h:64px; --nav-gap:12px;
}
.pqr,.pqr *{box-sizing:border-box}
/* The reference is a 430px column centred in a full-height body; here the page IS that column, as a
   fixed layer, so it reads identically at any width the phone breakpoint lets through. NO z-index and
   NO transform on this root, deliberately: either would open a stacking context and trap the
   children, and the reference relies on them competing globally - the quote viewer (60) and the
   toast (70) rise OVER the nav bar, while the card (18) and the dock (19) tuck under it. */
.pqr{position:fixed;top:0;bottom:0;left:0;right:0;width:100%;max-width:100%;margin:0 auto;
  overflow:hidden;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.4;
  -webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
/* While an item card is up the whole screen steps back: inset 16px, rounded, on paper. In the
   reference this falls out of the root carrying class "card" while the card is open, which also
   matches its .card rule - so the page behind takes the same margin, border and radius the item
   cards have. Scoping made .card a descendant selector, which can no longer match the root, so it is
   restated here. Same four values, same result. */
.pqr.card{left:16px;right:16px;width:auto;margin:0;background:var(--paper);border:1px solid var(--line);border-radius:22px}
.pqr button,.pqr input{font:inherit;color:inherit}
.pqr button{cursor:pointer}
.pqr :focus-visible{outline:2px solid var(--clay-hi);outline-offset:3px;border-radius:10px}
.pqr [hidden]{display:none!important}
.pqr .view{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:calc(var(--nav-h) + 130px + env(safe-area-inset-bottom))}

/* =====================================================================
   PURCHASE REQUEST, arriving from WhatsApp.
   The page answers three questions, in this order, and never mixes them:
     1  Did it come through?   the message, who sent it, when, the photo itself, and the count of what was read.
     2  What do I still owe?   one short list. Hollow ring = still to add · sage tick = done. The page's one button always
                                does the next thing on that list, so nobody has to work out where to tap.
     3  What was read?         the items, numbered as on the quote. A row says where each fact came from:
                                "read from the quote" carries nothing (it is the normal case); a gap carries the ring and says what is missing.
   Every screen that edits uses the slip: label · value · chevron, one line open at a time.
   ===================================================================== */
.pqr .hero{background:var(--night);color:rgb(var(--cream));padding:12px 20px 24px}
.pqr .hbar{display:flex;align-items:center;justify-content:space-between;margin:0 -8px 8px}
.pqr .hbar button{display:flex;align-items:center;gap:4px;height:44px;padding:0 10px;border:0;border-radius:22px;background:none;font-size:15px;font-weight:600;color:rgba(var(--cream),.75)}
.pqr .hbar svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pqr .hbar .dots svg{fill:currentColor;stroke:none}
.pqr .hero h1{margin:6px 0 0;font-family:var(--serif);font-weight:600;font-size:32px;letter-spacing:-.01em;line-height:1.1}
.pqr .origin{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13.5px;color:rgba(var(--cream),.65)}
.pqr .origin svg{width:15px;height:15px;fill:#3DBB6C;flex:none}
.pqr .origin b{color:rgba(var(--cream),.9);font-weight:600}
.pqr .came{display:flex;gap:16px;align-items:center;margin-top:22px}
.pqr .paper{position:relative;flex:none;width:70px;height:92px;border:0;padding:0;border-radius:7px;background:var(--sheet);overflow:hidden;box-shadow:0 12px 24px -12px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.06);transform:rotate(-2deg)}
.pqr .paper img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top}
.pqr .paper .scan{position:absolute;left:0;right:0;top:0;height:30px;margin-top:-30px;background:linear-gradient(rgba(212,99,62,0),rgba(212,99,62,.28));border-bottom:1.5px solid var(--clay-hi);animation:pqr_scan 1.6s cubic-bezier(.45,.05,.55,.95) infinite alternate}
.pqr .paper.done .scan{animation:none;opacity:0;transition:opacity .4s}
@keyframes pqr_scan{from{transform:translateY(0)}to{transform:translateY(114px)}}
.pqr .paper .pg{position:absolute;left:5px;bottom:5px;height:16px;padding:0 5px;border-radius:8px;background:rgba(21,16,12,.75);color:rgb(var(--cream));font-family:var(--mono);font-size:10px;display:flex;align-items:center}
.pqr .readout{flex:1;min-width:0}
.pqr .readout .n{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 8px;font-family:var(--mono);font-size:34px;letter-spacing:-.01em;line-height:1.1}
.pqr .readout .n small{font-family:var(--sans);font-size:14px;color:rgba(var(--cream),.55)}
.pqr .readout p{margin:4px 0 0;font-size:14px;line-height:1.4;color:rgba(var(--cream),.6)}
.pqr .readout p b{color:rgba(var(--cream),.9);font-weight:600}
.pqr .livedot{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:var(--clay-hi);vertical-align:middle;animation:pqr_breath 1.5s ease-in-out infinite}
@keyframes pqr_breath{50%{transform:scale(.72)}}
.pqr .said{margin:14px 0 0;padding:10px 12px;border-radius:12px;background:rgba(var(--cream),.07);font-family:var(--mono);font-size:13px;line-height:1.45;color:rgba(var(--cream),.85)}
.pqr .run{display:flex;gap:3px;height:6px;margin:16px 0 8px;border-radius:3px;overflow:hidden;background:rgba(var(--cream),.12)}
.pqr .run i{display:block;height:100%;flex:0 0 0;transition:flex-grow .7s var(--ease)}
.pqr .run .d{background:var(--sage-hi)}
.pqr .runtxt{font-size:12.5px;color:rgba(var(--cream),.6)}
.pqr .runtxt b{font-family:var(--mono);font-weight:500;color:rgba(var(--cream),.9)}

.pqr .compact{position:absolute;left:0;right:0;top:0;z-index:12;height:52px;padding:0 12px 0 8px;display:flex;align-items:center;gap:8px;background:var(--night);color:rgb(var(--cream));transform:translateY(-100%);transition:transform .35s var(--ease)}
.pqr .compact.on{transform:none}
.pqr .compact button{width:40px;height:40px;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.8);display:grid;place-items:center}
.pqr .compact button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pqr .compact b{flex:1;font-family:var(--serif);font-weight:600;font-size:18px}
.pqr .compact span{font-family:var(--mono);font-size:13px;color:rgba(var(--cream),.85)}

.pqr .sec{display:flex;align-items:baseline;justify-content:space-between;padding:22px 24px 9px}
.pqr .sec h2{margin:0;font-family:var(--serif);font-weight:500;font-size:19px}
.pqr .sec span{font-size:13px;color:var(--ink-3)}
.pqr .sec span b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.pqr .said2{margin:0 24px 10px;font-size:13.5px;line-height:1.45;color:var(--ink-2);text-wrap:pretty}
.pqr .said2 i{font-family:var(--serif);font-style:italic}
.pqr .said2 span{color:var(--ink-3)}
.pqr .card{margin:0 16px;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.pqr .card.ok{border-color:#CFE0CE}
.pqr .late{animation:pqr_arrive .5s var(--ease) both}
/* the list of what you still owe */
.pqr .todo{display:flex;align-items:center;gap:14px;width:100%;min-height:64px;padding:10px 16px;border:0;border-top:1px solid var(--rule);background:none;text-align:left;transition:background-color .3s}
.pqr .todo:first-child{border-top:0}
.pqr .todo:active{background:#F7F2EA}
.pqr .todo.flash{animation:pqr_flash 1.6s ease-out}
@keyframes pqr_flash{0%,30%{background:var(--sage-wash)}100%{background:var(--paper)}}
.pqr .mark{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;box-shadow:inset 0 0 0 1.5px var(--clay);transition:background-color .35s,box-shadow .35s}
.pqr .mark svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22}
.pqr .todo.done .mark{background:var(--sage);box-shadow:none}
.pqr .todo.done .mark svg{animation:pqr_tick .4s .1s ease-out forwards}
@keyframes pqr_tick{to{stroke-dashoffset:0}}
.pqr .todo.soft .mark{box-shadow:inset 0 0 0 1.5px var(--line-2)}
/* set but NOT on file — an amber hollow ring (no green tick), with a nudge line to save or pick it */
.pqr .todo.unsaved .mark{background:none;box-shadow:inset 0 0 0 1.5px #C99A3F}
.pqr .todo b.uns{color:var(--ink)}
.pqr .uns-note{display:block;margin-top:2px;font-size:12px;font-weight:500;color:#9A6B12}
.pqr .todo .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pqr .todo .t span{font-size:13px;color:var(--ink-3)}
.pqr .todo .t b{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pqr .todo .t b.ask{color:var(--clay)}
.pqr .todo.done .t span{color:var(--ink-3)}.pqr .todo.done .t b{color:var(--ink)}
.pqr .todo.soft .t b.ask{color:var(--ink-2)}
.pqr .todo .c{flex:none;width:18px;height:18px;fill:none;stroke:var(--ink-3);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pqr .alldone{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--sage-wash);color:var(--sage);font-size:14.5px;font-weight:600}
.pqr .alldone svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
/* the items */
.pqr .it{scroll-margin-top:64px;display:flex;align-items:center;gap:12px;width:100%;min-height:70px;padding:11px 14px 11px 16px;border:0;border-top:1px solid var(--rule);background:none;text-align:left;animation:pqr_arrive .5s var(--ease) both}
.pqr .it:first-child{border-top:0}
.pqr .it:active{background:#F7F2EA}
.pqr .it.lit{animation:pqr_flash 1.8s ease-out}
@keyframes pqr_arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pqr .it .no{flex:none;width:28px;height:28px;border-radius:14px;background:#F3EEE5;color:var(--ink-2);font-family:var(--mono);font-size:12.5px;display:grid;place-items:center}
.pqr .it .b{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.pqr .it .b b{font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pqr .it .b span{font-size:13px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pqr .it .q{flex:none;font-family:var(--mono);font-size:15px}
.pqr .it .q small{font-family:var(--sans);font-size:12px;color:var(--ink-3);margin-left:3px}
.pqr .it .c{flex:none;width:16px;height:16px;fill:none;stroke:var(--ink-3);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pqr .sk{display:flex;align-items:center;gap:12px;min-height:70px;padding:11px 16px;border-top:1px solid var(--rule)}
.pqr .sk i{display:block;border-radius:6px;background:linear-gradient(90deg,#F0E9DF 25%,#F8F3EB 45%,#F0E9DF 65%);background-size:300% 100%;animation:pqr_shim 1.3s linear infinite}
.pqr .sk .a{width:28px;height:28px;border-radius:14px}.pqr .sk .t{flex:1;display:flex;flex-direction:column;gap:7px}.pqr .sk .t i:first-child{width:55%;height:12px}.pqr .sk .t i:last-child{width:35%;height:9px}.pqr .sk .e{width:36px;height:12px}
@keyframes pqr_shim{from{background-position:100% 0}to{background-position:-100% 0}}
.pqr .addit{display:flex;align-items:center;justify-content:center;gap:8px;margin:12px 16px 0;height:50px;width:calc(100% - 32px);border-radius:18px;border:1.5px dashed var(--line-2);background:none;font-size:14.5px;font-weight:600;color:var(--clay)}
.pqr .addit svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.pqr .foot-note{margin:14px 24px 0;font-size:13px;color:var(--ink-3)}
.pqr .foot-note b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}

/* the one button: it always does the next thing */
.pqr .dock{position:absolute;left:16px;right:16px;bottom:calc(var(--nav-gap) + var(--nav-h) + 14px + env(safe-area-inset-bottom));z-index:19;transition:transform .35s var(--ease),opacity .25s}
.pqr .dock.away{transform:translateY(20px);opacity:0;pointer-events:none}
.pqr .dock.away{animation:none!important}
.pqr .next{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:56px;border:0;border-radius:28px;background:var(--clay);color:#fff;font-size:16.5px;font-weight:600;
  box-shadow:0 16px 28px -14px rgba(181,71,42,.95),0 4px 10px -6px rgba(21,16,12,.4);transition:background-color .4s,box-shadow .4s}
.pqr .next:active{transform:scale(.98)}
.pqr .next.ink{background:var(--ink);box-shadow:0 16px 28px -14px rgba(21,16,12,.8)}
.pqr .next.sage{background:var(--sage);box-shadow:0 16px 28px -14px rgba(47,93,58,.9)}
.pqr .next svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22}
.pqr .next.sage svg{animation:pqr_tick .4s .15s ease-out forwards}
.pqr .next .step{font-family:var(--mono);font-weight:400;font-size:12.5px;opacity:.75;margin-left:2px}
.pqr .dock .pair{display:flex;gap:8px}
.pqr .dock .pair button{flex:1;height:56px;border:0;border-radius:28px;font-size:15.5px;font-weight:600;box-shadow:0 12px 24px -14px rgba(21,16,12,.6)}
.pqr .dock .pair .g{background:var(--paper);color:var(--ink);border:1px solid var(--line-2)}
.pqr .dock .pair .p{background:var(--clay);color:#fff}
.pqr .dock .pair button{transition:transform .12s ease,opacity .15s ease}
.pqr .dock .pair button:active:not(:disabled){transform:scale(.97)}
.pqr .dock .pair button:disabled{opacity:.6}
.pqr .dock .pair button.loading{opacity:.9}

/* =====================================================================
   AN ITEM.  Read first, edit on a tap.
     Every line is shown as plain text with a small pencil: what it is, then what it says. Tap the line and it
     becomes a field, right there; ✓ or Enter puts it back. Nothing is "missing": Size and Specification are always
     listed; Brand and Note stay out of the way as "+ Brand" "+ Note" until you give them something.
     When the keyboard is up, the bar and the button step aside and the card grows so the line you are typing stays in view.
   ===================================================================== */
.pqr .ihead{display:flex;align-items:flex-start;gap:10px;margin:2px 0 0}
.pqr .ihead .no{flex:none;width:30px;height:30px;margin-top:2px;border-radius:15px;background:rgba(var(--cream),.1);font-family:var(--mono);font-size:12.5px;display:grid;place-items:center}
.pqr .ihead .t{flex:1;min-width:0}
.pqr .ihead .name{display:flex;align-items:flex-start;gap:8px;width:100%;padding:0;border:0;background:none;color:rgb(var(--cream));text-align:left}
.pqr .ihead .name b{flex:1;min-width:0;font-family:var(--serif);font-weight:600;font-size:21px;line-height:1.2;overflow-wrap:anywhere}
.pqr .ihead .name b.long{font-size:17px;line-height:1.25}
.pqr .ihead .name b.empty{color:rgba(var(--cream),.4);font-family:var(--sans);font-weight:400;font-size:17px}
.pqr .ihead .name .pen{flex:none;margin-top:4px}
.pqr .ihead .name.editing{display:block}
.pqr .ihead textarea{display:block;width:100%;min-height:44px;padding:8px 10px;border:0;border-radius:12px;background:rgba(var(--cream),.08);box-shadow:inset 0 0 0 1.5px var(--clay-hi);font-family:var(--serif);font-weight:600;font-size:19px;line-height:1.25;color:rgb(var(--cream));outline:none;resize:none}
.pqr .ihead .sub{display:block;margin-top:3px;font-size:12.5px;color:rgba(var(--cream),.5)}
.pqr .ihead .inav{flex:none;display:flex;gap:2px;margin:-4px -8px 0 0}
.pqr .ihead .inav button{width:36px;height:36px;border:0;border-radius:18px;background:none;color:rgba(var(--cream),.75);display:grid;place-items:center}
.pqr .ihead .inav button[disabled]{opacity:.25}
.pqr .ihead .inav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pqr .pen{width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.45);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.pqr .ipips{display:flex;gap:4px;margin:8px 0 6px}
.pqr .ipips i{flex:1;height:3px;border-radius:2px;background:rgba(var(--cream),.14)}
.pqr .ipips i.cur{background:var(--clay-hi)}
.pqr .icount{display:flex;align-items:center;gap:10px;min-height:56px;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pqr .icount .l{flex:none;width:96px;font-size:14px;color:rgba(var(--cream),.55)}
.pqr .icount .fig{display:flex;align-items:baseline;gap:4px;font-family:var(--serif);font-weight:600;font-size:26px;line-height:1;font-variant-numeric:lining-nums}
.pqr .icount .fig span{font-size:16px;color:var(--clay-hi)}
.pqr .icount .st{display:flex;gap:4px;margin-left:4px}
.pqr .icount .st button{width:36px;height:36px;border:0;border-radius:18px;background:rgba(var(--cream),.08);color:rgb(var(--cream));font-size:18px;display:grid;place-items:center}
.pqr .icount select{margin-left:auto;height:34px;padding:0 28px 0 12px;border:0;border-radius:17px;background:rgba(var(--cream),.08) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FAF8F3' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center/14px;color:rgb(var(--cream));font-size:13.5px;font-weight:600;appearance:none;-webkit-appearance:none;outline:none}
/* a line: label · value · pencil. Tap → field · ✓ */
.pqr .ln{display:flex;align-items:center;gap:10px;width:100%;min-height:54px;padding:0;border:0;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pqr .ln .l{flex:none;width:96px;display:flex;flex-direction:column;font-size:14px;color:rgba(var(--cream),.55)}
.pqr .ln .l em{font-style:normal;font-size:10.5px;color:rgba(var(--cream),.35)}
.pqr .ln .v{flex:1;min-width:0;font-size:16px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.pqr .ln .v.none{color:rgba(var(--cream),.4);font-weight:400}
.pqr .ln .v small{display:block;font-family:var(--mono);font-size:12px;font-weight:400;color:rgba(var(--cream),.5);margin-top:2px}
.pqr .ln.editing{box-shadow:none}
.pqr .ed{display:flex;align-items:center;gap:8px;padding:0 0 12px;box-shadow:0 1px 0 0 rgba(var(--cream),.08);animation:pqr_pickIn .3s var(--ease) both}
.pqr .ed .l{flex:none;width:96px;font-size:14px;color:var(--clay-hi)}
.pqr .ed .inp{flex:1;min-width:0;height:44px;border:0;border-radius:12px;background:rgba(var(--cream),.08);padding:0 12px;font-size:16px;font-weight:600;color:rgb(var(--cream));outline:none;box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pqr .ed .inp::placeholder{font-weight:400;color:rgba(var(--cream),.35)}
.pqr .ed .two{flex:1;min-width:0;display:flex;align-items:center;gap:6px}
.pqr .ed .two .inp{width:auto;flex:1;text-align:center;padding:0 6px}
.pqr .ed .two span{color:rgba(var(--cream),.5)}
.pqr .ed .ok{flex:none;width:44px;height:44px;border:0;border-radius:22px;background:var(--sage);color:#fff;display:grid;place-items:center}
.pqr .ed .ok svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.pqr .edwrap{display:flex;flex-direction:column;gap:8px;padding:8px 0 12px;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pqr .edwrap .ed{padding:0;box-shadow:none;animation:none}
.pqr .sw{display:flex;align-items:center;gap:10px;height:34px;margin-left:104px;text-align:left;white-space:nowrap;padding:0;border:0;background:none;color:rgba(var(--cream),.6);font-size:12.5px;font-weight:600}
.pqr .sw i{position:relative;width:34px;height:20px;border-radius:10px;background:rgba(var(--cream),.16);transition:background-color .25s}
.pqr .sw i::after{content:'';position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:rgb(var(--cream));transition:transform .3s var(--ease)}
.pqr .sw[aria-pressed="true"] i{background:var(--clay)}.pqr .sw[aria-pressed="true"] i::after{transform:translateX(14px)}
.pqr .sw[aria-pressed="true"]{color:rgb(var(--cream))}
.pqr .more{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}
.pqr .more button{height:34px;padding:0 13px;border:1px dashed rgba(var(--cream),.25);border-radius:17px;background:none;color:rgba(var(--cream),.75);font-size:13px;font-weight:600}
.pqr .tip{margin:8px 0 0;font-size:12px;color:rgba(var(--cream),.4);text-align:center}
.pqr .ifoot{position:sticky;bottom:calc(-1 * (var(--nav-h) + 14px));z-index:2;display:flex;align-items:center;gap:8px;margin:10px -16px -14px;padding:10px 16px calc(var(--nav-h) + 14px);background:linear-gradient(rgba(21,16,12,0),var(--night) 14px)}
.pqr .ifoot .ic{flex:none;width:48px;height:48px;border:0;border-radius:16px;background:rgba(var(--cream),.08);color:rgba(var(--cream),.85);display:grid;place-items:center}
.pqr .ifoot .ic svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.pqr .ifoot .ic.del{color:rgba(240,165,138,.9)}
.pqr .ifoot .ghost{flex:1;height:48px}
.pqr .ifoot .big{flex:1.3;height:48px;display:flex;align-items:center;justify-content:center;gap:6px}
.pqr .ifoot .big svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
/* keyboard up: the card is the screen, nothing else competes */
.pqr.kb .panel.short{max-height:calc(100% - 12px)}
.pqr.kb .panel{padding-bottom:12px}
.pqr.kb .tip,.pqr.kb .ipips{display:none}

/* bar, toast, panel, viewer */
/* The bar itself is the app's MobileNavBar - the same capsule, the same five tabs, live counts. This
   page lends it the item toolbar (navTakeover), so the reference's "the tabs step down, the actions
   step up" is the bar's own lent state. The bar lays a lent set out as equal columns; this toolbar is
   the reference's icon - icon - ghost - go, so it restates its own layout inside that one slot. */
/* The bar's own set carries 6px of side padding; the reference's toolbar carries 9. The 3 that are
   missing are made up here, so the row sits exactly where the reference draws it. */
.mnav .nav .acts .pqr-acts,.mnav .nav .acts .pqr-acts *{box-sizing:border-box}
.mnav .nav .acts .pqr-acts{display:flex;align-items:center;gap:8px;width:100%;padding:0 3px}
.mnav .nav .acts .pqr-acts .ic{flex:none;width:46px;height:46px;border:0;border-radius:23px;background:rgba(var(--cream),.08);color:rgba(var(--cream),.85);display:grid;place-items:center;transition:transform .15s}
.mnav .nav .acts .pqr-acts .ic:active{transform:scale(.92)}
.mnav .nav .acts .pqr-acts .ic svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.mnav .nav .acts .pqr-acts .ic.del{color:#F0A58A}
.mnav .nav .acts .pqr-acts .ghost{flex:1;height:46px;border:0;border-radius:23px;background:rgba(var(--cream),.1);color:rgb(var(--cream));font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:4px}
.mnav .nav .acts .pqr-acts .go{flex:1.25;height:46px;border:0;border-radius:23px;background:var(--clay);color:#fff;font-size:15.5px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 8px 18px -10px rgba(181,71,42,.9);transition:transform .15s,background-color .35s}
.mnav .nav .acts .pqr-acts .go:active{transform:scale(.97)}
.mnav .nav .acts .pqr-acts .go.sage{background:var(--sage)}
.mnav .nav .acts .pqr-acts svg.c2{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
/* ...and the reference draws its nav bar INSIDE that screen, so the bar steps back with it. The real
   bar is a global, fixed component and cannot inset itself, so the page insets it for as long as the
   card is up. 17px is the 16px the screen steps back plus its 1px border. */
body.pqr-card .mnav .nav{left:calc(var(--nav-gap) + 17px);right:calc(var(--nav-gap) + 17px);max-width:372px;
  bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom) + 1px)}
/* keyboard up: the card is the screen. The dock is this page's; the bar is the app's. */
.pqr.kb .dock{opacity:0;pointer-events:none}
body.pqr-kb .mnav{opacity:0;pointer-events:none;transition:opacity .2s}
.pqr .toast{position:absolute;left:16px;right:16px;top:62px;z-index:70;width:fit-content;max-width:calc(100% - 32px);margin-inline:auto;transform:translateY(-16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:11px 8px 11px 16px;border-radius:16px;background:var(--night);color:rgb(var(--cream));font-size:14px;box-shadow:0 18px 40px -16px rgba(21,16,12,.6);transition:transform .4s var(--ease),opacity .3s}
.pqr .toast.on{transform:none;opacity:1;pointer-events:auto}
.pqr .toast button{min-height:34px;padding:0 12px;border:0;border-radius:10px;background:rgba(var(--cream),.14);color:#fff;font-size:13.5px;font-weight:600}
.pqr .scrim{position:absolute;inset:0;z-index:17;background:rgba(21,16,12,.38);opacity:0;pointer-events:none;transition:opacity .35s}
.pqr .scrim.on{opacity:1;pointer-events:auto}
.pqr .panel{touch-action:pan-y;overflow-x:hidden;position:absolute;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom) + var(--kb,0px));z-index:18;max-height:calc(100% - 24px);padding:8px 16px calc(var(--nav-h) + 14px);border-radius:32px;background:var(--night);color:rgb(var(--cream));box-shadow:0 24px 50px -16px rgba(21,16,12,.7);
  transform:translateY(24px) scale(.96);transform-origin:50% 100%;opacity:0;visibility:hidden;overflow:auto;scrollbar-width:none;transition:transform .46s var(--ease),opacity .28s,visibility 0s .46s,bottom .25s,padding-bottom .25s;-webkit-touch-callout:none}
.pqr .panel::-webkit-scrollbar{display:none}
.pqr .panel.drag{transition:none!important}
.pqr #pBody{transition:none;will-change:transform}
.pqr #pIn{position:absolute;left:16px;right:16px;top:28px;will-change:transform;pointer-events:none}
.pqr .panel.fling{transition:transform .26s cubic-bezier(.4,0,.7,1)!important}
.pqr .panel.land{transition:transform .42s var(--ease)!important}
.pqr #pBody.nudge{animation:pqr_nudge 1.1s .6s var(--ease) 1}
@keyframes pqr_nudge{0%,100%{transform:none}30%{transform:translateX(-18px)}55%{transform:translateX(5px)}}
.pqr .tip b{display:inline-flex;align-items:center;gap:2px;font-weight:600;color:rgba(var(--cream),.6)}
.pqr .panel.short{background:radial-gradient(130% 70% at 0% 0%,rgba(212,99,62,.16),transparent 58%),linear-gradient(168deg,#241A12 0%,#15100C 60%)}
.pqr .ihead .no{background:rgba(212,99,62,.18)!important;color:#F0A58A}
.pqr .ipips i.cur{box-shadow:0 0 10px rgba(212,99,62,.7)}
.pqr .ipips i.was{background:rgba(var(--cream),.4)}
.pqr .ln{border-radius:12px;transition:background-color .2s}
.pqr .ln:active{background:rgba(var(--cream),.06)}
.pqr .ln:active .pen{stroke:var(--clay-hi)}
.pqr .icount .fig b.pop{animation:pqr_pop .32s var(--ease)}
@keyframes pqr_pop{0%{transform:scale(1.35);color:var(--clay-hi)}100%{transform:none}}
.pqr .ed .ok{animation:pqr_okin .35s cubic-bezier(.3,1.4,.5,1) both}
@keyframes pqr_okin{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
.pqr .ed .ok:active{transform:scale(.9)}
.pqr .ln .v.chg{animation:pqr_chg .9s ease-out}
.pqr #pBody.fwd{animation:pqr_stepIn .38s var(--ease) both}.pqr #pBody.bwd{animation:pqr_stepBack .38s var(--ease) both}
@keyframes pqr_stepIn{from{opacity:0;transform:translateX(22px)}to{opacity:1;transform:none}}
@keyframes pqr_stepBack{from{opacity:0;transform:translateX(-22px)}to{opacity:1;transform:none}}
.pqr .ipips i{transition:background-color .3s,box-shadow .3s}
.pqr.kb .panel{padding-bottom:16px}
.pqr .panel.on{transform:none;opacity:1;visibility:visible;transition:transform .5s var(--ease),opacity .3s,visibility 0s,bottom .25s,padding-bottom .25s}
.pqr .grab{display:grid;place-items:center;height:24px;margin:-8px -16px 0;padding-top:8px;touch-action:none;cursor:grab}.pqr .grab i{width:44px;height:5px;border-radius:3px;background:rgba(var(--cream),.28)}
.pqr .panel.short{max-height:84%}
.pqr .scrim.light{background:rgba(21,16,12,.22)}
.pqr .it.editing{background:var(--clay-wash)}
.pqr .p-head{display:flex;align-items:flex-start;gap:8px;margin:6px 0 10px}
.pqr .p-head .t{flex:1;min-width:0}
.pqr .p-head h2{margin:0;font-family:var(--serif);font-weight:600;font-size:21px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pqr .p-head span{font-size:13px;color:rgba(var(--cream),.55)}
.pqr .p-head .x{flex:none;width:40px;height:40px;margin:-6px -8px 0 0;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.7);display:grid;place-items:center}
.pqr .pips{display:flex;gap:5px;margin:0 0 12px}
.pqr .pips button{flex:1;height:22px;padding:0;border:0;background:none;display:grid;place-items:center}
.pqr .pips i{display:block;width:100%;height:4px;border-radius:2px;background:rgba(var(--cream),.14);transition:background-color .3s,transform .3s}
.pqr .pips .ok i{background:var(--sage-hi)}.pqr .pips .gap i{background:rgba(212,99,62,.55)}.pqr .pips .cur i{background:rgb(var(--cream));transform:scaleY(1.6)}
.pqr .qty{display:flex;align-items:center;gap:12px;margin:4px 0 10px}
.pqr .qty .fig{display:flex;align-items:baseline;gap:6px;font-family:var(--serif);font-weight:600;font-size:40px;line-height:1.05;font-variant-numeric:lining-nums}
.pqr .qty .fig span{font-size:24px;color:var(--clay-hi)}
.pqr .qty .fig small{font-family:var(--sans);font-weight:400;font-size:14px;color:rgba(var(--cream),.55)}
.pqr .qty .st{margin-left:auto;display:flex;gap:6px}
.pqr .qty .st button{width:44px;height:44px;border:0;border-radius:22px;background:rgba(var(--cream),.08);color:rgb(var(--cream));font-size:22px;display:grid;place-items:center}
.pqr .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}
.pqr .chip{height:36px;padding:0 13px;border-radius:18px;border:0;background:rgba(var(--cream),.07);color:rgba(var(--cream),.85);font-size:13.5px;font-weight:600;transition:background .25s,color .25s}
.pqr .chip[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.pqr .rowS{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:0 4px;border:0;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pqr .rowS .l{flex:none;width:86px;font-size:14px;color:rgba(var(--cream),.55);display:flex;align-items:center;gap:7px}
.pqr .rowS .l i{width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pqr .rowS .v{flex:1;min-width:0;text-align:right;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pqr .rowS .v.none{color:var(--clay-hi)}
.pqr .rowS .v.opt{color:rgba(var(--cream),.4);font-weight:400}
.pqr .rowS .v.mono{font-family:var(--mono);font-weight:500}
.pqr .rowS .v.chg{animation:pqr_chg .9s ease-out}
@keyframes pqr_chg{0%,25%{color:var(--clay-hi)}100%{color:rgb(var(--cream))}}
.pqr .rowS .from{flex:none;font-size:11px;color:rgba(var(--cream),.45)}
.pqr .rowS .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .35s var(--ease)}
.pqr .rowS.open{box-shadow:none}.pqr .rowS.open .c{transform:rotate(90deg)}
.pqr .rowS.plain{pointer-events:none}.pqr .rowS.plain .c{display:none}.pqr .rowS.plain .v{font-weight:400;color:rgba(var(--cream),.85)}
.pqr .pick{padding:2px 4px 14px;box-shadow:0 1px 0 0 rgba(var(--cream),.08);animation:pqr_pickIn .38s var(--ease) both}
@keyframes pqr_pickIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.pqr .inp{display:block;width:100%;height:48px;border:0;border-radius:14px;background:rgba(var(--cream),.07);padding:0 14px;font-size:16px;color:rgb(var(--cream));outline:none}
.pqr .inp::placeholder{color:rgba(var(--cream),.4)}
.pqr .inp:focus{box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pqr .two{display:flex;align-items:center;gap:8px}
.pqr .two .inp{flex:1;min-width:0}
.pqr .two span{color:rgba(var(--cream),.5)}
.pqr .quote{margin:12px 0 0;padding:11px 13px;border-radius:14px;background:rgba(var(--cream),.06);font-family:var(--mono);font-size:12.5px;line-height:1.5;color:rgba(var(--cream),.85);text-wrap:pretty}
.pqr .quote small{display:block;font-family:var(--sans);font-size:12px;font-weight:600;color:rgba(var(--cream),.5);margin-bottom:3px}
.pqr .quote.none{color:rgba(var(--cream),.6)}
.pqr .foot{display:flex;gap:8px;margin-top:14px}
.pqr .big{flex:1.4;height:52px;border:0;border-radius:16px;background:var(--clay);color:#fff;font-size:15.5px;font-weight:600;transition:opacity .25s,background-color .35s}
.pqr .big.ok{background:var(--sage)}
.pqr .big[disabled]{opacity:.32}
.pqr .ghost{flex:1;height:52px;border:0;border-radius:16px;background:rgba(var(--cream),.08);color:rgb(var(--cream));font-size:15px;font-weight:600}
.pqr .quiet{display:block;width:100%;height:42px;margin-top:6px;border:0;background:none;color:rgba(var(--cream),.5);font-size:13.5px;font-weight:600;text-decoration:underline;text-underline-offset:3px}
.pqr .opt{display:flex;align-items:center;gap:12px;width:100%;min-height:58px;padding:0 4px;border:0;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.pqr .opt:active{background:rgba(var(--cream),.06)}
.pqr .opt .av{flex:none;width:36px;height:36px;border-radius:18px;background:rgba(var(--cream),.09);display:grid;place-items:center;font-size:12px;font-weight:700;color:rgba(var(--cream),.85)}
.pqr .opt .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pqr .opt b{font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pqr .opt span{font-size:12.5px;color:rgba(var(--cream),.5)}
.pqr .opt .r{flex:none;width:9px;height:9px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(var(--cream),.35)}
.pqr .opt[aria-pressed="true"] .r{background:var(--clay-hi);box-shadow:none}
.pqr .opt.add{color:var(--clay-hi)}.pqr .opt.add .av{background:rgba(212,99,62,.16);color:var(--clay-hi)}
.pqr .find{display:flex;align-items:center;gap:10px;height:48px;margin-bottom:6px;padding:0 14px;border-radius:14px;background:rgba(var(--cream),.07)}
.pqr .find svg{flex:none;width:17px;height:17px;fill:none;stroke:rgba(var(--cream),.5);stroke-width:2;stroke-linecap:round}
.pqr .find input{flex:1;min-width:0;height:100%;border:0;background:none;outline:none;font-size:16px;color:rgb(var(--cream))}
.pqr .find input::placeholder{color:rgba(var(--cream),.4)}
.pqr .find:focus-within{box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.pqr .slipnote{margin:10px 2px 0;font-size:13px;color:rgba(var(--cream),.55);text-wrap:pretty}
.pqr .viewer{position:absolute;inset:0;z-index:60;background:rgba(12,9,7,.95);display:grid;place-items:center;opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s}
.pqr .viewer.on{opacity:1;visibility:visible;transition:opacity .3s,visibility 0s}
.pqr .viewer img{width:min(92%,380px);max-height:80%;object-fit:contain;border-radius:10px}
.pqr .viewer button{position:absolute;top:16px;right:16px;width:44px;height:44px;border:0;border-radius:22px;background:rgba(var(--cream),.12);color:rgb(var(--cream));display:grid;place-items:center}
.pqr .viewer p{position:absolute;left:0;right:0;bottom:24px;margin:0;text-align:center;font-size:13px;color:rgba(var(--cream),.6)}
@media (prefers-reduced-motion:reduce){.pqr *{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
