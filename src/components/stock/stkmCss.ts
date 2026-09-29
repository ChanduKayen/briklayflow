/**
 * Stock on a phone, scoped under .stkm.
 *
 * The desktop page is a table: five columns, a hover-select, a side drawer. None of that survives
 * contact with a phone held in one hand on a site. The same three beats are kept, in the same order
 * the desktop keeps them — the fact (how much is here), the story (arrived → used → left), the
 * action (say "used 10") — but each material becomes a card, the site filter becomes a strip you
 * thumb through, and the ledger becomes a sheet.
 *
 * The values are the desktop page's own (the .stk2 palette, the night binding the app's other phone
 * pages wear). Keyframes are namespaced so they cannot collide with another page's.
 */
export const STKM_CSS = `.stkm{
  --ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;
  --night:#170E08;--night-bg:linear-gradient(180deg,#191009,#140D07);--night-edge:#302014;--cream:250,248,243;
  --clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;--sage-hi:#8FC79A;--sage-wash:#E7F0E6;--amber:#8A6A2E;--amber-wash:#F6EEDC;
  --serif:'Playfair Display',Georgia,'Times New Roman',serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,.8,.24,1);--nav-h:64px;--nav-gap:12px;
}
.stkm,.stkm *{box-sizing:border-box}
.stkm{background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;
  padding-bottom:calc(var(--nav-h) + 110px + env(safe-area-inset-bottom))}
.stkm button,.stkm input{font:inherit;color:inherit}
.stkm button{cursor:pointer}
.stkm :focus-visible{outline:2px solid var(--clay-hi);outline-offset:3px;border-radius:10px}

/* ── the band: what is here, and where ─────────────────────────────────────── */
.stkm .band{background:var(--night-bg);color:rgb(var(--cream));padding:calc(14px + env(safe-area-inset-top)) 0 16px;box-shadow:inset 0 -1px 0 var(--night-edge)}
.stkm .bin{padding:0 18px}
.stkm .brow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.stkm .band h1{margin:0;font-family:var(--serif);font-weight:600;font-size:27px;letter-spacing:-.01em;line-height:1.1}
.stkm .new{flex:none;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border:0;border-radius:18px;background:rgba(var(--cream),.1);color:rgb(var(--cream));font-size:13.5px;font-weight:600}
.stkm .new svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.stkm .big{display:flex;align-items:baseline;gap:8px;margin-top:10px;font-family:var(--mono);font-size:30px;letter-spacing:-.01em;line-height:1}
.stkm .big small{font-family:var(--sans);font-size:13px;color:rgba(var(--cream),.55);letter-spacing:0}
.stkm .facts{margin-top:7px;font-size:13px;color:rgba(var(--cream),.6)}
.stkm .facts b{font-weight:600;color:rgba(var(--cream),.9)}
.stkm .facts b.low{color:#F0A58A}
.stkm .facts i{font-style:normal;margin:0 7px;opacity:.4}

/* the site strip — the phone's Site filter, thumbed rather than dropped down */
.stkm .sites{display:flex;gap:7px;margin-top:14px;padding:0 18px 2px;overflow-x:auto;scrollbar-width:none}
.stkm .sites::-webkit-scrollbar{display:none}
.stkm .sites button{flex:none;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;border:1px solid rgba(var(--cream),.16);border-radius:17px;background:none;
  color:rgba(var(--cream),.72);font-size:13.5px;font-weight:600;white-space:nowrap;transition:background-color .2s,color .2s,border-color .2s}
.stkm .sites button em{font-style:normal;font-family:var(--mono);font-size:11.5px;opacity:.6}
.stkm .sites button.on{background:rgb(var(--cream));border-color:rgb(var(--cream));color:var(--night)}
.stkm .sites button.on em{opacity:.55}

/* ── what needs doing ──────────────────────────────────────────────────────── */
.stkm .needs{margin:14px 16px 0;border-radius:16px;background:var(--wash);overflow:hidden}
.stkm .needs .ln{display:flex;align-items:center;gap:10px;padding:12px 14px;font-size:13.5px;color:var(--ink-2);border-top:1px solid rgba(43,33,26,.06)}
.stkm .needs .ln:first-child{border-top:0}
.stkm .needs .ic{flex:none;width:26px;height:26px;border-radius:13px;display:grid;place-items:center}
.stkm .needs .ic svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.stkm .needs .ic.clay{background:var(--clay-wash);color:var(--clay)}
.stkm .needs .ic.amber{background:var(--amber-wash);color:var(--amber)}
.stkm .needs .tx{flex:1;min-width:0}
.stkm .needs b{font-weight:600;color:var(--ink)}
.stkm .needs a{flex:none;color:var(--clay);font-weight:600;font-size:13px;text-decoration:underline;text-underline-offset:3px}

/* ── search + categories ───────────────────────────────────────────────────── */
.stkm .find{display:flex;align-items:center;gap:10px;margin:14px 16px 0;height:44px;padding:0 15px;border:1px solid var(--line-2);border-radius:22px;background:var(--paper);color:var(--ink-3)}
.stkm .find svg{flex:none;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.stkm .find input{flex:1;min-width:0;border:0;background:none;outline:none;font-size:15px;color:var(--ink)}
.stkm .cats{display:flex;gap:7px;margin-top:10px;padding:0 16px 2px;overflow-x:auto;scrollbar-width:none}
.stkm .cats::-webkit-scrollbar{display:none}
.stkm .cats button{flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border:1px solid var(--line-2);border-radius:17px;background:var(--paper);
  font-size:13.5px;font-weight:500;color:var(--ink);white-space:nowrap;transition:background-color .2s,border-color .2s,color .2s}
.stkm .cats button em{font-style:normal;font-family:var(--mono);font-size:11.5px;color:var(--ink-3)}
.stkm .cats button.on{background:var(--clay-wash);border-color:var(--clay-wash);color:var(--clay)}
.stkm .cats button.on em{color:var(--clay)}

/* ── the materials ─────────────────────────────────────────────────────────── */
.stkm .grp{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:22px 20px 8px}
.stkm .grp h3{margin:0;font-family:var(--serif);font-weight:500;font-size:17px}
.stkm .grp span{font-size:12.5px;color:var(--ink-3)}
.stkm .grp span b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.stkm .card{margin:0 16px;background:var(--paper);border:1px solid var(--line);border-radius:20px;overflow:hidden}
.stkm .it{width:100%;border:0;border-top:1px solid var(--rule);background:none;text-align:left;padding:13px 14px 12px;display:block;transition:background-color .2s}
.stkm .it:first-child{border-top:0}
.stkm .it:active{background:#F9F5EF}
.stkm .it.low{box-shadow:inset 3px 0 0 var(--clay)}
.stkm .it.flash{animation:stkm_flash 1.4s ease-out}
@keyframes stkm_flash{0%,25%{background:var(--sage-wash)}100%{background:transparent}}
.stkm .top{display:flex;align-items:flex-start;gap:11px}
.stkm .av{flex:none;width:34px;height:34px;border-radius:17px;background:var(--wash);color:var(--ink-2);display:grid;place-items:center;font-family:var(--mono);font-size:11.5px;font-weight:500}
.stkm .nm{flex:1;min-width:0}
/* the name is the block; everything inside the line under it stays INLINE, so the line truncates as
   one line rather than breaking wherever a <b> happens to fall */
.stkm .nm > b{display:block;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stkm .nm > span{display:block;margin-top:2px;font-size:12.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stkm .nm > span b{display:inline;font-size:12.5px;font-weight:600;color:var(--ink-2)}
.stkm .nm > span b.lo{color:var(--clay)}
.stkm .nm > span b.ok{color:var(--sage)}
.stkm .qty{flex:none;text-align:right;line-height:1.05}
.stkm .qty b{display:block;font-family:var(--mono);font-size:21px;font-weight:500}
.stkm .qty b.low{color:var(--clay)}
.stkm .qty span{display:block;margin-top:2px;font-size:11.5px;color:var(--ink-3)}
/* arrived → used → left, as one bar */
.stkm .bar{display:flex;gap:2px;height:5px;margin:11px 0 6px 45px;border-radius:3px;overflow:hidden;background:var(--rule)}
.stkm .bar i{display:block;height:100%}
.stkm .bar i.u{background:var(--clay-hi)}
.stkm .bar i.l{background:var(--sage-hi)}
.stkm .since{margin-left:45px;font-size:11.5px;color:var(--ink-3)}
.stkm .since b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
/* the action, on the row */
.stkm .acts{display:flex;gap:8px;margin:11px 0 0 45px}
.stkm .pill{flex:1;height:38px;border:1px solid var(--line-2);border-radius:19px;background:var(--paper);font-size:13.5px;font-weight:600;color:var(--ink-2)}
.stkm .pill.out:active{background:var(--clay-wash);border-color:var(--clay-wash);color:var(--clay)}
.stkm .pill.in:active{background:var(--sage-wash);border-color:var(--sage-wash);color:var(--sage)}
.stkm .ent{display:flex;align-items:center;gap:7px;margin:11px 0 0 45px;height:42px;padding:0 6px 0 12px;border-radius:21px;background:var(--wash)}
.stkm .ent.out{background:var(--clay-wash)}
.stkm .ent.in{background:var(--sage-wash)}
.stkm .ent .k{flex:none;font-size:12.5px;font-weight:700;letter-spacing:.01em}
.stkm .ent.out .k{color:var(--clay)}
.stkm .ent.in .k{color:var(--sage)}
.stkm .ent .stp{flex:none;width:30px;height:30px;border:0;border-radius:15px;background:rgba(255,255,255,.75);font-size:17px;line-height:1;color:var(--ink-2);display:grid;place-items:center}
.stkm .ent input{flex:1;min-width:0;height:30px;border:0;border-radius:8px;background:rgba(255,255,255,.75);text-align:center;font-family:var(--mono);font-size:15px;color:var(--ink);outline:none}
.stkm .ent .u{flex:none;font-size:12px;color:var(--ink-3)}
.stkm .ent .ok{flex:none;width:32px;height:32px;border:0;border-radius:16px;background:var(--line-2);color:#fff;display:grid;place-items:center;transition:background-color .2s}
.stkm .ent .ok.ready{background:var(--sage)}
.stkm .ent .ok svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.stkm .ent .x{flex:none;width:30px;height:30px;border:0;border-radius:15px;background:none;color:var(--ink-3);display:grid;place-items:center}
.stkm .ent .x svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.stkm .empty{margin:26px 16px;padding:26px 18px;border-radius:20px;border:1px dashed var(--line-2);text-align:center;font-size:14px;color:var(--ink-3)}

/* ── the material's own sheet ──────────────────────────────────────────────── */
.stkm-scrim{position:fixed;inset:0;z-index:57;background:rgba(21,16,12,.44);opacity:0;pointer-events:none;transition:opacity .3s;backdrop-filter:saturate(.8) blur(1.5px)}
.stkm-scrim.on{opacity:1;pointer-events:auto}
.stkm-sheet{position:fixed;left:var(--nav-gap,12px);right:var(--nav-gap,12px);bottom:calc(var(--nav-gap,12px) + env(safe-area-inset-bottom));z-index:58;max-width:406px;margin:0 auto;max-height:86dvh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;
  border-radius:30px;background:linear-gradient(180deg,#191009,#140D07);color:rgb(250,248,243);box-shadow:0 24px 50px -16px rgba(20,13,7,.72),0 0 0 1px rgba(245,240,231,.10),inset 0 1px 0 rgba(245,240,231,.34);
  padding:8px 18px calc(18px + 64px);transform:translateY(24px) scale(.97);opacity:0;visibility:hidden;transition:transform .42s cubic-bezier(.22,.8,.24,1),opacity .26s,visibility 0s .42s;
  font-family:'DM Sans',system-ui,-apple-system,sans-serif}
.stkm-sheet::-webkit-scrollbar{display:none}
.stkm-sheet.on{transform:none;opacity:1;visibility:visible;transition:transform .46s cubic-bezier(.22,.8,.24,1),opacity .28s,visibility 0s}
.stkm-sheet .grab{display:grid;place-items:center;height:22px;margin:-8px -18px 4px;touch-action:none}
.stkm-sheet .grab i{width:42px;height:5px;border-radius:3px;background:rgba(250,248,243,.26)}
.stkm-sheet .sh{display:flex;align-items:flex-start;gap:10px;margin:4px 0 2px}
.stkm-sheet .sh .t{flex:1;min-width:0}
.stkm-sheet .cat{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:rgba(250,248,243,.45)}
.stkm-sheet h2{margin:3px 0 0;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:22px;line-height:1.2;overflow-wrap:anywhere}
.stkm-sheet .at2{margin-top:3px;font-size:12.5px;color:rgba(250,248,243,.55)}
.stkm-sheet .x{flex:none;width:36px;height:36px;margin:-2px -6px 0 0;border:0;border-radius:18px;background:none;color:rgba(250,248,243,.7);display:grid;place-items:center}
.stkm-sheet .x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.stkm-sheet .fig{display:flex;align-items:baseline;gap:8px;margin:14px 0 2px;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:38px;line-height:1}
.stkm-sheet .fig.low{color:#F0A58A}
.stkm-sheet .fig small{font-family:'DM Sans',sans-serif;font-weight:400;font-size:13.5px;color:rgba(250,248,243,.55)}
.stkm-sheet .lasts{font-size:13px;color:rgba(250,248,243,.6)}
.stkm-sheet .lasts b{display:block;font-size:14px;font-weight:600;color:rgb(250,248,243)}
.stkm-sheet .lasts.warn b{color:#F0A58A}
.stkm-sheet .lasts.ok b{color:#A9D6B1}
.stkm-sheet .sacts{display:flex;gap:8px;margin:16px 0 0}
.stkm-sheet .sacts button{flex:1;height:46px;border:0;border-radius:23px;background:rgba(250,248,243,.09);color:rgb(250,248,243);font-size:14.5px;font-weight:600}
.stkm-sheet .sacts .out{background:rgba(212,99,62,.18);color:#F0A58A}
.stkm-sheet .sacts .in{background:rgba(143,199,154,.16);color:#A9D6B1}
.stkm-sheet .sfacts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:18px 0 0}
.stkm-sheet .sfact{padding:11px 12px;border-radius:14px;background:rgba(250,248,243,.06)}
.stkm-sheet .sfact span{display:block;font-size:11px;color:rgba(250,248,243,.45)}
.stkm-sheet .sfact b{display:block;margin-top:3px;font-family:'DM Mono',ui-monospace,monospace;font-size:14px;font-weight:500}
.stkm-sheet .alert{display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:12px 14px;border-radius:14px;background:rgba(250,248,243,.06);font-size:13px;color:rgba(250,248,243,.7)}
.stkm-sheet .alert input{width:70px;height:34px;border:0;border-radius:9px;background:rgba(250,248,243,.1);text-align:center;font-family:'DM Mono',monospace;font-size:14px;color:rgb(250,248,243);outline:none}
.stkm-sheet h4{margin:20px 0 2px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:rgba(250,248,243,.45)}
.stkm-sheet .fl{display:flex;gap:6px;margin:10px 0 4px}
.stkm-sheet .fl button{height:30px;padding:0 12px;border:0;border-radius:15px;background:rgba(250,248,243,.07);color:rgba(250,248,243,.65);font-size:12.5px;font-weight:600}
.stkm-sheet .fl button.on{background:rgb(250,248,243);color:#140D07}
.stkm-sheet .day{margin:14px 0 6px;font-size:11.5px;color:rgba(250,248,243,.4)}
.stkm-sheet .e{display:flex;align-items:center;gap:10px;min-height:46px;box-shadow:0 1px 0 0 rgba(250,248,243,.07)}
.stkm-sheet .e .w{flex:1;min-width:0}
.stkm-sheet .e .w b{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600}
.stkm-sheet .e .w b i{width:7px;height:7px;border-radius:4px;background:rgba(250,248,243,.3)}
.stkm-sheet .e.in .w b i{background:#A9D6B1}
.stkm-sheet .e.out .w b i{background:#F0A58A}
.stkm-sheet .e .w small{display:block;font-size:11.5px;color:rgba(250,248,243,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stkm-sheet .e .q{flex:none;font-family:'DM Mono',monospace;font-size:14.5px}
.stkm-sheet .e .bal{flex:none;width:58px;text-align:right;font-family:'DM Mono',monospace;font-size:12.5px;color:rgba(250,248,243,.45)}
.stkm-sheet .none{padding:16px 0;font-size:13px;color:rgba(250,248,243,.45)}
@media (prefers-reduced-motion:reduce){.stkm *,.stkm-sheet{transition:none!important;animation:none!important}}
`;
