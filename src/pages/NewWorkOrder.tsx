import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Stakeholder } from '../types';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { multiply, parseAmount } from '../lib/money';
import { WORKER_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { useSnackbar } from '../components/Snackbar';
import PhoneInput from '../components/PhoneInput';

// ─── Work Stage types ──────────────────────────────────────────────────────

interface StageDraft {
  id: string;
  name: string;
  paid_when: string;       // "Paid when" — the milestone's condition (UI-captured; RPC ignores it today)
  unit_type: string;
  quantity: number | null;
  rate: number | null;
  amount: number | null;   // directly-entered lumpsum; null means computed from qty×rate
  ambiguous?: boolean;     // amber flag for AI-extracted stages needing review
}

interface ExtractedStage {
  name: string;
  mode: 'measured' | 'lumpsum' | 'ambiguous';
  unit_type: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  arithmetic_mismatch: boolean;
}

type StageMode = 'empty' | 'measured' | 'lumpsum';

function getMode(s: StageDraft): StageMode {
  if (!s.name && !(s.amount ?? 0) && !(s.quantity ?? 0) && !(s.rate ?? 0)) return 'empty';
  if (s.unit_type === 'LS') return 'lumpsum';
  if ((s.quantity ?? 0) > 0 && (s.rate ?? 0) > 0) return 'measured';
  if ((s.amount ?? 0) > 0) return 'lumpsum';
  return 'empty';
}

// ─── Unit system (canonical values the rest of the app expects) ─────────────

const UNIT_GROUPS = [
  { group: 'LUMP SUM', items: [{ value: 'LS', label: 'LS' }] },
  { group: 'AREA', items: [
    { value: 'Sqft', label: 'Sqft' }, { value: 'Sqm', label: 'Sqm' }, { value: 'Sqyd', label: 'Sqyd' },
  ]},
  { group: 'VOLUME', items: [
    { value: 'Cum', label: 'Cum' }, { value: 'Cft', label: 'Cft' }, { value: 'Cu.yd', label: 'Cu.yd' },
  ]},
  { group: 'LENGTH', items: [
    { value: 'Rmt', label: 'Rmt' }, { value: 'Rft', label: 'Rft' },
  ]},
  { group: 'COUNT', items: [
    { value: 'Nos', label: 'Nos' }, { value: 'Per Point', label: 'Per Point' },
    { value: 'Per Fixture', label: 'Per Fixture' }, { value: 'Per Set', label: 'Per Set' },
    { value: 'Per Column', label: 'Per Column' }, { value: 'Per Beam', label: 'Per Beam' },
    { value: 'Per Footing', label: 'Per Footing' },
  ]},
  { group: 'RESIDENTIAL', items: [
    { value: 'Per Flat', label: 'Per Flat' }, { value: 'Per Floor', label: 'Per Floor' },
    { value: 'Per Room', label: 'Per Room' }, { value: 'Per Bay', label: 'Per Bay' },
  ]},
  { group: 'WEIGHT', items: [
    { value: 'Kg', label: 'Kg' }, { value: 'MT', label: 'MT' }, { value: 'Quintal', label: 'Quintal' },
  ]},
];

const UNIT_SUGGESTIONS: Array<{ pattern: RegExp; unit: string }> = [
  { pattern: /plastering|brickwork|masonry|tiling|flooring|painting|false.?ceiling|waterproofing/, unit: 'Sqft' },
  { pattern: /concrete|slab|excavation/, unit: 'Cum' },
  { pattern: /steel|reinforcement/, unit: 'Kg' },
  { pattern: /plumbing/, unit: 'Per Fixture' },
  { pattern: /electrical/, unit: 'Per Point' },
  { pattern: /door|window/, unit: 'Nos' },
];

function suggestUnit(name: string): string {
  const n = name.toLowerCase();
  for (const { pattern, unit } of UNIT_SUGGESTIONS) if (pattern.test(n)) return unit;
  return '';
}

// Stage-name suggestions offered in the row popover (purely a typing aid).
const STAGE_NAMES = [
  'Foundation & footing', 'Plinth beam', 'GF columns', 'GF slab', 'Brickwork',
  'Plastering', 'Flooring', 'Electrical first fix', 'Plumbing first fix', 'Painting',
  'Final finish & handover',
];

function calcAmount(s: StageDraft): number {
  const mode = getMode(s);
  if (mode === 'measured') return multiply(s.quantity ?? 0, s.rate ?? 0);
  if (mode === 'lumpsum') return s.amount ?? 0;
  return 0;
}

const fmt = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

// ─── Scoped styles — a faithful port of the contract-create mockup ──────────
const WOX_CSS = `
.wox{
  --cream:#F6F2EA; --paper:#FFFDF9; --paper-2:#FBF8F2;
  --ink:#2F2622; --ink-2:#6E635B; --ink-3:#A39A91;
  --line:#E4DCD0; --line-2:#EFE9DF;
  --terra:#C4613A; --terra-deep:#A94E2B; --terra-tint:#F8E7DE;
  --sage:#5F7F5B; --sage-tint:#E7EFE4;
  --gold:#B8862E;
  --r:8px; --ease:cubic-bezier(.2,.7,.2,1);
  --shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);
  background:#FBF9F6; color:var(--ink);
  font:15px/1.45 "DM Sans",system-ui,sans-serif; -webkit-font-smoothing:antialiased; min-height:100vh;
}
.wox .page{max-width:1020px;margin:0 auto;padding:26px 32px 120px}
.wox .page>*{animation:woxrise .5s var(--ease) both}
.wox .page>*:nth-child(2){animation-delay:.05s}.wox .page>*:nth-child(3){animation-delay:.1s}.wox .page>*:nth-child(4){animation-delay:.15s}.wox .page>*:nth-child(5){animation-delay:.2s}
@keyframes woxrise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.wox .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum"}
.wox button,.wox input,.wox select{font:inherit;color:inherit}
.wox input::placeholder{color:var(--ink-3)}

.wox .top{display:flex;align-items:center;gap:14px;margin-bottom:24px}
.wox .back{width:36px;height:36px;border-radius:50%;border:1px solid transparent;background:transparent;display:grid;place-items:center;cursor:pointer;transition:background .18s,border-color .18s,transform .18s}
.wox .back:hover{background:var(--paper);border-color:var(--line)}
.wox .back:active{transform:scale(.92)}
.wox .back svg{width:18px;height:18px;stroke:var(--ink);fill:none;stroke-width:1.8}
.wox .title-wrap{position:relative;display:inline-block}
.wox h1{font:600 26px/1.1 "Playfair Display",Georgia,serif;margin:0;letter-spacing:-.01em}
.wox .wo{margin-left:auto;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--paper);border:1px solid var(--line);color:var(--ink-2);font-size:13px}
.wox .wo .mono{color:var(--ink);letter-spacing:.02em}
.wox .wo i{width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block}

.wox .sec{display:flex;align-items:center;justify-content:space-between;margin:24px 0 10px}
.wox .sec h2{margin:0;font:600 11.5px/1 "DM Sans";letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);padding-left:10px;border-left:3px solid var(--terra);display:flex;align-items:center;gap:14px;flex:1}
.wox .sec h2::after{content:"";flex:1;height:1px;background:var(--line);margin-right:14px}

.wox .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
.wox table{width:100%;border-collapse:collapse;table-layout:fixed}
.wox th{font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:9px 12px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap}
.wox td{padding:0;border-bottom:1px solid var(--line-2);vertical-align:middle;height:46px}
.wox th+th,.wox td+td{border-left:1px solid var(--line-2)}
.wox tr:last-child td{border-bottom:0}
.wox .hdr th{width:118px;background:var(--paper-2);border-bottom:1px solid var(--line-2);vertical-align:middle}
.wox .hdr tr:last-child th{border-bottom:0}

.wox .cell{position:relative;height:100%}
.wox .cell input,.wox .cell select{width:100%;height:46px;border:0;background:transparent;padding:0 12px;outline:none;border-radius:0}
.wox .cell select{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:32px}
.wox .cell.sel::after{content:"";position:absolute;right:12px;top:50%;width:7px;height:7px;border-right:1.5px solid var(--ink-3);border-bottom:1.5px solid var(--ink-3);transform:translateY(-70%) rotate(45deg);pointer-events:none}
.wox .cell::before{content:"";position:absolute;inset:0;pointer-events:none;border:2px solid transparent;border-radius:3px;transition:border-color .15s,box-shadow .15s}
.wox .cell:focus-within::before{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.wox .cell:hover:not(:focus-within)::before{border-color:var(--line)}
.wox .cell.bad::before{border-color:var(--terra);background:rgba(196,97,58,.06)}
.wox .cell.filled input{font-weight:500}
.wox .cell.num input{text-align:right;font-family:"DM Mono",monospace;font-feature-settings:"tnum"}
.wox .cell .pre{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--ink-3);font-size:13px;pointer-events:none}
.wox .cell.pre-pad input{padding-left:24px}
.wox .cell.calc input{color:var(--ink-2);font-weight:500}
.wox .cell.calc .pre{color:var(--sage);font-weight:600}
.wox .cell.calc .pre::after{content:" ="}

.wox .pop{position:absolute;left:-1px;right:-1px;top:calc(100% + 4px);z-index:30;background:var(--paper);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 30px -12px rgba(47,38,34,.28);padding:4px;display:none;max-height:250px;overflow:auto}
.wox .pop.open{display:block;animation:woxpop .16s var(--ease)}
@keyframes woxpop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.wox .pop button{display:flex;align-items:center;width:100%;gap:10px;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:6px;cursor:pointer}
.wox .pop button:hover{background:var(--terra-tint)}
.wox .pop button small{color:var(--ink-3);margin-left:auto;font-size:12px}
.wox .pop .new{color:var(--terra);font-weight:500}
.wox .pop .new b{width:18px;height:18px;border-radius:50%;background:var(--terra-tint);display:grid;place-items:center;font-size:14px;line-height:1;font-weight:500}

.wox .stg .n{width:44px;text-align:center;color:var(--ink-3);font-size:12px;font-family:"DM Mono"}
.wox .stg .share{text-align:right;padding:0 12px;font-family:"DM Mono";font-size:12px;color:var(--ink-3);white-space:nowrap}
.wox .stg .share b{font-weight:500;color:var(--ink-2)}
.wox .stg .del{width:40px;text-align:center}
.wox .stg .del button{width:28px;height:28px;border:0;background:transparent;border-radius:6px;display:inline-grid;place-items:center;color:var(--ink-3);cursor:pointer;opacity:0;transition:opacity .15s,background .15s,color .15s,transform .15s}
.wox .stg tr:hover .del button,.wox .stg .del button:focus-visible{opacity:1}
.wox .stg .del button:hover{background:var(--terra-tint);color:var(--terra)}
.wox .stg .del button:active{transform:scale(.9)}
.wox .stg .del svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7}
.wox .stg tr.in{animation:woxrowin .28s var(--ease)}
@keyframes woxrowin{from{background:var(--sage-tint)}to{background:transparent}}
.wox .split{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--line-2);margin:14px 16px 4px}
.wox .split i{height:100%;transition:width .35s var(--ease);min-width:0}
.wox .split i:nth-child(5n+1){background:var(--terra)}.wox .split i:nth-child(5n+2){background:var(--gold)}.wox .split i:nth-child(5n+3){background:var(--sage)}.wox .split i:nth-child(5n+4){background:#E0906A}.wox .split i:nth-child(5n+5){background:#8FA98B}
.wox .split-lbl{display:flex;justify-content:space-between;margin:0 16px 12px;font-size:12px;color:var(--ink-3)}

.wox .addrow{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border:0;border-top:1px dashed var(--line);background:var(--paper-2);color:var(--ink-2);cursor:pointer;transition:background .15s,color .15s;font-weight:500}
.wox .addrow:hover{background:var(--terra-tint);color:var(--terra)}
.wox .addrow:active{background:#F1D8CB}
.wox .addrow kbd{font:11px "DM Mono";color:var(--ink-3);border:1px solid var(--line);border-radius:4px;padding:1px 5px;background:var(--paper);margin-left:6px}

.wox tfoot td{background:var(--paper-2);height:44px;padding:0 12px;font-size:13.5px;color:var(--ink-2);border-top:2px solid var(--line)}
.wox tfoot .num{text-align:right;font-family:"DM Mono";font-weight:600;color:var(--ink);font-size:15px}
.wox .gst{display:flex;align-items:center;gap:8px}
.wox .tgl{width:34px;height:20px;border-radius:999px;background:var(--line);border:0;position:relative;cursor:pointer;transition:background .2s;flex:none}
.wox .tgl::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .2s var(--ease)}
.wox .tgl[aria-checked=true]{background:var(--sage)}
.wox .tgl[aria-checked=true]::after{transform:translateX(14px)}

.wox .btn{--bg:var(--paper);--fg:var(--ink);--bd:var(--line);display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:var(--r);border:1px solid var(--bd);background:var(--bg);color:var(--fg);font-weight:500;cursor:pointer;position:relative;overflow:hidden;transition:background .16s var(--ease),border-color .16s,color .16s,transform .12s var(--ease),box-shadow .16s}
.wox .btn:hover{--bg:var(--paper-2);box-shadow:0 2px 8px -4px rgba(47,38,34,.25);transform:translateY(-1px)}
.wox .btn:active{transform:translateY(0) scale(.97);box-shadow:none}
.wox .btn:focus-visible{outline:2px solid var(--terra);outline-offset:2px}
.wox .btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8}
.wox .btn.primary{--bg:var(--terra);--fg:#fff;--bd:var(--terra)}
.wox .btn.primary:hover{--bg:var(--terra-deep);--bd:var(--terra-deep);box-shadow:0 6px 16px -8px rgba(196,97,58,.7)}
.wox .btn.primary:active{--bg:#93441F}
.wox .btn.soft{--bg:var(--terra-tint);--fg:var(--terra);--bd:transparent}
.wox .btn.soft:hover{--bg:#F2D9CC}
.wox .btn.ghost{--bd:transparent;--bg:transparent;color:var(--ink-2)}
.wox .btn.ghost:hover{--bg:var(--paper)}
.wox .btn.sm{height:32px;padding:0 12px;font-size:13.5px}
.wox .btn .lbl{display:inline-flex;align-items:center;gap:8px;transition:opacity .15s,transform .2s var(--ease)}
.wox .btn .alt{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .25s var(--ease)}
.wox .btn.loading .lbl,.wox .btn.done .lbl{opacity:0;transform:translateY(-8px)}
.wox .btn.loading .alt.spin,.wox .btn.done .alt.ok{opacity:1;transform:none}
.wox .btn.loading{pointer-events:none}
.wox .btn.done{--bg:var(--sage);--bd:var(--sage);--fg:#fff;pointer-events:none}
.wox .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:woxspin .7s linear infinite}
.wox .btn.soft .spinner{border-color:rgba(196,97,58,.3);border-top-color:var(--terra)}
@keyframes woxspin{to{transform:rotate(360deg)}}
.wox .ok svg{width:18px;height:18px;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

.wox .note{color:var(--ink-3);font-size:13px;line-height:1.6;margin-top:12px}
.wox .note kbd{font:11px "DM Mono";border:1px solid var(--line);border-radius:4px;padding:1px 5px;background:var(--paper)}
.wox .err{margin-top:14px;padding:10px 14px;border-radius:8px;background:var(--terra-tint);color:var(--terra-deep);font-size:13px;display:flex;gap:8px;align-items:center}

.wox .addform{margin:10px 16px 4px;padding:14px;border-radius:10px;background:var(--paper-2);border:1px solid var(--line);display:grid;gap:10px;max-width:440px}
.wox .addform label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3)}
.wox .addform input,.wox .addform select{width:100%;height:38px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--paper);outline:none}
.wox .addform input:focus,.wox .addform select:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}

.wox .stamp{position:absolute;left:100%;top:-6px;margin-left:16px;padding:4px 10px;border:2px solid var(--sage);color:var(--sage);border-radius:6px;font:600 11px/1 "DM Sans";letter-spacing:.16em;text-transform:uppercase;transform:rotate(-8deg) scale(1.6);opacity:0;white-space:nowrap}
.wox .stamp.on{animation:woxstamp .45s var(--ease) forwards}
@keyframes woxstamp{60%{opacity:1;transform:rotate(-8deg) scale(.95)}100%{opacity:1;transform:rotate(-8deg) scale(1)}}
.wox.locked .sheet{opacity:.75;pointer-events:none}

.woxbar{position:fixed;left:0;right:0;bottom:0;background:rgba(246,242,234,.85);backdrop-filter:blur(10px);border-top:1px solid #E4DCD0;z-index:40}
@media (min-width:768px){.woxbar{left:18rem}}
.woxbar .in{max-width:1020px;margin:0 auto;padding:12px 32px;display:flex;align-items:center;gap:10px}
.woxbar .stat{margin-right:auto;color:#6E635B;font-size:13px;line-height:1.4}
.woxbar .stat b{color:#2F2622;font-weight:500}
.woxbar .stat small{display:block;color:#A39A91}

.woxtoast{position:fixed;left:50%;bottom:84px;transform:translate(-50%,10px);background:#2F2622;color:#FFFDF9;padding:10px 16px;border-radius:999px;font-size:13.5px;opacity:0;pointer-events:none;transition:opacity .2s,transform .3s cubic-bezier(.2,.7,.2,1);display:flex;gap:10px;align-items:center;z-index:50}
.woxtoast.show{opacity:1;transform:translate(-50%,0)}
.woxtoast.warn{background:#A94E2B}
.woxtoast i{width:6px;height:6px;border-radius:50%;background:#5F7F5B}
.woxtoast.warn i{background:#FFD5C2}
.woxbrick{position:fixed;width:12px;height:6px;border-radius:1px;pointer-events:none;z-index:60;will-change:transform,opacity}
.wox .shake{animation:woxshake .4s var(--ease)}
@keyframes woxshake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}

@media (max-width:760px){
  .wox .page{padding:18px 14px 130px}
  .wox .hdr th{width:86px}
  .wox .stg-scroll{overflow-x:auto}.wox .stg-scroll table{min-width:900px}
  .woxbar .in{padding:10px 14px;flex-wrap:wrap}.woxbar .stat{width:100%}
}
@media (prefers-reduced-motion:reduce){.wox *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function bricks(x: number, y: number) {
  if (reduced) return;
  const cs = ['#C4613A', '#E0906A', '#5F7F5B', '#B8862E', '#F1D8CB'];
  for (let i = 0; i < 26; i++) {
    const b = document.createElement('span');
    b.className = 'woxbrick';
    b.style.cssText = `background:${cs[i % 5]};left:${x}px;top:${y}px`;
    document.body.appendChild(b);
    const a = -Math.PI / 2 + (Math.random() - .5) * 1.6, sp = 260 + Math.random() * 260;
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, rot = (Math.random() - .5) * 720;
    b.animate([
      { transform: 'translate(0,0)', opacity: 1 },
      { transform: `translate(${vx * .6}px,${vy * .6 + 140}px) rotate(${rot}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(${vx}px,${vy + 520}px) rotate(${rot * 1.4}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => b.remove();
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export default function NewWorkOrder({ session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();

  const initState = (location.state as any) || {};
  const backTo = initState.returnTo || (initState.from === 'project' && initState.projectId ? `/projects/${initState.projectId}/work-orders` : '/work-orders');

  const [projectId, setProjectId] = useState<string>(initState.projectId || '');
  const [stakeholderId, setStakeholderId] = useState<string>(initState.stakeholderId || '');
  const [conSearch, setConSearch] = useState('');
  const [conOpen, setConOpen] = useState(false);
  const [scope, setScope] = useState('');
  const [agreedValue, setAgreedValue] = useState<number>(0);   // optional; blank ⇒ derive from stages
  const [dateIssued, setDateIssued] = useState(new Date().toISOString().split('T')[0]);
  const [gst, setGst] = useState(false);

  const [stages, setStages] = useState<StageDraft[]>([blankStage()]);
  const [newStageId, setNewStageId] = useState<string | null>(null);

  const [showAddWorker, setShowAddWorker] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState('');
  const [newWorkerTrade, setNewWorkerTrade] = useState('');
  const [newWorkerTradeOther, setNewWorkerTradeOther] = useState('');
  const [newWorkerContact, setNewWorkerContact] = useState('');

  const [source, setSource] = useState<'manual' | 'uploaded_doc'>('manual');
  const [isAiExtracted, setIsAiExtracted] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);

  const [badKeys, setBadKeys] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conCellRef = useRef<HTMLDivElement>(null);

  function blankStage(): StageDraft {
    return { id: Math.random().toString(36).slice(2), name: '', paid_when: '', unit_type: 'LS', quantity: null, rate: null, amount: null };
  }

  const toast = useCallback((text: string, warn?: boolean) => {
    setToastMsg({ text, warn });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2400);
  }, []);

  useEffect(() => {
    if (!newStageId) return;
    const el = document.querySelector(`[data-stage-name="${newStageId}"]`) as HTMLInputElement | null;
    el?.focus();
    setNewStageId(null);
  }, [newStageId, stages.length]);

  // close the contractor popover on an outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (conCellRef.current && !conCellRef.current.contains(e.target as Node)) setConOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name, project_code').eq('status', 'Active').order('name');
      if (error) throw error;
      return data as Array<{ project_id: string; name: string; project_code: string | null }>;
    },
  });

  const { data: workers } = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders').select('stakeholder_id, name, category').eq('type', 'Worker').order('name');
      if (error) throw error;
      return data as Pick<Stakeholder, 'stakeholder_id' | 'name' | 'category'>[];
    },
  });

  const selectedWorker = workers?.find(w => w.stakeholder_id === stakeholderId);
  useEffect(() => { if (selectedWorker && !conSearch) setConSearch(selectedWorker.name); }, [selectedWorker]); // eslint-disable-line

  // ─── Derivations ──────────────────────────────────────────────────────────
  const namedStages = stages.filter(s => s.name.trim());
  const stagesTotal = stages.reduce((sum, s) => sum + calcAmount(s), 0);
  const contractValue = agreedValue > 0 ? agreedValue : stagesTotal;      // saved order_value
  const gstAmt = gst ? contractValue * 0.18 : 0;
  const grossTotal = contractValue + gstAmt;
  const isOver = agreedValue > 0 && stagesTotal > agreedValue + 0.01;
  const measuredCount = stages.filter(s => s.unit_type !== 'LS' && (s.quantity ?? 0) > 0 && (s.rate ?? 0) > 0).length;

  // ─── Create mutation ──────────────────────────────────────────────────────
  const createWO = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!projectId || !stakeholderId || !dateIssued) throw new Error('Please fill in all required fields.');
      const scopeText = scope.trim() || namedStages.map(s => s.name).join(', ') || 'Work contract';
      const milestones = stages
        .filter(s => s.name.trim() || calcAmount(s) > 0)
        .map((s, idx) => {
          const mode = getMode(s);
          return {
            seq_no: idx + 1,
            name: s.name.trim() || `Stage ${idx + 1}`,
            paid_when: s.paid_when.trim() || null,
            unit_type: s.unit_type || null,
            quantity: mode === 'measured' ? s.quantity : (mode === 'lumpsum' ? 1 : null),
            rate: mode === 'measured' ? s.rate : null,
            planned_amount: calcAmount(s),
            ai_extracted: isAiExtracted,
          };
        });
      const { data, error } = await supabase.rpc('create_work_order', {
        p_org_id: orgId,
        p_project_id: projectId,
        p_stakeholder_id: stakeholderId,
        p_scope: scopeText,
        p_order_value: contractValue,
        p_date_issued: dateIssued,
        p_source: source,
        p_milestones: milestones,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create contract');
      return data.wo_id as string;
    },
    onSuccess: (woId, _v, _c) => {
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      setCreated(woId);
      requestAnimationFrame(() => {
        const el = document.getElementById('wox-create');
        if (el) { const r = el.getBoundingClientRect(); bricks(r.left + r.width / 2, r.top + r.height / 2); }
      });
      toast(`${woId} created · ${selectedWorker?.name ?? 'contract'}`);
    },
    onError: (err: any) => toast(err.message || 'Failed to create contract', true),
  });

  const createWorker = useMutation({
    mutationFn: async () => {
      const name = newWorkerName.trim();
      if (!name) throw new Error('Worker name is required');
      const category = newWorkerTrade === OTHER_TRADE ? (newWorkerTradeOther.trim() || 'Other') : newWorkerTrade;
      if (!category) throw new Error('Trade is required');
      const ns = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name, type: 'Worker', category,
        contact: newWorkerContact.trim() || null, org_id: orgId,
      };
      const { data, error } = await supabase.from('stakeholders').insert([ns]).select().single();
      if (error) throw error;
      return data as Stakeholder;
    },
    onSuccess: (w) => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      setStakeholderId(w.stakeholder_id);
      setConSearch(w.name);
      setShowAddWorker(false);
      setNewWorkerName(''); setNewWorkerTrade(''); setNewWorkerTradeOther(''); setNewWorkerContact('');
      showSnackbar(`Worker "${w.name}" added`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to add worker', { type: 'error' }),
  });

  // ─── Stage helpers ──────────────────────────────────────────────────────
  const addStage = () => {
    const s = blankStage();
    setStages(prev => [...prev, s]);
    setNewStageId(s.id);
  };
  const updateStage = (id: string, patch: Partial<StageDraft>) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const removeStage = (id: string) =>
    setStages(prev => {
      if (prev.length === 1) return [blankStage()];   // never leave the table empty
      return prev.filter(s => s.id !== id);
    });
  const clearBad = (key: string) => setBadKeys(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });

  const selectContractor = (id: string, name: string) => {
    setStakeholderId(id); setConSearch(name); setConOpen(false); clearBad('con');
  };

  // ─── AI scan → rows fill directly ────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsExtracting(true);
    try {
      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that file — try again.'));
        reader.onload = () => {
          const res = (reader.result as string) || '';
          const b64 = res.includes(',') ? res.split(',')[1] : '';
          b64 ? resolve(b64) : reject(new Error('Could not read that file — try again.'));
        };
        reader.readAsDataURL(file);
      });
      const { data: extracted, error: efError } = await supabase.functions.invoke('sku-matcher', {
        body: { action: 'extractWorkOrderBoQ', image_base64: base64String, image_mime: file.type },
      });
      if (efError) {
        let msg = efError.message;
        try {
          const ctx = (efError as any).context;
          const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          if (parsed?.error) msg = parsed.error;
        } catch { /* keep the generic message */ }
        throw new Error(msg || 'Could not read the document. Try a clearer photo or a PDF.');
      }
      if ((extracted as any)?.error) throw new Error((extracted as any).error);
      const data = extracted as any;

      if (data.scope_of_work && !scope.trim()) setScope(data.scope_of_work);
      if (data.order_value) setAgreedValue(Number(data.order_value) || 0);
      if (data.date_issued && !isNaN(Date.parse(data.date_issued))) setDateIssued(data.date_issued);
      if (data.worker_name_fuzzy && workers) {
        const match = workers.find(w => w.name.toLowerCase().includes((data.worker_name_fuzzy as string).toLowerCase()));
        if (match) selectContractor(match.stakeholder_id, match.name);
      }

      if (Array.isArray(data.stages) && data.stages.length > 0) {
        const drafted: StageDraft[] = (data.stages as any[]).map((s): StageDraft => {
          const es: ExtractedStage = {
            name: s.name ?? '',
            mode: s.mode ?? 'ambiguous',
            unit_type: s.unit_type ?? null,
            qty: s.qty ?? null,
            rate: s.rate ?? null,
            amount: Number(s.amount) || 0,
            arithmetic_mismatch: Boolean(s.arithmetic_mismatch),
          };
          return {
            id: Math.random().toString(36).slice(2),
            name: es.name,
            paid_when: '',
            unit_type: es.mode === 'measured' ? (es.unit_type ?? 'Sqft') : 'LS',
            quantity: es.mode === 'measured' ? es.qty : null,
            rate: es.mode === 'measured' ? es.rate : null,
            amount: es.mode === 'measured' ? null : es.amount,
            ambiguous: es.mode === 'ambiguous' || es.arithmetic_mismatch,
          };
        });
        // replace the empty starter row(s) with the drafted stages
        setStages(prev => {
          const kept = prev.filter(s => s.name.trim() || calcAmount(s) > 0);
          return [...kept, ...drafted];
        });
      }
      setSource('uploaded_doc');
      setIsAiExtracted(true);
      toast(`Drafted ${Array.isArray(data.stages) ? data.stages.length : 0} stage${(data.stages?.length ?? 0) > 1 ? 's' : ''} from the document — check amounts`);
    } catch (err: any) {
      toast(err.message || 'Failed to read the document', true);
    } finally {
      setIsExtracting(false);
    }
  };

  // ─── Validate + create ────────────────────────────────────────────────────
  function attemptCreate() {
    if (createWO.isPending || created) return;
    const bad = new Set<string>();
    if (!stakeholderId) bad.add('con');
    if (!projectId) bad.add('proj');
    let any = false;
    stages.forEach(s => {
      const named = !!s.name.trim(), amt = calcAmount(s) > 0;
      if (!named && !amt) return;
      any = true;
      if (!named) bad.add(`name-${s.id}`);
      if (!amt) bad.add(`amt-${s.id}`);
    });
    if (!any) bad.add(`name-${stages[0].id}`);
    if (bad.size) {
      setBadKeys(bad);
      toast(bad.size === 1 ? 'One field needs filling' : `${bad.size} fields need filling`, true);
      return;
    }
    if (isOver) { toast(`Stages exceed the agreed value by ${fmt(stagesTotal - agreedValue)}`, true); return; }
    setBadKeys(new Set());
    createWO.mutate();
  }

  // Ctrl/Cmd+Enter creates
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); attemptCreate(); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Access guard ─────────────────────────────────────────────────────────
  if (profile && profile.role !== 'management' && profile.role !== 'principal') {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl">
          <h3 className="text-headline-md font-headline-md">Access Denied</h3>
          <p className="text-body-sm mt-2">Only Management and Principal can create Contracts.</p>
        </div>
      </div>
    );
  }

  const conHits = (workers ?? []).filter(w => w.name.toLowerCase().includes(conSearch.trim().toLowerCase()));
  const conExact = conHits.some(w => w.name.toLowerCase() === conSearch.trim().toLowerCase());

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{WOX_CSS}</style>
      <div className={`wox${created ? ' locked' : ''}`}>
        <div className="page">

          {/* top */}
          <div className="top">
            <button className="back" aria-label="Back" onClick={() => navigate(backTo)}>
              <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <div className="title-wrap">
              <h1>New work contract</h1>
              <span className={`stamp${created ? ' on' : ''}`}>Created</span>
            </div>
            <div className="wo">
              <i /><span>{created ? 'Contract' : 'Auto-generated'}</span>
              <span className="mono">{created ?? 'WO · auto'}</span>
            </div>
          </div>

          {/* ===== Agreement ===== */}
          <div className="sec"><h2>Agreement</h2></div>
          <div className="sheet hdr">
            <table>
              <colgroup><col style={{ width: 118 }} /><col /><col style={{ width: 118 }} /><col /></colgroup>
              <tbody>
                <tr>
                  <th>Contractor</th>
                  <td>
                    <div className={`cell${badKeys.has('con') ? ' bad' : ''}${stakeholderId ? ' filled' : ''}`} ref={conCellRef}>
                      <input
                        value={conSearch}
                        onChange={e => { setConSearch(e.target.value); setStakeholderId(''); setConOpen(true); clearBad('con'); }}
                        onFocus={() => setConOpen(true)}
                        placeholder="Search contractor…"
                        autoComplete="off"
                      />
                      <div className={`pop${conOpen && (conHits.length > 0 || conSearch.trim()) ? ' open' : ''}`}>
                        {conHits.map(w => (
                          <button type="button" key={w.stakeholder_id} onMouseDown={e => { e.preventDefault(); selectContractor(w.stakeholder_id, w.name); }}>
                            <span>{w.name}</span>{w.category && <small>{w.category}</small>}
                          </button>
                        ))}
                        {conSearch.trim() && !conExact && (
                          <button type="button" className="new" onMouseDown={e => { e.preventDefault(); setNewWorkerName(conSearch.trim()); setShowAddWorker(true); setConOpen(false); }}>
                            <b>+</b>Add “{conSearch.trim()}” as new contractor
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  <th>Project</th>
                  <td>
                    <div className={`cell sel${badKeys.has('proj') ? ' bad' : ''}${projectId ? ' filled' : ''}`}>
                      <select value={projectId} onChange={e => { setProjectId(e.target.value); clearBad('proj'); }}>
                        <option value="">Choose project</option>
                        {projects?.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                      </select>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>Starts</th>
                  <td><div className="cell filled"><input type="date" value={dateIssued} onChange={e => setDateIssued(e.target.value)} /></div></td>
                  <th>Value</th>
                  <td>
                    <div className={`cell num pre-pad${agreedValue > 0 ? ' filled' : ''}`}>
                      <span className="pre">₹</span>
                      <input
                        inputMode="decimal"
                        value={agreedValue || ''}
                        onChange={e => setAgreedValue(parseAmount(e.target.value))}
                        placeholder="agreed total — or leave blank to add up from stages"
                        style={{ textAlign: 'left', fontFamily: 'inherit' }}
                      />
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>Work</th>
                  <td colSpan={3}>
                    <div className={`cell${scope.trim() ? ' filled' : ''}`}>
                      <input value={scope} onChange={e => setScope(e.target.value)} placeholder="One line — e.g. Structure up to GF slab, labour only" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* add-contractor inline form */}
          {showAddWorker && (
            <div className="addform">
              <div>
                <label>New contractor</label>
                <input value={newWorkerName} onChange={e => setNewWorkerName(e.target.value)} placeholder="Contractor name" autoFocus style={{ marginTop: 6 }} />
              </div>
              <select value={newWorkerTrade} onChange={e => { setNewWorkerTrade(e.target.value); setNewWorkerTradeOther(''); }}>
                <option value="" disabled>Select trade…</option>
                {WORKER_TRADE_GROUPS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.trades.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
              {newWorkerTrade === OTHER_TRADE && (
                <input value={newWorkerTradeOther} onChange={e => setNewWorkerTradeOther(e.target.value)} placeholder="Specify trade…" />
              )}
              <PhoneInput value={newWorkerContact} onChange={setNewWorkerContact} placeholder="Contact (optional)" style={{ height: 40 }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost sm" onClick={() => { setShowAddWorker(false); setNewWorkerName(''); setNewWorkerTrade(''); setNewWorkerTradeOther(''); setNewWorkerContact(''); }}>Cancel</button>
                <button type="button" className="btn primary sm" disabled={!newWorkerName.trim() || !newWorkerTrade || (newWorkerTrade === OTHER_TRADE && !newWorkerTradeOther.trim()) || createWorker.isPending} onClick={() => createWorker.mutate()}>
                  {createWorker.isPending ? 'Saving…' : 'Save & select'}
                </button>
              </div>
            </div>
          )}

          {/* ===== Stages & payments ===== */}
          <div className="sec">
            <h2>Stages &amp; payments</h2>
            <label className="btn soft sm" style={{ cursor: isExtracting ? 'default' : 'pointer' }}>
              {isExtracting
                ? <span className="lbl"><span className="spinner" /> Reading…</span>
                : <span className="lbl">
                    <svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16" /></svg>
                    Scan agreement / quote
                  </span>}
              <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFileUpload} disabled={isExtracting} />
            </label>
          </div>

          <div className="sheet stg">
            <div className="split">
              {stagesTotal > 0
                ? stages.filter(s => calcAmount(s) > 0).map(s => <i key={s.id} style={{ width: `${(calcAmount(s) / stagesTotal) * 100}%` }} />)
                : <i style={{ width: '100%', background: 'var(--line-2)' }} />}
            </div>
            <div className="split-lbl">
              <span>How the money splits across stages</span>
              <span>{stagesTotal > 0
                ? `${stages.filter(s => calcAmount(s) > 0).length} payments · biggest ${Math.round(Math.max(...stages.map(s => calcAmount(s))) / stagesTotal * 100)}%`
                : 'no stages yet'}</span>
            </div>

            <div className="stg-scroll">
              <table>
                <colgroup>
                  <col style={{ width: 44 }} /><col style={{ width: '21%' }} /><col /><col style={{ width: '8%' }} />
                  <col style={{ width: '9%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '8%' }} /><col style={{ width: 40 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th><th>Stage</th><th>Paid when</th><th style={{ textAlign: 'right' }}>Qty</th><th>Unit</th>
                    <th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Share</th><th />
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s, i) => (
                    <StageRow
                      key={s.id}
                      idx={i + 1}
                      stage={s}
                      total={stagesTotal}
                      isLast={i === stages.length - 1}
                      badName={badKeys.has(`name-${s.id}`)}
                      badAmt={badKeys.has(`amt-${s.id}`)}
                      onChange={patch => updateStage(s.id, patch)}
                      onClearBad={which => clearBad(`${which}-${s.id}`)}
                      onRemove={() => removeStage(s.id)}
                      onAddRow={addStage}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>
                      <span className="gst">
                        <button type="button" className="tgl" role="switch" aria-checked={gst} aria-label="Add GST 18%" onClick={() => setGst(g => !g)} />
                        GST 18%<span className="mono" style={{ color: 'var(--ink-3)' }}>{fmt(gstAmt)}</span>
                      </span>
                    </td>
                    <td colSpan={2} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {agreedValue > 0 ? 'Contract value' : 'Contract value (from stages)'}
                    </td>
                    <td className="num">{fmt(grossTotal)}</td><td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <button type="button" className="addrow" onClick={addStage}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
              Add stage <kbd>Enter</kbd> on the last row also adds one
            </button>
          </div>

          {isOver && (
            <div className="err">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z" /></svg>
              Stages exceed the agreed value by {fmt(stagesTotal - agreedValue)}
            </div>
          )}

          <div className="note">
            Each stage becomes a payable milestone. Lump-sum stages take a straight amount; pick a measured unit (Sqft / Rft / Cft / Nos …) to enter qty × rate — the amount computes, and measured stages settle on actual site measurement at billing. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> creates the contract.
          </div>
        </div>
      </div>

      {/* fixed bottom bar */}
      <div className="woxbar">
        <div className="in">
          <div className="stat">
            <b>{namedStages.length ? `${namedStages.length} stage${namedStages.length > 1 ? 's' : ''}` : 'No stages'}</b>
            <span className="mono" style={{ marginLeft: 6 }}>{fmt(grossTotal)}</span>
            <small>{namedStages.length
              ? `${conSearch || 'Contractor'} · ${measuredCount ? `${measuredCount} measured stage${measuredCount > 1 ? 's' : ''} settle on actual quantities` : 'paid stage by stage as work completes'}`
              : 'Add at least one stage, or scan the agreement'}</small>
          </div>
          {created ? (
            <button className="btn" onClick={() => navigate(initState.returnTo
              ? initState.returnTo
              : `/work-orders/${created}`, { state: initState.from === 'project' ? { from: 'project', projectId: initState.projectId, projectName: initState.projectName } : undefined })}>
              Open contract
            </button>
          ) : (
            <button className="btn ghost" onClick={() => navigate(backTo)}>Cancel</button>
          )}
          <button
            id="wox-create"
            className={`btn primary${createWO.isPending ? ' loading' : ''}${created ? ' done' : ''}`}
            onClick={attemptCreate}
          >
            <span className="lbl"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg>Create contract</span>
            <span className="alt spin"><span className="spinner" /></span>
            <span className="alt ok"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg></span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className={`woxtoast show${toastMsg.warn ? ' warn' : ''}`}><i /><span>{toastMsg.text}</span></div>
      )}
    </>
  );
}

// ─── Stage row ──────────────────────────────────────────────────────────────
function StageRow({
  idx, stage, total, isLast, badName, badAmt, onChange, onClearBad, onRemove, onAddRow,
}: {
  idx: number;
  stage: StageDraft;
  total: number;
  isLast: boolean;
  badName: boolean;
  badAmt: boolean;
  onChange: (patch: Partial<StageDraft>) => void;
  onClearBad: (which: 'name' | 'amt') => void;
  onRemove: () => void;
  onAddRow: () => void;
}) {
  const [namePop, setNamePop] = useState(false);
  const mode = getMode(stage);
  const isLS = stage.unit_type === 'LS';
  const amount = calcAmount(stage);
  const share = amount && total ? Math.round((amount / total) * 100) : 0;

  const usedFilter = STAGE_NAMES.filter(n => n.toLowerCase().includes(stage.name.toLowerCase()) && n.toLowerCase() !== stage.name.toLowerCase()).slice(0, 6);

  const enterAdds = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); if (isLast) onAddRow(); } };

  return (
    <tr className="in" style={stage.ambiguous ? { boxShadow: 'inset 3px 0 0 #E5A100' } : undefined}
        title={stage.ambiguous ? 'Verify this stage — check the amount or add qty & rate' : undefined}>
      <td className="n">{idx}</td>

      {/* Stage name + suggestions */}
      <td>
        <div className={`cell${badName ? ' bad' : ''}${stage.name ? ' filled' : ''}`}>
          <input
            data-stage-name={stage.id}
            value={stage.name}
            onChange={e => { onChange({ name: e.target.value }); onClearBad('name'); setNamePop(true); }}
            onFocus={() => setNamePop(true)}
            onBlur={() => { setTimeout(() => setNamePop(false), 120); if (!stage.unit_type || stage.unit_type === 'LS') { const u = suggestUnit(stage.name); if (u) onChange({ unit_type: u }); } }}
            onKeyDown={e => { if (e.key === 'Enter' && namePop && usedFilter[0]) { e.preventDefault(); onChange({ name: usedFilter[0] }); setNamePop(false); } else enterAdds(e); if (e.key === 'Escape') setNamePop(false); }}
            placeholder="Stage name…"
            autoComplete="off"
          />
          <div className={`pop${namePop && usedFilter.length > 0 ? ' open' : ''}`}>
            {usedFilter.map(n => (
              <button type="button" key={n} onMouseDown={e => { e.preventDefault(); onChange({ name: n }); setNamePop(false); }}>
                <span>{n}</span>
              </button>
            ))}
          </div>
        </div>
      </td>

      {/* Paid when */}
      <td>
        <div className={`cell${stage.paid_when ? ' filled' : ''}`}>
          <input value={stage.paid_when} onChange={e => onChange({ paid_when: e.target.value })} onKeyDown={enterAdds} placeholder="e.g. on slab casting" />
        </div>
      </td>

      {/* Qty */}
      <td>
        <div className={`cell num${!isLS && stage.quantity != null ? ' filled' : ''}`}>
          {isLS
            ? <input value="" readOnly placeholder="—" tabIndex={-1} style={{ pointerEvents: 'none' }} />
            : <input inputMode="decimal" value={stage.quantity ?? ''} onChange={e => onChange({ quantity: parseFloat(e.target.value) || null, amount: null })} onKeyDown={enterAdds} placeholder="—" />}
        </div>
      </td>

      {/* Unit */}
      <td>
        <div className="cell sel">
          <select
            value={stage.unit_type}
            onChange={e => {
              const u = e.target.value;
              onChange(u === 'LS'
                ? { unit_type: 'LS', quantity: null, rate: null }
                : { unit_type: u, amount: null });
            }}
          >
            {UNIT_GROUPS.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map(it => <option key={it.value} value={it.value}>{it.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </td>

      {/* Rate */}
      <td>
        <div className={`cell num pre-pad${!isLS && stage.rate != null ? ' filled' : ''}`}>
          <span className="pre">₹</span>
          {isLS
            ? <input value="" readOnly placeholder="—" tabIndex={-1} style={{ pointerEvents: 'none' }} />
            : <input inputMode="decimal" value={stage.rate ?? ''} onChange={e => onChange({ rate: parseFloat(e.target.value) || null, amount: null })} onKeyDown={enterAdds} placeholder="—" />}
        </div>
      </td>

      {/* Amount (computed for measured, entered otherwise) */}
      <td>
        <div className={`cell num pre-pad${badAmt ? ' bad' : ''}${mode === 'measured' ? ' calc filled' : (stage.amount ? ' filled' : '')}`}>
          <span className="pre">₹</span>
          {mode === 'measured'
            ? <input value={Math.round(amount)} readOnly tabIndex={-1} />
            : <input inputMode="decimal" value={stage.amount ?? ''} onChange={e => { onChange({ amount: parseFloat(e.target.value) || null, quantity: null, rate: null }); onClearBad('amt'); }} onKeyDown={enterAdds} placeholder="amount" />}
        </div>
      </td>

      {/* Share */}
      <td className="share">{share ? <b>{share}%</b> : '—'}</td>

      {/* Delete */}
      <td className="del">
        <button type="button" aria-label="Remove stage" onClick={onRemove}>
          <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
        </button>
      </td>
    </tr>
  );
}
