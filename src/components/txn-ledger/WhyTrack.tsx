/**
 * WhyTrack — an optional, context-aware explainer ("what tracking does for you"),
 * opened from the subtle "Why track?" link in the Track panel. It tells a real story:
 * loose payments to a worker/vendor organising into named work/purchase orders with
 * paid-vs-committed bars. Run inside an isolated <iframe srcDoc> so its CSS/JS can
 * never collide with the app.
 */
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// ── Real worked examples ─────────────────────────────────────────────────────────
const WO_CFG = {
  subject: 'Uday Kumar', subtitle: 'ASM Elite', noun: 'work order',
  lanes: [
    { name: 'Internal flooring', paid: 10000, budget: 12000 },
    { name: 'External flooring', paid: 21500, budget: 22500 },
  ],
  chips: [
    { amt: '6,000', lane: 0, col: 0 }, { amt: '4,000', lane: 0, col: 1 },
    { amt: '13,500', lane: 1, col: 0 }, { amt: '8,000', lane: 1, col: 1 },
  ],
};
const PO_CFG = {
  subject: 'Khajari Tiles', subtitle: 'purchases', noun: 'purchase order',
  lanes: [
    { name: 'Internal tiles', paid: 150000, budget: 150000 },
    { name: 'External tiles', paid: 100000, budget: 300000 },
  ],
  chips: [
    { amt: '90,000', lane: 0, col: 0 }, { amt: '60,000', lane: 0, col: 1 },
    { amt: '1,00,000', lane: 1, col: 0 },
  ],
};

function whyTrackHtml(kind: 'WO' | 'PO'): string {
  const cfg = kind === 'PO' ? PO_CFG : WO_CFG;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Why track</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#1c1a17;--ink-2:#6b655d;--ink-3:#9b948a;
    --paper:#ffffff;--page:#fbfaf7;--line:#ece7df;--line-2:#e2dccf;
    --terra:#bb4a23;--terra-deep:#9c3d1c;--terra-soft:#fbeee4;--amber-line:#f0dcb8;
    --sage:#5b7350;--sage-deep:#475c3f;--sage-line:#d8e3cd;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  body{margin:0;font-family:'DM Sans',system-ui,sans-serif;background:var(--page);color:var(--ink);-webkit-font-smoothing:antialiased;}
  .frame{max-width:620px;margin:0 auto;padding:24px 20px 26px;}
  .kicker{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--terra);margin-bottom:7px;}
  h1{font-family:Georgia,serif;font-size:24px;line-height:1.2;margin:0 0 18px;letter-spacing:-.01em;}
  .stage-wrap{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgba(28,26,23,.04),0 14px 40px -24px rgba(28,26,23,.22);overflow:hidden;}
  .stage{position:relative;height:300px;background:radial-gradient(120% 90% at 50% -10%,#fff,var(--page));overflow:hidden;}

  .chip{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:7px 11px;border-radius:11px;background:#fff;border:1px solid var(--line-2);box-shadow:0 4px 14px -8px rgba(28,26,23,.3);white-space:nowrap;
    transition:left .62s cubic-bezier(.45,.05,.2,1),top .62s cubic-bezier(.45,.05,.2,1),opacity .45s ease,transform .62s cubic-bezier(.45,.05,.2,1),border-color .4s;
    transform:translate(-50%,-50%) rotate(var(--r,0deg)) scale(var(--s,1));}
  .chip .amt{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink);}
  .chip .work{font-size:9.5px;font-weight:600;color:var(--terra-deep);text-transform:uppercase;letter-spacing:.03em;max-height:0;opacity:0;overflow:hidden;transition:max-height .4s ease,opacity .4s ease;}
  .chip.named .work{max-height:14px;opacity:1;}
  .chip .tick{position:absolute;top:-8px;right:-8px;width:19px;height:19px;border-radius:99px;background:var(--sage);color:#fff;display:grid;place-items:center;opacity:0;transform:scale(.4);transition:opacity .3s,transform .3s cubic-bezier(.2,.9,.3,1.5);}
  .chip.ticked .tick{opacity:1;transform:scale(1);}
  .chip.loose{border-style:dashed;}.chip.loose .amt{color:var(--ink-2);}

  .decor{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .5s ease;}
  .decor.on{opacity:1;}
  .lane{position:absolute;left:7%;display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--ink);transform:translateY(-50%);}
  .lane .lg{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:var(--terra-soft);border:1px solid var(--amber-line);color:var(--terra-deep);}

  .ghost{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:240px;border:1.5px dashed var(--line-2);border-radius:14px;background:rgba(255,255,255,.65);padding:15px;text-align:center;}
  .ghost .g1{font-size:12.5px;font-weight:600;color:var(--ink-2);}
  .ghost .g2{font-family:Georgia,serif;font-size:28px;color:var(--ink-3);margin-top:5px;}

  .hint{position:absolute;left:50%;top:7%;transform:translateX(-50%);display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line-2);border-radius:10px;padding:6px 11px;font-size:12px;font-weight:600;box-shadow:0 6px 18px -10px rgba(28,26,23,.4);}
  .hint .yy{width:18px;height:18px;border-radius:99px;background:var(--terra-soft);color:var(--terra-deep);display:grid;place-items:center;}

  .jobcard{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(340px,90%);background:#fff;border:1px solid var(--line);border-radius:15px;box-shadow:0 16px 40px -20px rgba(28,26,23,.4);padding:15px 16px 16px;}
  .jc-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;}
  .jc-name{font-family:Georgia,serif;font-size:18px;}
  .jc-sub{font-size:11px;color:var(--ink-3);}
  .jc-row{margin-top:11px;}
  .jc-rt{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;}
  .jc-rt .nm{font-weight:600;color:var(--ink);}
  .jc-rt .am{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink-2);}
  .jc-bar{height:7px;border-radius:99px;background:var(--line);margin-top:6px;overflow:hidden;}
  .jc-bar>i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--sage),#7a9a6c);transition:width 1s cubic-bezier(.2,.8,.2,1);}
  .jc-row.done .jc-rt .am{color:var(--sage-deep);}

  .cap-area{min-height:72px;padding:18px 20px 4px;}
  .cap{font-size:15.5px;line-height:1.5;color:var(--ink);opacity:0;transform:translateY(6px);transition:opacity .4s ease,transform .4s ease;}
  .cap.on{opacity:1;transform:none;}
  .cap em{font-style:normal;color:var(--terra-deep);font-weight:600;}

  .controls{display:flex;align-items:center;gap:14px;padding:6px 20px 18px;}
  .dots{display:flex;gap:7px;flex:1;}
  .dots button{width:7px;height:7px;border-radius:99px;border:none;background:var(--line-2);cursor:pointer;padding:0;transition:all .25s;}
  .dots button.active{background:var(--terra);width:20px;}
  .nav{display:flex;gap:8px;}
  .nav button{width:34px;height:34px;border-radius:9px;border:1px solid var(--line-2);background:#fff;color:var(--ink-2);cursor:pointer;display:grid;place-items:center;transition:all .12s;}
  .nav button:disabled{opacity:.35;cursor:default;}
  .replay{font-family:inherit;font-size:13px;font-weight:600;color:var(--terra-deep);background:var(--terra-soft);border:1px solid var(--amber-line);border-radius:9px;padding:7px 13px;cursor:pointer;display:none;}
  .replay.show{display:inline-block;}
  @media (max-width:430px){.stage{height:288px;}h1{font-size:21px;}.cap{font-size:15px;}.chip{padding:6px 9px;}.chip .amt{font-size:12px;}}
  @media (prefers-reduced-motion:reduce){*{transition-duration:.001ms!important;animation:none!important;}}
</style>
</head>
<body>
<div class="frame">
  <div class="kicker">Briklay · tracking</div>
  <h1>What "tracking" actually does for you</h1>
  <div class="stage-wrap">
    <div class="stage" id="stage">
      <div class="decor" id="d-ghost"><div class="ghost"><div class="g1" id="ghostq"></div><div class="g2">?</div></div></div>
      <div class="decor" id="d-lanes"></div>
      <div class="decor" id="d-hint"><div class="hint"><span class="yy" id="yytick"></span> <span id="hintt"></span></div></div>
      <div class="decor" id="d-card"><div class="jobcard" id="jobcard"></div></div>
    </div>
    <div class="cap-area"><div class="cap" id="cap"></div></div>
    <div class="controls">
      <div class="dots" id="dots"></div>
      <button class="replay" id="replay" onclick="goto(0)">&#8635; Replay</button>
      <div class="nav">
        <button id="prev" onclick="step(-1)" aria-label="Back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>
        <button id="next" onclick="step(1)" aria-label="Next"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>
    </div>
  </div>
</div>
<script>
var CONFIG = ${JSON.stringify(cfg)};
var R = '₹';
var WORK='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/></svg>';
var CHK='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>';
document.getElementById('yytick').innerHTML=CHK;
document.getElementById('ghostq').textContent=CONFIG.subject + ' · what was it all for?';
document.getElementById('hintt').textContent='Track under ' + CONFIG.lanes[0].name + '?';

function fmt(n){ return n>=100000 ? R+(n/100000).toFixed(n%100000?1:0)+'L' : R+n.toLocaleString('en-IN'); }

// lane labels
var lanesEl=document.getElementById('d-lanes');
var laneTop=[36,62];
CONFIG.lanes.forEach(function(l,i){
  var d=document.createElement('div');d.className='lane';d.style.top=laneTop[i]+'%';
  d.innerHTML='<span class="lg">'+WORK+'</span> '+l.name;
  lanesEl.appendChild(d);
});

// payoff card
var jc=document.getElementById('jobcard');
var jcHtml='<div class="jc-top"><span class="jc-name">'+CONFIG.subject+'</span><span class="jc-sub">'+CONFIG.subtitle+'</span></div>';
CONFIG.lanes.forEach(function(l,i){
  jcHtml+='<div class="jc-row" id="jcrow'+i+'"><div class="jc-rt"><span class="nm">'+l.name+'</span><span class="am">'+fmt(l.paid)+' / '+fmt(l.budget)+'</span></div><div class="jc-bar"><i id="jcbar'+i+'"></i></div></div>';
});
jc.innerHTML=jcHtml;

// chips
var stage=document.getElementById('stage');
CONFIG.chips.forEach(function(c){
  var el=document.createElement('div');el.className='chip';
  el.innerHTML='<span class="amt">'+R+c.amt+'</span><span class="work">'+CONFIG.lanes[c.lane].name+'</span><span class="tick">'+CHK+'</span>';
  stage.appendChild(el);c.el=el;
});

var SCATTER=[{l:20,t:30,r:-7},{l:70,t:22,r:5},{l:28,t:72,r:6},{l:66,t:76,r:-6},{l:82,t:50,r:-3}];
function groupPos(c){return {l:c.col===0?56:78,t:laneTop[c.lane],r:0};}

function place(c,p,o){o=o||{};var el=c.el;el.style.left=p.l+'%';el.style.top=p.t+'%';el.style.setProperty('--r',(p.r||0)+'deg');el.style.setProperty('--s',o.sc==null?1:o.sc);el.style.opacity=o.op==null?1:o.op;el.classList.toggle('named',!!o.named);el.classList.toggle('ticked',!!o.ticked);el.classList.toggle('loose',!!o.loose);}

var CAPS=[
  'Right now, money just leaves. You see the <em>payment</em> — not what it was for.',
  'So you can\\'t answer the real question: how much has '+CONFIG.subject+' been paid, and how much is <em>still due?</em>',
  'The fix is small — tell it what each payment was <em>for</em>: the order it belongs to.',
  'It already half-knows, so it <em>suggests</em>. You just confirm — one tap.',
  'Now every payment rolls up on its own — <em>paid vs committed,</em> order by order.',
  'You never touched a ledger. You answered "what\\'s this for?" — and the <em>picture built itself.</em>'
];
var N=CAPS.length,scene=0,timer=null,playing=true;
var dotsEl=document.getElementById('dots');
for(var i=0;i<N;i++){(function(i){var b=document.createElement('button');b.onclick=function(){goto(i);};dotsEl.appendChild(b);})(i);}
function decor(id,on){document.getElementById(id).classList.toggle('on',on);}

function applyScene(s){
  CONFIG.chips.forEach(function(c,i){
    if(s<=1) place(c,SCATTER[i%SCATTER.length],{loose:true,op:1});
    else if(s===2) place(c,groupPos(c),{named:true});
    else if(s===3) place(c,groupPos(c),{named:true,ticked:true});
    else place(c,{l:50,t:50},{named:true,ticked:true,op:0,sc:.5});
  });
  decor('d-ghost',s===1);
  decor('d-lanes',s===2||s===3);
  decor('d-hint',s===3);
  decor('d-card',s>=4);
  CONFIG.lanes.forEach(function(l,i){
    var bar=document.getElementById('jcbar'+i);var row=document.getElementById('jcrow'+i);
    if(s>=4){var pct=Math.min(100,Math.round(l.paid/l.budget*100));setTimeout(function(){bar.style.width=pct+'%';row.classList.toggle('done',pct>=100);},120+i*220);}
    else{bar.style.width='0';row.classList.remove('done');}
  });
  var cap=document.getElementById('cap');cap.classList.remove('on');
  setTimeout(function(){cap.innerHTML=CAPS[s];cap.classList.add('on');},180);
  var kids=dotsEl.children;for(var i=0;i<kids.length;i++){kids[i].classList.toggle('active',i===s);}
  document.getElementById('prev').disabled=s===0;
  document.getElementById('next').disabled=s===N-1;
  document.getElementById('replay').classList.toggle('show',s===N-1);
}
function render(){applyScene(scene);}
function step(d){scene=Math.max(0,Math.min(N-1,scene+d));render();schedule();}
function goto(i){scene=i;render();schedule();}
function schedule(){clearTimeout(timer);if(playing&&scene<N-1){timer=setTimeout(function(){scene++;render();schedule();},scene===0?2600:4200);}}
['pointerenter','pointerdown'].forEach(function(e){stage.addEventListener(e,function(){playing=false;clearTimeout(timer);});});
stage.addEventListener('pointerleave',function(){playing=true;schedule();});
window.step=step;window.goto=goto;
render();schedule();
</script>
</body>
</html>`;
}

export function WhyTrackModal({ kind, onClose }: { kind: 'WO' | 'PO'; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-3 db-track-pop-in"
      style={{ zIndex: 100000, background: 'rgba(28,26,23,0.5)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ width: 'min(96vw, 660px)', maxHeight: '94vh', background: '#fbfaf7', boxShadow: '0 30px 80px rgba(28,26,23,0.4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute"
          style={{ top: 10, right: 10, zIndex: 2, width: 30, height: 30, borderRadius: 8, background: '#fff', border: '1px solid #e2dccf', display: 'grid', placeItems: 'center' }}
        >
          <X size={16} style={{ color: '#6b655d' }} />
        </button>
        <iframe title="Why track" srcDoc={whyTrackHtml(kind)} style={{ width: '100%', height: 'min(88vh, 600px)', border: 0, display: 'block' }} />
      </div>
    </div>,
    document.body,
  );
}
