/**
 * Onboarding — a port of the reference design, scoped to `.obx`.
 *
 * The desktop half is the reference verbatim: the same tokens, type ramp, transitions and
 * blueprint. The `@media (max-width:760px)` block below is the phone, which the reference does
 * not draw — it only hides the elevation under 900px. See obxLamp.ts for what replaces the
 * cursor there.
 */
export const OBX_CSS = `
.obx{
  --cream:#FAF7F0; --paper:#FFFDF7; --ink:#2A241C; --walnut:#6E5F4C; --soft:#9A8C77;
  --rule:#E6DECD; --terra:#C0603F; --terra-soft:#F3E0D6; --sage:#6E8260; --sage-soft:#E4EADD;
  --wa-dark:#075E54; --wa-green:#25D366; --wa-bubble:#DCF8C6; --wa-bg:#EFE7DC; --wa-tick:#53BDEB;
  --serif:'Playfair Display', Georgia, 'Times New Roman', serif;
  --sans:'DM Sans', -apple-system, 'Segoe UI', sans-serif;
  --mono:'DM Mono', 'SF Mono', Consolas, monospace;
  position:fixed; inset:0; z-index:100; background:var(--cream); color:var(--ink);
  font-family:var(--sans); overflow:hidden;
}
.obx *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}

.obx .orb{position:fixed; width:760px; height:760px; border-radius:50%; left:0; top:0; pointer-events:none; z-index:0;
  background:radial-gradient(closest-side, rgba(192,96,63,.13), rgba(210,168,92,.09) 45%, transparent 72%);}
.obx.finale .orb{background:radial-gradient(closest-side, rgba(192,96,63,.20), rgba(210,168,92,.13) 45%, transparent 75%)}

.obx .blueprint{position:fixed; inset:0; z-index:1; pointer-events:none}
.obx .blueprint svg{width:100%;height:100%;display:block}
.obx .blueprint .bp{stroke:var(--walnut); fill:none; stroke-width:1; opacity:.5}
.obx .blueprint .bp-fine{stroke:var(--walnut); fill:none; stroke-width:.6; opacity:.35}
.obx .blueprint text{fill:var(--walnut); opacity:.55; font-family:var(--mono); letter-spacing:.14em}

.obx .stage{position:fixed; inset:0; z-index:2}
.obx .step{position:absolute; inset:0; display:grid; place-items:center; padding:48px; overflow-y:auto;
  opacity:0; visibility:hidden; transform:scale(.93) translateY(14px); filter:blur(3px);
  transition:opacity .75s cubic-bezier(.22,.75,.25,1), transform .75s cubic-bezier(.22,.75,.25,1), filter .75s ease, visibility 0s .75s;}
.obx .step.active{opacity:1; visibility:visible; transform:none; filter:none;
  transition:opacity .8s cubic-bezier(.22,.75,.25,1) .28s, transform .8s cubic-bezier(.22,.75,.25,1) .28s, filter .8s ease .28s;}
.obx .step.leaving{opacity:0; visibility:hidden; transform:scale(1.12); filter:blur(8px);
  transition:opacity .55s ease, transform .55s cubic-bezier(.5,0,.8,.4), filter .55s ease, visibility 0s .55s;}
.obx .inner{width:min(920px,100%); text-align:center}

.obx .hello{font-family:var(--mono); font-size:12px; letter-spacing:.32em; text-transform:uppercase; color:var(--soft); margin-bottom:26px}
.obx h1{font-family:var(--serif); font-weight:500; font-size:clamp(36px,4.6vw,58px); line-height:1.08; letter-spacing:-.01em; margin-bottom:18px}
.obx h1 em{font-style:italic; font-weight:400}
.obx .lede{font-size:17px; color:var(--walnut); line-height:1.6; max-width:54ch; margin:0 auto 40px}

.obx .field{max-width:560px; margin:0 auto 10px; text-align:left}
.obx .flabel{font-family:var(--mono); font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--soft); display:block; margin-bottom:10px}
.obx .ledger-input{width:100%; background:transparent; border:0; outline:0;
  font-family:var(--serif); font-size:clamp(26px,3vw,36px); color:var(--ink);
  padding:6px 2px 14px; border-bottom:1px solid var(--rule); box-shadow:0 3px 0 -2px var(--rule);
  transition:border-color .3s, box-shadow .3s; caret-color:var(--terra);}
.obx .ledger-input::placeholder{color:#CFC4B0; font-style:italic}
.obx .ledger-input:focus{border-color:var(--walnut); box-shadow:0 3px 0 -2px var(--walnut)}
.obx .slug{font-family:var(--mono); font-size:14px; color:var(--soft); margin:16px auto 40px; max-width:560px; text-align:left; min-height:20px}
.obx .slug b{color:var(--walnut); font-weight:500}

.obx .btn{display:inline-flex; align-items:center; gap:10px; background:var(--ink); color:var(--cream); border:0; cursor:pointer;
  font-family:var(--sans); font-weight:600; font-size:15px; padding:16px 34px; border-radius:999px;
  transition:transform .35s cubic-bezier(.2,.9,.3,1.4), box-shadow .35s, opacity .3s;
  box-shadow:0 1px 0 rgba(42,36,28,.2);}
.obx .btn:hover{transform:translateY(-2px); box-shadow:0 14px 30px -14px rgba(42,36,28,.45)}
.obx .btn:active{transform:translateY(0) scale(.98)}
.obx .btn:disabled{opacity:.35; cursor:not-allowed; transform:none; box-shadow:none}
.obx .btn .arr{display:inline-block; transition:transform .3s}
.obx .btn:hover .arr{transform:translateX(4px)}
.obx .quiet{display:inline-block; margin-top:24px; background:none; border:0; cursor:pointer; font-family:var(--sans); font-size:14px; color:var(--soft);
  border-bottom:1px solid transparent; padding-bottom:2px; transition:color .3s, border-color .3s}
.obx .quiet:hover{color:var(--walnut); border-color:var(--rule)}
.obx .back{position:absolute; left:48px; top:44px; background:none; border:0; cursor:pointer; font-family:var(--sans); font-size:14px; color:var(--soft); transition:color .3s; z-index:4}
.obx .back:hover{color:var(--ink)}
.obx .err{color:var(--terra); font-size:14px; margin:14px auto 0; max-width:560px}

.obx .numpad{display:flex; align-items:flex-end; justify-content:center; gap:12px; margin:8px auto 34px; cursor:text; user-select:none}
.obx .cc-big{font-family:var(--mono); font-size:clamp(28px,3.4vw,40px); color:var(--soft); padding-bottom:12px}
.obx .slots{display:flex; gap:10px}
.obx .slots .gap{width:14px}
.obx .slot{width:clamp(34px,3.6vw,46px); text-align:center; font-family:var(--mono); font-size:clamp(30px,3.6vw,44px); color:var(--ink);
  padding-bottom:10px; border-bottom:2px solid var(--rule); min-height:1.4em; position:relative; transition:border-color .3s}
.obx .slot.filled{border-color:var(--walnut)}
.obx .slot.next{border-color:var(--terra); animation:obx-slotblink 1.1s steps(1) infinite}
@keyframes obx-slotblink{50%{border-color:var(--rule)}}
.obx .slot span{display:inline-block; animation:obx-digitpop .3s cubic-bezier(.2,.9,.3,1.6)}
@keyframes obx-digitpop{0%{transform:scale(.3) translateY(8px); opacity:0}100%{transform:scale(1) translateY(0); opacity:1}}
.obx .numpad.done .slot{animation:obx-wave .5s ease}
.obx .numpad.done .slot:nth-child(n){animation-delay:calc(var(--i)*40ms)}
@keyframes obx-wave{30%{transform:translateY(-7px)}100%{transform:translateY(0)}}
.obx .hiddenphone{position:absolute; opacity:0; pointer-events:none; left:-9999px}
.obx .num-tick{width:38px; height:38px; flex:none; margin-bottom:6px; margin-left:8px; overflow:visible}
.obx .num-tick circle,.obx .num-tick path{stroke:var(--sage); fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round;
  stroke-dasharray:1; stroke-dashoffset:1}
.obx .num-tick.on circle{stroke-dashoffset:0; transition:stroke-dashoffset .55s cubic-bezier(.4,0,.2,1)}
.obx .num-tick.on path{stroke-dashoffset:0; transition:stroke-dashoffset .35s ease .45s}

.obx .contact-card{max-width:400px; margin:0 auto 36px; display:flex; align-items:center; gap:14px; text-align:left;
  background:var(--paper); border:1px solid var(--rule); border-radius:16px; padding:16px 20px;
  box-shadow:0 22px 44px -26px rgba(78,64,46,.4);
  opacity:0; transform:perspective(700px) rotateX(-26deg) translateY(22px) scale(.95); transform-origin:50% 0;
  transition:opacity .5s ease, transform .75s cubic-bezier(.2,.9,.3,1.35)}
.obx .contact-card.show{opacity:1; transform:perspective(700px) rotateX(0) translateY(0) scale(1)}
.obx .cc-av{width:46px; height:46px; border-radius:50%; background:var(--wa-dark); color:#fff; display:grid; place-items:center;
  font-family:var(--serif); font-size:20px; flex:none; position:relative;
  opacity:0; transform:scale(.4) rotate(-20deg); transition:opacity .35s ease .3s, transform .5s cubic-bezier(.2,.9,.3,1.6) .3s}
.obx .contact-card.show .cc-av{opacity:1; transform:scale(1) rotate(0)}
.obx .cc-av .dot{position:absolute; right:-1px; bottom:-1px; width:12px; height:12px; border-radius:50%; background:var(--wa-green); border:2px solid var(--paper)}
.obx .contact-card.show .dot{animation:obx-dotping 1.3s ease-out .85s 2}
@keyframes obx-dotping{0%{box-shadow:0 0 0 0 rgba(37,211,102,.55)}70%{box-shadow:0 0 0 11px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}
.obx .cc-body{opacity:0; transform:translateX(-10px); transition:opacity .5s ease .48s, transform .55s cubic-bezier(.2,.9,.3,1.2) .48s}
.obx .contact-card.show .cc-body{opacity:1; transform:none}
.obx .cc-body b{display:block; font-size:15.5px}
.obx .cc-body span{font-size:13px; color:var(--soft)}
.obx .cc-body .num{font-family:var(--mono); color:var(--walnut)}

.obx .chat{max-width:600px; margin:0 auto; background:#fff; border:1px solid var(--rule); border-radius:18px; overflow:hidden;
  box-shadow:0 34px 66px -34px rgba(42,36,28,.5); text-align:left}
.obx .ch-head{display:flex; align-items:center; gap:12px; padding:13px 18px; background:var(--wa-dark); color:#fff}
.obx .ch-av{width:38px; height:38px; border-radius:50%; background:var(--terra); display:grid; place-items:center; font-family:var(--serif); font-size:18px; flex:none}
.obx .ch-name{font-size:15px; font-weight:600}
.obx .ch-sub{font-size:11.5px; opacity:.75}
.obx .ch-body{padding:20px 16px 10px; min-height:210px; background-color:var(--wa-bg);
  background-image:radial-gradient(rgba(110,95,76,.09) 1px, transparent 1.4px); background-size:22px 22px}
.obx .msg{max-width:84%; border-radius:10px; padding:8px 10px 6px; font-size:14.5px; line-height:1.45; margin-bottom:10px;
  box-shadow:0 1px 1px rgba(42,36,28,.12); position:relative;
  opacity:0; transform:translateY(10px); transition:all .5s cubic-bezier(.2,.9,.3,1.2)}
.obx .msg.show{opacity:1; transform:none}
.obx .msg.in{background:#fff; border-top-left-radius:2px}
.obx .msg.out{background:var(--wa-bubble); margin-left:auto; border-top-right-radius:2px}
.obx .msg .mt{display:inline-block; float:right; font-size:10.5px; color:#8b857c; margin:8px 0 0 10px}
.obx .msg .mt .tk{letter-spacing:-.12em; transition:color .4s}
.obx .msg .mt .tk.blue{color:var(--wa-tick)}
.obx .typing{display:inline-flex; gap:4px; background:#fff; border-radius:10px; border-top-left-radius:2px;
  padding:12px 14px; margin-bottom:10px; box-shadow:0 1px 1px rgba(42,36,28,.12); opacity:0; transition:opacity .3s}
.obx .typing.show{opacity:1}
.obx .typing i{width:6px; height:6px; border-radius:50%; background:#9a938a; animation:obx-tp 1s infinite}
.obx .typing i:nth-child(2){animation-delay:.15s}.obx .typing i:nth-child(3){animation-delay:.3s}
@keyframes obx-tp{0%,100%{opacity:.3; transform:translateY(0)}50%{opacity:1; transform:translateY(-3px)}}
.obx .ch-compose{display:flex; align-items:center; gap:10px; padding:10px 12px; background:#F0EDE6}
.obx .ch-compose .cwrap{flex:1; background:#fff; border-radius:999px; display:flex; align-items:center; padding:0 18px; border:1px solid transparent; transition:border-color .3s}
.obx .ch-compose input{flex:1; border:0; outline:0; background:transparent; padding:13px 0;
  font-family:var(--sans); font-size:15px; color:var(--ink); caret-color:var(--wa-dark)}
.obx .ch-compose input::placeholder{color:#B9B2A6}
.obx .send{width:50px; height:50px; border-radius:50%; border:0; background:var(--wa-green); color:#fff; cursor:pointer; flex:none;
  display:grid; place-items:center; font-size:19px; position:relative;
  transition:transform .3s cubic-bezier(.2,.9,.3,1.5), opacity .3s, box-shadow .3s}
.obx .send:hover{transform:scale(1.1) rotate(-8deg)}
.obx .send:active{transform:scale(.94)}
.obx .send:disabled{opacity:.35; cursor:not-allowed; transform:none}
.obx .send.glow{animation:obx-sendpulse 1.6s ease-out infinite}
@keyframes obx-sendpulse{0%{box-shadow:0 0 0 0 rgba(37,211,102,.5)}70%{box-shadow:0 0 0 18px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}
.obx .send-hint{text-align:center; font-size:14px; color:var(--walnut); margin-top:18px; opacity:0; transform:translateY(6px); transition:all .5s ease}
.obx .send-hint.show{opacity:1; transform:none}
.obx .send-hint b{color:var(--ink)}

.obx .drop{max-width:560px; margin:0 auto 30px; border:1.5px dashed #D2C6AF; border-radius:16px; background:var(--paper);
  padding:44px 30px; cursor:pointer; transition:border-color .3s, transform .3s}
.obx .drop:hover{border-color:var(--walnut); transform:translateY(-2px)}
.obx .drop .d-ic{font-size:26px; margin-bottom:12px}
.obx .drop b{display:block; font-size:16px; margin-bottom:6px}
.obx .drop span{font-size:13.5px; color:var(--soft)}
.obx .filechip{display:none; align-items:center; gap:10px; max-width:560px; margin:0 auto 22px; text-align:left;
  background:var(--paper); border:1px solid var(--rule); border-radius:12px; padding:14px 18px}
.obx .filechip.show{display:flex}
.obx .filechip .fc-ic{width:36px; height:36px; border-radius:9px; background:var(--sage-soft); color:var(--sage); display:grid; place-items:center; font-family:var(--mono); font-size:10px; flex:none}
.obx .filechip b{font-size:14px} .obx .filechip span{font-size:12px; color:var(--soft); display:block}
.obx .inkbar{flex:1; height:3px; background:var(--rule); border-radius:99px; overflow:hidden; margin-left:14px}
.obx .inkbar i{display:block; height:100%; width:0; background:var(--walnut); border-radius:99px; transition:width 1.6s cubic-bezier(.3,0,.2,1)}
.obx .counts{display:none; grid-template-columns:repeat(3,1fr); max-width:640px; margin:0 auto 36px; border-top:1px solid var(--ink); border-bottom:1px solid var(--rule)}
.obx .counts.show{display:grid}
.obx .cnt{padding:20px 10px 18px; border-right:1px solid var(--rule)}
.obx .cnt:last-child{border-right:0}
.obx .cnt b{display:block; font-family:var(--mono); font-size:clamp(26px,3vw,34px); font-weight:500; margin-bottom:4px}
.obx .cnt span{font-family:var(--mono); font-size:10.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--soft)}

.obx .setline{font-size:16px; color:var(--walnut); margin-bottom:32px}
.obx .setline b{color:var(--ink); font-weight:600}
.obx .ledger-card{max-width:600px; margin:0 auto 34px; background:var(--paper); border:1px solid var(--rule); border-radius:16px;
  box-shadow:0 30px 60px -32px rgba(78,64,46,.45); text-align:left; overflow:hidden;
  opacity:0; transform:translateY(16px); transition:opacity .8s ease .5s, transform .8s cubic-bezier(.2,.9,.3,1.1) .5s}
.obx .ledger-card.land{opacity:1; transform:none}
.obx .lc-head{display:flex; justify-content:space-between; align-items:baseline; padding:16px 22px 12px; border-bottom:1px solid var(--rule)}
.obx .lc-head b{font-family:var(--serif); font-size:19px; font-weight:600}
.obx .lc-head span{font-family:var(--mono); font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--soft)}
.obx .lc-row{display:flex; align-items:center; gap:16px; padding:18px 22px}
.obx .lc-av{width:44px; height:44px; border-radius:50%; background:var(--cream); border:1px solid var(--rule); flex:none;
  display:grid; place-items:center; font-family:var(--serif); font-size:17px; color:var(--walnut)}
.obx .lc-mid{flex:1}
.obx .lc-mid .who{font-weight:600; font-size:16px}
.obx .lc-mid .note{font-size:13px; color:var(--soft); margin-top:2px}
.obx .lc-right{text-align:right}
.obx .lc-right .amt{font-family:var(--mono); font-size:20px}
.obx .lc-right .pills{display:flex; gap:6px; justify-content:flex-end; margin-top:6px; flex-wrap:wrap}
.obx .pill{font-family:var(--mono); font-size:10.5px; letter-spacing:.08em; padding:3px 9px; border-radius:999px}
.obx .pill.sage{background:var(--sage-soft); color:var(--sage)}
.obx .pill.terra{background:var(--terra-soft); color:var(--terra)}
.obx .lc-foot{padding:12px 22px; border-top:1px solid var(--rule); font-size:12.5px; color:var(--soft)}
.obx .lc-foot b{color:var(--walnut); font-family:var(--mono); font-weight:500; font-size:12px}

.obx .more{max-width:600px; margin:0 auto 34px; text-align:left; opacity:0; transform:translateY(10px); transition:opacity .7s ease, transform .7s ease;
  background:var(--paper); border:1px solid var(--rule); border-radius:16px; padding:18px 24px 8px;
  box-shadow:0 22px 46px -30px rgba(78,64,46,.4)}
.obx .more.show{opacity:1; transform:none}
.obx .more .rv-lbl{font-family:var(--mono); font-size:11px; letter-spacing:.24em; text-transform:uppercase; color:var(--terra); margin-bottom:12px; text-align:center}
.obx .tmsg{display:flex; align-items:center; gap:14px; padding:11px 4px; border-bottom:1px solid var(--rule);
  opacity:0; transform:translateY(8px); transition:opacity .5s ease, transform .5s cubic-bezier(.2,.9,.3,1.2)}
.obx .tmsg:last-of-type{border-bottom:0}
.obx .tmsg.show{opacity:1; transform:none}
.obx .tmsg .bub{flex:1; font-size:14px}
.obx .tmsg .arrow{font-family:var(--mono); color:var(--soft); font-size:13px; flex:none}
.obx .thesis{font-family:var(--serif); font-size:17.5px; font-style:italic; color:var(--walnut); text-align:center;
  display:table; margin:0 auto 8px; padding:6px 18px; background:var(--cream); border-radius:999px;
  box-shadow:0 0 0 8px var(--cream);
  opacity:0; transform:translateY(8px); transition:opacity .8s ease, transform .8s ease}
.obx .thesis.show{opacity:1; transform:none}

.obx .elev{position:fixed; left:44px; bottom:36px; z-index:3; pointer-events:none}
.obx .elev path,.obx .elev line,.obx .elev rect{stroke:var(--walnut); fill:none; stroke-width:1.4; stroke-linecap:round;
  stroke-dasharray:1; stroke-dashoffset:1; opacity:.9; transition:stroke-dashoffset 1.3s cubic-bezier(.4,0,.2,1) .15s}
.obx .elev g.inked path,.obx .elev g.inked line,.obx .elev g.inked rect{stroke-dashoffset:0}
.obx .elev .flag{stroke:var(--terra)}
.obx .elev-cap{font-family:var(--mono); font-size:11px; letter-spacing:.18em; color:var(--soft); margin-top:10px; text-transform:uppercase}
.obx .count{position:fixed; right:44px; bottom:44px; z-index:3; font-family:var(--mono); font-size:13px; letter-spacing:.2em; color:var(--soft)}
.obx .count b{color:var(--ink); font-weight:500}
.obx .mark{position:fixed; left:44px; top:38px; z-index:3; font-family:var(--serif); font-size:22px; font-weight:600}
.obx .mark i{font-style:normal; color:var(--terra)}

/* ── the phone ──────────────────────────────────────────────────────────────
   The reference only hides the elevation under 900px. Everything below is the
   touch build: the type ramp reset for a 390px column, every control at or above
   44px, the chat full-bleed, and the progress moved to a rail across the top —
   a drawing in the corner is a desktop luxury on a screen this size. */
@media (max-width:760px){
  .obx .step{padding:calc(20px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom)); place-items:start center}
  .obx .inner{width:100%; padding-top:52px}
  .obx .hello{font-size:11px; letter-spacing:.28em; margin-bottom:14px}
  .obx h1{font-size:clamp(28px,8.2vw,36px); line-height:1.12; margin-bottom:12px}
  .obx .lede{font-size:15.5px; line-height:1.55; margin-bottom:28px}
  .obx .elev{display:none}
  .obx .count{display:none}
  .obx .mark{left:20px; top:calc(16px + env(safe-area-inset-top)); font-size:19px}

  /* progress as a rail of five, across the top — legible at a glance, no drawing */
  .obx .rail{position:fixed; left:20px; right:20px; top:calc(50px + env(safe-area-inset-top)); z-index:3;
    display:flex; gap:6px; align-items:center}
  .obx .rail i{flex:1; height:3px; border-radius:2px; background:var(--rule); overflow:hidden; position:relative}
  .obx .rail i::after{content:''; position:absolute; inset:0; background:var(--terra); transform:scaleX(0);
    transform-origin:left; transition:transform .7s cubic-bezier(.4,0,.2,1)}
  .obx .rail i.on::after{transform:scaleX(1)}
  .obx .rail b{font-family:var(--mono); font-size:10.5px; letter-spacing:.16em; color:var(--soft); font-weight:400; flex:none; margin-left:4px}

  .obx .field{max-width:none}
  .obx .ledger-input{font-size:27px; padding:6px 2px 12px}
  .obx .slug{font-size:13px; margin:12px auto 28px; max-width:none}
  .obx .btn{width:100%; justify-content:center; height:54px; padding:0 24px; font-size:16px}
  .obx .btn:hover{transform:none; box-shadow:0 1px 0 rgba(42,36,28,.2)}
  .obx .quiet{margin-top:20px; padding:10px 4px; font-size:14.5px}
  .obx .back{left:20px; top:calc(14px + env(safe-area-inset-top)); padding:10px 4px}

  /* ten slots have to fit 390px: no fixed width, let them share the row */
  .obx .numpad{gap:8px; margin:4px auto 26px}
  .obx .cc-big{font-size:22px; padding-bottom:8px; flex:none}
  .obx .slots{gap:5px; flex:1; justify-content:center}
  .obx .slots .gap{width:7px}
  .obx .slot{width:auto; flex:1; max-width:30px; font-size:22px; padding-bottom:7px; min-height:1.5em}
  .obx .num-tick{width:28px; height:28px; margin-left:4px; margin-bottom:4px}
  .obx .contact-card{max-width:none; margin-bottom:26px; padding:14px 16px}

  .obx .chat{max-width:none; border-radius:16px; box-shadow:0 18px 40px -26px rgba(42,36,28,.5)}
  .obx .ch-body{min-height:180px; padding:16px 12px 8px}
  .obx .msg{max-width:88%; font-size:14px}
  .obx .ch-compose{padding:8px 10px; gap:8px}
  .obx .ch-compose .cwrap{padding:0 14px}
  .obx .ch-compose input{font-size:16px; padding:12px 0}   /* 16px keeps Android/iOS from zooming */
  .obx .send{width:46px; height:46px}
  .obx .send:hover{transform:none}
  .obx .send-hint{font-size:13.5px; margin-top:14px}

  .obx .drop{max-width:none; padding:34px 22px}
  .obx .drop:hover{transform:none}
  .obx .filechip{max-width:none}
  .obx .counts{max-width:none; margin-bottom:28px}
  .obx .cnt{padding:16px 6px 14px}
  .obx .cnt b{font-size:24px}
  .obx .cnt span{font-size:9.5px; letter-spacing:.12em}

  .obx .setline{font-size:15px; margin-bottom:24px}
  .obx .ledger-card,.obx .more{max-width:none; margin-bottom:24px}
  .obx .lc-row{padding:16px; gap:12px}
  .obx .lc-right .amt{font-size:18px}
  .obx .more{padding:16px 18px 6px}
  .obx .thesis{font-size:16px; padding:6px 14px}
}

@media (prefers-reduced-motion:reduce){
  .obx *{transition-duration:.01ms !important; animation:none !important}
}
`;
