// ReviewMobile — the phone's review deck, built to the for-review reference design.
//
// One card at a time: swipe right to file, left for later. Every action runs through the code that
// already owns it — fileRoughEntry / fileRoughEntrySplit / rejectRoughEntry / createParty — and the
// AI's guessed ids go through resolveEntry, the same check the desktop card makes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoughEntry } from '../../types';
import { fileRoughEntry, fileRoughEntrySplit, rejectRoughEntry, createParty, errMessage, type ProjectSplit } from './fileEntry';
import { resolveEntry, type ProjectLite, type StakeholderLite } from './resolveEntry';

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

.rvm .deck{flex:1;padding:18px 24px calc(88px + env(safe-area-inset-bottom));overflow-y:auto}
.rvm .deck::-webkit-scrollbar{display:none}

.rvm .rcard{position:relative;background:var(--card);border-radius:24px;padding:20px 20px 18px;
  box-shadow:0 14px 36px -16px rgba(27,23,19,.22);touch-action:pan-y;will-change:transform}
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
.rvm .ddlist{padding-bottom:8px;max-height:224px;overflow-y:auto}
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
.rvm .notice.split i{background:var(--good)}
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
.rvm .later{width:92px;height:52px;border:0;border-radius:16px;flex-shrink:0;
  background:rgba(27,23,19,.05);color:var(--ink);font-size:15px;font-weight:600;
  cursor:pointer;transition:transform .15s var(--spring),background .2s}
.rvm .later:active{transform:scale(.95);background:rgba(27,23,19,.1)}

.rvm .stamp{position:absolute;top:16px;font-size:13px;font-weight:800;letter-spacing:.06em;
  padding:7px 13px;border-radius:11px;border:2.5px solid;opacity:0;pointer-events:none;
  text-transform:uppercase;background:var(--card);z-index:2}
.rvm .stamp.L{left:16px;color:var(--good);border-color:var(--good);transform:rotate(-7deg)}
.rvm .stamp.R{right:16px;color:var(--ink-3);border-color:var(--ink-3);transform:rotate(7deg)}

.rvm .peek{margin:0 auto;display:flex;flex-direction:column;align-items:center}
.rvm .peek s{display:block;height:34px;border-radius:0 0 18px 18px;background:var(--card);
  box-shadow:0 10px 22px -14px rgba(27,23,19,.22);
  margin-top:-24px;transition:width .4s var(--spring),opacity .3s}
.rvm .peek s:nth-child(1){width:91%;z-index:-1;position:relative}
.rvm .peek s:nth-child(2){width:82%;opacity:.6;z-index:-2;position:relative}
.rvm .peek s.off{opacity:0}

.rvm .hint{text-align:center;font-size:12.5px;color:var(--ink-3);margin-top:18px;transition:opacity .4s}
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
.rvm .splitsum{text-align:center;font-size:13.5px;color:var(--ink-2);margin:2px 0 14px;font-variant-numeric:tabular-nums}
.rvm .splitsum.err{color:#D0342C;font-weight:600}
.rvm .autonote{font-size:13px;color:var(--ink-3);text-align:center;margin-top:10px;line-height:1.45}

@media (prefers-reduced-motion:reduce){
  .rvm *,.rvm *::before,.rvm *::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const CHEV = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;

/** A card's local edits — the deck never writes to the row until it is filed. */
interface Draft {
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
}

export default function ReviewMobile(p: ReviewMobileProps) {
  const projects = p.projects;

  // "Later" moves a card to the back for this visit only — the deck order is the queue with the
  // deferred ids moved to the end, so nothing has to be kept in step with the query.
  const [deferred, setDeferred] = useState<string[]>([]);
  /**
   * Cards this visit has finished with. The write lands before the query refetches, so without
   * this the filed card sits at the top of the deck for a beat — long enough to file it twice.
   */
  const [gone, setGone] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [sheet, setSheet] = useState<null | 'filed' | 'menu' | 'edit' | 'np' | 'split'>(null);
  const [sug, setSug] = useState<null | 'to' | 'site'>(null);
  const [ddq, setDdq] = useState('');
  const [msgOpen, setMsgOpen] = useState(false);
  const [flash, setFlash] = useState<null | 'to' | 'site'>(null);
  const [busy, setBusy] = useState(false);
  const [acted, setActed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(p.entries.map(e => [e.id, e])), [p.entries]);

  const order = useMemo(() => {
    const ids = p.entries.map(e => e.id).filter(id => !gone.includes(id));
    const back = deferred.filter(id => ids.includes(id));
    return [...ids.filter(id => !back.includes(id)), ...back];
  }, [p.entries, deferred, gone]);

  const entry = order.length ? byId.get(order[0]) ?? null : null;

  const base = useMemo(
    () => (entry ? resolveEntry(entry, p.stakeholders, projects) : null),
    [entry, p.stakeholders, projects],
  );

  const draft: Draft | null = useMemo(() => {
    if (!entry || !base) return null;
    return drafts[entry.id] ?? {
      payeeId: base.payeeId, payeeName: base.payeeName, projectId: base.projectId,
      amount: base.amount, description: base.description, split: null,
    };
  }, [entry, base, drafts]);

  const patch = (d: Partial<Draft>) => {
    if (!entry || !draft) return;
    setDrafts(s => ({ ...s, [entry.id]: { ...draft, ...d } }));
  };

  const projectName = draft?.projectId ? projects.find(x => x.project_id === draft.projectId)?.name ?? null : null;
  const isNewParty = !!draft && !draft.payeeId && !!draft.payeeName?.trim();

  // ── the card's own facts ────────────────────────────────────────────────────
  const senderName = entry?.sender_name || 'Someone';
  const via = entry?.source?.startsWith('WHATSAPP') ? 'WhatsApp' : 'Briklay';
  const sentTime = entry ? new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  const message = (entry?.transcribed_text || entry?.raw_text || '').trim();

  const left = order.length;
  const leftAmount = order.reduce((s, id) => {
    const e = byId.get(id);
    if (!e) return s;
    const d = drafts[id];
    return s + (d ? d.amount : resolveEntry(e, p.stakeholders, projects).amount);
  }, 0);

  const reset = () => { setSug(null); setDdq(''); setMsgOpen(false); setFlash(null); };

  // ── name + site pickers ─────────────────────────────────────────────────────
  const suggestions = useMemo(() => {
    const ai = entry?.ai_extracted || {};
    const names: string[] = [];
    if (ai.suggested_payee?.name) names.push(ai.suggested_payee.name);
    (ai.payee_closest_match ?? []).forEach(m => { if (m?.name && !names.includes(m.name)) names.push(m.name); });
    return names;
  }, [entry]);

  const nameRows = (() => {
    const q = ddq.trim(), ql = q.toLowerCase();
    const hit = (n: string) => n.toLowerCase().includes(ql);
    const sugNames = suggestions.filter(hit);
    const rest = p.stakeholders.filter(s => !sugNames.includes(s.name) && hit(s.name)).slice(0, 4);
    const rows: { name: string; id: string | null; tag?: string; create?: boolean }[] = [];
    const exact = [...sugNames, ...rest.map(r => r.name)].some(n => n.toLowerCase() === ql);
    if (q && !exact) rows.push({ name: q, id: null, tag: 'new party', create: true });
    sugNames.forEach(n => rows.push({ name: n, id: p.stakeholders.find(s => s.name === n)?.stakeholder_id ?? null, tag: 'suggested' }));
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
  const setPayee = (name: string, id: string | null) => { patch({ payeeName: name, payeeId: id }); setSug(null); setDdq(''); };
  const setSite = (id: string) => { patch({ projectId: id }); setSug(null); };

  // ── file / later / bin ──────────────────────────────────────────────────────
  const wobble = () => {
    cardRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 380, easing: 'ease' },
    );
  };

  /**
   * The gentle speed bump. A missing name or site is NOT waved through: an allocation needs a real
   * project row and a payment needs a real party, so "file anyway" would only fail at the foreign
   * key. The card wobbles, the missing field flashes, and its picker opens.
   */
  const preFileCheck = (): boolean => {
    if (!draft) return false;
    const noPayee = !draft.split && !draft.payeeId && !draft.payeeName?.trim();
    const noSite = !draft.split && !draft.projectId;
    if (noPayee || noSite) {
      wobble();
      const which = noPayee ? 'to' : 'site';
      setFlash(null);
      requestAnimationFrame(() => setFlash(which));
      if (sug !== which) toggleSug(which, false);
      return false;
    }
    if (!draft.split && isNewParty) { openNp(); return false; }
    return true;
  };

  const autoDesc = (d: Draft, s?: { projectId: string }) => {
    const siteName = projects.find(x => x.project_id === (s ? s.projectId : d.projectId))?.name || 'No site yet';
    return s ? `${d.description} · ${siteName} · part of ${inr(d.amount)} (WhatsApp)` : `${d.description} · ${siteName}`;
  };

  const leave = (how: 'file' | 'later') => {
    const el = cardRef.current;
    if (!el) return;
    if (how === 'later') {
      el.style.transition = 'transform .4s ease-in, opacity .4s';
      el.style.transform = 'translateY(46px) scale(.9)';
      el.style.opacity = '0';
    } else {
      el.style.transition = 'transform .36s ease-in, opacity .36s';
      el.style.transform = 'translateX(125%) rotate(5deg)';
      el.style.opacity = '.25';
    }
  };

  const advance = (how: 'file' | 'later', delay: number) => {
    const id = order[0];
    setActed(true);
    setTimeout(() => {
      if (how === 'later') setDeferred(d => [...d.filter(x => x !== id), id]);
      else setGone(g => [...g, id]);
      reset();
    }, delay);
  };

  const doFile = async (already = false) => {
    if (!entry || !draft || busy) return;
    if (!preFileCheck()) {
      if (already && cardRef.current) {
        const el = cardRef.current;
        el.style.transition = 'transform .4s cubic-bezier(.32,1.4,.5,1)';
        el.style.transform = ''; el.style.opacity = '1';
      }
      return;
    }
    setBusy(true);
    try {
      if (draft.split) {
        const splits: ProjectSplit[] = draft.split.map(s => ({
          projectId: s.projectId, amount: s.amount, payeeId: s.payeeId,
          description: autoDesc(draft, { projectId: s.projectId }),
        }));
        await fileRoughEntrySplit(entry, p.orgId, { payeeId: draft.payeeId || '', amount: draft.amount, description: draft.description }, splits);
      } else {
        await fileRoughEntry(entry, p.orgId, {
          payeeId: draft.payeeId || '', projectId: draft.projectId || '',
          amount: draft.amount, description: draft.description,
        });
      }
      if (!already) leave('file');
      advance('file', already ? 80 : 340);
      p.onChanged();
    } catch (e) {
      p.onError(errMessage(e, 'Could not file this entry'));
      if (cardRef.current) { cardRef.current.style.transition = 'transform .4s cubic-bezier(.32,1.4,.5,1)'; cardRef.current.style.transform = ''; cardRef.current.style.opacity = '1'; }
    } finally { setBusy(false); }
  };

  const doLater = (already = false) => {
    if (order.length === 1) {
      cardRef.current?.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(10px)' }, { transform: 'translateY(0)' }],
        { duration: 340, easing: 'ease' },
      );
      return;
    }
    if (!already) leave('later');
    advance('later', already ? 80 : 340);
  };

  const doBin = async () => {
    if (!entry) return;
    setSheet(null);
    try { await rejectRoughEntry(entry); leave('file'); advance('file', 340); p.onChanged(); }
    catch (e) { p.onError(errMessage(e, 'Could not bin this entry')); }
  };

  // the new-party sheet — the one place a party is created from this deck
  const [npName, setNpName] = useState('');
  const openNp = () => { setNpName(draft?.payeeName ?? ''); setSheet('np'); };
  const npAdd = async () => {
    const name = npName.trim();
    if (!entry || !name || busy) return;
    setBusy(true);
    try {
      // The kind comes from what the extractor read, not from a guess about intent — and the
      // party stays editable afterwards, exactly as the sheet says.
      const t = entry.ai_extracted?.transaction_type;
      const kind = t === 'Material Purchase' ? 'Vendor' : 'Worker';
      const made = await createParty(name, kind, p.orgId);
      setDrafts(s => ({ ...s, [entry.id]: { ...draft!, payeeId: made.id, payeeName: made.name } }));
      setSheet(null);
      p.onChanged();
    } catch (e) { p.onError(errMessage(e, 'Could not add the party')); }
    finally { setBusy(false); }
  };

  // ── edit sheet ──────────────────────────────────────────────────────────────
  const [ed, setEd] = useState({ amt: '', payee: '', forr: '', site: '' });
  const openEdit = () => {
    if (!draft) return;
    setEd({ amt: String(draft.amount || ''), payee: draft.payeeName ?? '', forr: draft.description, site: draft.projectId ?? '' });
    setSheet('edit');
  };
  const saveEdit = () => {
    if (!draft) return;
    const name = ed.payee.trim();
    patch({
      amount: parseInt(ed.amt.replace(/[^\d]/g, ''), 10) || draft.amount,
      payeeName: name || draft.payeeName,
      payeeId: name && name !== draft.payeeName ? (p.stakeholders.find(s => s.name === name)?.stakeholder_id ?? null) : draft.payeeId,
      description: ed.forr.trim() || draft.description,
      projectId: ed.site || draft.projectId,
      split: ed.site ? null : draft.split,
    });
    setSheet(null);
  };

  // ── split sheet ─────────────────────────────────────────────────────────────
  const [spLines, setSpLines] = useState<{ payee: string; projectId: string; amt: number }[]>([]);
  const openSplit = () => {
    if (!draft) return;
    setSpLines(draft.split
      ? draft.split.map(s => ({ payee: s.payeeName, projectId: s.projectId, amt: s.amount }))
      : [{ payee: draft.payeeName ?? '', projectId: draft.projectId || projects[0]?.project_id || '', amt: Math.round(draft.amount / 2) },
         { payee: draft.payeeName ?? '', projectId: projects[1]?.project_id || projects[0]?.project_id || '', amt: draft.amount - Math.round(draft.amount / 2) }]);
    setSheet('split');
  };
  const splitSum = spLines.reduce((s, l) => s + (l.amt || 0), 0);
  const splitOk = !!draft && splitSum === draft.amount && spLines.every(l => l.projectId && l.amt > 0);
  const doSplit = () => {
    if (!draft || !splitOk) return;
    patch({
      split: spLines.filter(l => l.amt > 0).map(l => ({
        payeeName: l.payee.trim(), payeeId: p.stakeholders.find(s => s.name === l.payee.trim())?.stakeholder_id ?? draft.payeeId,
        projectId: l.projectId, amount: l.amt,
      })),
    });
    setSheet(null);
  };

  // ── swipe ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !entry) return;
    const L = el.querySelector<HTMLElement>('.stamp.L'), R = el.querySelector<HTMLElement>('.stamp.R');
    let sx = 0, sy = 0, dx = 0, drag = false, locked = false;
    const skip = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest('button,input,select,.dd,.ddsearch,.sug');
    const start = (x: number, y: number) => { sx = x; sy = y; dx = 0; drag = false; locked = false; el.style.transition = 'none'; };
    const move = (x: number, y: number, ev?: Event) => {
      if (locked) return;
      const ddx = x - sx, ddy = y - sy;
      if (!drag) {
        if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy) * 1.4) drag = true;
        else if (Math.abs(ddy) > 10) { locked = true; return; }
        else return;
      }
      if (ev?.cancelable) ev.preventDefault();
      dx = ddx;
      el.style.transform = `translateX(${dx * .95}px) rotate(${dx * .02}deg)`;
      if (L) L.style.opacity = dx > 34 ? String(Math.min(1, (dx - 34) / 56)) : '0';
      if (R) R.style.opacity = dx < -34 ? String(Math.min(1, (-dx - 34) / 56)) : '0';
    };
    const end = () => {
      el.style.transition = 'transform .4s cubic-bezier(.32,1.4,.5,1), opacity .35s';
      if (drag && dx > 96) { el.style.transform = 'translateX(130%) rotate(6deg)'; el.style.opacity = '.25'; void doFile(true); }
      else if (drag && dx < -96) { el.style.transform = 'translateX(-40px) translateY(46px) scale(.9)'; el.style.opacity = '0'; doLater(true); }
      else { el.style.transform = ''; if (L) L.style.opacity = '0'; if (R) R.style.opacity = '0'; }
    };
    const ts = (e: TouchEvent) => { if (skip(e.target)) return; start(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent) => { if (skip(e.target)) return; move(e.touches[0].clientX, e.touches[0].clientY, e); };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', end);
    return () => { el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', end); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, draft, busy, order.length]);

  const total0 = left + gone.length;
  const pct = total0 ? (gone.length / total0) * 100 : 0;
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

      <div className="deck">
        {entry && draft && base && (
          <div className="rcard enter" ref={cardRef} key={entry.id}>
            <div className="stamp L">File</div>
            <div className="stamp R">Later</div>

            <div className="top">
              <i />
              <div className="f">{senderName} · {via} · {sentTime}</div>
              <button type="button" className="editpill" onClick={() => setSheet('menu')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                Edit
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </div>

            <div className="amt">−{inr(draft.amount)}</div>

            {draft.split ? (
              <>
                <button type="button" className="splits" onClick={openSplit}>
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
                          <button type="button" className={`dd${r.create ? ' create' : ''}`} key={`${r.name}-${i}`} onClick={() => setPayee(r.name, r.id)}>
                            <div className="dn">{r.create ? `Add “${r.name}”` : r.name}</div>
                            {r.tag && <div className="dt">{r.tag}</div>}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>

                <button type="button" className={`kv tap${sug === 'site' ? ' open' : ''}${flash === 'site' ? ' flash' : ''}`} onClick={() => toggleSug('site')}>
                  <div className="k">Site</div>
                  <div className={`v${projectName ? '' : ' dim'}`}>{projectName || base.projectRaw || 'Pick a site'}</div>
                  <span className="chev">{CHEV}</span>
                </button>
                <div className={`sug${sug === 'site' ? ' open' : ''}`}>
                  <div className="sug-w">
                    <div className="ddlist">
                      {projects.map(s => (
                        <button type="button" className="dd" key={s.project_id} onClick={() => setSite(s.project_id)}>
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
              <button type="button" className="cta" disabled={busy} onClick={() => void doFile()}>
                {draft.split ? `File ${draft.split.length} entries` : 'File it'}
              </button>
              <button type="button" className="later" onClick={() => doLater()}>Later</button>
            </div>
          </div>
        )}

        {entry && (
          <div className="peek">
            <s className={left < 2 ? 'off' : ''} />
            <s className={left < 3 ? 'off' : ''} />
          </div>
        )}
        <div className={`hint${acted || !left ? ' off' : ''}`}>Swipe right to file · left for later</div>
      </div>

      <div className={`zero${left ? '' : ' show'}`}>
        <div className="halo">
          <svg className="ck" width="42" height="42" viewBox="0 0 60 60" aria-hidden="true"><path d="M16 31 L26 41 L45 21" /></svg>
        </div>
        <h2>All caught up</h2>
        <p>Come back when the next message lands.</p>
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

      <div className={`sheet${sheet === 'filed' ? ' show' : ''}`} role="dialog" aria-label="Filed">
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
      </div>

      <div className={`sheet${sheet === 'menu' ? ' show' : ''}`} role="dialog" aria-label="Entry actions">
        <div className="grab" />
        <button type="button" className="mi" onClick={openEdit}>Edit details</button>
        <button type="button" className="mi" onClick={openSplit}>Split across sites</button>
        <button type="button" className="mi dim" onClick={() => void doBin()}>Not a transaction</button>
      </div>

      <div className={`sheet${sheet === 'edit' ? ' show' : ''}`} role="dialog" aria-label="Edit details">
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
      </div>

      <div className={`sheet${sheet === 'np' ? ' show' : ''}`} role="dialog" aria-label="New party">
        <div className="grab" />
        <h3>New party</h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, margin: '2px 0 16px' }}>
          “<b style={{ color: 'var(--ink)' }}>{draft?.payeeName}</b>” isn't in your parties yet. Add them to the system, or pick someone else.
        </p>
        <div className="field">
          <label>Name — fix it if it's misspelt</label>
          <input value={npName} onChange={e => setNpName(e.target.value)} />
        </div>
        <button type="button" className="b2" disabled={busy || !npName.trim()} onClick={() => void npAdd()}>Add &amp; file</button>
        <button type="button" className="b2" style={{ background: 'rgba(27,23,19,.06)', color: 'var(--ink)', marginTop: 8 }}
          onClick={() => { setSheet(null); setTimeout(() => toggleSug('to'), 200); }}>Pick someone else</button>
      </div>

      <div className={`sheet${sheet === 'split' ? ' show' : ''}`} role="dialog" aria-label="Split into transactions">
        <div className="grab" />
        <h3 style={{ marginBottom: 4 }}>Split into transactions</h3>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 14 }}>{inr(draft?.amount ?? 0)} from the message — divide it below.</p>
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
          {splitOk ? `Adds up — ${inr(draft?.amount ?? 0)}` : `${inr(splitSum)} of ${inr(draft?.amount ?? 0)} — adjust to match`}
        </div>
        <button type="button" className="b2" disabled={!splitOk} onClick={doSplit}>File {spLines.length} entries</button>
        <div className="autonote">Each transaction is described automatically —<br />purpose · site · part of the original amount.</div>
      </div>
    </div>
  );
}
