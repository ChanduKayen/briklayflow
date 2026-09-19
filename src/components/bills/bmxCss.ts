/**
 * Bills on a phone — the "Briklay · Bills" reference, scoped under `.bmx`. A drawer of paper: every
 * row leads with the bill itself, and what is linked against each paper is what turns into vendor
 * credit in Ledgers.
 *
 * Every value in the artifact's stylesheet is kept. Three adaptations, none of them visual: the root
 * scrolls in the app's own shell rather than filling a document; the overlays (the slim header, the
 * bill's own page, the scrim, the card, the viewer, the capsule) are fixed to the viewport; and the
 * artifact's copy of the bottom bar is dropped, since the app's real one floats over every page.
 * The dark ground is the app's night binding, and the card carries its rim.
 *
 * Its @keyframes are namespaced so they cannot collide with another page's.
 */
export const BMX_CSS = `.bmx{
  --ground:#FAF8F3; --paper:#FFFFFF; --ink:#2B211A; --ink-2:#5C4F45; --ink-3:#8A7B6E; --line:#E9E1D6; --line-2:#DCD2C4; --rule:#F0E9DF;
  --night:#170E08;--night-bg:linear-gradient(180deg,#191009,#140D07);--night-edge:#302014;--lift:0 24px 50px -16px rgba(20,13,7,.72),0 0 0 1px rgba(245,240,231,.10),inset 0 1px 0 rgba(245,240,231,.34); --cream:250,248,243; --clay:#B5472A; --clay-hi:#D4633E; --clay-wash:#FBEDE6; --sage:#2F5D3A; --sage-hi:#8FC79A; --sage-wash:#E7F0E6; --sheet:#F4EFE6;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif; --sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif; --mono:'DM Mono',ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,.8,.24,1); --nav-h:64px; --nav-gap:12px;
}
.bmx,.bmx *{box-sizing:border-box}
.bmx{background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;
  padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom))}
.bmx button,.bmx input{font:inherit;color:inherit}
.bmx button{cursor:pointer}
.bmx :focus-visible{outline:2px solid var(--clay-hi);outline-offset:3px;border-radius:10px}
.bmx [hidden]{display:none!important}
.bmx .view{}
/* a bill slides in over the drawer: its own scroller, fixed to the viewport */
.bmx .page{position:fixed;inset:0;z-index:14;max-width:430px;margin:0 auto;overflow-y:auto;overscroll-behavior:contain;background:var(--ground);
  padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom))}

/* =====================================================================
   BILLS.  A drawer of paper. What is linked against each paper is what turns into vendor credit in Ledgers.
     header   what you owe on bills, and how OLD that debt is (this week · 8–30 days · older). Age is the credit story.
     Bills    the drawer. Every row leads with the paper itself, slightly askew, like a bill on a desk.
              Status is one word with meaning: due · part paid · paid. A bill with no number carries the hollow ring (it cannot be duplicate-checked).
              Vendor credit itself lives in Ledgers; this page feeds it. Each bill links out to its vendor's ledger.
   BILL.      the paper is the hero. Then: is it paid? (settlement, with the Book payment that probably paid it, one tap to link)
              then what the bill says (lines, double-ruled total), then its particulars. Delete is in ⋯ and must be held.
   ===================================================================== */
.bmx .hero{background:var(--night-bg);color:rgb(var(--cream));padding:20px 20px 18px}
.bmx .hero-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.bmx .hero h1{margin:0;font-family:var(--serif);font-weight:600;font-size:32px;letter-spacing:-.01em;line-height:1.1}
.bmx .icb{width:40px;height:40px;border:0;border-radius:20px;background:rgba(var(--cream),.07);color:rgba(var(--cream),.85);display:grid;place-items:center}
.bmx .icb svg{width:20px;height:20px;fill:currentColor}
.bmx .owed{display:flex;align-items:baseline;gap:8px;margin-top:16px;font-family:var(--mono);font-size:31px;letter-spacing:-.01em}
.bmx .owed small{font-family:var(--sans);font-size:14px;color:rgba(var(--cream),.55)}
.bmx .sub{margin:4px 0 0;font-size:13px;color:rgba(var(--cream),.55)}
.bmx .age{display:flex;gap:3px;height:6px;margin:16px 0 10px;border-radius:3px;overflow:hidden}
.bmx .age i{display:block;height:100%;border-radius:1px}
.bmx .ages{display:grid;grid-template-columns:repeat(3,auto);justify-content:space-between;gap:8px}
.bmx .ages button{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 0;border:0;background:none;text-align:left;color:rgba(var(--cream),.6);font-size:12px}
.bmx .ages b{font-family:var(--mono);font-weight:500;font-size:13.5px;color:rgba(var(--cream),.92)}
.bmx .ages span{display:flex;align-items:center;gap:6px}
.bmx .ages i{width:7px;height:7px;border-radius:50%}
.bmx .ages button[aria-pressed="true"] span{color:rgb(var(--cream));text-decoration:underline;text-underline-offset:3px}
.bmx .c0{background:rgba(var(--cream),.4)}.bmx .c1{background:rgba(var(--cream),.85)}.bmx .c2{background:var(--clay-hi)}

.bmx .compact{position:fixed;left:0;right:0;top:0;max-width:430px;margin:0 auto;z-index:12;height:52px;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--night-bg);color:rgb(var(--cream));transform:translateY(-100%);transition:transform .35s var(--ease)}
.bmx .compact.on{transform:none}
.bmx .compact b{font-family:var(--serif);font-weight:600;font-size:19px}
.bmx .compact span{font-family:var(--mono);font-size:14px;color:rgba(var(--cream),.85)}
.bmx .compact small{font-family:var(--sans);font-size:12px;color:rgba(var(--cream),.5);margin-left:6px}

.bmx .tools{position:-webkit-sticky;position:sticky;top:52px;z-index:6;padding:12px 16px 10px;background:var(--ground);box-shadow:0 8px 10px -8px rgba(43,33,26,.14);transition:transform .34s var(--ease),opacity .25s}
.bmx .tools.tuck{transform:translateY(-120%);opacity:0;pointer-events:none}
.bmx .seg2{position:relative;display:grid;grid-template-columns:1fr 1fr;padding:4px;border-radius:18px;background:#EFE9DF}
.bmx .seg2 .th{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:14px;background:var(--paper);box-shadow:0 2px 8px -3px rgba(43,33,26,.25);transition:transform .45s cubic-bezier(.3,1.25,.5,1)}
.bmx .seg2 button{position:relative;z-index:1;height:40px;border:0;background:none;font-size:14.5px;font-weight:600;color:var(--ink-3);transition:color .3s}
.bmx .seg2 button[aria-pressed="true"]{color:var(--ink)}
.bmx .find{display:flex;align-items:center;gap:10px;height:48px;padding:0 16px;border-radius:24px;background:var(--paper);border:1px solid var(--line)}
.bmx .find svg{flex:none;width:18px;height:18px;fill:none;stroke:var(--ink-3);stroke-width:2;stroke-linecap:round}
.bmx .find input{flex:1;min-width:0;height:100%;border:0;background:none;outline:none;font-size:16px}
.bmx .find input::placeholder{color:var(--ink-3)}
.bmx .find:focus-within{border-color:var(--ink)}
.bmx .chips{display:flex;gap:6px;margin-top:10px;user-select:none;-webkit-user-select:none}
.bmx .chip{flex:1 1 auto;height:36px;padding:0 10px;border-radius:18px;border:1px solid var(--line-2);background:none;font-size:13.5px;font-weight:600;color:var(--ink-2);white-space:nowrap;transition:background .25s,color .25s,border-color .25s}
.bmx .chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--ground)}
.bmx .result{margin:10px 8px 0;font-size:13px;color:var(--ink-2)}
.bmx .result b{font-family:var(--mono);font-weight:500;color:var(--ink)}

.bmx .month{display:flex;align-items:baseline;justify-content:space-between;padding:20px 24px 9px}
.bmx .month h2{margin:0;font-family:var(--serif);font-weight:500;font-size:18px}
.bmx .month span{font-size:13px;color:var(--ink-3)}
.bmx .month span b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.bmx .card{margin:0 16px;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.bmx .card + .card{margin-top:12px}
.bmx .bill{display:flex;align-items:center;gap:15px;width:100%;min-height:84px;padding:12px 18px 12px 16px;border:0;border-top:1px solid var(--rule);background:none;text-align:left;transition:background-color .2s}
.bmx .bill:first-child{border-top:0}
.bmx .bill:active{background:#F7F2EA}
.bmx .bill.lit{animation:bmx-lit 2.2s ease-out}
@keyframes bmx-lit{0%,30%{background:var(--sage-wash)}100%{background:var(--paper)}}
/* the paper */
.bmx .sheet{position:relative;flex:none;width:44px;height:58px;border-radius:5px;background:var(--sheet);overflow:hidden;box-shadow:0 5px 12px -6px rgba(43,33,26,.45),0 0 0 1px rgba(43,33,26,.06);transform:rotate(-2deg)}
.bmx .bill:nth-child(even) .sheet{transform:rotate(1.5deg)}
.bmx .sheet svg,.bmx .sheet img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bmx .sheet.none{background:none;box-shadow:none;border:1.5px dashed var(--line-2)}
.bmx .bx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.bmx .b1{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.bmx .b1 b{min-width:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmx .b1 .amt{flex:none;font-family:var(--mono);font-size:15.5px;font-weight:500}
.bmx .b2{display:flex;align-items:center;justify-content:space-between;gap:10px}
.bmx .b2 .meta{min-width:0;font-size:13px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmx .ring{display:inline-block;width:8px;height:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay);margin:0 5px -1px 0}
.bmx .st{flex:none;font-size:12.5px;font-weight:600;color:var(--ink-2)}                  /* a bill from this week is not an alarm */
.bmx .st.late{color:var(--clay)}
.bmx .st.old{color:var(--clay);font-weight:700}
.bmx .st.fits{display:inline-flex;align-items:center;gap:5px;color:var(--sage)}
.bmx .st.fits i{width:6px;height:6px;border-radius:50%;background:var(--sage)}
.bmx .st.part{color:var(--ink-2)}
.bmx .st.paid{display:inline-flex;align-items:center;gap:5px;color:var(--sage)}
.bmx .st svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.bmx .vrow{display:flex;align-items:center;gap:12px;width:100%;min-height:76px;padding:12px 16px;border:0;border-top:1px solid var(--rule);background:none;text-align:left}
.bmx .vrow:first-child{border-top:0}
.bmx .vrow:active{background:#F7F2EA}
.bmx .av{flex:none;width:40px;height:40px;border-radius:20px;background:#F3EEE5;color:var(--ink-2);display:grid;place-items:center;font-size:12.5px;font-weight:700}
.bmx .vbar{height:4px;border-radius:2px;background:var(--rule);overflow:hidden;margin-top:5px}
.bmx .vbar i{display:block;height:100%;border-radius:2px;background:var(--sage-hi)}
.bmx .empty{margin:20px 16px 0;padding:26px 20px;border:1.5px dashed var(--line-2);border-radius:22px;text-align:center;font-size:14.5px;color:var(--ink-2)}
.bmx .empty b{display:block;font-size:16.5px;color:var(--ink);margin-bottom:4px}

/* pages that slide over the list */
.bmx .page{transform:translateX(100%);visibility:hidden;transition:transform .46s var(--ease),visibility 0s .46s}
.bmx .page.on{transform:none;visibility:visible;transition:transform .5s var(--ease),visibility 0s}
.bmx .page.lift{transition:none!important;transform:none}
.bmx .pp.fly{transform-origin:0 0;z-index:3}
.bmx .pbar b{flex:1;min-width:0;text-align:center;font-family:var(--serif);font-weight:600;font-size:16.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transform:translateY(4px);transition:opacity .25s,transform .3s var(--ease)}
.bmx .pbar.named b{opacity:1;transform:none}
.bmx.deep .view{transform:translateX(-22%);transition:transform .5s var(--ease)}
.bmx .view{transition:transform .46s var(--ease)}
.bmx .pbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 8px 0 6px;background:rgba(250,248,243,.94);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.bmx .pbar button{display:flex;align-items:center;gap:4px;height:44px;padding:0 10px;border:0;border-radius:22px;background:none;font-size:15px;font-weight:600;color:var(--ink-2)}
.bmx .pbar svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.bmx .pbar .dots svg{fill:currentColor;stroke:none}
.bmx .phead{padding:6px 20px 0}
.bmx .phead h1{margin:0;font-family:var(--serif);font-weight:600;font-size:28px;line-height:1.15;letter-spacing:-.01em}
.bmx .phead p{margin:6px 0 0;font-size:14px;color:var(--ink-2)}
.bmx .pamt{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px}
.bmx .pamt b{font-family:var(--mono);font-weight:500;font-size:32px;letter-spacing:-.01em}
.bmx .cap{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border-radius:16px;font-size:13.5px;font-weight:600;transition:background-color .4s,color .4s,box-shadow .4s}
.bmx .cap.due{box-shadow:inset 0 0 0 1.5px var(--clay);color:var(--clay)}
.bmx .cap.part{box-shadow:inset 0 0 0 1.5px var(--ink-2);color:var(--ink-2)}
.bmx .cap.paid{background:var(--sage);color:#fff}
.bmx .cap svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.bmx .bigsheet{position:relative;display:block;width:calc(100% - 32px);margin:18px 16px 0;height:230px;padding:0;border:0;border-radius:16px;background:var(--sheet);overflow:hidden;box-shadow:0 18px 36px -22px rgba(43,33,26,.55),0 0 0 1px rgba(43,33,26,.07)}
.bmx .bigsheet{background:#E9E2D5}
.bmx .bigsheet .pp{position:absolute;left:50%;top:20px;width:176px;height:234px;margin-left:-88px;border-radius:6px;overflow:hidden;background:var(--sheet);transform:rotate(-1.6deg);box-shadow:0 16px 30px -14px rgba(43,33,26,.55),0 0 0 1px rgba(43,33,26,.06)}
.bmx .bigsheet .pp svg,.bmx .bigsheet .pp img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bmx .bigsheet::after{content:'';position:absolute;left:0;right:0;bottom:0;height:80px;background:linear-gradient(rgba(233,226,213,0),rgba(233,226,213,.97))}
.bmx .bigsheet span{position:absolute;left:0;right:0;bottom:12px;z-index:1;text-align:center;font-size:13px;font-weight:600;color:var(--ink-2)}
.bmx .bigsheet.none{height:96px;background:none;box-shadow:none;border:1.5px dashed var(--line-2)}
.bmx .bigsheet.none::after{display:none}.bmx .bigsheet.none span{bottom:36px}
.bmx .blk{margin:14px 16px 0;background:var(--paper);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.bmx .blk h3{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0;padding:15px 18px 11px;font-size:15px;font-weight:600}
.bmx .blk h3 span{font-size:13px;font-weight:400;color:var(--ink-3)}
.bmx .match{margin:14px 16px 0;padding:14px 16px;border-radius:20px;background:var(--sage-wash);display:flex;flex-direction:column;gap:10px;animation:bmx-drop .5s var(--ease) both}
@keyframes bmx-drop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.bmx .match b{font-size:15px;color:var(--sage)}
.bmx .match p{margin:-6px 0 0;font-size:13.5px;color:var(--ink-2);text-wrap:pretty}
.bmx .match div{display:flex;gap:8px}
.bmx .match button{height:40px;padding:0 16px;border-radius:20px;border:0;font-size:14px;font-weight:600}
.bmx .match .y{background:var(--sage);color:#fff}.bmx .match .n{background:none;color:var(--ink-2)}
.bmx .setbar{height:6px;margin:0 18px;border-radius:3px;background:var(--clay-wash);overflow:hidden}
.bmx .setbar i{display:block;height:100%;width:0;border-radius:3px;background:var(--sage);transition:width .9s var(--ease)}
.bmx .setnum{display:flex;justify-content:space-between;padding:9px 18px 4px;font-size:13px;color:var(--ink-2)}
.bmx .setnum b{font-family:var(--mono);font-weight:500;color:var(--ink)}
.bmx .payrow{display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid var(--rule);animation:bmx-drop .5s var(--ease) both}
.bmx .payrow .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bmx .payrow b{font-size:14.5px;font-weight:600}
.bmx .payrow .m > span{font-size:12.5px;color:var(--ink-3)}
.bmx .payrow em{font-style:normal;font-family:var(--mono);font-size:14.5px}
.bmx .tickc{flex:none;width:26px;height:26px;border-radius:13px;background:var(--sage-wash);color:var(--sage);display:grid;place-items:center}
.bmx .tickc svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.bmx .none2{padding:2px 18px 6px;font-size:14px;color:var(--ink-3)}
.bmx .two{display:flex;gap:8px;padding:12px 14px 14px}
.bmx .two button{flex:1;height:46px;border-radius:15px;border:1px solid var(--line-2);background:none;font-size:14.5px;font-weight:600}
.bmx .two .pri{background:var(--clay);border-color:var(--clay);color:#fff}
.bmx .ln{display:flex;align-items:baseline;gap:10px;padding:11px 18px;border-top:1px solid var(--rule)}
.bmx .ln b{flex:1;min-width:0;font-size:15px;font-weight:500}
.bmx .ln span{flex:none;font-family:var(--mono);font-size:13px;color:var(--ink-3)}
.bmx .ln em{flex:none;min-width:70px;text-align:right;font-style:normal;font-family:var(--mono);font-size:14.5px}
.bmx .tot{display:flex;align-items:flex-end;justify-content:space-between;padding:12px 18px 16px;border-top:1px solid var(--rule)}
.bmx .tot i{font-family:var(--serif);font-style:italic;font-size:15px;color:var(--ink-2)}
.bmx .tot b{font-family:var(--mono);font-weight:500;font-size:15px;padding:0 0 5px 28px;border-bottom:3px double var(--ink)}
.bmx .kv{display:flex;align-items:baseline;gap:12px;width:100%;min-height:48px;padding:12px 18px;border:0;border-top:1px solid var(--rule);background:none;text-align:left}
.bmx .kv span{flex:none;width:92px;font-size:14px;color:var(--ink-3)}
.bmx .kv b{flex:1;min-width:0;text-align:right;font-size:15px;font-weight:600}
.bmx .kv b.warn{color:var(--clay)}
/* statement */
.bmx .sline{display:flex;align-items:center;gap:12px;padding:13px 18px;border-top:1px solid var(--rule)}
.bmx .sline:first-of-type{border-top:0}
.bmx .sline .k{flex:none;width:34px;height:34px;border-radius:17px;display:grid;place-items:center;background:#F3EEE5;color:var(--ink-2)}
.bmx .sline .k svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.bmx .sline .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bmx .sline b{font-size:15px;font-weight:600}
.bmx .sline .m > span{font-size:12.5px;color:var(--ink-3)}
.bmx .sline b{color:var(--ink)}
.bmx .sline .r{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.bmx .sline em{font-style:normal;font-family:var(--mono);font-size:14.5px}
.bmx .sline em.minus{color:var(--sage)}
.bmx .sline small{font-family:var(--mono);font-size:11.5px;color:var(--ink-3)}
.bmx .flagc{margin:14px 16px 0;padding:14px 16px;border-radius:20px;box-shadow:inset 0 0 0 1.5px var(--clay);font-size:14px;color:var(--ink-2);text-wrap:pretty}
.bmx .flagc b{display:block;color:var(--ink);margin-bottom:2px}

/* =====================================================================
   LINK A PAYMENT.  Nothing is created here. It only ties the bill to money that is ALREADY in Book.
     eligible  same vendor · same site · not yet linked to any bill. (One quiet switch widens it to the vendor's other sites: sites get mis-tagged.)
     1 pick    the bill's amount sits on top as a target. Each payment you tick pours into it; the bar fills; the words say what is still to cover.
               Best guesses float up and say why: "same amount", "closest date". Pick one or several.
               If a payment is bigger than what is left, only what is needed is used and the rest stays free for another bill. It says so, on that row.
     2 check   one slip: what goes where, and what the bill becomes (Paid · or ₹X left). Then link. Undo is one tap.
   ===================================================================== */
.bmx .wz{display:flex;flex-direction:column;min-height:0}
.bmx .steps{display:flex;gap:6px;padding:16px 8px 0 0}
.bmx .steps i{width:6px;height:6px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(var(--cream),.35);transition:background-color .3s,box-shadow .3s,transform .4s var(--ease)}
.bmx .steps i.was{background:rgba(var(--cream),.8);box-shadow:none}.bmx .steps i.now{background:var(--clay-hi);box-shadow:none;transform:scale(1.25)}
.bmx .target{margin:2px 0 12px}
.bmx .target .fig{display:flex;align-items:baseline;gap:8px;font-family:var(--serif);font-weight:600;font-size:34px;line-height:1.1;font-variant-numeric:lining-nums}
.bmx .target .fig span{font-size:22px;color:var(--clay-hi)}
.bmx .target .fig small{font-family:var(--sans);font-weight:400;font-size:13.5px;color:rgba(var(--cream),.55)}
.bmx .pour{height:6px;margin:12px 0 8px;border-radius:3px;background:rgba(var(--cream),.12);overflow:hidden}
.bmx .pour i{display:block;height:100%;width:0;border-radius:3px;background:var(--sage-hi);transition:width .6s var(--ease)}
.bmx .target p{margin:0;min-height:19px;font-size:13.5px;color:rgba(var(--cream),.7)}
.bmx .target p b{font-family:var(--mono);font-weight:500;color:rgb(var(--cream))}
.bmx .target p.full{color:var(--sage-hi)}
.bmx .cands{display:flex;flex-direction:column;max-height:266px;overflow:auto;margin:0 -4px;scrollbar-width:none}
.bmx .cands::-webkit-scrollbar{display:none}
.bmx .cand{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:8px 4px;border:0;border-radius:14px;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08);transition:background-color .2s;animation:bmx-candIn .4s var(--ease) both}
@keyframes bmx-candIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.bmx .cand:active{background:rgba(var(--cream),.06)}
.bmx .cand .pick{flex:none;width:26px;height:26px;border-radius:13px;box-shadow:inset 0 0 0 1.5px rgba(var(--cream),.3);display:grid;place-items:center;transition:background-color .25s,box-shadow .25s,transform .3s var(--ease)}
.bmx .cand .pick svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity .2s}
.bmx .cand[aria-pressed="true"] .pick{background:var(--clay);box-shadow:none;transform:scale(1.06)}
.bmx .cand[aria-pressed="true"] .pick svg{opacity:1}
.bmx .cand .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bmx .cand .m b{font-size:15px;font-weight:600}
.bmx .cand .m > span{font-size:12.5px;color:rgba(var(--cream),.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bmx .cand .tagslot{display:block;overflow:visible!important}
.bmx .cand .tagslot:empty{display:none}
.bmx .cand .tagslot .why{margin-top:3px}
.bmx .cand .r{flex:none;align-self:flex-start;padding-top:2px;display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.bmx .cand .r em{font-style:normal;font-family:var(--mono);font-size:15px}
.bmx .why{height:20px;padding:0 8px;border-radius:10px;background:rgba(143,199,154,.16);color:#A9D6B1;font-size:11px;font-weight:600;display:inline-flex;align-items:center;white-space:nowrap}
.bmx .why.part{background:rgba(var(--cream),.08);color:rgba(var(--cream),.7)}
.bmx .widen{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:48px;margin-top:4px;padding:0 4px;border:0;background:none;color:rgba(var(--cream),.75);font-size:13.5px;font-weight:600;text-align:left}
.bmx .sw{flex:none;position:relative;width:38px;height:22px;border-radius:11px;background:rgba(var(--cream),.16);transition:background-color .25s}
.bmx .sw::after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:rgb(var(--cream));transition:transform .3s var(--ease)}
.bmx .widen[aria-pressed="true"] .sw{background:var(--clay)}
.bmx .widen[aria-pressed="true"] .sw::after{transform:translateX(16px)}
.bmx .nonefound{padding:22px 8px;text-align:center;font-size:14px;color:rgba(var(--cream),.6);text-wrap:pretty}
.bmx .nonefound b{display:block;font-size:16px;color:rgb(var(--cream));margin-bottom:4px}
.bmx .wzbtn{width:100%;height:54px;margin-top:8px;border:0;border-radius:16px;background:var(--clay);color:#fff;font-size:16.5px;font-weight:600;transition:opacity .25s,background-color .35s}
.bmx .wzbtn[disabled]{opacity:.32}
.bmx .wzbtn.ok{background:var(--sage)}
.bmx .alloc{display:flex;align-items:baseline;gap:10px;min-height:48px;padding:12px 0;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.bmx .alloc span{flex:1;min-width:0;font-size:14.5px;color:rgba(var(--cream),.8)}
.bmx .alloc span small{display:block;font-size:12px;color:rgba(var(--cream),.5)}
.bmx .alloc b{flex:none;font-family:var(--mono);font-weight:500;font-size:15px}
.bmx .becomes{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding:14px 16px;border-radius:16px;background:rgba(var(--cream),.06);font-size:14.5px}
.bmx .becomes .cap{height:30px}
.bmx .becomes .cap.paid{background:var(--sage)}.bmx .becomes .cap.part{box-shadow:inset 0 0 0 1.5px rgba(var(--cream),.5);color:rgb(var(--cream))}
.bmx .wzbody{animation:bmx-stepIn .42s var(--ease) both}.bmx .wzbody.back{animation-name:bmx-stepBack}
@keyframes bmx-stepIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes bmx-stepBack{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}

/* bar, capsule, toast, panel, viewer */
.bmx .fab{--w:120px;position:fixed;right:max(16px,calc(50vw - 199px));bottom:calc(var(--nav-gap) + var(--nav-h) + 14px + env(safe-area-inset-bottom));z-index:19;height:54px;width:var(--w);padding:0;border:0;border-radius:27px;background:var(--clay);color:#fff;display:flex;align-items:center;overflow:hidden;white-space:nowrap;user-select:none;-webkit-user-select:none;
  box-shadow:0 16px 28px -14px rgba(181,71,42,.95),0 4px 10px -6px rgba(21,16,12,.4);transition:width .42s var(--ease),transform .38s var(--ease),opacity .25s,background-color .4s}
.bmx .fab .ic{flex:none;width:54px;height:54px;display:grid;place-items:center}
.bmx .fab .ic svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.bmx .fab .lbl{font-size:16px;font-weight:600;margin-left:-6px;padding-right:22px;transition:opacity .22s}
.bmx .fab.folded{width:54px}.bmx .fab.folded .lbl{opacity:0}
.bmx .fab.away{transform:translateY(16px) scale(.7);opacity:0;pointer-events:none}
.bmx .measure{position:fixed;visibility:hidden;white-space:nowrap;font-size:16px;font-weight:600}
.bmx .toast{position:fixed;left:16px;right:16px;top:62px;z-index:70;width:fit-content;max-width:calc(100% - 32px);margin-inline:auto;transform:translateY(-16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:11px 8px 11px 16px;border-radius:16px;background:var(--night-bg);color:rgb(var(--cream));font-size:14px;box-shadow:0 18px 40px -16px rgba(21,16,12,.6);transition:transform .4s var(--ease),opacity .3s}
.bmx .toast.on{transform:none;opacity:1;pointer-events:auto}
.bmx .toast button{min-height:34px;padding:0 12px;border:0;border-radius:10px;background:rgba(var(--cream),.14);color:#fff;font-size:13.5px;font-weight:600}
.bmx .scrim{position:fixed;inset:0;z-index:17;background:rgba(9,6,3,.52);backdrop-filter:saturate(.8) blur(1.5px);-webkit-backdrop-filter:saturate(.8) blur(1.5px);opacity:0;pointer-events:none;transition:opacity .35s}
.bmx .scrim.on{opacity:1;pointer-events:auto}
.bmx .panel{position:fixed;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom));z-index:18;max-width:406px;margin:0 auto;max-height:calc(100dvh - 24px);padding:8px 16px calc(var(--nav-h) + 14px);border-radius:32px;background:var(--night-bg);color:rgb(var(--cream));box-shadow:var(--lift);
  transform:translateY(24px) scale(.96);transform-origin:50% 100%;opacity:0;visibility:hidden;overflow:auto;transition:transform .46s var(--ease),opacity .28s,visibility 0s .46s;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.bmx .panel.on{transform:none;opacity:1;visibility:visible;transition:transform .5s var(--ease),opacity .3s,visibility 0s}
.bmx .grab{display:grid;place-items:center;height:20px}.bmx .grab i{width:36px;height:4px;border-radius:2px;background:rgba(var(--cream),.18)}
.bmx .p-head{display:flex;align-items:flex-start;gap:10px;margin:6px 0 10px}
.bmx .p-head .t{flex:1;min-width:0}
.bmx .p-head h2{margin:0;font-family:var(--serif);font-weight:600;font-size:21px;line-height:1.2}
.bmx .p-head span{font-size:13px;color:rgba(var(--cream),.55)}
.bmx .p-head .x{flex:none;width:40px;height:40px;margin:-6px -8px 0 0;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.7);display:grid;place-items:center}
.bmx .opt{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:60px;border:0;background:none;color:rgb(var(--cream));text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08);overflow:hidden;touch-action:manipulation}
.bmx .opt .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.bmx .opt b{font-size:15px;font-weight:600}
.bmx .opt span{font-size:12.5px;color:rgba(var(--cream),.55)}
.bmx .opt em{flex:none;font-style:normal;font-family:var(--mono);font-size:14.5px}
.bmx .opt .best{flex:none;height:22px;padding:0 8px;border-radius:11px;background:rgba(143,199,154,.18);color:#A9D6B1;font-size:11.5px;font-weight:600;display:inline-flex;align-items:center}
.bmx .opt svg{flex:none;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.8}
.bmx .opt.danger{color:var(--clay-hi);touch-action:none}
.bmx .opt.danger::before{content:'';position:absolute;inset:6px -4px;border-radius:16px;background:rgba(212,99,62,.2);transform:scaleX(0);transform-origin:left;transition:transform .15s}
.bmx .opt.danger.hold::before{transform:scaleX(1);transition:transform 1s linear}
.bmx .viewer{position:fixed;inset:0;z-index:60;background:rgba(12,9,7,.95);display:grid;place-items:center;opacity:0;visibility:hidden;transition:opacity .3s,visibility 0s .3s}
.bmx .viewer.on{opacity:1;visibility:visible;transition:opacity .3s,visibility 0s}
.bmx .viewer .big{position:relative;width:min(88%,360px);aspect-ratio:3/4;border-radius:12px;background:var(--sheet);overflow:hidden}
.bmx .viewer .big svg{position:absolute;inset:0;width:100%;height:100%}
.bmx .viewer button{position:absolute;top:16px;right:16px;width:44px;height:44px;border:0;border-radius:22px;background:rgba(var(--cream),.12);color:rgb(var(--cream));display:grid;place-items:center}
@media (prefers-reduced-motion:reduce){.bmx,.bmx *{transition-duration:.01ms!important;animation-duration:.01ms!important}}
`;
