/**
 * The New-bill modal, in Briklay's own hand.
 *
 * A straight port of the reference: cream ground, paper card, the ledger rule, Playfair for the
 * name of the thing and DM Mono for the small capitals that label a column. Everything is scoped
 * under `.nbx` so it can be opened from any page without the page's own CSS reaching into it.
 */
export const NBX_CSS = `
.nbx{
  --cream:#FAF7F0; --paper:#FFFDF7; --ink:#2A241C; --walnut:#6E5F4C; --soft:#9A8C77;
  --rule:#E6DECD; --terra:#C0603F; --terra-soft:#F7E9E2; --sage:#6E8260; --sage-soft:#E4EADD;
  --amber:#9A6A1F; --amber-soft:#F5EDDA;
  /* the drawer the phone wears — the same night the transactions slide-up is cut from */
  --night:#170E08; --night-bg:linear-gradient(180deg,#191009,#140D07); --night-edge:#302014;
  --lift:0 24px 50px -16px rgba(20,13,7,.72), 0 0 0 1px rgba(245,240,231,.10), inset 0 1px 0 rgba(245,240,231,.34);
  --cream:250,248,243; --clay:#B5472A; --clay-hi:#D4633E; --ease:cubic-bezier(.22,.8,.24,1);
  --serif:'Playfair Display', Georgia, serif;
  --sans:'DM Sans', -apple-system, sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;
  position:fixed; inset:0; z-index:120; display:grid; place-items:center; padding:40px;
  font-family:var(--sans); color:var(--ink);
}
.nbx *{margin:0; padding:0; box-sizing:border-box}
.nbx .backdrop{position:fixed; inset:0; background:rgba(42,36,28,.28); backdrop-filter:blur(2px)}

.nbx .modal{position:relative; width:min(560px,94vw); max-height:calc(100vh - 80px); display:flex; flex-direction:column;
  background:var(--paper); border-radius:20px; box-shadow:0 40px 90px -34px rgba(42,36,28,.5); overflow:hidden;
  animation:nbx-pop .45s cubic-bezier(.2,.9,.3,1.2)}
@keyframes nbx-pop{0%{transform:scale(.94) translateY(14px); opacity:0}100%{transform:none; opacity:1}}
.nbx .modal.leaving{transition:all .4s cubic-bezier(.5,0,.8,.4); transform:scale(.94) translateY(10px); opacity:0}
.nbx .m-head{display:flex; align-items:center; justify-content:space-between; padding:20px 26px 14px; flex:none}
.nbx .m-head b{font-family:var(--serif); font-size:23px; font-weight:600}
.nbx .m-head .qn{margin-left:auto; margin-right:10px; font-family:var(--mono); font-size:11.5px; color:var(--soft)}
.nbx .m-x{width:30px; height:30px; border-radius:50%; border:0; background:transparent; color:var(--soft); font-size:15px; cursor:pointer; flex:none}
.nbx .m-x:hover{background:var(--cream); color:var(--ink)}
.nbx .m-body{padding:4px 26px 8px; overflow-y:auto; flex:1 1 auto}

/* ---------- stage 1: the drop ---------- */
.nbx .dropzone{border:1.5px dashed #D4C4A8; border-radius:16px; padding:38px 24px; text-align:center; cursor:pointer;
  /* a <button>, not the reference's <div>, so it is reachable by keyboard — hence the resets */
  width:100%; display:block; font-family:var(--sans); font-size:16px; color:var(--ink); background:transparent;
  transition:border-color .25s, background .25s, transform .2s; margin-bottom:14px}
.nbx .dropzone:hover,.nbx .dropzone.over{border-color:var(--walnut); background:#FCFAF3; transform:translateY(-1px)}
.nbx .dropzone .dz-ic{font-size:26px; margin-bottom:10px}
.nbx .dropzone b{display:block; font-size:15.5px; margin-bottom:5px}
.nbx .dropzone span{font-size:13px; color:var(--soft)}
.nbx .orline{display:flex; align-items:center; gap:12px; color:var(--soft); font-size:12px; margin:4px 0 14px}
.nbx .orline::before,.nbx .orline::after{content:''; flex:1; height:1px; background:var(--rule)}
.nbx .manual-link{display:block; width:100%; text-align:center; background:none; border:0; cursor:pointer;
  font-family:var(--sans); font-size:14px; font-weight:600; color:var(--walnut); padding:6px 0 16px}
.nbx .manual-link:hover{color:var(--ink)}

/* extraction state */
.nbx .reading{display:flex; align-items:center; gap:14px; border:1px solid var(--rule); border-radius:14px; padding:16px 18px; margin-bottom:18px}
.nbx .rd-doc{width:40px; height:50px; border:1px solid var(--rule); border-radius:5px; background:#fff; position:relative; overflow:hidden; flex:none}
.nbx .rd-doc i{position:absolute; left:0; right:0; height:16px; top:-16px;
  background:linear-gradient(rgba(192,96,63,0), rgba(192,96,63,.25), rgba(192,96,63,0));
  animation:nbx-scan 1.3s linear infinite}
@keyframes nbx-scan{to{top:60px}}
.nbx .reading b{display:block; font-size:14px}
.nbx .reading span{font-size:12.5px; color:var(--soft)}
.nbx .readfail{border:1px solid #E4C9B9; background:var(--terra-soft); color:#8A3E22; border-radius:14px;
  padding:14px 16px; font-size:13px; line-height:1.5; margin-bottom:16px}
.nbx .readfail b{display:block; font-size:13.5px; margin-bottom:3px}

/* ---------- stage 2: the form ---------- */
.nbx .frow{margin-bottom:18px; position:relative}
.nbx .f2{display:grid; grid-template-columns:1fr 1fr; gap:20px}
.nbx .flabel{font-family:var(--mono); font-size:10.5px; letter-spacing:.2em; text-transform:uppercase; color:var(--soft);
  display:flex; align-items:center; gap:7px; margin-bottom:6px}
.nbx .flabel .opt{font-size:9px; letter-spacing:.1em; color:#C7BBA4}
.nbx .ftick{width:14px; height:14px; border-radius:50%; background:var(--sage-soft); color:var(--sage); font-size:9px;
  display:none; place-items:center}
.nbx .frow.filled .ftick{display:grid; animation:nbx-tickin .35s cubic-bezier(.2,.9,.3,1.5)}
@keyframes nbx-tickin{0%{transform:scale(.3)}100%{transform:scale(1)}}
.nbx .finput{width:100%; background:transparent; border:0; outline:0; font-family:var(--sans); font-size:16.5px; color:var(--ink);
  padding:3px 2px 10px; border-bottom:1px solid var(--rule); box-shadow:0 3px 0 -2px transparent;
  transition:border-color .3s; caret-color:var(--terra); border-radius:0}
.nbx .finput:focus{border-color:var(--walnut)}
.nbx .finput.big{font-family:var(--mono); font-size:19px}
.nbx .finput::placeholder{color:#CFC4B0; font-style:italic}
.nbx .frow.inked .finput{animation:nbx-inkin .5s ease}
@keyframes nbx-inkin{0%{color:transparent; border-color:var(--sage)}60%{color:var(--ink)}100%{border-color:var(--rule)}}
.nbx select.finput{appearance:none; cursor:pointer}
.nbx .locked{font-size:16.5px; padding:3px 2px 10px; border-bottom:1px solid var(--rule); display:flex; align-items:center; gap:9px}
.nbx .locked .ta-av{flex:none}
.nbx .locked em{font-style:normal; font-family:var(--mono); font-size:11.5px; color:var(--soft); margin-left:auto}

/* vendor typeahead */
.nbx .ta{position:absolute; left:0; right:0; top:calc(100% + 6px); background:var(--paper); border:1px solid var(--rule);
  border-radius:12px; box-shadow:0 20px 40px -22px rgba(42,36,28,.4); z-index:20; overflow:hidden; max-height:232px; overflow-y:auto}
.nbx .ta-item{display:flex; align-items:center; gap:10px; padding:11px 14px; cursor:pointer; font-size:14px;
  width:100%; text-align:left; background:none; border:0; font-family:var(--sans); color:var(--ink)}
.nbx .ta-item:hover,.nbx .ta-item.hot{background:var(--cream)}
.nbx .ta-item .ta-av{width:28px; height:28px; border-radius:50%; background:var(--cream); border:1px solid var(--rule);
  display:grid; place-items:center; font-family:var(--serif); font-size:12px; color:var(--walnut); flex:none}
.nbx .ta-item span{margin-left:auto; font-family:var(--mono); font-size:11.5px; color:var(--soft); flex:none}
.nbx .ta-new{border-top:1px solid var(--rule); color:var(--terra); font-weight:600}

/* duplicate warning */
.nbx .dupe{display:flex; align-items:flex-start; gap:9px; background:var(--amber-soft); color:var(--amber);
  border-radius:12px; padding:11px 14px; font-size:13px; margin:-6px 0 16px; line-height:1.5; animation:nbx-fadein .35s ease}
@keyframes nbx-fadein{from{opacity:0; transform:translateY(-4px)}to{opacity:1}}
.nbx .dupe .lnk{color:var(--amber); font-weight:600; cursor:pointer; text-decoration:underline; background:none; border:0;
  font-family:var(--sans); font-size:13px; padding:0}
.nbx .dupe .anyway{display:flex; align-items:center; gap:6px; margin-top:7px; cursor:pointer; font-size:12.5px}
.nbx .dupe .anyway input{accent-color:var(--amber); width:14px; height:14px}

/* ---------- footer: the ledger consequence ---------- */
.nbx .m-foot{border-top:1px solid var(--rule); padding:16px 26px 18px; display:flex; align-items:center; justify-content:space-between; gap:14px; flex:none}
.nbx .consequence{font-size:13px; color:var(--walnut); line-height:1.5; min-height:20px}
.nbx .consequence b{font-family:var(--mono); color:var(--ink); font-weight:500}
.nbx .consequence .up{color:var(--terra)}
.nbx .actions{display:flex; gap:10px; flex:none}
.nbx .btn-quiet{background:transparent; border:1px solid var(--rule); color:var(--walnut); border-radius:999px; padding:12px 22px;
  font-family:var(--sans); font-weight:600; font-size:14px; cursor:pointer; transition:border-color .2s}
.nbx .btn-quiet:hover{border-color:var(--walnut)}
.nbx .btn{background:var(--ink); color:var(--cream); border:0; border-radius:999px; padding:12px 26px;
  font-family:var(--sans); font-weight:600; font-size:14px; cursor:pointer;
  transition:transform .25s cubic-bezier(.2,.9,.3,1.4), opacity .25s, background .3s}
.nbx .btn:hover:not(:disabled){transform:translateY(-1px)}
.nbx .btn:active:not(:disabled){transform:scale(.97)}
.nbx .btn:disabled{opacity:.35; transform:none; cursor:not-allowed}
.nbx .btn.ok{background:var(--sage)}

/* ---------- the phone: the night drawer ----------
   Not a page-wide card with square shoulders, but the drawer every other sheet on the phone is:
   inset from all three edges, cut from the same night as the transactions slide-up, lifted off the
   page rather than pasted to its bottom. Everything below re-inks the daylight form for that ground. */
.nbx.sheet{place-items:end center; padding:0}
.nbx.sheet .backdrop{background:rgba(9,6,3,.52); backdrop-filter:saturate(.8) blur(1.5px); -webkit-backdrop-filter:saturate(.8) blur(1.5px)}
.nbx.sheet .modal{width:calc(100% - 24px); max-width:406px; margin:0 0 calc(12px + env(safe-area-inset-bottom,0px));
  max-height:calc(100dvh - 24px); border-radius:32px; background:var(--night-bg); color:rgb(var(--cream));
  box-shadow:var(--lift); animation:nbx-lift .46s var(--ease);
  transition:transform .28s var(--ease), opacity .28s}
@keyframes nbx-lift{from{transform:translateY(24px) scale(.96); opacity:0}to{transform:none; opacity:1}}
.nbx.sheet .modal.leaving{transition:transform .32s var(--ease), opacity .3s; transform:translateY(24px) scale(.96); opacity:0}
.nbx.sheet .grab{width:36px; height:4px; border-radius:2px; background:rgba(var(--cream),.18); margin:8px auto 0}
.nbx.sheet .m-head{padding:8px 18px 10px}
.nbx.sheet .m-head b{font-size:21px; color:rgb(var(--cream))}
.nbx.sheet .m-head .qn{color:rgba(var(--cream),.56)}
.nbx.sheet .m-x{width:40px; height:40px; margin:-4px -8px 0 0; border-radius:20px; color:rgba(var(--cream),.7); font-size:16px}
.nbx.sheet .m-x:hover{background:rgba(var(--cream),.08); color:rgb(var(--cream))}
.nbx.sheet .m-body{padding:2px 18px 8px; -webkit-overflow-scrolling:touch}

/* the drop */
.nbx.sheet .dropzone{border:1.5px dashed rgba(var(--cream),.22); border-radius:20px; background:rgba(var(--cream),.04);
  color:rgb(var(--cream)); padding:28px 18px}
.nbx.sheet .dropzone:hover,.nbx.sheet .dropzone.over{border-color:rgba(var(--cream),.45); background:rgba(var(--cream),.08)}
.nbx.sheet .dropzone .dz-ic{color:rgba(var(--cream),.6)}
.nbx.sheet .dropzone span{color:rgba(var(--cream),.56)}
.nbx.sheet .orline{color:rgba(var(--cream),.52)}
.nbx.sheet .orline::before,.nbx.sheet .orline::after{background:rgba(var(--cream),.12)}
.nbx.sheet .manual-link{color:rgba(var(--cream),.82)}
.nbx.sheet .manual-link:hover{color:rgb(var(--cream))}
.nbx.sheet .reading{border-color:rgba(var(--cream),.14)}
.nbx.sheet .reading b{color:rgb(var(--cream))}
.nbx.sheet .reading span{color:rgba(var(--cream),.56)}
.nbx.sheet .rd-doc{border-color:rgba(var(--cream),.16); background:rgba(var(--cream),.06)}
.nbx.sheet .readfail{border-color:rgba(212,99,62,.32); background:rgba(212,99,62,.14); color:#EFAE93}

/* the form */
.nbx.sheet .flabel{color:rgba(var(--cream),.56)}
.nbx.sheet .flabel .opt{color:rgba(var(--cream),.45)}
.nbx.sheet .ftick{background:rgba(143,199,154,.2); color:#A9D6B1}
/* 16px floor: anything smaller and the phone zooms the page on focus */
.nbx.sheet .finput{font-size:16.5px; color:rgb(var(--cream)); border-bottom-color:rgba(var(--cream),.16); caret-color:var(--clay-hi)}
.nbx.sheet .finput:focus{border-bottom-color:rgba(var(--cream),.5)}
.nbx.sheet .finput::placeholder{color:rgba(var(--cream),.45)}
/* the OS paints the option list itself — it needs daylight ink of its own or it comes out unreadable */
.nbx.sheet select.finput{color-scheme:dark}
.nbx.sheet select.finput option{color:var(--ink); background:var(--paper)}
.nbx.sheet input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1); opacity:.5}
.nbx.sheet .frow.inked .finput{animation:none}
.nbx.sheet .locked{color:rgb(var(--cream)); border-bottom-color:rgba(var(--cream),.16)}
.nbx.sheet .locked em{color:rgba(var(--cream),.56)}
.nbx.sheet .ta{background:#1F150E; border-color:rgba(var(--cream),.12); box-shadow:0 22px 44px -22px rgba(0,0,0,.8)}
.nbx.sheet .ta-item{color:rgb(var(--cream))}
.nbx.sheet .ta-item:hover,.nbx.sheet .ta-item.hot{background:rgba(var(--cream),.07)}
.nbx.sheet .ta-item .ta-av{background:rgba(var(--cream),.09); border-color:transparent; color:rgba(var(--cream),.8)}
.nbx.sheet .ta-item span{color:rgba(var(--cream),.56)}
.nbx.sheet .ta-new{border-top-color:rgba(var(--cream),.12); color:var(--clay-hi)}
.nbx.sheet .dupe{background:rgba(196,146,58,.15); color:#E3BE7C}
.nbx.sheet .dupe .lnk{color:#E3BE7C}
.nbx.sheet .dupe .anyway input{accent-color:#E3BE7C}

/* the consequence, then the two buttons — the drawer's own footing */
.nbx.sheet .m-foot{border-top-color:rgba(var(--cream),.1); padding:14px 18px calc(16px + env(safe-area-inset-bottom,0px)); flex-wrap:wrap}
.nbx.sheet .consequence{flex:1 1 100%; order:1; margin-bottom:2px; color:rgba(var(--cream),.66)}
.nbx.sheet .consequence b{color:rgb(var(--cream))}
.nbx.sheet .consequence .up{color:var(--clay-hi)}
.nbx.sheet .actions{order:2; flex:1 1 100%; gap:10px}
.nbx.sheet .btn,.nbx.sheet .btn-quiet{flex:1; height:50px; padding:0 18px; border-radius:16px; font-size:15px}
.nbx.sheet .btn{flex:1.4; background:var(--clay); color:#fff}
.nbx.sheet .btn.ok{background:#4E8A5E}
.nbx.sheet .btn-quiet{border:0; background:rgba(var(--cream),.08); color:rgba(var(--cream),.85)}
.nbx.sheet .btn-quiet:hover{background:rgba(var(--cream),.13)}
.nbx.sheet .f2{gap:16px}

/* ---------- the Add-bill redesign: opens on the form, a flexible date, chips, a live status ---------- */
/* the photo drop, now a compact option inside the form rather than a gate in front of it */
.nbx .dropmini{display:flex; align-items:center; gap:12px; width:100%; text-align:left; cursor:pointer;
  border:1.5px dashed #D4C4A8; border-radius:14px; background:transparent; color:var(--walnut);
  padding:12px 16px; margin:2px 0 18px; font-family:var(--sans); font-size:13.5px; transition:border-color .2s, background .2s}
.nbx .dropmini:hover,.nbx .dropmini.over{border-color:var(--walnut); background:#FCFAF3}
.nbx .dropmini .dz-ic{font-size:20px; flex:none}
.nbx .dropmini b{color:var(--ink); font-weight:600}
/* Today / Yesterday quick-picks riding on the date label */
.nbx .flabel .dquick{margin-left:auto; display:flex; gap:12px}
.nbx .flabel .dquick button{background:none; border:0; padding:0; cursor:pointer; font-family:var(--sans);
  font-size:11px; font-weight:600; letter-spacing:0; text-transform:none; color:var(--walnut); text-decoration:underline; text-underline-offset:3px}
.nbx .flabel .dquick button:hover{color:var(--ink)}
/* the date field: input + calendar button + the echo line under it */
.nbx .datewrap{position:relative; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--rule)}
.nbx .datewrap .finput{border-bottom:0; padding-bottom:8px}
.nbx .finput.bad{color:#B4431C}
.nbx .calbtn{flex:none; width:34px; height:34px; display:grid; place-items:center; border:0; border-radius:9px;
  background:transparent; color:var(--soft); cursor:pointer}
.nbx .calbtn:hover,.nbx .calbtn.on{background:var(--cream); color:var(--ink)}
.nbx .decho{min-height:17px; margin-top:6px; font-size:12.5px; line-height:1.35; color:var(--soft)}
.nbx .decho.ok{color:var(--sage)} .nbx .decho.warn{color:#C0603F}
.nbx .frow.miss .finput,.nbx .frow.miss .datewrap,.nbx .frow.miss .amtline{border-bottom-color:#E0987C}
/* the calendar popover */
.nbx .cal{position:absolute; top:calc(100% + 8px); left:0; width:300px; z-index:30; background:var(--paper);
  border:1px solid var(--rule); border-radius:16px; box-shadow:0 24px 54px -26px rgba(42,36,28,.5); padding:14px 14px 10px}
.nbx .cal-top{display:flex; align-items:center; justify-content:space-between; margin-bottom:10px}
.nbx .cal-mo{font-family:var(--serif); font-size:19px} .nbx .cal-mo em{font-style:normal; font-size:13px; color:var(--soft); margin-left:5px}
.nbx .cal-nav button{width:32px; height:32px; border:1px solid var(--rule); border-radius:8px; background:var(--paper); color:var(--ink); cursor:pointer; font-size:15px; line-height:1}
.nbx .cal-nav button+button{margin-left:6px} .nbx .cal-nav button:disabled{color:#CFC4B0; cursor:not-allowed}
.nbx .cal-grid{display:grid; grid-template-columns:repeat(7,1fr); gap:2px}
.nbx .cal-wd{height:24px; display:grid; place-items:center; font-size:10.5px; font-weight:600; color:var(--soft)}
.nbx .cal-day{height:36px; border:0; border-radius:9px; background:transparent; color:var(--ink); cursor:pointer; font:inherit; font-size:13.5px}
.nbx .cal-day:hover:not(:disabled){background:var(--cream)} .nbx .cal-day.blank{visibility:hidden}
.nbx .cal-day:disabled{color:#CFC4B0; cursor:not-allowed}
.nbx .cal-day.today{box-shadow:inset 0 0 0 1.5px var(--terra); font-weight:600}
.nbx .cal-day.sel{background:var(--terra); color:#fff; font-weight:600}
.nbx .cal-foot{padding-top:10px; margin-top:6px; border-top:1px solid var(--rule); text-align:right; font-size:11px; color:var(--soft)}
/* amount: the ₹ and the lakh/crore echo */
.nbx .amtline{display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--rule)}
.nbx .amtline .rs{font-family:var(--mono); font-size:18px; color:var(--soft)}
.nbx .amtline .finput{border-bottom:0}
.nbx .ahint{min-height:17px; margin-top:6px; font-size:12.5px; color:var(--soft)}
/* site chips replace the select */
.nbx .chips{display:flex; flex-wrap:wrap; gap:8px}
.nbx .chips .chip{display:inline-flex; align-items:center; gap:6px; height:38px; padding:0 15px; border-radius:999px;
  border:1px solid var(--rule); background:transparent; color:var(--walnut); cursor:pointer; font-family:var(--sans); font-size:14px; transition:all .18s}
.nbx .chips .chip:hover{border-color:var(--walnut)}
.nbx .chips .chip.on{background:var(--terra); border-color:var(--terra); color:#fff; font-weight:500}
.nbx .chips .chip .ck{font-size:11px}
/* the live status line + the Enter hint on the button */
.nbx .fstatus{font-size:12.5px; color:var(--soft); margin-right:auto; align-self:center}
.nbx .fstatus.ok{color:var(--sage)} .nbx .fstatus.warn{color:#C0603F}
.nbx .btn{display:inline-flex; align-items:center; gap:10px}
.nbx .btn.dim{opacity:.5}
.nbx .btn .kbd{font-family:var(--mono); font-size:10px; padding:2px 6px; border-radius:5px; background:rgba(255,255,255,.18)}

/* the phone drawer re-inks the new bits for night */
.nbx.sheet .dropmini{border-color:rgba(var(--cream),.22); color:rgba(var(--cream),.82)}
.nbx.sheet .dropmini:hover,.nbx.sheet .dropmini.over{border-color:rgba(var(--cream),.45); background:rgba(var(--cream),.06)}
.nbx.sheet .dropmini b{color:rgb(var(--cream))}
.nbx.sheet .flabel .dquick button{color:rgba(var(--cream),.8)} .nbx.sheet .flabel .dquick button:hover{color:rgb(var(--cream))}
.nbx.sheet .datewrap,.nbx.sheet .amtline{border-bottom-color:rgba(var(--cream),.16)}
.nbx.sheet .calbtn{color:rgba(var(--cream),.7)} .nbx.sheet .calbtn:hover,.nbx.sheet .calbtn.on{background:rgba(var(--cream),.1); color:rgb(var(--cream))}
.nbx.sheet .decho{color:rgba(var(--cream),.56)} .nbx.sheet .decho.ok{color:#A9D6B1} .nbx.sheet .decho.warn{color:#EFAE93}
.nbx.sheet .amtline .rs{color:rgba(var(--cream),.6)} .nbx.sheet .ahint{color:rgba(var(--cream),.56)}
.nbx.sheet .cal{background:#1F150E; border-color:rgba(var(--cream),.12); box-shadow:0 24px 54px -22px rgba(0,0,0,.8)}
.nbx.sheet .cal-mo{color:rgb(var(--cream))} .nbx.sheet .cal-mo em{color:rgba(var(--cream),.56)}
.nbx.sheet .cal-nav button{background:rgba(var(--cream),.06); border-color:rgba(var(--cream),.14); color:rgb(var(--cream))}
.nbx.sheet .cal-wd{color:rgba(var(--cream),.5)} .nbx.sheet .cal-day{color:rgb(var(--cream))} .nbx.sheet .cal-day:hover:not(:disabled){background:rgba(var(--cream),.08)}
.nbx.sheet .cal-day:disabled{color:rgba(var(--cream),.3)} .nbx.sheet .cal-foot{color:rgba(var(--cream),.5); border-top-color:rgba(var(--cream),.12)}
.nbx.sheet .chips .chip{border-color:rgba(var(--cream),.24); color:rgba(var(--cream),.85)}
.nbx.sheet .chips .chip:hover{border-color:rgba(var(--cream),.45)}
.nbx.sheet .chips .chip.on{background:var(--clay); border-color:var(--clay); color:#fff}
.nbx.sheet .fstatus{color:rgba(var(--cream),.6)} .nbx.sheet .fstatus.ok{color:#A9D6B1} .nbx.sheet .fstatus.warn{color:#EFAE93}
.nbx.sheet .frow.miss .datewrap,.nbx.sheet .frow.miss .amtline,.nbx.sheet .frow.miss .finput{border-bottom-color:#E0987C}

@media (prefers-reduced-motion:reduce){
  .nbx .modal,.nbx .dupe{animation:none}
  .nbx .rd-doc i{animation:none; opacity:.4; top:16px}
  .nbx .frow.filled .ftick,.nbx .frow.inked .finput{animation:none}
}
`;
