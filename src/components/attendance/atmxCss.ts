/**
 * The phone attendance sheet's stylesheet — the briklayattendancemobile1 reference, verbatim,
 * with every selector scoped under `.atmx` so it cannot touch the rest of the app. Nothing else
 * is changed: the rule order (and so the cascade, including the reference's two competing `.trow`
 * rules) is exactly the reference's.
 *
 * Three adaptations, none of them visual:
 *  · `:root` and `body` fold into `.atmx` — the page is a div here, not a document.
 *  · `@keyframes cpop` is namespaced, so it cannot collide with another sheet's.
 *  · The three fixed overlays (#shade, .sheet, #toast) are rendered through a portal on <body> and
 *    their z-indexes are each raised by 20, to clear the app's fixed bottom nav (z-40). Their order
 *    relative to one another is unchanged.
 */
export const ATMX_CSS = `
.atmx{--bg:#FBF4F0; --card:#FFFFFF; --ink:#2A241C; --walnut:#6E5F4C; --soft:#9A8C77;
  --rule:#EFE6DC; --clay:#BE3E22; --clay-soft:#F9E9E4; --sage:#6E8260; --sage-soft:#E7EDE1;
  --today:#FBF1E4;
  --serif:'Playfair Display', Georgia, serif;
  --sans:'DM Sans', -apple-system, sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;}
.atmx *{margin:0;padding:0;box-sizing:border-box; -webkit-tap-highlight-color:transparent}
.atmx{background:var(--bg); color:var(--ink); font-family:var(--sans); min-height:100vh; max-width:430px; margin:0 auto;
  padding-bottom:90px}
/* ---------- top ---------- */
.atmx .top{padding:18px 18px 10px}
.atmx .trow{display:flex; align-items:baseline; justify-content:space-between}
.atmx h1{font-family:var(--serif); font-size:26px; font-weight:600}
.atmx .wklink{font-size:12.5px; color:var(--soft); font-weight:600}
.atmx .stats{display:flex; gap:8px; margin-top:12px}
.atmx .stat{flex:1; background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:10px 12px}
.atmx .stat b{display:block; font-family:var(--mono); font-size:17px; font-weight:500}
.atmx .stat span{font-family:var(--mono); font-size:8.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--soft)}
.atmx .stat.gap b{color:var(--clay)}
/* ---------- date strip ---------- */
.atmx .datestrip{position:sticky; top:0; z-index:20; background:var(--bg); padding:10px 12px 8px; display:flex; gap:6px}
.atmx .day{flex:1; text-align:center; padding:8px 0 7px; border-radius:12px; cursor:pointer; border:1px solid transparent;
  transition:background .2s, border-color .2s}
.atmx .day small{display:block; font-family:var(--mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--soft)}
.atmx .day b{font-family:var(--serif); font-size:16px; font-weight:600; color:var(--walnut)}
.atmx .day .u{display:block; width:4px; height:4px; border-radius:50%; background:transparent; margin:3px auto 0}
.atmx .day.sel{background:var(--card); border-color:var(--rule); box-shadow:0 8px 18px -12px rgba(42,36,28,.3)}
.atmx .day.today b{color:var(--clay)}
.atmx .day.today .u{background:var(--clay)}
.atmx .day.future{opacity:.4}
/* ---------- list ---------- */
.atmx #list{padding:4px 14px 0; will-change:transform; touch-action:pan-y}
.atmx .sitecard{background:var(--card); border:1px solid var(--rule); border-radius:18px; margin-bottom:14px; overflow:hidden}
.atmx .shead{background:var(--card); display:flex; align-items:center; gap:8px;
  padding:13px 16px 11px; border-bottom:1px solid var(--rule)}
.atmx .sdot{width:8px; height:8px; border-radius:50%; flex:none}
.atmx .shead b{font-family:var(--serif); font-size:16.5px; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.atmx .shead .scount{font-family:var(--mono); font-size:11.5px; color:var(--walnut); flex:none}
.atmx .markall{border:0; background:none; color:var(--clay); font-family:var(--sans); font-size:12px; font-weight:700; flex:none; padding:4px 0 4px 10px; cursor:pointer}
.atmx .addbtn{width:26px; height:26px; border-radius:50%; border:1px solid var(--rule); background:var(--card); color:var(--walnut);
  font-size:14px; line-height:1; cursor:pointer; flex:none; margin-left:6px}
.atmx .addbtn:active{transform:scale(.9)}
/* add-worker sheet form */
.atmx .f-lab{font-family:var(--mono); font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--soft); margin:14px 0 6px}
.atmx .f-in{width:100%; background:var(--bg); border:1px solid var(--rule); border-radius:12px; padding:13px 14px;
  font-family:var(--sans); font-size:15px; color:var(--ink); outline:0; caret-color:var(--clay)}
.atmx .f-in:focus{border-color:var(--walnut)}
.atmx .f-in::placeholder{color:#C9BDA6}
.atmx .f-in.mono{font-family:var(--mono)}
.atmx .f2{display:grid; grid-template-columns:1.4fr 1fr; gap:10px}
/* worker action sheet */
.atmx .wk-week{font-family:var(--mono); font-size:12px; color:var(--walnut); margin:2px 0 8px}
.atmx .arow{display:flex; align-items:center; gap:13px; padding:15px 2px; border-bottom:1px solid var(--rule);
  font-size:15px; font-weight:600; cursor:pointer}
.atmx .arow:last-of-type{border-bottom:0}
.atmx .arow:active{background:var(--bg)}
.atmx .arow .aic{width:34px; height:34px; border-radius:10px; background:var(--bg); border:1px solid var(--rule);
  display:grid; place-items:center; color:var(--walnut); flex:none}
.atmx .arow .aic svg{width:16px; height:16px; stroke:currentColor; fill:none; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round}
.atmx .arow .ch{margin-left:auto; color:var(--soft); font-weight:400}
.atmx .arow.danger{color:var(--clay)}
.atmx .arow.danger .aic{color:var(--clay); background:var(--clay-soft); border-color:var(--clay-soft)}
/* party picker */
.atmx .pick{display:flex; align-items:center; gap:12px; padding:12px 2px; border-bottom:1px solid var(--rule); cursor:pointer}
.atmx .pick:active{background:var(--bg)}
.atmx .pick .wav{width:36px; height:36px}
.atmx .pick .pm{flex:1; min-width:0}
.atmx .pick .pm b{display:block; font-size:14.5px; font-weight:600}
.atmx .pick .pm span{font-size:12px; color:var(--soft)}
.atmx .pick .prate{font-family:var(--mono); font-size:12px; color:var(--walnut); flex:none}
.atmx .pick.onsite{opacity:.45; pointer-events:none}
.atmx .pick.newrow{color:var(--clay); font-weight:700; border-bottom:0}
.atmx .pick.newrow .wav{color:var(--clay); background:var(--clay-soft); border-color:var(--clay-soft); font-family:var(--sans)}
.atmx .picklist{max-height:290px; overflow-y:auto; margin-top:4px}
/* type editor rows */
.atmx .trow{display:flex; gap:8px; align-items:center; margin-bottom:8px}
.atmx .trow .f-in{padding:11px 12px; font-size:14px}
.atmx .trow .tdel{width:34px; height:40px; border:0; background:none; color:var(--soft); font-size:15px; cursor:pointer; flex:none}
.atmx .trow .tdel:disabled{opacity:.25}
.atmx .addtype{border:0; background:none; color:var(--clay); font-family:var(--sans); font-size:13px; font-weight:700; padding:4px 0 12px; cursor:pointer}
/* combined sheet */
.atmx .divider{height:1px; background:var(--rule); margin:10px -20px 2px}
.atmx .weekline{display:flex; align-items:center; gap:10px; font-family:var(--mono); font-size:11.5px; color:var(--soft); margin:12px 0 2px}
.atmx .weekline .weekdots{margin:0}
.atmx .weekline .wd{width:6px; height:6px}
/* week muster — the Saturday settlement line */
.atmx .muster{background:var(--bg); border:1px solid var(--rule); border-radius:12px; padding:10px 14px; margin:12px 0 2px}
.atmx .muster .m-lab{font-family:var(--mono); font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--soft); margin-bottom:6px}
.atmx .muster .m-row{display:flex; justify-content:space-between; font-size:12.5px; color:var(--walnut); padding:2.5px 0}
.atmx .muster .m-row b{font-family:var(--mono); font-weight:500; color:var(--ink)}
.atmx .muster .m-tot{display:flex; justify-content:space-between; border-top:1px solid var(--rule); margin-top:6px; padding-top:7px;
  font-size:12.5px; font-weight:700}
.atmx .muster .m-tot b{font-family:var(--mono); font-weight:500}
/* trade templates */
.atmx .tchips{display:flex; gap:7px; flex-wrap:wrap; margin:2px 0 12px}
.atmx .tchip{border:1px solid var(--rule); background:var(--card); color:var(--walnut); border-radius:999px;
  padding:7px 13px; font-family:var(--sans); font-size:12.5px; font-weight:600; cursor:pointer}
.atmx .tchip:active{transform:scale(.95)}
.atmx .tchip.on{background:var(--ink); color:#FFFDF7; border-color:var(--ink)}
/* alone / team segmented choice */
.atmx .seg{display:flex; background:var(--bg); border:1px solid var(--rule); border-radius:13px; padding:4px; gap:4px; margin:2px 0 14px}
.atmx .seg button{flex:1; border:0; background:transparent; border-radius:10px; padding:11px 0;
  font-family:var(--sans); font-size:13.5px; font-weight:700; color:var(--soft); cursor:pointer; transition:all .2s}
.atmx .seg button.on{background:var(--card); color:var(--ink); box-shadow:0 4px 12px -6px rgba(42,36,28,.25)}
/* quiet manage line — attendance owns the sheet */
.atmx .quietacts{display:flex; align-items:center; gap:20px; padding:13px 2px 4px}
.atmx .qa{border:0; background:none; font-family:var(--sans); font-size:13px; font-weight:600; color:var(--soft); cursor:pointer; padding:0}
.atmx .qa:active{color:var(--ink)}
.atmx .qa.danger{color:var(--clay); opacity:.75; margin-left:auto}
.atmx .qa.danger:active{opacity:1}
.atmx .wrow{display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--rule)}
.atmx .wrow:last-child{border-bottom:0}
.atmx .wav{width:38px; height:38px; border-radius:50%; background:var(--bg); border:1px solid var(--rule); flex:none;
  display:grid; place-items:center; font-family:var(--serif); font-size:14px; color:var(--walnut); position:relative}
.atmx .wav .src{position:absolute; right:-1px; bottom:-1px; width:10px; height:10px; border-radius:50%; background:var(--sage); border:2px solid var(--card)}
.atmx .wmid{flex:1; min-width:0}
.atmx .wmid b{display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.atmx .wmid .sub{font-size:11px; color:var(--soft)}
.atmx .weekdots{display:flex; gap:3.5px; margin-top:5px}
.atmx .wd{width:5px; height:5px; border-radius:50%; background:var(--rule)}
.atmx .wd.on{background:var(--sage)}
.atmx .wd.tod{box-shadow:0 0 0 1.5px var(--clay-soft); background:var(--rule)}
.atmx .wd.tod.on{background:var(--sage); box-shadow:0 0 0 1.5px var(--sage-soft)}
/* the counter */
.atmx .ctr{min-width:52px; height:40px; border-radius:12px; border:1.5px dashed var(--rule); background:transparent;
  font-family:var(--mono); font-size:15px; font-weight:500; color:var(--soft); cursor:pointer; flex:none;
  display:grid; place-items:center; transition:all .15s; padding:0 10px}
.atmx .ctr:active{transform:scale(.92)}
.atmx .ctr.filled{border-style:solid; border-color:var(--sage-soft); background:var(--sage-soft); color:var(--ink)}
.atmx .ctr.filled.pop{animation:atmx-cpop .3s cubic-bezier(.2,.9,.3,1.6)}
@keyframes atmx-cpop{0%{transform:scale(.8)}100%{transform:scale(1)}}
.atmx .ctr.ro{pointer-events:none; opacity:.4}
.atmx .siteempty{padding:14px 16px; font-size:12.5px; color:var(--soft)}
.atmx .siteempty b{color:var(--walnut); font-weight:700; cursor:pointer}
/* ---------- crew sheet ---------- */
.atmx #shade{position:fixed; inset:0; background:rgba(42,36,28,.35); opacity:0; pointer-events:none; transition:opacity .3s; z-index:60}
.atmx #shade.show{opacity:1; pointer-events:auto}
.atmx .sheet{position:fixed; left:0; right:0; bottom:0; max-width:430px; margin:0 auto; background:var(--card);
  border-radius:22px 22px 0 0; padding:10px 20px calc(20px + env(safe-area-inset-bottom)); z-index:70;
  max-height:86vh; max-height:86dvh; overflow-y:auto; overscroll-behavior:contain;
  transform:translateY(105%); transition:transform .38s cubic-bezier(.2,.9,.25,1)}
.atmx .sheet.show{transform:none}
.atmx .grab{width:36px; height:4px; border-radius:99px; background:var(--rule); margin:0 auto 14px}
.atmx .grab, .atmx .sh-head{touch-action:none}
.atmx .grab::before{content:''; position:absolute; left:0; right:0; top:0; height:46px}
/* fat invisible drag zone */
.atmx .sh-head{display:flex; align-items:baseline; justify-content:space-between; margin-bottom:4px}
.atmx .sh-head b{font-family:var(--serif); font-size:19px; font-weight:600}
.atmx .sh-head span{font-family:var(--mono); font-size:11px; color:var(--soft)}
.atmx .sh-src{font-size:11.5px; color:var(--sage); font-weight:600; margin-bottom:10px}
.atmx .srow{display:flex; align-items:center; gap:12px; padding:13px 0; border-bottom:1px solid var(--rule)}
.atmx .srow:last-of-type{border-bottom:0}
.atmx .srow .t{flex:1; font-size:14.5px; font-weight:600}
.atmx .srow .t small{display:block; font-family:var(--mono); font-size:11px; color:var(--soft); font-weight:400; margin-top:2px}
.atmx .step{display:flex; align-items:center; gap:10px}
.atmx .step button{width:38px; height:38px; border-radius:12px; border:1px solid var(--rule); background:var(--card); color:var(--walnut);
  font-size:17px; cursor:pointer; transition:all .12s}
.atmx .step button:active{transform:scale(.9); background:var(--bg)}
.atmx .step b{font-family:var(--mono); font-size:17px; min-width:26px; text-align:center}
.atmx .sh-foot{display:flex; justify-content:space-between; align-items:center; padding:14px 0 12px;
  font-family:var(--mono); font-size:13px; color:var(--walnut)}
.atmx .sh-done{width:100%; background:var(--ink); color:#FFFDF7; border:0; border-radius:999px; padding:15px 0;
  font-family:var(--sans); font-weight:700; font-size:15px; cursor:pointer}
.atmx .sh-done:active{transform:scale(.98)}
.atmx #toast{position:fixed; left:50%; bottom:24px; transform:translate(-50%,16px); background:var(--ink); color:#FFFDF7;
  font-size:13px; border-radius:999px; padding:11px 18px; opacity:0; transition:all .35s cubic-bezier(.2,.9,.3,1.2); z-index:80; white-space:nowrap}
.atmx #toast.show{opacity:1; transform:translate(-50%,0)}
/* The portal that hosts the fixed overlays is a page-level element, not the page: it must paint
   nothing and take no space of its own. */
.atmx.atmx-portal{background:none; min-height:0; max-width:none; margin:0; padding:0; height:0}
/* The app's <main> reserves its own clearance for the bottom tab bar underneath this page. That
   room sits below the .atmx box, so paint the page's ground behind it — otherwise a seam of a
   different colour shows under the last card. */
.atmx-page{background:#FBF4F0; min-height:100vh}
`;
