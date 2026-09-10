/**
 * The phone bills register's stylesheet — the briklaybillsmobile reference, verbatim, with every
 * selector scoped under `.blm` so it cannot touch the rest of the app. Rule order, and so the
 * cascade, is exactly the reference's.
 *
 * Two adaptations, neither visual: `:root` and `body` fold into `.blm` (the page is a div here,
 * not a document), and the row-entry keyframe is namespaced so it cannot collide with another
 * sheet's. The overlays already sit above the app's bottom chrome at the reference's own
 * z-indexes, so those are untouched.
 *
 * After the reference come the rules it had no need for: the pay sheet. In the mock, tapping a
 * bill opened a viewer with one Pay button that only toasted. Here a tap opens the bill's own
 * page, and the SWIPE opens this — the two ways money actually meets a bill in Briklay: record a
 * payment now, or point one already in the ledger at it. Written in the reference's own language
 * so the sheet reads as part of the same page.
 */
export const BLM_CSS = `
.blm{--bg:#FAF5EE; --card:#FFFFFF; --ink:#221C14; --choc:#2E2417;
  --walnut:#6E5F4C; --soft:#9A8C77; --faint:#C9BDA6; --rule:#EEE5D8;
  --clay:#C75B2B; --sage:#6E8260;
  --serif:'Playfair Display', Georgia, serif;
  --sans:'DM Sans', -apple-system, sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;}
.blm *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.blm{background:var(--bg); color:var(--ink); font-family:var(--sans); max-width:430px; margin:0 auto;
  min-height:100dvh; padding:0 16px 110px; touch-action:manipulation; user-select:none; -webkit-user-select:none}
/* ---------- large title, collapsing ---------- */
.blm .small{position:fixed; top:0; left:0; right:0; z-index:60; max-width:430px; margin:0 auto;
  background:rgba(250,245,238,.92); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
  text-align:center; padding:13px 18px; border-bottom:1px solid var(--rule);
  transform:translateY(-100%); transition:transform .28s cubic-bezier(.2,.85,.25,1)}
.blm .small b{font-family:var(--serif); font-size:16px; font-weight:600}
.blm .small span{font-family:var(--mono); font-size:12.5px; color:var(--walnut); margin-left:8px}
.blm .small.show{transform:none}
.blm .big{padding:26px 2px 0}
.blm .big h1{font-family:var(--serif); font-size:32px; font-weight:600; letter-spacing:-.01em}
.blm .big .line{margin-top:6px; font-size:14px; color:var(--soft)}
.blm .big .line b{font-family:var(--mono); font-size:15px; color:var(--ink); font-weight:500}
/* ---------- search ---------- */
.blm .search{display:flex; align-items:center; gap:9px; background:rgba(34,28,20,.05); border-radius:12px;
  padding:11px 13px; margin:16px 0 12px; color:var(--faint)}
.blm .search input{flex:1; border:0; outline:0; background:none; font-family:var(--sans); font-size:16px;
  caret-color:var(--clay); color:var(--ink); user-select:text; -webkit-user-select:text}
.blm .search input::placeholder{color:var(--faint)}
/* ---------- one control ---------- */
.blm .seg{display:flex; background:rgba(34,28,20,.05); border-radius:12px; padding:3px; position:relative; margin-bottom:6px}
.blm .seg .thumb{position:absolute; top:3px; bottom:3px; border-radius:10px; background:var(--card);
  box-shadow:0 1px 5px -2px rgba(34,28,20,.25); transition:left .3s cubic-bezier(.2,.85,.25,1), width .3s cubic-bezier(.2,.85,.25,1)}
.blm .seg button{flex:1; border:0; background:none; padding:8px 0; font-family:var(--sans); font-size:13px; font-weight:600;
  color:var(--soft); cursor:pointer; position:relative; z-index:1; transition:color .25s}
.blm .seg button.on{color:var(--ink)}
/* ---------- the list ---------- */
.blm .cap{font-family:var(--mono); font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:var(--faint);
  margin:18px 4px 8px}
.blm .slot{position:relative; border-radius:16px; margin-bottom:8px; overflow:hidden}
.blm .under{position:absolute; inset:0; background:var(--sage); color:#FFFDF7; display:flex; align-items:center;
  padding-left:20px; font-weight:700; font-size:13.5px; gap:8px; opacity:0}
.blm .row{position:relative; display:flex; align-items:center; gap:13px; background:var(--card); border-radius:16px;
  padding:12px 15px 12px 12px; cursor:pointer; transition:transform .3s cubic-bezier(.2,.85,.25,1);
  animation:blm-rowin .35s cubic-bezier(.2,.85,.25,1) both}
@keyframes blm-rowin{0%{opacity:0; transform:translateY(8px)}100%{opacity:1; transform:none}}
.blm .row:active{background:#FBF8F2}
.blm .th{width:44px; height:56px; border-radius:8px; flex:none; position:relative; overflow:hidden;
  background:linear-gradient(150deg, #F3ECDD, #E7DCC6)}
.blm .th::after{content:''; position:absolute; left:18%; right:18%; top:20%; height:34%;
  background:repeating-linear-gradient(180deg, rgba(110,95,76,.22) 0 1.5px, transparent 1.5px 8px)}
.blm .th.multi::before{content:attr(data-n); position:absolute; right:3px; bottom:3px; z-index:1;
  font-family:var(--mono); font-size:8.5px; background:rgba(34,28,20,.75); color:#FFF7EF; border-radius:99px; padding:1px 5px}
.blm .th.none{background:none; border:1.5px dashed #DCD1BD; display:grid; place-items:center}
.blm .th.none::after{display:none}
.blm .th.none svg{width:16px; height:16px; stroke:#C9BDA6; fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round}
.blm .bm{flex:1; min-width:0}
.blm .bm b{display:block; font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.blm .bm span{display:block; font-size:12px; color:var(--soft); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.blm .br{flex:none; text-align:right}
.blm .br b{display:block; font-family:var(--mono); font-size:15px; font-weight:500}
.blm .br span{display:block; font-size:11px; margin-top:3px; font-weight:600}
.blm .br .due{color:var(--clay)}
.blm .br .part{color:var(--walnut)}
.blm .row.settled .bm b{font-weight:500}
.blm .row.settled .br b{color:var(--soft); font-weight:400}
.blm .row.settled .br span{color:var(--faint); font-weight:400}
.blm .nores{text-align:center; color:var(--soft); font-size:13.5px; padding:48px 0}
/* ---------- bill sheet (tap) ---------- */
.blm #vshade{position:fixed; inset:0; background:rgba(34,28,20,.5); backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px);
  opacity:0; pointer-events:none; transition:opacity .3s; z-index:90}
.blm #vshade.show{opacity:1; pointer-events:auto}
.blm .sheet{position:fixed; left:0; right:0; bottom:0; z-index:95; max-width:430px; margin:0 auto;
  background:var(--bg); border-radius:22px 22px 0 0; padding:10px 20px calc(20px + env(safe-area-inset-bottom));
  transform:translateY(105%); transition:transform .42s cubic-bezier(.2,.85,.25,1)}
.blm .sheet.show{transform:none}
.blm .grab{width:38px; height:4px; border-radius:99px; background:#D8CDBB; margin:2px auto 16px}
.blm .sv-scan{height:180px; border-radius:14px; background:linear-gradient(150deg, #F3ECDD, #E7DCC6); position:relative; overflow:hidden}
.blm .sv-scan::after{content:''; position:absolute; left:14%; right:14%; top:16%; height:40%;
  background:repeating-linear-gradient(180deg, rgba(110,95,76,.2) 0 2px, transparent 2px 11px)}
.blm .sv-scan.none{background:none; border:1.5px dashed #DCD1BD; display:grid; place-items:center; color:var(--faint); font-size:13px}
.blm .sv-vendor{font-family:var(--serif); font-size:20px; font-weight:600; margin-top:16px}
.blm .sv-meta{font-size:13px; color:var(--soft); margin-top:4px}
.blm .sv-amt{display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--rule);
  margin-top:16px; padding-top:13px}
.blm .sv-amt span{font-size:13px; color:var(--soft)}
.blm .sv-amt b{font-family:var(--mono); font-size:22px; font-weight:500}
.blm .sv-paid{display:flex; justify-content:space-between; font-size:12px; margin-top:7px; color:var(--soft)}
.blm .sv-paid b{color:var(--sage); font-weight:600}
.blm .sv-pay{width:100%; margin-top:18px; border:0; background:var(--clay); color:#FFF7EF; border-radius:999px;
  padding:15px 0; font-family:var(--sans); font-weight:700; font-size:15px; cursor:pointer; transition:background .3s}
.blm .sv-pay.sage{background:var(--sage)}
.blm .sv-pay.ghosted{background:rgba(34,28,20,.06); color:var(--walnut)}
.blm #toast{position:fixed; left:50%; bottom:26px; transform:translate(-50%,16px); background:var(--ink); color:#FFF7EF;
  font-size:13px; border-radius:999px; padding:11px 18px; opacity:0; transition:all .35s cubic-bezier(.2,.9,.3,1.2); z-index:99; white-space:nowrap}
.blm #toast.show{opacity:1; transform:translate(-50%,0)}
/* ── the pay sheet ─────────────────────────────────────────────────────────── */
.blm .pv-h{display:flex; align-items:baseline; justify-content:space-between; gap:12px}
.blm .pv-h b{font-family:var(--serif); font-size:20px; font-weight:600; min-width:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.blm .pv-h span{font-family:var(--mono); font-size:12px; color:var(--soft); flex:none}
.blm .pv-meta{font-size:12.5px; color:var(--soft); margin-top:3px}
.blm .pv-due{display:flex; justify-content:space-between; align-items:baseline;
  border-top:1px solid var(--rule); margin-top:14px; padding-top:12px}
.blm .pv-due span{font-size:13px; color:var(--soft)}
.blm .pv-due b{font-family:var(--mono); font-size:24px; font-weight:500}
.blm .pv-paid{display:flex; justify-content:space-between; font-size:12px; margin-top:6px; color:var(--soft)}
.blm .pv-paid b{color:var(--sage); font-weight:600}

.blm .pv-seg{margin:16px 0 4px}
.blm .pv-lab{font-family:var(--mono); font-size:10px; letter-spacing:.18em; text-transform:uppercase;
  color:var(--faint); margin:14px 2px 7px}

/* the amount, typed the way the amount on a bill is read — big, mono, in the paper's own weight */
.blm .pv-amt{display:flex; align-items:center; gap:8px; background:rgba(34,28,20,.05);
  border:1px solid transparent; border-radius:13px; padding:12px 14px; transition:border-color .18s}
.blm .pv-amt:focus-within{border-color:var(--clay)}
.blm .pv-amt i{font-family:var(--mono); font-size:19px; color:var(--soft); font-style:normal}
.blm .pv-amt input{flex:1; min-width:0; border:0; outline:0; background:none; font-family:var(--mono);
  font-size:22px; font-weight:500; color:var(--ink); caret-color:var(--clay);
  user-select:text; -webkit-user-select:text}
.blm .pv-amt button{border:0; background:none; font-family:var(--sans); font-size:12px; font-weight:700;
  color:var(--clay); padding:4px 2px; cursor:pointer}

.blm .pv-row{display:flex; gap:8px; margin-top:9px}
.blm .pv-date{flex:1; background:rgba(34,28,20,.05); border:0; border-radius:12px; padding:11px 13px;
  font-family:var(--mono); font-size:14px; color:var(--ink); outline:0;
  user-select:text; -webkit-user-select:text}
.blm .pv-modes{display:flex; gap:6px; margin-top:9px}
.blm .pv-modes button{flex:1; border:1px solid var(--rule); background:var(--card); border-radius:11px;
  padding:9px 0; font-family:var(--sans); font-size:12.5px; font-weight:600; color:var(--walnut);
  cursor:pointer; transition:all .18s}
.blm .pv-modes button.on{background:var(--ink); border-color:var(--ink); color:#FFF7EF}
.blm .pv-modes button:active{transform:scale(.96)}

.blm .pv-go{width:100%; margin-top:16px; border:0; background:var(--clay); color:#FFF7EF; border-radius:999px;
  padding:15px 0; font-family:var(--sans); font-weight:700; font-size:15px; cursor:pointer;
  transition:background .3s, transform .12s}
.blm .pv-go:active{transform:scale(.985)}
.blm .pv-go.sage{background:var(--sage)}
.blm .pv-go[disabled]{background:rgba(34,28,20,.08); color:var(--faint); cursor:default}

/* a payment already on the books — the closest amount sits at the top */
.blm .lp{display:flex; align-items:center; gap:12px; background:var(--card); border-radius:14px;
  padding:12px 14px; margin-bottom:7px; cursor:pointer; transition:transform .12s}
.blm .lp:active{transform:scale(.985); background:#FBF8F2}
.blm .lp .lm{flex:1; min-width:0}
.blm .lp .lm b{display:block; font-family:var(--mono); font-size:15px; font-weight:500}
.blm .lp .lm span{display:block; font-size:11.5px; color:var(--soft); margin-top:3px}
.blm .lp .lt{flex:none; font-size:11px; font-weight:700; color:var(--sage)}
.blm .lp.best{box-shadow:0 0 0 1.5px var(--sage) inset}
.blm .lp-none{text-align:center; color:var(--soft); font-size:13px; padding:26px 0 10px}
.blm .lp-err{font-size:12.5px; color:var(--clay); margin-top:10px}

/* ── hosting the reference inside the app ─────────────────────────────────── */
/* The portal that carries the fixed overlays is a page-level element, not the page: it must paint
   nothing and take no space of its own. */
.blm.blm-portal{background:none; min-height:0; max-width:none; margin:0; padding:0; height:0}
/* The app's <main> reserves its own clearance for the bottom tab bar under this page. That room
   sits below the .blm box, so paint the page's ground behind it — otherwise a seam of a different
   colour shows under the last row. */
.blm-page{background:#FAF5EE; min-height:100vh}
`;
