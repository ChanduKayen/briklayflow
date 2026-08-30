import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import type { StatusHistoryEntry, PaymentMode } from '../types';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';
import {
  fmtDate as pdfFmtDate, fmtRupee,
  MARGIN, CONTENT, RIGHT, C,
  setColor, setFill, drawRule,
  sectionLabel, valueText, drawHeader, drawFooter, drawSignatures,
} from '../lib/pdfHelpers';
import { parseAmount } from '../lib/money';

// A milestone counts as work-done when the site marks it complete/approved/paid; otherwise the
// work-done estimate falls back to how much of it has been paid. Honest, from real status.
const DONE_STATUSES = new Set(['Completed', 'Approved', 'Paid']);
const SETTLE_TOLERANCE = 50;

const fmt = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
// Placeholder strings some contracts carry as a stage name / condition — treated as empty.
const PLACEHOLDER = new Set(['', 'none', 'n/a', 'na', '-', '—', 'null', 'undefined', 'stage']);
const cleanText = (s: any): string => { const t = String(s ?? '').trim(); return PLACEHOLDER.has(t.toLowerCase()) ? '' : t; };
const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmtLogTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const hasTime = iso.length > 10;
  return hasTime ? `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : day;
}

function bricks(x: number, y: number) {
  if (reduced) return;
  const cs = ['#C4613A', '#E0906A', '#5F7F5B', '#B8862E', '#F1D8CB'];
  for (let i = 0; i < 24; i++) {
    const b = document.createElement('span');
    b.className = 'cdx-brick';
    b.style.cssText = `background:${cs[i % 5]};left:${x}px;top:${y}px`;
    document.body.appendChild(b);
    const a = -Math.PI / 2 + (Math.random() - .5) * 1.6, sp = 240 + Math.random() * 240;
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, rot = (Math.random() - .5) * 720;
    b.animate([
      { transform: 'translate(0,0)', opacity: 1 },
      { transform: `translate(${vx * .6}px,${vy * .6 + 130}px) rotate(${rot}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(${vx}px,${vy + 480}px) rotate(${rot * 1.4}deg)`, opacity: 0 },
    ], { duration: 1050 + Math.random() * 400, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => b.remove();
  }
}

const CDX_CSS = `
.cdx{
  --cream:#F6F2EA; --paper:#FFFDF9; --paper-2:#FBF8F2;
  --ink:#2F2622; --ink-2:#6E635B; --ink-3:#A39A91;
  --line:#E4DCD0; --line-2:#EFE9DF;
  --terra:#C4613A; --terra-deep:#A94E2B; --terra-tint:#F8E7DE;
  --sage:#5F7F5B; --sage-tint:#E7EFE4; --sage-soft:#B9CBB5;
  --gold:#B8862E; --gold-tint:#F7EEDA;
  --r:8px; --ease:cubic-bezier(.2,.7,.2,1);
  --shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);
  background:var(--cream);color:var(--ink);font:15px/1.45 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;
}
.cdx *{box-sizing:border-box}
.cdx button,.cdx input,.cdx select{font:inherit;color:inherit}
.cdx input::placeholder{color:var(--ink-3)}
.cdx .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum"}
.cdx .page{max-width:1080px;margin:0 auto;padding:22px 32px 90px}
.cdx .page>*{animation:cdxrise .5s var(--ease) both}
@keyframes cdxrise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.cdx .crumb{display:flex;align-items:center;gap:6px;color:var(--ink-3);font-size:13px;margin-bottom:16px}
.cdx .crumb a{color:var(--ink-2);text-decoration:none;padding:4px 6px;border-radius:6px;margin-left:-6px;cursor:pointer;transition:background .15s}
.cdx .crumb a:hover{background:var(--paper)}
.cdx .crumb b{color:var(--ink);font-weight:500}
.cdx .head{display:grid;grid-template-columns:1fr auto auto;gap:8px 22px;align-items:start;margin-bottom:20px;position:relative;z-index:40}
.cdx h1{font:600 28px/1.1 "Playfair Display",Georgia,serif;margin:0 0 8px;letter-spacing:-.01em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cdx .tag{font:500 13px/1 "DM Mono";letter-spacing:.04em;color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:6px 9px;border-radius:6px}
.cdx .meta{color:var(--ink-2);font-size:14px;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center}
.cdx .meta b{color:var(--ink);font-weight:500}
.cdx .meta a{color:var(--ink);text-decoration:none;border-bottom:1px dashed var(--ink-3);font-weight:500;cursor:pointer}
.cdx .meta a:hover{border-bottom-style:solid;color:var(--terra)}
.cdx .meta .sep{width:1px;height:16px;background:var(--line)}
.cdx .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12.5px;font-weight:500;border:1px solid transparent}
.cdx .chip i{width:6px;height:6px;border-radius:50%}
.cdx .chip.gold{color:var(--gold);background:var(--gold-tint)}.cdx .chip.gold i{background:var(--gold)}
.cdx .chip.sage{color:var(--sage);background:var(--sage-tint)}.cdx .chip.sage i{background:var(--sage)}
.cdx .chip.terra{color:var(--terra-deep);background:var(--terra-tint)}.cdx .chip.terra i{background:var(--terra)}
.cdx .scope{color:var(--ink-2);font-size:14px;margin-top:6px}
.cdx .scope b{color:var(--ink);font-weight:500}
.cdx .amount{text-align:right;padding-top:2px}
.cdx .amount small{border-top:3px solid var(--terra);padding-top:6px;display:inline-block;font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);margin-bottom:2px}
.cdx .amount .mono{font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1;display:block}
.cdx .amount .dir{font-size:12px;color:var(--ink-3);margin-top:2px}
.cdx .more{position:relative}
.cdx .kebab{width:36px;height:36px;border-radius:50%;border:1px solid transparent;background:transparent;cursor:pointer;display:grid;place-items:center;color:var(--ink-2);transition:background .15s,border-color .15s,transform .12s}
.cdx .kebab:hover{background:var(--paper);border-color:var(--line)}
.cdx .kebab:active{transform:scale(.92)}
.cdx .menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--paper);border:1px solid var(--line);border-radius:var(--r);box-shadow:0 12px 30px -12px rgba(47,38,34,.28);padding:4px;min-width:200px;z-index:90;animation:cdxpop .16s var(--ease)}
@keyframes cdxpop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.cdx .menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:transparent;text-align:left;padding:9px 10px;border-radius:6px;cursor:pointer}
.cdx .menu button:hover{background:var(--paper-2)}
.cdx .menu button.danger{color:var(--terra)}.cdx .menu button.danger:hover{background:var(--terra-tint)}
.cdx .menu hr{border:0;border-top:1px solid var(--line-2);margin:4px 0}
.cdx .menu svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7}
.cdx .approve{display:flex;align-items:center;gap:14px;background:var(--gold-tint);border:1px solid #EBD9B4;border-radius:10px;padding:12px 16px;margin-bottom:20px}
.cdx .approve p{margin:0;flex:1;font-size:14px;color:var(--ink-2)}
.cdx .approve p b{color:var(--ink);font-weight:500}
.cdx .sec{display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px}
.cdx .sec h2{margin:0;font:600 11.5px/1 "DM Sans";letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2);padding-left:10px;border-left:3px solid var(--terra);display:flex;align-items:center;gap:14px;flex:1}
.cdx .sec h2::after{content:"";flex:1;height:1px;background:var(--line);margin-right:14px}
.cdx .legend{display:flex;gap:14px;font-size:12px;color:var(--ink-2);align-items:center;white-space:nowrap}
.cdx .legend i{display:inline-block;width:14px;height:7px;border-radius:3px;margin-right:5px;vertical-align:0}
.cdx .legend .paid i{background:var(--sage)}
.cdx .legend .est i{background:var(--sage-soft)}
.cdx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow)}
.cdx .sheet.clip{overflow:hidden}
.cdx table{width:100%;border-collapse:collapse;table-layout:fixed}
.cdx th{font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:9px 12px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap}
.cdx td{padding:8px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle}
.cdx th+th,.cdx td+td{border-left:1px solid var(--line-2)}
.cdx tbody tr:last-child td{border-bottom:0}
.cdx .num{text-align:right;font-family:"DM Mono",monospace;font-feature-settings:"tnum"}
.cdx .dim{color:var(--ink-3)}
.cdx .n{text-align:center;color:var(--ink-3);font-size:12px;font-family:"DM Mono"}
.cdx .money{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:22px;box-shadow:var(--shadow)}
.cdx .money>div{padding:16px 20px 14px;border-right:1px solid var(--line-2);position:relative}
.cdx .money>div::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--line-2)}
.cdx .money>div:last-child{border-right:0}
.cdx .money>div:nth-child(2)::before{background:var(--sage-soft)}
.cdx .money>div:nth-child(3)::before{background:var(--sage)}
.cdx .money>div.gap::before{background:var(--gold)}
.cdx .money small{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:4px}
.cdx .money .mono{font-size:22px;font-weight:500;letter-spacing:-.01em}
.cdx .money .sub{font-size:12px;color:var(--ink-3);margin-top:2px}
.cdx .money .gap .mono{color:var(--gold)}
.cdx .stg td{height:64px}
.cdx .stg .name b{display:block;font-weight:600;letter-spacing:-.005em}
.cdx .stg .name small{display:block;color:var(--ink-3);font-size:12px;margin-top:1px}
.cdx .stg .name .meas{display:inline-block;font:500 10.5px "DM Mono";letter-spacing:.05em;color:var(--gold);background:var(--gold-tint);padding:2px 5px;border-radius:4px;margin-left:6px;vertical-align:1px}
.cdx .prog{min-width:0}
.cdx .bar{position:relative;height:8px;border-radius:4px;background:var(--line-2);overflow:hidden;margin-bottom:6px}
.cdx .bar .est{position:absolute;inset:0 auto 0 0;background:var(--sage-soft);border-radius:4px;transition:width .5s var(--ease)}
.cdx .bar .paid{position:absolute;inset:0 auto 0 0;background:var(--sage);border-radius:4px;transition:width .5s var(--ease)}
.cdx .prog .lbl{font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cdx .prog .lbl .hint{color:var(--ink-3)}
.cdx .prog .lbl .ahead{color:var(--gold);font-weight:500}
.cdx .paidcell small{display:block;font-size:11.5px;color:var(--ink-3);font-family:"DM Sans"}
.cdx .stg .done-tick{color:var(--sage);font-weight:600}
.cdx td.act{width:130px;text-align:right}
.cdx .next{height:30px;padding:0 12px;border-radius:6px;border:1px solid var(--terra);background:var(--terra);color:#fff;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s,transform .12s,box-shadow .15s,opacity .15s}
.cdx .next:hover{background:var(--terra-deep);transform:translateY(-1px);box-shadow:0 5px 12px -6px rgba(196,97,58,.7)}
.cdx .next:active{transform:scale(.96)}
.cdx .next:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.cdx .inline{display:grid;grid-template-columns:1.1fr 1fr 1fr 1.5fr auto;gap:12px;align-items:end;padding:16px 18px;background:var(--sage-tint);border-top:1px solid var(--line);box-shadow:inset 0 3px 0 rgba(95,127,91,.4);animation:cdxpop .2s var(--ease)}
.cdx .inline .ctx{grid-column:1/-1;font-size:13px;color:var(--ink-2);margin:-4px 0 2px}
.cdx .inline .ctx b{color:var(--ink);font-weight:500}
.cdx .f label{display:block;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2);margin-bottom:5px}
.cdx .f input,.cdx .f select{width:100%;height:38px;border:1px solid var(--line);border-radius:6px;background:var(--paper);padding:0 10px;outline:none;transition:border-color .15s,box-shadow .15s}
.cdx .f input:focus,.cdx .f select:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.cdx .btn{--bg:var(--paper);--fg:var(--ink);--bd:var(--line);display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:var(--r);border:1px solid var(--bd);background:var(--bg);color:var(--fg);font-weight:500;cursor:pointer;position:relative;overflow:hidden;transition:background .16s,border-color .16s,color .16s,transform .12s var(--ease),box-shadow .16s}
.cdx .btn:hover{--bg:var(--paper-2);box-shadow:0 2px 8px -4px rgba(47,38,34,.25);transform:translateY(-1px)}
.cdx .btn:active{transform:translateY(0) scale(.97);box-shadow:none}
.cdx .btn.primary{--bg:var(--terra);--fg:#fff;--bd:var(--terra)}
.cdx .btn.primary:hover{--bg:var(--terra-deep);--bd:var(--terra-deep);box-shadow:0 6px 16px -8px rgba(196,97,58,.7)}
.cdx .btn.ghost{--bd:transparent;--bg:transparent;color:var(--ink-2)}.cdx .btn.ghost:hover{--bg:var(--paper)}
.cdx .btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8}
.cdx .btn:disabled{opacity:.5;pointer-events:none}
.cdx .btn .lbl{display:inline-flex;align-items:center;gap:8px;transition:opacity .15s,transform .2s var(--ease)}
.cdx .btn .alt{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .25s var(--ease)}
.cdx .btn.loading .lbl,.cdx .btn.done .lbl{opacity:0;transform:translateY(-8px)}
.cdx .btn.loading .alt.spin,.cdx .btn.done .alt.ok{opacity:1;transform:none}
.cdx .btn.loading{pointer-events:none}
.cdx .btn.done{--bg:var(--sage);--bd:var(--sage);--fg:#fff;pointer-events:none}
.cdx .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:cdxspin .7s linear infinite}
@keyframes cdxspin{to{transform:rotate(360deg)}}
.cdx .ok svg{width:18px;height:18px;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.cdx tfoot td{background:var(--paper-2);height:44px;font-size:13.5px;color:var(--ink-2);border-top:2px solid var(--line)}
.cdx tfoot td.num{color:var(--ink);font-weight:600;font-size:15px}
.cdx .log{list-style:none;margin:0;padding:6px 0}
.cdx .log li{display:grid;grid-template-columns:120px 14px 1fr;gap:10px;padding:10px 16px;font-size:13.5px;color:var(--ink-2);align-items:start}
.cdx .log li+li{border-top:1px solid var(--line-2)}
.cdx .log li i{width:8px;height:8px;border-radius:50%;background:var(--line);border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line);margin-top:6px}
.cdx .log li:first-child i{background:var(--terra);box-shadow:0 0 0 1px var(--terra)}
.cdx .log .mono{color:var(--ink-3);font-size:12px;padding-top:2px}
.cdx .log b{color:var(--ink);font-weight:500}
.cdx .empty{padding:34px 16px;text-align:center;color:var(--ink-3);font-size:13.5px}
.cdx .ecell{width:100%;height:34px;border:1px solid var(--line);border-radius:6px;background:var(--paper);padding:0 8px;outline:none;transition:border-color .15s,box-shadow .15s}
.cdx .ecell:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.cdx .ecell.num{text-align:right;font-family:"DM Mono",monospace}
.cdx .ecell.sm{height:30px;font-size:12.5px;margin-top:4px}
.cdx .scope-edit{width:100%;min-height:38px;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:8px 10px;outline:none;font-size:14px;margin-top:6px}
.cdx .scope-edit:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.cdx .addrow{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border:0;border-top:1px dashed var(--line);background:var(--paper-2);color:var(--ink-2);cursor:pointer;transition:background .15s,color .15s;font-weight:500}
.cdx .addrow:hover{background:var(--terra-tint);color:var(--terra)}
.cdx .addrow svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}
.cdx .savebar{display:flex;align-items:center;gap:10px;margin-top:14px}
.cdx .savebar .info{margin-right:auto;font-size:13px;color:var(--ink-2)}
.cdx .savebar .info b{color:var(--ink);font-weight:500}
.cdx .rowdel{width:28px;height:28px;border:0;background:transparent;border-radius:6px;display:inline-grid;place-items:center;color:var(--ink-3);cursor:pointer;transition:background .15s,color .15s}
.cdx .rowdel:hover{background:var(--terra-tint);color:var(--terra)}
.cdx .rowdel:disabled{opacity:.3;cursor:not-allowed}
.cdx .rowdel svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7}
.cdx .editing-note{font-size:12.5px;color:var(--terra-deep);background:var(--terra-tint);border-radius:6px;padding:2px 8px;font-weight:500}
.cdx .scrim{position:fixed;inset:0;background:rgba(47,38,34,.35);backdrop-filter:blur(2px);display:grid;place-items:center;z-index:60;padding:20px;animation:cdxfade .15s ease}
@keyframes cdxfade{from{opacity:0}to{opacity:1}}
.cdx-card{background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 60px -20px rgba(47,38,34,.5);max-width:360px;width:100%;padding:22px}
.cdx-card h3{font:600 17px "Playfair Display",Georgia,serif;margin:0 0 8px;color:var(--ink)}
.cdx-card p{margin:0 0 16px;font-size:13.5px;color:var(--ink-2);line-height:1.5}
.cdx-card .row{display:flex;gap:8px;justify-content:flex-end}
.cdx-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,10px);background:#2F2622;color:#FFFDF9;padding:10px 16px;border-radius:999px;font-size:13.5px;opacity:0;pointer-events:none;transition:opacity .2s,transform .3s cubic-bezier(.2,.7,.2,1);z-index:70;display:flex;gap:10px;align-items:center}
.cdx-toast.show{opacity:1;transform:translate(-50%,0)}
.cdx-toast i{width:6px;height:6px;border-radius:50%;background:#5F7F5B}
.cdx-brick{position:fixed;width:12px;height:6px;border-radius:1px;pointer-events:none;z-index:80;will-change:transform,opacity}
.cdx .shake{animation:cdxshake .4s var(--ease)}
@keyframes cdxshake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@media (max-width:900px){
  .cdx .page{padding:16px 14px 60px}
  .cdx .head{grid-template-columns:1fr auto}.cdx .amount{text-align:left;grid-column:1}
  .cdx .money{grid-template-columns:1fr 1fr}
  .cdx .sheet.stgwrap{overflow-x:auto}.cdx .stg table{min-width:920px}
  .cdx .inline{grid-template-columns:1fr 1fr}
}
@media (prefers-reduced-motion:reduce){.cdx *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

export default function WorkOrderDetail({ session }: { session: Session }) {
  const { woId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const navState = (location.state as { from?: string; projectId?: string; projectName?: string }) || {};

  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showStakeholderDrawer, setShowStakeholderDrawer] = useState(false);
  const [approveDone, setApproveDone] = useState(false);

  // Edit mode — change scope, add/remove stages, edit amounts.
  interface EStage { key: string; milestone_id: string | null; name: string; paid_when: string; agreed: string; paid: number }
  const [editMode, setEditMode] = useState(false);
  const [editScope, setEditScope] = useState('');
  const [editStages, setEditStages] = useState<EStage[]>([]);

  // Inline release row — the milestone whose "Release" was tapped.
  const [releaseFor, setReleaseFor] = useState<{ milestone: any; remaining: number } | null>(null);
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseMode, setReleaseMode] = useState<PaymentMode>('NEFT');
  const [releaseDate, setReleaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [releaseRemarks, setReleaseRemarks] = useState('');
  const [releaseBad, setReleaseBad] = useState(false);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = (m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  };

  const canApprove = profile?.role === 'management' || profile?.role === 'principal';
  const canTransition = profile?.role === 'management' || profile?.role === 'accountant';
  const canRelease = canApprove || canTransition;

  useEffect(() => {
    const h = () => setMenuOpen(false);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data: wo, isLoading: loadingWo } = useQuery({
    queryKey: ['wo', woId],
    queryFn: async () => {
      if (!woId) throw new Error('No WO ID');
      const { data, error } = await supabase
        .from('work_orders')
        .select(`*, projects(name, site_location), stakeholders(name, category, contact), wo_milestones(*)`)
        .eq('wo_id', woId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!woId,
  });

  const { data: allocations, isLoading: loadingAllocs } = useQuery({
    queryKey: ['wo_allocations', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, transactions(txn_id, date, status, total_amount, payment_mode, category, remarks)')
        .eq('order_type', 'WO')
        .eq('order_ref', woId);
      if (error) throw error;
      return data.filter((a: any) => a.transactions?.status !== 'Voided');
    },
    enabled: !!woId,
  });

  // ─── Mutations ─────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: async () => {
      const userName = profile?.name || session.user.email || 'Unknown';
      const newEntry: StatusHistoryEntry = { status: 'Assigned', at: new Date().toISOString(), by: userName };
      const payload: Record<string, any> = { status: 'Assigned' };
      if (wo && 'status_history' in wo) payload.status_history = [...((wo as any).status_history || []), newEntry];
      const { data, error } = await supabase.from('work_orders').update(payload).eq('wo_id', woId).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setApproveDone(true);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['wo', woId] });
        queryClient.invalidateQueries({ queryKey: ['work_orders'] });
        queryClient.invalidateQueries({ queryKey: ['nav_wo_pending'] });
        setApproveDone(false);
        toast('Contract approved — payments can now be released');
      }, reduced ? 60 : 700);
    },
    onError: (err: any) => toast(err.message || 'Approval failed'),
  });

  const transitionMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const userName = profile?.name || session.user.email || 'Unknown';
      const newEntry: StatusHistoryEntry = { status: newStatus, at: new Date().toISOString(), by: userName };
      const payload: Record<string, any> = { status: newStatus };
      if (wo && 'status_history' in wo) payload.status_history = [...((wo as any).status_history || []), newEntry];
      const { data, error } = await supabase.from('work_orders').update(payload).eq('wo_id', woId).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, newStatus) => {
      queryClient.invalidateQueries({ queryKey: ['wo', woId] });
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      queryClient.invalidateQueries({ queryKey: ['stakeholder_wos'] });
      setConfirmCancel(false);
      toast(newStatus === 'Cancelled' ? 'Contract cancelled' : `Contract ${String(newStatus).toLowerCase()}`);
    },
    onError: (err: any) => toast(err.message || 'Update failed'),
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      if (!releaseFor || !wo) throw new Error('No stage selected.');
      const amount = parseAmount(releaseAmount);
      if (!amount || amount <= 0) throw new Error('Enter a valid amount.');
      if (!releaseDate) throw new Error('Select a payment date.');
      const txnId = `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const { error: rpcError } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: {
          txn_id: txnId, org_id: orgId, stakeholder_id: wo.stakeholder_id,
          date: releaseDate, total_amount: amount, payment_mode: releaseMode,
          category: 'Running Bill',
          remarks: releaseRemarks || `Payment for ${releaseFor.milestone.name}`,
          ai_flag_status: 'Clean', ai_flag_data: {},
        },
        p_allocations: [{
          project_id: wo.project_id, order_type: 'WO', order_ref: wo.wo_id,
          milestone_id: releaseFor.milestone.milestone_id, allocated_amount: amount,
        }],
      });
      if (rpcError) throw rpcError;
      return amount;
    },
    onSuccess: (amount) => {
      const settledAll = (totalPaid + (amount ?? 0)) >= orderValue - SETTLE_TOLERANCE && orderValue > 0;
      const stageName = releaseFor?.milestone?.name ?? 'stage';
      const leftOnStage = (releaseFor?.remaining ?? 0) - (amount ?? 0);
      queryClient.invalidateQueries({ queryKey: ['wo_allocations', woId] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['stakeholder_txns', wo?.stakeholder_id] });
      setReleaseFor(null); setReleaseAmount(''); setReleaseRemarks(''); setReleaseBad(false);
      if (settledAll) {
        const el = document.getElementById('cdx-total-paid');
        if (el) { const r = el.getBoundingClientRect(); bricks(r.left, r.top); }
        toast('Contract fully settled');
      } else if (leftOnStage <= SETTLE_TOLERANCE) toast(`${stageName} settled in full`);
      else toast(`${fmt(amount ?? 0)} released · ${fmt(leftOnStage)} left on ${stageName}`);
    },
    onError: (err: any) => toast(err.message || 'Failed to release payment'),
  });

  const editSaveMutation = useMutation({
    mutationFn: async () => {
      if (!wo) throw new Error('No contract');
      const rows = editStages.filter((s) => s.name.trim() || parseAmount(s.agreed) > 0);
      if (rows.length === 0) throw new Error('Add at least one stage.');
      const orderVal = rows.reduce((a, s) => a + (parseAmount(s.agreed) || 0), 0);

      // Update the contract header (scope + agreed value = sum of stages).
      const { error: woErr } = await supabase.from('work_orders')
        .update({ scope_of_work: editScope.trim(), order_value: orderVal }).eq('wo_id', woId);
      if (woErr) throw woErr;

      // Delete stages the user removed — only ones with no payments (UI blocks removing paid stages).
      const keptIds = new Set(rows.filter((s) => s.milestone_id).map((s) => s.milestone_id));
      const toDelete = sortedMs.filter((m) => !keptIds.has(m.milestone_id) && (milestonePayments[m.milestone_id] || 0) <= 0);
      for (const m of toDelete) {
        const { error } = await supabase.from('wo_milestones').delete().eq('milestone_id', m.milestone_id);
        if (error) throw error;
      }

      // Upsert the kept + new stages, renumbered by position.
      let seq = 1;
      for (const s of rows) {
        const base = {
          name: s.name.trim() || `Stage ${seq}`,
          planned_amount: parseAmount(s.agreed) || 0,
          trigger_condition: s.paid_when.trim() || null,
          seq_no: seq,
        };
        seq++;
        if (s.milestone_id) {
          const { error } = await supabase.from('wo_milestones').update(base).eq('milestone_id', s.milestone_id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('wo_milestones').insert({
            ...base, wo_id: woId, org_id: (wo as any).org_id,
            unit_type: 'LS', quantity: 1, rate: null, status: 'Pending', ai_extracted: false,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wo', woId] });
      queryClient.invalidateQueries({ queryKey: ['wo_allocations', woId] });
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      setEditMode(false);
      toast('Contract updated');
    },
    onError: (err: any) => toast(err.message || 'Failed to save changes'),
  });

  // ─── Calculations ──────────────────────────────────────────────────────────
  const milestones: any[] = (wo as any)?.wo_milestones ?? [];
  const orderValue = Number(wo?.order_value) || 0;
  const milestonePayments: Record<string, number> = {};
  let totalPaid = 0;
  allocations?.forEach((alloc: any) => {
    const amount = Number(alloc.allocated_amount) || 0;
    totalPaid += amount;
    if (alloc.milestone_id) milestonePayments[alloc.milestone_id] = (milestonePayments[alloc.milestone_id] || 0) + amount;
  });
  const balance = orderValue - totalPaid;
  const progressPercentage = orderValue > 0 ? Math.min(100, Math.round((totalPaid / orderValue) * 100)) : 0;

  const sortedMs = [...milestones].sort((a, b) => (a.seq_no ?? 0) - (b.seq_no ?? 0));
  const sumPlanned = sortedMs.reduce((a, m) => a + (Number(m.planned_amount) || 0), 0);
  // A single-phase contract: one milestone that carries no amount of its own — the whole agreed
  // value IS that one stage's payment. Represent it with the full value, not ₹0.
  const singlePhaseFill = sortedMs.length === 1 && sumPlanned <= SETTLE_TOLERANCE && orderValue > 0;
  const baseRows = sortedMs.map((m) => {
    const agreed = singlePhaseFill ? orderValue : (Number(m.planned_amount) || 0);
    const paid = milestonePayments[m.milestone_id] || 0;
    const bal = agreed - paid;
    const done = bal <= SETTLE_TOLERANCE && agreed > 0;
    const workDone = DONE_STATUSES.has(m.status);
    const estP = workDone ? 1 : (agreed > 0 ? Math.min(1, paid / agreed) : 0);
    const measured = m.unit_type && m.unit_type !== 'LS';
    const measText = measured && (m.quantity || m.rate)
      ? `${m.quantity ?? ''}${m.unit_type ? ' ' + m.unit_type : ''}${m.rate ? ' @ ₹' + Number(m.rate).toLocaleString('en-IN') : ''}`.trim()
      : '';
    const name = singlePhaseFill ? 'Full contract' : (cleanText(m.name) || 'Stage');
    const note = singlePhaseFill ? 'single payment on completion of the work' : (cleanText(m.trigger_condition) || cleanText(m.description));
    return { m, name, note, agreed, paid, bal, done, estP, measured, measText };
  });
  // A contract with no stages settles as one payment for the whole agreed value — a synthetic
  // "Full contract" stage stands in, releasable like any other (its payment allocates with no milestone).
  const synthetic = baseRows.length === 0 && orderValue > 0;
  const stageRows = synthetic
    ? [{
        m: { milestone_id: null, name: 'Full contract', trigger_condition: '', unit_type: 'LS' },
        name: 'Full contract', note: 'single payment on completion of the work',
        agreed: orderValue, paid: totalPaid, bal: orderValue - totalPaid,
        done: orderValue - totalPaid <= SETTLE_TOLERANCE, estP: totalPaid > 0 ? Math.min(1, totalPaid / orderValue) : 0,
        measured: false, measText: '',
      }]
    : baseRows;
  const workDoneEst = stageRows.reduce((a, r) => a + r.estP * r.agreed, 0);
  const workAhead = workDoneEst - totalPaid;
  const releaseCount = allocations?.length ?? 0;

  const handleDownloadPdf = () => {
    if (!wo) return;
    const doc = new jsPDF('p', 'mm', 'a4');
    let y = drawHeader(doc, 'CONTRACT', wo.wo_id);
    const rx = MARGIN + CONTENT / 2;
    sectionLabel(doc, 'ISSUED TO', MARGIN, y); y += 4;
    valueText(doc, wo.stakeholders?.name ?? '—', MARGIN, y, { bold: true, size: 11 }); y += 5;
    valueText(doc, wo.stakeholders?.category ?? '', MARGIN, y, { color: C.muted, size: 8 }); y += 4;
    let ry = y - 13;
    sectionLabel(doc, 'PROJECT', rx, ry); ry += 4;
    valueText(doc, wo.projects?.name ?? '—', rx, ry, { bold: true, size: 11 }); ry += 5;
    if (wo.projects?.site_location) valueText(doc, wo.projects.site_location, rx, ry, { color: C.muted, size: 8 });
    y += 2;
    sectionLabel(doc, 'ISSUED', MARGIN, y); sectionLabel(doc, 'STATUS', rx, y); y += 4;
    valueText(doc, pdfFmtDate(wo.date_issued), MARGIN, y, { size: 9 });
    valueText(doc, wo.status?.toUpperCase() ?? '—', rx, y, { size: 9, bold: true, color: wo.status === 'Active' ? C.warning : wo.status === 'Closed' ? C.success : C.muted });
    y += 8; drawRule(doc, y); y += 7;
    if (wo.scope_of_work) {
      sectionLabel(doc, 'SCOPE OF WORK', MARGIN, y); y += 4;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); setColor(doc, C.dark);
      const lines = doc.splitTextToSize(wo.scope_of_work, CONTENT);
      doc.text(lines, MARGIN, y); y += lines.length * 4.5 + 6; drawRule(doc, y); y += 7;
    }
    sectionLabel(doc, 'FINANCIAL SUMMARY', MARGIN, y); y += 6;
    const rows: [string, number][] = [['Order Value', orderValue], ['Total Paid', totalPaid], ['Balance Due', balance]];
    rows.forEach(([label, val], i) => {
      const isLast = i === rows.length - 1;
      doc.setFontSize(9); doc.setFont('helvetica', isLast ? 'bold' : 'normal');
      setColor(doc, isLast && balance > 0 ? C.warning : C.dark);
      doc.text(label, MARGIN, y); doc.setFont('courier', isLast ? 'bold' : 'normal');
      doc.text(fmtRupee(val), RIGHT, y, { align: 'right' }); y += 5.5;
    });
    y += 2;
    setFill(doc, C.border); doc.roundedRect(MARGIN, y, CONTENT, 2.5, 1, 1, 'F');
    if (progressPercentage > 0) { setFill(doc, progressPercentage >= 100 ? C.success : C.accent); doc.roundedRect(MARGIN, y, CONTENT * (progressPercentage / 100), 2.5, 1, 1, 'F'); }
    y += 5.5; doc.setFontSize(7); doc.setFont('helvetica', 'normal'); setColor(doc, C.muted);
    doc.text(`Payment: ${progressPercentage}%`, MARGIN, y); y += 6; drawRule(doc, y); y += 7;
    if (sortedMs.length > 0) {
      sectionLabel(doc, 'PAYMENT MILESTONES', MARGIN, y); y += 4;
      const msBody = sortedMs.map((m: any, i: number) => {
        const paid = milestonePayments[m.milestone_id] || 0;
        const planned = Number(m.planned_amount) || 0;
        const statusStr = planned > 0 && paid >= planned - SETTLE_TOLERANCE ? 'PAID ✓' : paid > 0 ? 'PARTIAL' : 'PENDING';
        return [String(i + 1), m.name ?? '', fmtRupee(planned), statusStr];
      });
      autoTable(doc, {
        startY: y, head: [['#', 'Milestone', 'Amount', 'Status']], body: msBody, theme: 'plain',
        columnStyles: { 0: { cellWidth: 10, halign: 'center', font: 'courier', fontSize: 8 }, 1: { cellWidth: 98, font: 'helvetica' }, 2: { cellWidth: 40, halign: 'right', font: 'courier' }, 3: { cellWidth: 34, halign: 'center', font: 'helvetica' } },
        headStyles: { fillColor: C.bg, textColor: C.muted as any, fontStyle: 'bold', fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } },
        bodyStyles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } },
        alternateRowStyles: { fillColor: C.bg },
        footStyles: { fillColor: C.white, textColor: C.dark as any, fontStyle: 'bold', fontSize: 9 },
        foot: [['', 'Total', fmtRupee(orderValue), '']], showFoot: 'lastPage', margin: { left: MARGIN, right: MARGIN },
        didParseCell: (data: any) => { if (data.section === 'body' && data.column.index === 3) { const v = String(data.cell.raw); if (v.includes('✓')) data.cell.styles.textColor = C.success; } },
      });
      y = (doc as any).lastAutoTable.finalY + 8; drawRule(doc, y); y += 7;
    }
    if (allocations && allocations.length > 0) {
      sectionLabel(doc, 'PAYMENTS MADE', MARGIN, y); y += 4;
      const paymentsBody = allocations.map((a: any) => { const t = a.transactions; return [t ? pdfFmtDate(t.date) : '—', t?.txn_id ?? '—', t?.category ?? '—', t?.payment_mode ?? '—', fmtRupee(Number(a.allocated_amount) || 0)]; });
      autoTable(doc, {
        startY: y, head: [['Date', 'TXN ID', 'Category', 'Mode', 'Amount']], body: paymentsBody, theme: 'plain',
        columnStyles: { 0: { cellWidth: 28, font: 'helvetica' }, 1: { cellWidth: 42, font: 'courier', fontSize: 7.5 }, 2: { cellWidth: 48, font: 'helvetica' }, 3: { cellWidth: 24, halign: 'center', font: 'helvetica' }, 4: { cellWidth: 40, halign: 'right', font: 'courier' } },
        headStyles: { fillColor: C.bg, textColor: C.muted as any, fontStyle: 'bold', fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 } },
        bodyStyles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } }, margin: { left: MARGIN, right: MARGIN },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
    if (y < 220) {
      drawRule(doc, y); y += 7; sectionLabel(doc, 'TERMS & CONDITIONS', MARGIN, y); y += 5;
      const terms = ['1. Work to be executed as per approved drawings and specifications.', '2. Payment shall be released upon milestone completion and site verification.', '3. Defects liability period: 12 months from date of completion.', '4. Any variations must be approved in writing before execution.'];
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); setColor(doc, C.mid);
      terms.forEach((t) => { const w = doc.splitTextToSize(t, CONTENT); doc.text(w, MARGIN, y); y += w.length * 4 + 1.5; }); y += 4;
    }
    drawRule(doc, y); y += 8; drawSignatures(doc, y, 'Worker Signature', wo.stakeholders?.name); drawFooter(doc);
    doc.save(`Contract_${wo.wo_id}.pdf`);
  };

  // ─── Activity ──────────────────────────────────────────────────────────────
  const statusHistory: StatusHistoryEntry[] = (wo as any)?.status_history || [];
  type Act = { at: string; who: string; what: string };
  const activity: Act[] = [];
  if (wo) {
    activity.push({ at: (wo as any).created_at, who: wo.created_by || 'Someone', what: `created this contract · ${milestones.length} stage${milestones.length !== 1 ? 's' : ''} · ${fmt(orderValue)}` });
    statusHistory.forEach((e) => {
      const verb = e.status === 'Assigned' ? 'approved the contract — releases are now open'
        : e.status === 'Cancelled' ? 'cancelled the contract'
        : e.status === 'Closed' ? 'closed the contract'
        : `marked it ${String(e.status).toLowerCase()}`;
      activity.push({ at: e.at, who: e.by || 'Someone', what: verb });
    });
    (allocations ?? []).forEach((a: any) => {
      const t = a.transactions; if (!t) return;
      const ms = sortedMs.find((m) => m.milestone_id === a.milestone_id);
      activity.push({ at: t.date, who: '', what: `released ${fmt(Number(a.allocated_amount) || 0)}${ms ? ` against ${ms.name}` : ''}${t.payment_mode ? ` · ${t.payment_mode}` : ''}` });
    });
  }
  activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // ─── Loading / not found ───────────────────────────────────────────────────
  if (loadingWo || loadingAllocs) {
    return (
      <div className="cdx"><style>{CDX_CSS}</style>
        <div className="page"><div className="empty" style={{ marginTop: 80 }}>Loading contract…</div></div>
      </div>
    );
  }
  if (!wo) {
    return (
      <div className="cdx"><style>{CDX_CSS}</style>
        <div className="page">
          <div className="empty" style={{ marginTop: 80 }}>Contract not found.</div>
          <div style={{ textAlign: 'center' }}>
            <button className="btn" onClick={() => navigate('/work-orders')}>Back to Contracts</button>
          </div>
        </div>
      </div>
    );
  }

  const status = wo.status as string;
  const isDraft = status === 'Draft';
  const isCancelled = status === 'Cancelled';
  const chipCls = isDraft ? 'gold' : isCancelled ? 'terra' : 'sage';
  const releasable = !isDraft && !isCancelled && canRelease;
  const backTo = navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/work-orders` : '/work-orders';
  const workerName = wo.stakeholders?.name || 'Contractor';
  const startLabel = wo.date_issued ? new Date(wo.date_issued).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const openRelease = (r: typeof stageRows[number]) => {
    setReleaseFor({ milestone: r.m, remaining: r.bal });
    setReleaseAmount(String(Math.round(r.bal)));
    setReleaseRemarks(''); setReleaseBad(false);
    setTimeout(() => document.getElementById('cdx-rel-amt')?.focus(), 30);
  };
  const submitRelease = () => {
    const amt = parseAmount(releaseAmount);
    if (!(amt > 0)) { setReleaseBad(true); setTimeout(() => setReleaseBad(false), 450); return; }
    releaseMutation.mutate();
  };

  const enterEdit = () => {
    setMenuOpen(false);
    setReleaseFor(null);
    setEditScope(wo.scope_of_work || '');
    const seed: EStage[] = sortedMs.map((m) => ({
      key: m.milestone_id, milestone_id: m.milestone_id,
      name: singlePhaseFill ? 'Full contract' : (cleanText(m.name) || ''),
      paid_when: cleanText(m.trigger_condition),
      agreed: String(Math.round(singlePhaseFill ? orderValue : (Number(m.planned_amount) || 0))),
      paid: milestonePayments[m.milestone_id] || 0,
    }));
    if (seed.length === 0) seed.push({ key: Math.random().toString(36).slice(2), milestone_id: null, name: 'Full contract', paid_when: 'single payment on completion of the work', agreed: orderValue ? String(Math.round(orderValue)) : '', paid: totalPaid });
    setEditStages(seed);
    setEditMode(true);
  };
  const addEditStage = () => setEditStages((prev) => [...prev, { key: Math.random().toString(36).slice(2), milestone_id: null, name: '', paid_when: '', agreed: '', paid: 0 }]);
  const updEditStage = (key: string, patch: Partial<EStage>) => setEditStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const delEditStage = (key: string) => setEditStages((prev) => prev.filter((s) => s.key !== key));
  const editTotal = editStages.reduce((a, s) => a + (parseAmount(s.agreed) || 0), 0);

  return (
    <div className="cdx">
      <style>{CDX_CSS}</style>
      <div className="page">
        <div className="crumb"><a onClick={() => navigate(backTo)}>Contracts</a> › <b>{wo.wo_id}</b></div>

        {/* HEAD */}
        <div className="head">
          <div>
            <h1>Work contract <span className="tag mono">{wo.wo_id}</span></h1>
            <div className="meta">
              <span>Contractor <a onClick={() => setShowStakeholderDrawer(true)}>{workerName}</a>{wo.stakeholders?.category && <span className="dim"> · {wo.stakeholders.category}</span>}</span>
              <span className="sep" />
              <span>Project <b>{wo.projects?.name || '—'}</b></span>
              <span className="sep" />
              <span>Started <b>{startLabel}</b></span>
              <span className={`chip ${chipCls}`}><i />{status}</span>
            </div>
            {editMode
              ? <input className="scope-edit" value={editScope} onChange={(e) => setEditScope(e.target.value)} placeholder="One line — the scope of work" />
              : (wo.scope_of_work && <div className="scope">Scope — <b>{wo.scope_of_work}</b></div>)}
          </div>
          <div className="amount">
            <small>Agreed value</small>
            <span className="mono">{fmt(editMode ? editTotal : orderValue)}</span>
            <div className="dir">{editMode ? 'sum of the stages below' : `${milestones.length} stage${milestones.length !== 1 ? 's' : ''} · paid as work completes`}</div>
          </div>
          <div className="more" onClick={(e) => e.stopPropagation()}>
            <button className="kebab" aria-label="More actions" onClick={() => setMenuOpen((o) => !o)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
            {menuOpen && (
              <div className="menu">
                {!isCancelled && (canApprove || canTransition) && (
                  <button onClick={enterEdit}>
                    <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /></svg>Edit contract
                  </button>
                )}
                <button onClick={() => { setMenuOpen(false); handleDownloadPdf(); }}>
                  <svg viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>Download contract PDF
                </button>
                <button onClick={() => { setMenuOpen(false); navigate('/work-orders/new', { state: { stakeholderId: wo.stakeholder_id, projectId: wo.project_id } }); }}>
                  <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 8 8M4 20l4-4M4 20v-4h4" /></svg>Duplicate as new
                </button>
                {!isCancelled && (canApprove || canTransition) && <>
                  <hr />
                  <button className="danger" onClick={() => { setMenuOpen(false); setConfirmCancel(true); }}>
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>Cancel contract
                  </button>
                </>}
              </div>
            )}
          </div>
        </div>

        {/* APPROVE BANNER (draft) */}
        {isDraft && canApprove && !editMode && (
          <div className="approve">
            <p><b>This contract is a draft.</b> {workerName} can't be paid against it until it's approved — check the stages below, then start it.</p>
            <button className={`btn primary${approveMutation.isPending ? ' loading' : ''}${approveDone ? ' done' : ''}`} onClick={() => approveMutation.mutate()}>
              <span className="lbl"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg>Approve &amp; start</span>
              <span className="alt spin"><span className="spinner" /></span>
              <span className="alt ok"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg></span>
            </button>
          </div>
        )}

        {/* MONEY FIGURES */}
        {!editMode && (
          <div className="money">
            <div><small>Agreed</small><span className="mono">{fmt(orderValue)}</span><div className="sub">across {milestones.length} stage{milestones.length !== 1 ? 's' : ''}</div></div>
            <div><small>Work done (est.)</small><span className="mono">{workDoneEst > 0 ? '~' + fmt(workDoneEst) : '—'}</span><div className="sub">from stage status — an aid, not a bill</div></div>
            <div><small>Paid</small><span className="mono" id="cdx-total-paid">{fmt(totalPaid)}</span><div className="sub">{releaseCount ? `${releaseCount} release${releaseCount > 1 ? 's' : ''}` : 'nothing released yet'}</div></div>
            <div className="gap"><small>{workAhead > SETTLE_TOLERANCE ? 'Work ahead of payment' : 'Outstanding'}</small><span className="mono">{workAhead > SETTLE_TOLERANCE ? '~' + fmt(workAhead) : fmt(Math.max(0, balance))}</span><div className="sub">{workAhead > SETTLE_TOLERANCE ? 'estimated work not yet paid for' : 'agreed value still to pay'}</div></div>
          </div>
        )}

        {/* STAGES */}
        <div className="sec">
          <h2>Stages</h2>
          {editMode
            ? <span className="editing-note">Editing — add, remove or change stages</span>
            : <div className="legend"><span className="paid"><i />Paid</span><span className="est"><i />Work done (est.)</span></div>}
        </div>
        <div className="sheet clip stgwrap">
          <table className="stg">
            <colgroup><col style={{ width: 40 }} /><col style={{ width: '22%' }} /><col style={{ width: '26%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: 130 }} /></colgroup>
            <thead><tr>
              <th>#</th><th>Stage</th><th>Work done vs paid</th><th className="num">Agreed</th><th className="num">Paid</th><th className="num">Balance</th><th />
            </tr></thead>
            <tbody>
              {editMode ? (
                editStages.map((s, i) => {
                  const agreedN = parseAmount(s.agreed) || 0;
                  const bal = agreedN - s.paid;
                  return (
                    <tr key={s.key}>
                      <td className="n">{i + 1}</td>
                      <td className="name" colSpan={2}>
                        <input className="ecell" value={s.name} onChange={(e) => updEditStage(s.key, { name: e.target.value })} placeholder="Stage name…" />
                        <input className="ecell sm" value={s.paid_when} onChange={(e) => updEditStage(s.key, { paid_when: e.target.value })} placeholder="Paid when — e.g. on slab casting" />
                      </td>
                      <td className="num"><input className="ecell num" inputMode="decimal" value={s.agreed} onChange={(e) => updEditStage(s.key, { agreed: e.target.value })} placeholder="₹0" /></td>
                      <td className="num paidcell">{s.paid ? fmt(s.paid) : '—'}</td>
                      <td className="num">{fmt(bal)}</td>
                      <td className="act">
                        <button className="rowdel" aria-label="Remove stage" disabled={s.paid > 0} title={s.paid > 0 ? 'Has payments — cannot remove' : 'Remove stage'} onClick={() => delEditStage(s.key)}>
                          <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : stageRows.length === 0 ? (
                <tr><td colSpan={7}><div className="empty">No stages on this contract.</div></td></tr>
              ) : stageRows.map((r, i) => {
                const pct = Math.round(r.estP * 100);
                const paidPct = r.agreed > 0 ? Math.round((r.paid / r.agreed) * 100) : 0;
                const ahead = r.estP * r.agreed - r.paid;
                return (
                  <tr key={r.m.milestone_id ?? 'synthetic'}>
                    <td className="n">{i + 1}</td>
                    <td className="name">
                      <b>{r.name}{r.measured && <span className="meas">MEASURED</span>}</b>
                      {(r.measText || r.note) && <small>{r.measText ? r.measText + (r.note ? ' · ' : '') : ''}{r.note}</small>}
                    </td>
                    <td className="prog">
                      <div className="bar"><span className="est" style={{ width: `${Math.round(r.estP * 100)}%` }} /><span className="paid" style={{ width: `${Math.min(100, paidPct)}%` }} /></div>
                      <div className="lbl">
                        {r.done ? <span className="hint">settled in full</span>
                          : r.estP > 0 ? <>{pct}% done{ahead > 1000 ? <> · <span className="ahead">~{fmt(ahead)} ahead of payment</span></> : ''}</>
                          : <span className="hint">{r.note || 'not started'}</span>}
                      </div>
                    </td>
                    <td className="num">{fmt(r.agreed)}</td>
                    <td className="num paidcell">{r.paid ? fmt(r.paid) : '—'}{r.paid > 0 && !r.done ? <small>{paidPct}% of stage</small> : null}</td>
                    <td className="num">{r.done ? <span className="done-tick">✓ Settled</span> : fmt(r.bal)}</td>
                    <td className="act">
                      {!r.done && releasable && (
                        <button className="next" onClick={() => openRelease(r)} disabled={releaseMutation.isPending}>Release</button>
                      )}
                      {!r.done && !releasable && isDraft && <span className="dim" style={{ fontSize: 12 }} title="Approve the contract first">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td colSpan={3} style={{ textAlign: 'right' }}>Totals</td>
              <td className="num">{fmt(editMode ? editTotal : orderValue)}</td>
              <td className="num">{fmt(totalPaid)}</td>
              <td className="num">{fmt((editMode ? editTotal : orderValue) - totalPaid)}</td>
              <td />
            </tr></tfoot>
          </table>

          {editMode && (
            <button type="button" className="addrow" onClick={addEditStage}>
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg> Add stage
            </button>
          )}

          {!editMode && releaseFor && (
            <div className="inline">
              <div className="ctx">Releasing against <b>{releaseFor.milestone.name}</b> — balance {fmt(releaseFor.remaining)}</div>
              <div className="f"><label>Amount</label><input id="cdx-rel-amt" className={`mono${releaseBad ? ' shake' : ''}`} inputMode="decimal" style={{ textAlign: 'right' }} value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} /></div>
              <div className="f"><label>Paid on</label><input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} /></div>
              <div className="f"><label>Mode</label>
                <select value={releaseMode} onChange={(e) => setReleaseMode(e.target.value as PaymentMode)}>
                  <option value="UPI">UPI</option><option value="NEFT">NEFT / RTGS</option><option value="Cash">Cash</option><option value="Cheque">Cheque</option>
                </select>
              </div>
              <div className="f"><label>Reference / note</label><input value={releaseRemarks} onChange={(e) => setReleaseRemarks(e.target.value)} placeholder="UTR, or 'part payment after measurement'" /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={() => setReleaseFor(null)}>Discard</button>
                <button className={`btn primary${releaseMutation.isPending ? ' loading' : ''}`} onClick={submitRelease}>
                  <span className="lbl">Release payment</span>
                  <span className="alt spin"><span className="spinner" /></span>
                  <span className="alt ok"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg></span>
                </button>
              </div>
            </div>
          )}
        </div>

        {editMode && (
          <div className="savebar">
            <span className="info">Agreed value updates to <b>{fmt(editTotal)}</b> · {editStages.length} stage{editStages.length !== 1 ? 's' : ''}</span>
            <button className="btn ghost" onClick={() => setEditMode(false)} disabled={editSaveMutation.isPending}>Cancel</button>
            <button className={`btn primary${editSaveMutation.isPending ? ' loading' : ''}`} onClick={() => editSaveMutation.mutate()}>
              <span className="lbl"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7" /></svg>Save changes</span>
              <span className="alt spin"><span className="spinner" /></span>
            </button>
          </div>
        )}

        {/* ACTIVITY */}
        <div className="sec"><h2>Activity</h2></div>
        <div className="sheet clip">
          <ul className="log">
            {activity.length === 0 ? <li><span /><i /><span className="dim">No activity yet.</span></li>
              : activity.map((a, i) => (
                <li key={i}><span className="mono">{fmtLogTime(a.at)}</span><i /><span>{a.who ? <><b>{a.who}</b> </> : ''}{a.what}</span></li>
              ))}
          </ul>
        </div>
      </div>

      {confirmCancel && (
        <div className="scrim" onClick={() => setConfirmCancel(false)}>
          <div className="cdx-card" onClick={(e) => e.stopPropagation()}>
            <h3>Cancel this contract?</h3>
            <p>This marks <b>{wo.wo_id}</b> as cancelled. Payments already released stay on record, but no new releases can be made. This can't be undone.</p>
            <div className="row">
              <button className="btn ghost" onClick={() => setConfirmCancel(false)}>Keep it</button>
              <button className={`btn primary${transitionMutation.isPending ? ' loading' : ''}`} onClick={() => transitionMutation.mutate('Cancelled')}>
                <span className="lbl">Cancel contract</span>
                <span className="alt spin"><span className="spinner" /></span>
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="cdx-toast show"><i /><span>{toastMsg}</span></div>}

      {wo.stakeholder_id && (
        <StakeholderLedgerDrawer isOpen={showStakeholderDrawer} onClose={() => setShowStakeholderDrawer(false)} stakeholderId={wo.stakeholder_id} />
      )}
    </div>
  );
}
