// ReviewMobile — the phone's review list, built to the for-review reference design.
//
// Every captured entry is a card in one scrolling column: file them in any order, scroll past what
// can wait. Actions run through the code that already owns them — fileRoughEntry /
// fileRoughEntrySplit / rejectRoughEntry / createParty — and the AI's guessed ids go through
// resolveEntry, the same check the desktop card makes.
import { useMemo, useRef, useState } from 'react';
import type { RoughEntry } from '../../types';
import { fileRoughEntry, fileRoughEntrySplit, rejectRoughEntry, createParty, errMessage, type ProjectSplit } from './fileEntry';
import { resolveEntry, type ProjectLite, type StakeholderLite } from './resolveEntry';
import { BillReviewCard } from './BillReviewCard';
import DragSheet from '../DragSheet';

const CSS = `
.rvm{--tint:#C4502B;--tint-press:#A8431F;--ink:#1B1713;--ink-2:#87807A;--ink-3:#B5AEA7;
  --bg:#F8F6F3;--card:#FFFFFF;--hair:rgba(50,42,35,.1);--good:#2FA04C;--warn:#B45309;
  --spring:cubic-bezier(.32,1.4,.5,1);--ease:cubic-bezier(.25,.1,.25,1);--sheet:cubic-bezier(.32,.72,0,1);
  position:relative;min-height:100dvh;display:flex;flex-direction:column;line-height:normal;
  background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','DM Sans',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.rvm *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.rvm button{font:inherit}

.rvm .hdr{padding:20px 24px 0;display:flex;align-items:baseline}
.rvm .title{font-size:24px;font-weight:800;letter-spacing:-.03em;flex:1;margin:0}
.rvm .filedbtn{border:0;background:none;font-size:14.5px;font-weight:600;color:var(--tint);
  cursor:pointer;padding:6px 0 6px 12px;transition:opacity .15s}
.rvm .filedbtn:active{opacity:.35}
.rvm .meta{display:flex;align-items:center;gap:10px;margin:10px 24px 0}
.rvm .meta .c{font-size:13.5px;color:var(--ink-2);font-variant-numeric:tabular-nums;white-space:nowrap}
.rvm .meta .pbar{flex:1;height:4px;border-radius:4px;background:rgba(27,23,19,.07);overflow:hidden}
.rvm .meta .pbar i{display:block;height:100%;border-radius:4px;background:var(--good);width:0;transition:width .6s var(--ease)}

/* ---------- the column of cards ---------- */
.rvm .deckwrap{flex:1;display:flex;flex-direction:column;min-height:0}
.rvm .deck{flex:1;display:flex;flex-direction:column;gap:14px;overflow-y:auto;
  padding:18px 24px 24px;scrollbar-width:none}
.rvm .deck::-webkit-scrollbar{display:none}
.rvm .cw{width:100%;
  transition:opacity .35s,transform .35s var(--ease),height .35s var(--ease),margin .35s var(--ease)}
.rvm .cw.leaving{opacity:0;transform:translateX(60px) scale(.97)}
.rvm .cw.tuck{opacity:0;transform:translateY(24px) scale(.97)}
.rvm .cw.collapse{height:0 !important;margin-top:-14px;overflow:hidden}

.rvm .rcard{position:relative;background:var(--card);border-radius:24px;padding:20px 20px 18px;
  box-shadow:0 14px 36px -16px rgba(27,23,19,.22)}
.rvm .rcard.enter{animation:rvmenter .5s var(--spring)}
@keyframes rvmenter{from{transform:translateY(14px) scale(.965);opacity:0}to{transform:none;opacity:1}}

.rvm .rcard .top{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-3)}
.rvm .rcard .top i{width:6px;height:6px;border-radius:50%;background:#25D366;flex-shrink:0}
.rvm .rcard .top .f{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvm .editpill{border:1px solid var(--hair);background:none;color:var(--ink-2);cursor:pointer;flex-shrink:0;
  display:flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;
  padding:6px 11px;border-radius:999px;margin:-6px 0;
  transition:transform .15s var(--spring),background .15s}
.rvm .editpill:active{transform:scale(.93);background:rgba(27,23,19,.05)}
.rvm .rcard .amt{font-size:36px;font-weight:800;letter-spacing:-.04em;margin-top:8px;font-variant-numeric:tabular-nums}

.rvm .kvs{margin-top:12px}
.rvm .kv{display:flex;align-items:center;min-height:42px;gap:12px;position:relative}
.rvm .kv+.kv::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rvm .kv .k{width:44px;flex-shrink:0;font-size:13px;font-weight:600;color:var(--ink-3)}
.rvm .kv .v{flex:1;font-size:15.5px;font-weight:600;letter-spacing:-.01em;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
.rvm .kv .v.dim{color:var(--ink-3);font-weight:500}
.rvm .kv.tap{cursor:pointer;border:0;background:none;width:100%;padding:0;color:inherit}
.rvm .kv.tap:active .v{opacity:.5}
.rvm .kv .chev{color:var(--ink-3);flex-shrink:0;transition:transform .3s var(--ease)}
.rvm .kv.open .chev{transform:rotate(180deg)}
.rvm .kv.flash{animation:rvmflash 1.4s var(--ease)}
@keyframes rvmflash{
  0%{background:rgba(180,83,9,.14);border-radius:12px}
  60%{background:rgba(180,83,9,.14);border-radius:12px}
  100%{background:transparent}}
.rvm .kv.flash .k{color:var(--warn)}

.rvm .sug{display:grid;grid-template-rows:0fr;transition:grid-template-rows .35s var(--sheet)}
.rvm .sug.open{grid-template-rows:1fr}
.rvm .sug>.sug-w{overflow:hidden;min-height:0}
.rvm .ddsearch{display:flex;align-items:center;gap:9px;background:var(--bg);border-radius:12px;
  padding:0 14px;height:44px;margin:2px 0 6px}
.rvm .ddsearch svg{color:var(--ink-3);flex-shrink:0}
.rvm .ddsearch input{flex:1;border:0;background:none;font:inherit;font-size:16px;outline:none;color:var(--ink)}
.rvm .ddsearch input::placeholder{color:var(--ink-3)}
.rvm .ddlist{padding-bottom:8px;max-height:238px;overflow-y:auto}
.rvm .dd{display:flex;align-items:center;gap:10px;min-height:46px;padding:6px 4px;cursor:pointer;
  position:relative;transition:background .15s;border-radius:10px;width:100%;border:0;background:none;
  text-align:left;color:inherit}
.rvm .dd:active{background:var(--bg)}
.rvm .dd+.dd::before{content:'';position:absolute;left:4px;right:4px;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rvm .dd .dn{flex:1;font-size:15.5px;font-weight:500;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvm .dd .dt{font-size:12px;font-weight:600;color:var(--ink-3);flex-shrink:0}
.rvm .dd.create .dn{color:var(--tint);font-weight:600}
.rvm .dd.create .dt{color:var(--warn)}
.rvm .ddempty{padding:12px 4px;font-size:13.5px;color:var(--ink-3)}

.rvm .notice{display:flex;align-items:center;gap:8px;margin-top:12px;
  font-size:13px;line-height:1.45;color:var(--ink-2)}
.rvm .notice i{width:6px;height:6px;border-radius:50%;flex-shrink:0;background:var(--ink-3)}
.rvm .notice.newp i{background:var(--warn)}
.rvm .notice b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}

.rvm .splits{margin-top:12px;background:var(--bg);border-radius:14px;padding:4px 14px;cursor:pointer;
  width:100%;border:0;text-align:left;color:inherit;transition:transform .15s var(--spring)}
.rvm .splits:active{transform:scale(.985)}
.rvm .sph{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--ink-2);padding:10px 0 4px}
.rvm .sph i{width:6px;height:6px;border-radius:50%;background:var(--good);flex-shrink:0}
.rvm .sph .e{margin-left:auto;font-weight:600;color:var(--tint)}
.rvm .sprow{display:flex;align-items:baseline;gap:8px;padding:9px 0;position:relative}
.rvm .sprow+.sprow::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rvm .sprow .sa{font-size:14.5px;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.rvm .sprow .sw{flex:1;font-size:14px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)}
.rvm .sprow .sw b{color:var(--ink);font-weight:600}
.rvm .spfoot{font-size:12px;color:var(--ink-3);padding:6px 0 10px}

.rvm .srcline{border:0;background:none;display:flex;align-items:center;gap:6px;
  font-size:13px;color:var(--ink-3);margin-top:12px;cursor:pointer;padding:3px 0}
.rvm .srcline svg{transition:transform .3s var(--ease)}
.rvm .srcline.open svg{transform:rotate(180deg)}
.rvm .msg{display:grid;grid-template-rows:0fr;transition:grid-template-rows .4s var(--sheet)}
.rvm .msg.open{grid-template-rows:1fr}
.rvm .msg>.msg-w{overflow:hidden;min-height:0}
.rvm .msg .m-in{margin-top:10px;font-size:14px;line-height:1.6;color:var(--ink);font-style:italic;
  border-left:2.5px solid rgba(27,23,19,.12);padding-left:13px}

.rvm .ctarow{display:flex;gap:9px;margin-top:16px}
.rvm .cta{flex:1;height:52px;border:0;border-radius:16px;background:var(--tint);color:#fff;
  font-size:16px;font-weight:600;letter-spacing:-.01em;cursor:pointer;
  transition:transform .15s var(--spring),background .25s}
.rvm .cta:active{transform:scale(.97);background:var(--tint-press)}
.rvm .cta:disabled{opacity:.55;pointer-events:none}
.rvm .splitbtn{height:52px;border:0;border-radius:16px;flex-shrink:0;padding:0 16px;
  background:rgba(27,23,19,.05);color:var(--ink-2);cursor:pointer;
  display:flex;align-items:center;gap:7px;font-size:15px;font-weight:600;
  transition:transform .15s var(--spring),background .2s,color .2s}
.rvm .splitbtn:active{transform:scale(.92);background:rgba(27,23,19,.1)}
.rvm .splitbtn svg rect,.rvm .splitbtn svg line{
  stroke-dasharray:66;stroke-dashoffset:66;
  animation:rvmdrawsplit 1.1s var(--ease) .35s forwards}
.rvm .splitbtn svg line{stroke-dasharray:14;stroke-dashoffset:14;animation-delay:.9s;animation-duration:.4s}
@keyframes rvmdrawsplit{to{stroke-dashoffset:0}}
.rvm .splitbtn.has{background:rgba(196,80,43,.1);color:var(--tint);animation:rvmsplitpulse 3.2s ease-in-out infinite}
@keyframes rvmsplitpulse{
  0%,100%{box-shadow:0 0 0 0 rgba(196,80,43,0)}
  50%{box-shadow:0 0 0 5px rgba(196,80,43,.1)}}

/* The reference reserves 10px under the hint and then draws its own tab bar. Ours is the app's,
   fixed and 56px tall over the safe area, so the hint keeps its 10px and clears that too. */
.rvm .hint{text-align:center;font-size:12.5px;color:var(--ink-3);
  padding-bottom:calc(10px + 56px + env(safe-area-inset-bottom));transition:opacity .4s}
.rvm .hint.off{opacity:0}

.rvm .zero{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;padding:0 40px;opacity:0;pointer-events:none;transition:opacity .5s var(--ease);
  background:var(--bg);z-index:20}
.rvm .zero.show{opacity:1;pointer-events:auto}
.rvm .zero .halo{width:92px;height:92px;border-radius:50%;background:var(--card);margin-bottom:24px;
  display:grid;place-items:center;box-shadow:0 12px 32px -12px rgba(27,23,19,.16);
  transform:scale(.5);transition:transform .6s var(--spring) .1s}
.rvm .zero.show .halo{transform:scale(1)}
.rvm .zero .ck path{stroke:var(--good);stroke-width:6.5;fill:none;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:80;stroke-dashoffset:80;transition:stroke-dashoffset .5s var(--ease) .45s}
.rvm .zero.show .ck path{stroke-dashoffset:0}
.rvm .zero h2{font-size:23px;font-weight:800;letter-spacing:-.02em}
.rvm .zero p{font-size:14.5px;color:var(--ink-2);margin-top:8px;line-height:1.55}
.rvm .zero button{margin-top:26px;border:0;background:none;font-size:15px;font-weight:600;
  color:var(--tint);cursor:pointer;padding:8px}

.rvm .scrim{position:fixed;inset:0;z-index:60;background:rgba(20,16,12,.42);opacity:0;
  pointer-events:none;transition:opacity .35s var(--ease)}
.rvm .scrim.show{opacity:1;pointer-events:auto}
.rvm .sheet{position:fixed;left:0;right:0;bottom:0;z-index:61;background:var(--bg);
  border-radius:24px 24px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));
  transform:translateY(105%);transition:transform .45s var(--sheet);
  box-shadow:0 -10px 40px rgba(20,16,12,.18);max-height:82vh;overflow-y:auto}
.rvm .sheet.show{transform:translateY(0)}
.rvm .grab{width:36px;height:4.5px;border-radius:3px;background:rgba(27,23,19,.18);margin:0 auto 16px}
.rvm .sheet h3{font-size:20px;font-weight:700;letter-spacing:-.02em;margin-bottom:12px}
.rvm .flgroup{background:var(--card);border-radius:18px;overflow:hidden}
.rvm .fl{display:flex;align-items:center;gap:12px;padding:14px 18px;position:relative}
.rvm .fl+.fl::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.rvm .fl .w{flex:1;min-width:0}
.rvm .fl .n{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvm .fl .s{font-size:12.5px;color:var(--ink-2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvm .fl .a{font-size:14.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.rvm .flempty{padding:18px;font-size:14px;color:var(--ink-2)}

.rvm .mi{display:flex;align-items:center;background:var(--card);border-radius:15px;width:100%;border:0;
  padding:16px 18px;margin-bottom:8px;font-size:16px;font-weight:500;cursor:pointer;text-align:left;
  color:inherit;transition:transform .15s var(--spring)}
.rvm .mi:active{transform:scale(.98)}
.rvm .mi.dim{color:var(--ink-2)}
.rvm .field{background:var(--card);border-radius:14px;padding:11px 16px;margin-bottom:10px;transition:box-shadow .2s}
.rvm .field:focus-within{box-shadow:0 0 0 2px var(--tint)}
.rvm .field label{display:block;font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:2px}
.rvm .field input{width:100%;border:0;background:none;font:inherit;font-size:16.5px;font-weight:500;color:var(--ink);outline:none}
.rvm .frow{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rvm .sitechips{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px}
.rvm .sitechips button{border:0;background:var(--card);font-size:14px;font-weight:500;color:var(--ink-2);
  padding:9px 16px;border-radius:999px;cursor:pointer;transition:all .2s}
.rvm .sitechips button.on{background:var(--ink);color:#fff;font-weight:600}
.rvm .b2{width:100%;height:52px;border:0;border-radius:16px;font-size:16.5px;font-weight:600;
  color:#fff;background:var(--tint);cursor:pointer;transition:transform .18s var(--spring),opacity .3s}
.rvm .b2:active{transform:scale(.97)}
.rvm .b2:disabled{opacity:.35;pointer-events:none}
.rvm .spline{background:var(--card);border-radius:14px;padding:12px 14px;margin-bottom:10px}
.rvm .spline .r1{display:flex;gap:10px}
.rvm .spline .r1 input.pn{flex:1;border:0;background:var(--bg);border-radius:10px;font:inherit;font-size:16px;
  font-weight:600;padding:10px 12px;outline:none;color:var(--ink);min-width:0}
.rvm .spline .r1 input.pa{width:96px;border:0;background:var(--bg);border-radius:10px;font:inherit;font-size:16px;
  font-weight:700;text-align:right;padding:10px 12px;outline:none;color:var(--ink);font-variant-numeric:tabular-nums}
.rvm .spline input:focus{box-shadow:0 0 0 2px var(--tint)}
.rvm .spline select{width:100%;margin-top:8px;border:0;background:var(--bg);border-radius:10px;font:inherit;
  font-size:16px;font-weight:500;color:var(--ink-2);padding:9px 12px;outline:none;
  -webkit-appearance:none;appearance:none}
.rvm .addline2{display:block;width:100%;border:1.5px dashed rgba(27,23,19,.18);background:none;
  border-radius:14px;font-size:14.5px;font-weight:600;color:var(--tint);
  padding:13px;cursor:pointer;margin-bottom:12px;transition:background .15s}
.rvm .addline2:active{background:rgba(196,80,43,.06)}
.rvm .splitsum{text-align:center;font-size:13.5px;color:var(--ink-2);margin:2px 0 14px;font-variant-numeric:tabular-nums}
.rvm .splitsum.err{color:#D0342C;font-weight:600}
.rvm .autonote{font-size:13px;color:var(--ink-3);text-align:center;margin-top:10px;line-height:1.45}

@media (prefers-reduced-motion:reduce){
  .rvm *,.rvm *::before,.rvm *::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const CHEV = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;

/** A card's local edits — the list never writes to the row until it is filed. */
export interface Draft {
  payeeId: string | null;
  payeeName: string | null;
  projectId: string | null;
  amount: number;
  description: string;
  /** built in the split sheet; the extractor produces no split of its own */
  split: { payeeId: string | null; payeeName: string; projectId: string; amount: number }[] | null;
}

export interface ReviewMobileProps {
  entries: RoughEntry[];
  filed: RoughEntry[];
  orgId: string;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  onChanged: () => void;
  onError: (msg: string) => void;
  senderLine: string | null;
  onManageSenders: () => void;
  onOpenWhatsApp: () => void;
}

/** One entry's card. Its own open/closed state lives here so a long list stays independent. */
function Card({
  entry, draft, projects, stakeholders, busy, onPatch, onMenu, onSplit, onFile, register,
}: {
  entry: RoughEntry;
  draft: Draft;
  projects: ProjectLite[];
  stakeholders: StakeholderLite[];
  busy: boolean;
  onPatch: (d: Partial<Draft>) => void;
  onMenu: () => void;
  onSplit: () => void;
  onFile: (nudge: (which: 'to' | 'site') => void) => void;
  register: (el: HTMLDivElement | null) => void;
}) {
  const [sug, setSug] = useState<null | 'to' | 'site'>(null);
  const [ddq, setDdq] = useState('');
  const [msgOpen, setMsgOpen] = useState(false);
  const [flash, setFlash] = useState<null | 'to' | 'site'>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLInputElement>(null);

  const projectName = draft.projectId ? projects.find(x => x.project_id === draft.projectId)?.name ?? null : null;
  const isNewParty = !draft.payeeId && !!draft.payeeName?.trim();
  const senderName = entry.sender_name || 'Someone';
  const via = entry.source?.startsWith('WHATSAPP') ? 'WhatsApp' : 'Briklay';
  const sentTime = new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const message = (entry.transcribed_text || entry.raw_text || '').trim();
  const projectRaw = resolveEntry(entry, stakeholders, projects).projectRaw;

  const suggestions = useMemo(() => {
    const ai = entry.ai_extracted || {};
    const names: string[] = [];
    if (ai.suggested_payee?.name) names.push(ai.suggested_payee.name);
    (ai.payee_closest_match ?? []).forEach(m => { if (m?.name && !names.includes(m.name)) names.push(m.name); });
    return names;
  }, [entry]);

  const nameRows = (() => {
    const q = ddq.trim(), ql = q.toLowerCase();
    const hit = (n: string) => n.toLowerCase().includes(ql);
    const sugNames = suggestions.filter(hit);
    const rest = stakeholders.filter(s => !sugNames.includes(s.name) && hit(s.name)).slice(0, 4);
    const rows: { name: string; id: string | null; tag?: string; create?: boolean }[] = [];
    const exact = [...sugNames, ...rest.map(r => r.name)].some(n => n.toLowerCase() === ql);
    if (q && !exact) rows.push({ name: q, id: null, tag: 'new party', create: true });
    sugNames.forEach(n => rows.push({ name: n, id: stakeholders.find(s => s.name === n)?.stakeholder_id ?? null, tag: 'suggested' }));
    rest.forEach(s => rows.push({ name: s.name, id: s.stakeholder_id }));
    return rows;
  })();

  const toggleSug = (which: 'to' | 'site', focus = true) => {
    setSug(cur => {
      const opening = cur !== which;
      if (which === 'to' && opening && focus) setTimeout(() => ddRef.current?.focus(), 380);
      return opening ? which : null;
    });
  };

  /** The gentle speed bump, driven from the parent's file attempt. */
  const nudge = (which: 'to' | 'site') => {
    cardRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 380, easing: 'ease' },
    );
    setFlash(null);
    requestAnimationFrame(() => setFlash(which));
    if (sug !== which) toggleSug(which, false);
  };

  return (
    <div className="cw" ref={register}>
      <div className="rcard enter" ref={cardRef}>
        <div className="top">
          <i />
          <div className="f">{senderName} · {via} · {sentTime}</div>
          <button type="button" className="editpill" onClick={onMenu}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
            Edit
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        </div>

        <div className="amt">−{inr(draft.amount)}</div>

        {draft.split ? (
          <>
            <button type="button" className="splits" onClick={onSplit}>
              <div className="sph"><i />Splits into {draft.split.length} transactions<span className="e">Adjust</span></div>
              {draft.split.map((s, i) => (
                <div className="sprow" key={i}>
                  <div className="sa">−{inr(s.amount)}</div>
                  <div className="sw"><b>{s.payeeName || draft.payeeName}</b> · {(projects.find(x => x.project_id === s.projectId)?.name || '').replace(' Residence', '').replace(' Apartments', '')}</div>
                </div>
              ))}
              <div className="spfoot">Payees &amp; sites as you set them · each entry described automatically</div>
            </button>
            <div className="kvs" style={{ marginTop: 4 }}>
              <div className="kv"><div className="k">For</div><div className="v" style={{ fontWeight: 500 }}>{draft.description || '—'}</div></div>
            </div>
          </>
        ) : (
          <div className="kvs">
            <button type="button" className={`kv tap${sug === 'to' ? ' open' : ''}${flash === 'to' ? ' flash' : ''}`} onClick={() => toggleSug('to')}>
              <div className="k">To</div>
              <div className={`v${draft.payeeName ? '' : ' dim'}`}>{draft.payeeName || 'Add a name'}</div>
              <span className="chev">{CHEV}</span>
            </button>
            <div className={`sug${sug === 'to' ? ' open' : ''}`}>
              <div className="sug-w">
                <div className="ddsearch">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                  <input ref={ddRef} value={ddq} onChange={e => setDdq(e.target.value)} placeholder="Search or type a new name" />
                </div>
                <div className="ddlist">
                  {nameRows.length === 0
                    ? <div className="ddempty">No matches — keep typing to add a new name</div>
                    : nameRows.map((r, i) => (
                      <button type="button" className={`dd${r.create ? ' create' : ''}`} key={`${r.name}-${i}`}
                        onClick={() => { onPatch({ payeeName: r.name, payeeId: r.id }); setSug(null); setDdq(''); }}>
                        <div className="dn">{r.create ? `Add “${r.name}”` : r.name}</div>
                        {r.tag && <div className="dt">{r.tag}</div>}
                      </button>
                    ))}
                </div>
              </div>
            </div>

            <button type="button" className={`kv tap${sug === 'site' ? ' open' : ''}${flash === 'site' ? ' flash' : ''}`} onClick={() => toggleSug('site')}>
              <div className="k">Site</div>
              <div className={`v${projectName ? '' : ' dim'}`}>{projectName || projectRaw || 'Pick a site'}</div>
              <span className="chev">{CHEV}</span>
            </button>
            <div className={`sug${sug === 'site' ? ' open' : ''}`}>
              <div className="sug-w">
                <div className="ddlist">
                  {projects.map(s => (
                    <button type="button" className="dd" key={s.project_id}
                      onClick={() => { onPatch({ projectId: s.project_id }); setSug(null); }}>
                      <div className="dn">{s.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="kv"><div className="k">For</div><div className="v" style={{ fontWeight: 500 }}>{draft.description || '—'}</div></div>
          </div>
        )}

        {!draft.split && !draft.payeeName?.trim() && (
          <div className="notice newp"><i /><div>No name yet — add one and it is saved as a party when you file.</div></div>
        )}
        {!draft.split && isNewParty && (
          <div className="notice newp"><i /><div><b>{draft.payeeName}</b> is new — saved as a party when you file. Editable anytime.</div></div>
        )}

        {message && (
          <>
            <button type="button" className={`srcline${msgOpen ? ' open' : ''}`} onClick={() => setMsgOpen(o => !o)}>
              See the message
              {CHEV}
            </button>
            <div className={`msg${msgOpen ? ' open' : ''}`}><div className="msg-w"><div className="m-in">“{message}”</div></div></div>
          </>
        )}

        <div className="ctarow">
          <button type="button" className="cta" disabled={busy} onClick={() => onFile(nudge)}>
            {draft.split ? `File ${draft.split.length} entries` : 'File it'}
          </button>
          <button type="button" className={`splitbtn${draft.split ? ' has' : ''}`} onClick={onSplit}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><line x1="12" y1="5" x2="12" y2="19" /></svg>
            Split
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewMobile(p: ReviewMobileProps) {
  const projects = p.projects;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Cards this visit has finished with — the write lands before the query refetches. */
  const [gone, setGone] = useState<string[]>([]);
  const [filedSum, setFiledSum] = useState(0);
  const [sheet, setSheet] = useState<null | 'filed' | 'menu' | 'edit' | 'np' | 'split'>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acted, setActed] = useState(false);
  const wraps = useRef<Record<string, HTMLDivElement | null>>({});

  const live = useMemo(() => p.entries.filter(e => !gone.includes(e.id)), [p.entries, gone]);

  const draftOf = (e: RoughEntry): Draft => {
    const d = drafts[e.id];
    if (d) return d;
    const r = resolveEntry(e, p.stakeholders, projects);
    return { payeeId: r.payeeId, payeeName: r.payeeName, projectId: r.projectId, amount: r.amount, description: r.description, split: null };
  };
  const patch = (e: RoughEntry, d: Partial<Draft>) =>
    setDrafts(s => ({ ...s, [e.id]: { ...draftOf(e), ...d } }));

  const active = activeId ? live.find(e => e.id === activeId) ?? null : null;
  const activeDraft = active ? draftOf(active) : null;

  const left = live.length;
  const leftAmount = live.reduce((s, e) => s + draftOf(e).amount, 0);
  const total0 = left + gone.length;
  const pct = total0 ? (gone.length / total0) * 100 : 0;

  /** The leave: slide out, then collapse the gap it leaves behind. */
  const leave = (id: string, how: 'file' | 'ignore') => {
    const el = wraps.current[id];
    if (el) {
      el.classList.add(how === 'file' ? 'leaving' : 'tuck');
      el.style.height = `${el.offsetHeight}px`;
      setTimeout(() => el.classList.add('collapse'), 300);
    }
    setActed(true);
    setTimeout(() => setGone(g => [...g, id]), 640);
  };

  const autoDesc = (d: Draft, projectId: string, part: boolean) => {
    const siteName = projects.find(x => x.project_id === projectId)?.name || 'No site yet';
    return part ? `${d.description} · ${siteName} · part of ${inr(d.amount)} (WhatsApp)` : `${d.description} · ${siteName}`;
  };

  /**
   * Filing with no name or no site is NOT waved through. An allocation needs a real project row
   * and a payment needs a real party, so a "file anyway" would only fail at the foreign key. The
   * card wobbles, the missing field flashes, and its picker opens.
   */
  const doFile = async (e: RoughEntry, nudge: (which: 'to' | 'site') => void) => {
    const d = draftOf(e);
    if (busy) return;
    if (!d.split) {
      if (!d.payeeId && !d.payeeName?.trim()) { nudge('to'); return; }
      if (!d.projectId) { nudge('site'); return; }
      if (!d.payeeId) { setActiveId(e.id); setNpName(d.payeeName ?? ''); setSheet('np'); return; }
    }
    setBusy(true);
    try {
      if (d.split) {
        const splits: ProjectSplit[] = d.split.map(s => ({
          projectId: s.projectId, amount: s.amount, payeeId: s.payeeId,
          description: autoDesc(d, s.projectId, true),
        }));
        await fileRoughEntrySplit(e, p.orgId, { payeeId: d.payeeId || '', amount: d.amount, description: d.description }, splits);
      } else {
        await fileRoughEntry(e, p.orgId, { payeeId: d.payeeId || '', projectId: d.projectId || '', amount: d.amount, description: d.description });
      }
      setFiledSum(s => s + d.amount);
      leave(e.id, 'file');
      p.onChanged();
    } catch (err) {
      p.onError(errMessage(err, 'Could not file this entry'));
    } finally { setBusy(false); }
  };

  const doBin = async () => {
    if (!active) return;
    const id = active.id;
    setSheet(null);
    try { await rejectRoughEntry(active); leave(id, 'ignore'); p.onChanged(); }
    catch (e) { p.onError(errMessage(e, 'Could not bin this entry')); }
  };

  // ── new party ───────────────────────────────────────────────────────────────
  const [npName, setNpName] = useState('');
  const npAdd = async () => {
    const name = npName.trim();
    if (!active || !activeDraft || !name || busy) return;
    setBusy(true);
    try {
      // The kind comes from what the extractor read, not from a guess about intent — and the
      // party stays editable afterwards, exactly as the sheet says.
      const kind = active.ai_extracted?.transaction_type === 'Material Purchase' ? 'Vendor' : 'Worker';
      const made = await createParty(name, kind, p.orgId);
      setDrafts(s => ({ ...s, [active.id]: { ...activeDraft, payeeId: made.id, payeeName: made.name } }));
      setSheet(null);
      p.onChanged();
    } catch (e) { p.onError(errMessage(e, 'Could not add the party')); }
    finally { setBusy(false); }
  };

  // ── edit sheet ──────────────────────────────────────────────────────────────
  const [ed, setEd] = useState({ amt: '', payee: '', forr: '', site: '' });
  const openEdit = () => {
    if (!activeDraft) return;
    setEd({ amt: String(activeDraft.amount || ''), payee: activeDraft.payeeName ?? '', forr: activeDraft.description, site: activeDraft.projectId ?? '' });
    setSheet('edit');
  };
  const saveEdit = () => {
    if (!active || !activeDraft) return;
    const name = ed.payee.trim();
    patch(active, {
      amount: parseInt(ed.amt.replace(/[^\d]/g, ''), 10) || activeDraft.amount,
      payeeName: name || activeDraft.payeeName,
      payeeId: name && name !== activeDraft.payeeName ? (p.stakeholders.find(s => s.name === name)?.stakeholder_id ?? null) : activeDraft.payeeId,
      description: ed.forr.trim() || activeDraft.description,
      projectId: ed.site || activeDraft.projectId,
      split: ed.site ? null : activeDraft.split,
    });
    setSheet(null);
  };

  // ── split sheet ─────────────────────────────────────────────────────────────
  const [spLines, setSpLines] = useState<{ payee: string; projectId: string; amt: number }[]>([]);
  const openSplit = (e: RoughEntry) => {
    const d = draftOf(e);
    setActiveId(e.id);
    setSpLines(d.split
      ? d.split.map(s => ({ payee: s.payeeName, projectId: s.projectId, amt: s.amount }))
      : [{ payee: d.payeeName ?? '', projectId: d.projectId || projects[0]?.project_id || '', amt: Math.round(d.amount / 2) },
         { payee: d.payeeName ?? '', projectId: projects[1]?.project_id || projects[0]?.project_id || '', amt: d.amount - Math.round(d.amount / 2) }]);
    setSheet('split');
  };
  const splitSum = spLines.reduce((s, l) => s + (l.amt || 0), 0);
  const splitOk = !!activeDraft && splitSum === activeDraft.amount && spLines.every(l => l.projectId && l.amt > 0);
  const doSplit = () => {
    if (!active || !activeDraft || !splitOk) return;
    patch(active, {
      split: spLines.filter(l => l.amt > 0).map(l => ({
        payeeName: l.payee.trim(),
        payeeId: p.stakeholders.find(s => s.name === l.payee.trim())?.stakeholder_id ?? activeDraft.payeeId,
        projectId: l.projectId, amount: l.amt,
      })),
    });
    setSheet(null);
  };

  const anySheet = sheet !== null;

  return (
    <div className="rvm">
      <style>{CSS}</style>

      <div className="hdr">
        <h1 className="title">For review</h1>
        <button type="button" className="filedbtn" onClick={() => setSheet('filed')}>Filed</button>
      </div>
      <div className="meta">
        <div className="pbar"><i style={{ width: `${pct}%` }} /></div>
        <div className="c">{left ? `${left} left · ${inr(leftAmount)}` : 'Done'}</div>
      </div>

      <div className="deckwrap">
        <div className="deck">
          {live.map(e => (
            e.ai_extracted?.kind === 'BILL' ? (
              // A captured bill is NOT a payment card — it files into `bills` (never a ₹0 transaction).
              // Reuse the self-contained bill card so mobile is correct without a second bill UI.
              <div className="cw" key={e.id} ref={el => { wraps.current[e.id] = el; }}>
                <BillReviewCard
                  entry={e}
                  orgId={p.orgId}
                  canManage
                  stakeholders={p.stakeholders}
                  projects={projects}
                  onFiled={() => { leave(e.id, 'file'); p.onChanged(); }}
                  onDismiss={() => { void (async () => { try { await rejectRoughEntry(e); leave(e.id, 'ignore'); p.onChanged(); } catch (err) { p.onError(errMessage(err, 'Could not bin this bill')); } })(); }}
                  onLightbox={() => { /* mobile deck has no lightbox wired here */ }}
                  onError={p.onError}
                  onVendorCreated={p.onChanged}
                />
              </div>
            ) : (
            <Card
              key={e.id}
              entry={e}
              draft={draftOf(e)}
              projects={projects}
              stakeholders={p.stakeholders}
              busy={busy}
              onPatch={d => patch(e, d)}
              onMenu={() => { setActiveId(e.id); setSheet('menu'); }}
              onSplit={() => openSplit(e)}
              onFile={nudge => void doFile(e, nudge)}
              register={el => { wraps.current[e.id] = el; }}
            />
            )
          ))}
        </div>
        <div className={`hint${acted || !left ? ' off' : ''}`}>File in any order — scroll past what can wait</div>
      </div>

      <div className={`zero${left ? '' : ' show'}`}>
        <div className="halo">
          <svg className="ck" width="42" height="42" viewBox="0 0 60 60" aria-hidden="true"><path d="M16 31 L26 41 L45 21" /></svg>
        </div>
        <h2>All caught up</h2>
        <p>
          {filedSum > 0 && <>{inr(filedSum)} entered your books.<br /></>}
          Come back when the next message lands.
        </p>
        <button type="button" onClick={() => setSheet('filed')}>See what was filed</button>
        {p.senderLine && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 34, fontSize: 13, color: 'var(--ink-3)' }}>
            <i style={{ width: 6, height: 6, borderRadius: '50%', background: '#25D366' }} />
            {p.senderLine}
            <button type="button" style={{ border: 0, background: 'none', fontSize: 13, fontWeight: 600, color: 'var(--tint)', cursor: 'pointer', padding: '4px 0' }} onClick={p.onManageSenders}>Manage</button>
          </div>
        )}
      </div>

      <div className={`scrim${anySheet ? ' show' : ''}`} onClick={() => setSheet(null)} />

      <DragSheet open={sheet === 'filed'} onDismiss={() => setSheet(null)} className={`sheet${sheet === 'filed' ? ' show' : ''}`} role="dialog" aria-label="Filed">
        <div className="grab" />
        <h3>Filed</h3>
        <div className="flgroup">
          {p.filed.length === 0 && <div className="flempty">Nothing filed yet.</div>}
          {p.filed.map(e => {
            const r = resolveEntry(e, p.stakeholders, projects);
            return (
              <div className="fl" key={e.id}>
                <div className="w">
                  <div className="n">{r.payeeName || 'General expense'}</div>
                  <div className="s">{[r.description, r.projectName].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="a">−{inr(r.amount)}</div>
              </div>
            );
          })}
        </div>
      </DragSheet>

      <DragSheet open={sheet === 'menu'} onDismiss={() => setSheet(null)} className={`sheet${sheet === 'menu' ? ' show' : ''}`} role="dialog" aria-label="Entry actions">
        <div className="grab" />
        <button type="button" className="mi" onClick={openEdit}>Edit details</button>
        <button type="button" className="mi" onClick={() => { if (active) openSplit(active); }}>Split into transactions</button>
        <button type="button" className="mi" onClick={() => { setSheet(null); p.onOpenWhatsApp(); }}>View in WhatsApp</button>
        <button type="button" className="mi dim" onClick={() => void doBin()}>Not a transaction</button>
      </DragSheet>

      <DragSheet open={sheet === 'edit'} onDismiss={() => setSheet(null)} className={`sheet${sheet === 'edit' ? ' show' : ''}`} role="dialog" aria-label="Edit details">
        <div className="grab" />
        <h3 style={{ marginBottom: 14 }}>Edit details</h3>
        <div className="frow">
          <div className="field"><label>Amount</label><input inputMode="numeric" value={ed.amt} onChange={e => setEd(v => ({ ...v, amt: e.target.value }))} /></div>
          <div className="field"><label>Paid to</label><input value={ed.payee} onChange={e => setEd(v => ({ ...v, payee: e.target.value }))} /></div>
        </div>
        <div className="field"><label>For</label><input value={ed.forr} onChange={e => setEd(v => ({ ...v, forr: e.target.value }))} /></div>
        <div className="sitechips">
          {projects.map(s => (
            <button type="button" key={s.project_id} className={ed.site === s.project_id ? 'on' : ''}
              onClick={() => setEd(v => ({ ...v, site: s.project_id }))}>
              {s.name.replace(' Residence', '').replace(' Apartments', '')}
            </button>
          ))}
        </div>
        <button type="button" className="b2" onClick={saveEdit}>Save</button>
      </DragSheet>

      <DragSheet open={sheet === 'np'} onDismiss={() => setSheet(null)} className={`sheet${sheet === 'np' ? ' show' : ''}`} role="dialog" aria-label="New party">
        <div className="grab" />
        <h3>New party</h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '2px 0 16px' }}>
          “<b style={{ color: 'var(--ink)' }}>{activeDraft?.payeeName}</b>” isn't in your parties yet. Add them to the system, or pick someone else.
        </p>
        <div className="field">
          <label>Name — fix it if it's misspelt</label>
          <input value={npName} onChange={e => setNpName(e.target.value)} />
        </div>
        <button type="button" className="b2" disabled={busy || !npName.trim()} onClick={() => void npAdd()}>Add &amp; file</button>
        <button type="button" className="b2" style={{ background: 'rgba(27,23,19,.06)', color: 'var(--ink)', marginTop: 8 }}
          onClick={() => setSheet(null)}>Pick someone else</button>
      </DragSheet>

      <DragSheet open={sheet === 'split'} onDismiss={() => setSheet(null)} className={`sheet${sheet === 'split' ? ' show' : ''}`} role="dialog" aria-label="Split into transactions">
        <div className="grab" />
        <h3 style={{ marginBottom: 4 }}>Split into transactions</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 14 }}>{inr(activeDraft?.amount ?? 0)} from the message — divide it below.</p>
        <div>
          {spLines.map((l, i) => (
            <div className="spline" key={i}>
              <div className="r1">
                <input className="pn" placeholder="Payee" value={l.payee}
                  onChange={e => setSpLines(s => s.map((x, j) => (j === i ? { ...x, payee: e.target.value } : x)))} />
                <input className="pa" inputMode="numeric" value={l.amt || ''}
                  onChange={e => setSpLines(s => s.map((x, j) => (j === i ? { ...x, amt: parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0 } : x)))} />
              </div>
              <select value={l.projectId} onChange={e => setSpLines(s => s.map((x, j) => (j === i ? { ...x, projectId: e.target.value } : x)))}>
                {projects.map(pr => <option key={pr.project_id} value={pr.project_id}>{pr.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button type="button" className="addline2" onClick={() => setSpLines(s => [...s, { payee: '', projectId: projects[0]?.project_id || '', amt: 0 }])}>
          Add another payee or site
        </button>
        <div className={`splitsum${splitOk ? '' : ' err'}`}>
          {splitOk ? `Adds up — ${inr(activeDraft?.amount ?? 0)}` : `${inr(splitSum)} of ${inr(activeDraft?.amount ?? 0)} — adjust to match`}
        </div>
        <button type="button" className="b2" disabled={!splitOk} onClick={doSplit}>File {spLines.length} entries</button>
        <div className="autonote">Each transaction is described automatically —<br />purpose · site · part of the original amount.</div>
      </DragSheet>
    </div>
  );
}
