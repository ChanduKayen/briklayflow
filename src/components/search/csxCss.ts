/**
 * Command search — the reference, scoped under `.csx`.
 *
 * The bar itself, the panel and the row rhythm are ported value-for-value. What the reference could
 * only imply is added around it: the bar floats over whatever page you are on (it is summoned, not
 * part of any page's layout), and on a phone the whole thing becomes a sheet, since a phone has no
 * space bar and no room for a page filtering behind a dropdown.
 */
export const CSX_CSS = `
.csx{
  --cream:#FAF7F0; --paper:#FFFDF7; --ink:#2A241C; --walnut:#6E5F4C; --soft:#9A8C77;
  --rule:#E6DECD; --terra:#C0603F; --terra-soft:#F7E9E2; --sage:#6E8260; --sage-soft:#E4EADD;
  --serif:'Playfair Display', Georgia, serif;
  --sans:'DM Sans', -apple-system, sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;
  position:fixed; inset:0; z-index:130; font-family:var(--sans); color:var(--ink);
}
.csx *{margin:0; padding:0; box-sizing:border-box}
.csx .veil{position:fixed; inset:0; background:rgba(42,36,28,.14); backdrop-filter:blur(1.2px);
  animation:csx-veil .3s ease}
@keyframes csx-veil{from{opacity:0}to{opacity:1}}

/* ---------- search bar ---------- */
/* Summoned from a page with no bar of its own — then, and only then, it floats. */
.csx.floating .searchwrap{position:absolute; left:50%; top:11vh; transform:translateX(-50%);
  width:min(640px, calc(100vw - 40px)); z-index:20}
/* Drawn on top of the page's own resting bar, at its exact box. */
.csx.anchored{pointer-events:none}
.csx.anchored .veil,.csx.anchored .searchwrap{pointer-events:auto}
.csx.anchored .searchwrap{position:absolute; z-index:20}
.csx .bar{display:flex; align-items:center; gap:11px; background:var(--paper); border:1px solid var(--walnut);
  border-radius:999px; padding:13px 20px; transform:scale(1.012);
  box-shadow:0 0 0 4px rgba(192,96,63,.08), 0 30px 60px -28px rgba(42,36,28,.4);
  animation:csx-drop .34s cubic-bezier(.2,.9,.3,1.1)}
@keyframes csx-drop{from{opacity:0; transform:translateY(-10px) scale(.99)}to{opacity:1; transform:scale(1.012)}}
.csx .bar .ic{color:var(--soft); font-size:15px; flex:none; line-height:1}
.csx .bar input{flex:1; min-width:0; border:0; outline:0; background:transparent; font-family:var(--sans);
  font-size:15px; color:var(--ink); caret-color:var(--terra)}
.csx .bar input::placeholder{color:#C9BDA6}
.csx .bar .kbd{font-family:var(--mono); font-size:10.5px; color:var(--soft); border:1px solid var(--rule);
  border-radius:6px; padding:2px 8px; flex:none}
.csx .scope{font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase;
  color:var(--terra); background:var(--terra-soft); border-radius:999px; padding:3px 10px; flex:none;
  white-space:nowrap; max-width:40%; overflow:hidden; text-overflow:ellipsis}

/* ---------- panel: only elsewhere + actions ---------- */
.csx .panel{position:absolute; left:0; right:0; top:calc(100% + 10px); background:var(--paper); border:1px solid var(--rule);
  border-radius:18px; box-shadow:0 40px 80px -30px rgba(42,36,28,.45); overflow:hidden; transform-origin:top center;
  animation:csx-panel .3s cubic-bezier(.2,.9,.3,1.2)}
@keyframes csx-panel{from{opacity:0; transform:translateY(-6px) scale(.985)}to{opacity:1; transform:none}}
.csx .plist{max-height:340px; overflow-y:auto; padding:6px 8px 8px}
.csx .sect{font-family:var(--mono); font-size:9.5px; letter-spacing:.22em; text-transform:uppercase; color:var(--soft); padding:12px 14px 6px}
.csx .pgcount{padding:11px 16px 4px; font-size:12.5px; color:var(--terra); font-weight:600}
.csx .pgcount span{color:var(--soft); font-weight:400}
.csx .item{display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:11px; cursor:pointer;
  font-size:14.5px; width:100%; text-align:left; background:none; border:0; font-family:var(--sans); color:var(--ink)}
.csx .item.hot{background:var(--cream)}
.csx .item .iv{width:32px; height:32px; border-radius:9px; background:var(--cream); border:1px solid var(--rule); flex:none;
  display:grid; place-items:center; font-size:14px; color:var(--walnut)}
.csx .item .imid{flex:1; min-width:0}
.csx .item .imid b{display:block; font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.csx .item .imid b mark{background:transparent; color:var(--terra); font-weight:700}
.csx .item .imid span{display:block; font-size:12px; color:var(--soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.csx .item .iright{font-family:var(--mono); font-size:12px; color:var(--walnut); flex:none}
.csx .item .kbd{font-family:var(--mono); font-size:10px; color:var(--soft); border:1px solid var(--rule); border-radius:5px; padding:1px 6px; flex:none}
/* Going somewhere else is a step up and out — say so, quietly. */
.csx .item .go{color:#CFC4B0; font-size:13px; flex:none; transition:color .15s, transform .15s}
.csx .item.hot .go{color:var(--terra); transform:translateX(2px)}
/* Staying put is the obvious move, so it is the only filled mark and the only row with no arrow. */
.csx .item.primary .iv{background:var(--terra); border-color:var(--terra); color:#fff}
.csx .item.primary .imid b{color:var(--terra)}
.csx .pfoot{display:flex; gap:16px; align-items:center; padding:9px 16px; border-top:1px solid var(--rule); font-size:11.5px; color:var(--soft)}
.csx .pfoot .kbd{font-family:var(--mono); font-size:10px; border:1px solid var(--rule); border-radius:5px; padding:1px 6px; margin-right:5px}
.csx .pfoot .tail{margin-left:auto; text-align:right}
.csx .empty{padding:22px 16px; text-align:center; color:var(--soft); font-size:13px}

/* ---------- the phone: no space bar, no room to filter behind a dropdown ---------- */
.csx.sheet .veil{background:rgba(42,36,28,.28)}
.csx.sheet .searchwrap{position:absolute; left:0; right:0; top:0; bottom:0; transform:none; width:auto;
  display:flex; flex-direction:column; background:var(--paper); animation:csx-rise .3s cubic-bezier(.2,.9,.3,1.05)}
@keyframes csx-rise{from{transform:translateY(14px); opacity:0}to{transform:none; opacity:1}}
.csx.sheet .bar{border-radius:0; border:0; border-bottom:1px solid var(--rule); box-shadow:none; transform:none;
  animation:none; padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px; gap:10px; flex:none}
.csx.sheet .bar input{font-size:16.5px}
.csx.sheet .x{width:32px; height:32px; border-radius:50%; border:0; background:var(--cream); color:var(--walnut);
  font-size:14px; flex:none; cursor:pointer}
.csx.sheet .panel{position:static; border:0; border-radius:0; box-shadow:none; animation:none; flex:1 1 auto;
  display:flex; flex-direction:column; min-height:0}
.csx.sheet .plist{max-height:none; flex:1 1 auto; padding:4px 8px 8px; -webkit-overflow-scrolling:touch}
.csx.sheet .item{padding:13px 12px; min-height:56px}
.csx.sheet .pfoot{padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px)); flex:none}

/* ---------- the resting bar, sitting in the page where its search always sat ---------- */
.csx-rest{
  --cream:#FAF7F0; --paper:#FFFDF7; --ink:#2A241C; --walnut:#6E5F4C; --soft:#9A8C77;
  --rule:#E6DECD; --terra:#C0603F;
  --sans:'DM Sans', -apple-system, sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;
  width:100%; max-width:640px; font-family:var(--sans); color:var(--ink)
}
.csx-rest *{margin:0; padding:0; box-sizing:border-box}
.csx-rest .bar{display:flex; align-items:center; gap:11px; background:var(--paper); border:1px solid var(--rule);
  border-radius:999px; padding:13px 20px; cursor:text;
  transition:box-shadow .35s cubic-bezier(.2,.8,.2,1), border-color .3s}
.csx-rest .bar:hover{border-color:var(--walnut)}
.csx-rest .ic{color:var(--soft); font-size:15px; flex:none; line-height:1}
.csx-rest input{flex:1; min-width:0; border:0; outline:0; background:transparent; font-family:var(--sans);
  font-size:15px; color:var(--ink); caret-color:var(--terra)}
.csx-rest input::placeholder{color:#C9BDA6}
.csx-rest .kbd{font-family:var(--mono); font-size:10.5px; color:var(--soft); border:1px solid var(--rule);
  border-radius:6px; padding:2px 8px; flex:none}
.csx-rest .clr{border:0; background:none; color:var(--soft); font-size:12px; cursor:pointer; flex:none;
  width:20px; height:20px; border-radius:50%}
.csx-rest .clr:hover{background:var(--cream); color:var(--ink)}
@media (max-width:760px){
  .csx-rest .bar{padding:10px 14px}
  .csx-rest input{font-size:16px}
  .csx-rest .kbd{display:none}
}

@media (prefers-reduced-motion:reduce){
  .csx .bar,.csx .panel,.csx .veil,.csx.sheet .searchwrap{animation:none}
}
`;

/**
 * Injected globally (not under `.csx`) so the row the keyboard is on lights up ON THE PAGE — the
 * whole point of the design is that the page itself is the local result list, so the highlight has
 * to live out there, not in a panel.
 */
export const CSX_ROW_CSS = `
[data-search-hot]{background:rgba(192,96,63,.07)!important; box-shadow:inset 3px 0 0 #C0603F; border-radius:6px}
`;
