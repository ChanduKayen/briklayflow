// NewPoMobile — the phone screen for creating a purchase order, built to the reference design.
//
// The desktop page is a spreadsheet: a wide item grid with rate, discount and GST columns. None of
// that survives contact with a phone held in one hand on a site. This is the same order, asked for
// the way the reference lays it out — a grouped list for the four facts that identify the order,
// then one big affordance for the thing that takes the longest: naming what you want. Voice first,
// camera and file beside it, typing behind a sheet.
//
// All the real work still belongs to NewPurchaseOrder: vendors, projects, SKU resolution and submit
// arrive as props. This file owns presentation and the one piece of local state a screen like this
// needs — which drawer is open, what the microphone is hearing, what the sheet is collecting.
import { useEffect, useMemo, useRef, useState } from 'react';

const CSS = `
.npm-w{--tint:#C4502B;--tint-press:#A8431F;--ink:#1C1815;--ink-2:#8A8178;--ink-3:#B8AFA5;
  --bg:#F5F2EE;--card:#FFFFFF;--hair:rgba(60,50,40,.12);--good:#34A853;--r:18px;
  --spring:cubic-bezier(.32,1.4,.5,1);--ease:cubic-bezier(.25,.1,.25,1);--sheet:cubic-bezier(.32,.72,0,1);
  position:fixed;inset:0;z-index:60;background:var(--bg);color:var(--ink);
  display:flex;flex-direction:column;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','DM Sans',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.npm-w *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.npm-w button{font:inherit}

.npm-nav{padding:calc(14px + env(safe-area-inset-top)) 20px 4px;display:flex;align-items:center;gap:8px;
  flex:none;background:linear-gradient(var(--bg) 60%,rgba(245,242,238,0))}
.npm-back{display:flex;align-items:center;gap:2px;border:0;background:none;cursor:pointer;
  color:var(--tint);font-size:17px;font-weight:500;padding:8px 10px 8px 0;transition:opacity .15s}
.npm-back:active{opacity:.4}
.npm-sp{flex:1}
.npm-seg{display:flex;background:rgba(30,24,18,.06);border-radius:999px;padding:3px;position:relative}
.npm-seg button{border:0;background:none;font-size:13px;font-weight:600;color:var(--ink-2);
  padding:7px 14px;border-radius:999px;cursor:pointer;position:relative;z-index:1;transition:color .25s}
.npm-seg button.on{color:var(--ink)}
.npm-pill{position:absolute;top:3px;bottom:3px;border-radius:999px;background:#fff;
  box-shadow:0 1px 4px rgba(30,24,18,.15);transition:left .35s var(--spring),width .35s var(--spring)}

.npm-main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:4px 20px 150px}
.npm-main::-webkit-scrollbar{display:none}
.npm-title{font-size:30px;font-weight:800;letter-spacing:-.03em;margin:6px 0 2px}
.npm-sub{font-size:15px;color:var(--ink-2);line-height:1.4}
.npm-sect{margin-top:28px}
.npm-sect-h{font-size:13px;font-weight:600;color:var(--ink-2);margin:0 4px 8px}

.npm-group{background:var(--card);border-radius:var(--r);overflow:hidden}
.npm-row{display:flex;align-items:center;min-height:56px;padding:8px 18px;gap:14px;width:100%;
  border:0;background:none;text-align:left;cursor:pointer;position:relative;transition:background .15s}
.npm-row::after{content:'';position:absolute;left:18px;right:0;bottom:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.npm-row:last-of-type::after{display:none}
.npm-row:active{background:#F7F3EE}
.npm-row .lb{font-size:16.5px;color:var(--ink);width:96px;flex-shrink:0}
.npm-row .vl{flex:1;text-align:right;font-size:16.5px;color:var(--ink-3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .25s}
.npm-row.set .vl{color:var(--ink);font-weight:500}
.npm-chev{color:var(--ink-3);flex-shrink:0;transition:transform .3s var(--ease)}
.npm-row.open .npm-chev{transform:rotate(90deg)}

.npm-drawer{max-height:0;overflow:hidden;transition:max-height .38s var(--sheet);background:#FBF9F6}
.npm-drawer.open{max-height:320px;overflow-y:auto}
.npm-drawer::before{content:'';display:block;height:1px;background:var(--hair);transform:scaleY(.5)}
.npm-opt{display:flex;align-items:baseline;gap:10px;padding:14px 18px;width:100%;border:0;background:none;
  text-align:left;cursor:pointer;transition:background .15s;position:relative}
.npm-opt+.npm-opt::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.npm-opt:active{background:#F3EEE7}
.npm-opt .nm{font-size:16px;font-weight:500}
.npm-opt .sb{font-size:13.5px;color:var(--ink-2);flex:1;text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.npm-opt .ck{width:18px;color:var(--tint);opacity:0;transform:scale(.5);transition:all .3s var(--spring);align-self:center;flex:none}
.npm-opt.sel .ck{opacity:1;transform:scale(1)}
.npm-empty{padding:16px 18px;font-size:14px;color:var(--ink-2)}

.npm-voice{border-radius:var(--r);cursor:pointer;position:relative;overflow:hidden;background:var(--card);
  width:100%;border:0;text-align:left;display:block;transition:transform .18s var(--spring)}
.npm-voice:active{transform:scale(.985)}
.npm-voice-in{position:relative;z-index:2;padding:22px 20px;display:flex;align-items:center;gap:16px;min-height:88px}
.npm-mic{width:46px;height:46px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;
  color:#fff;background:var(--tint);transition:all .4s var(--spring)}
.npm-mic svg{width:20px;height:20px}
.npm-voice.rec .npm-mic{background:rgba(255,255,255,.16)}
.npm-vt{flex:1;min-width:0}
.npm-vt .t1{font-size:17px;font-weight:600;letter-spacing:-.01em;transition:color .4s}
.npm-vt .t2{font-size:14px;color:var(--ink-2);margin-top:2px;transition:color .4s;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.npm-timer{font-variant-numeric:tabular-nums;font-size:15px;font-weight:600;color:rgba(255,255,255,.9);display:none}
.npm-voice.rec .npm-timer{display:block}
.npm-mesh{position:absolute;inset:0;opacity:0;transition:opacity .6s;background:#17130F}
.npm-mesh::before,.npm-mesh::after{content:'';position:absolute;inset:-60%;
  background:
    radial-gradient(38% 45% at 25% 35%, rgba(255,120,60,.75), transparent 65%),
    radial-gradient(40% 50% at 75% 30%, rgba(255,80,140,.55), transparent 65%),
    radial-gradient(45% 55% at 60% 80%, rgba(120,90,255,.55), transparent 65%),
    radial-gradient(35% 45% at 20% 85%, rgba(255,180,60,.5), transparent 65%);
  filter:blur(30px);animation:npm-mesh 9s ease-in-out infinite alternate}
.npm-mesh::after{animation-duration:13s;animation-direction:alternate-reverse;opacity:.7;transform:rotate(40deg)}
@keyframes npm-mesh{0%{transform:translate(-6%,-4%) rotate(0deg) scale(1)}100%{transform:translate(6%,5%) rotate(28deg) scale(1.15)}}
.npm-voice.rec .npm-mesh{opacity:1}
.npm-voice.rec .npm-vt .t1{color:#fff}
.npm-voice.rec .npm-vt .t2{color:rgba(255,255,255,.65)}
.npm-wave{display:none;align-items:center;gap:3px;height:22px;margin-top:8px}
.npm-voice.rec .npm-wave{display:flex}
.npm-wave i{width:3px;border-radius:3px;background:rgba(255,255,255,.85);height:5px;animation:npm-wv 1s ease-in-out infinite}
@keyframes npm-wv{0%,100%{height:4px}50%{height:var(--h)}}
.npm-live{display:none;position:relative;z-index:2;padding:0 20px 20px;color:rgba(255,255,255,.92);
  font-size:15px;font-weight:500;line-height:1.5;letter-spacing:-.01em}
.npm-voice.rec .npm-live{display:block}
.npm-cursor{display:inline-block;width:2px;height:14px;background:#fff;margin-left:1px;vertical-align:-2px;animation:npm-blink 1.1s steps(1) infinite}
@keyframes npm-blink{50%{opacity:0}}

.npm-alt{display:flex;justify-content:center;align-items:center;gap:6px;margin-top:14px;font-size:15px;color:var(--ink-2)}
.npm-alt button{border:0;background:none;font-size:15px;font-weight:500;color:var(--tint);
  cursor:pointer;padding:8px 6px;transition:opacity .15s}
.npm-alt button:active{opacity:.4}
.npm-alt button:disabled{opacity:.4}

.npm-parsing{margin-top:14px;background:var(--card);border-radius:var(--r);padding:18px 20px}
.npm-pl{display:flex;align-items:center;gap:12px}
.npm-ring{width:18px;height:18px;border-radius:50%;flex-shrink:0;border:2px solid var(--hair);
  border-top-color:var(--tint);animation:npm-sp .8s linear infinite}
.npm-pl span{font-size:15px;font-weight:500;color:var(--ink-2)}
@keyframes npm-sp{to{transform:rotate(360deg)}}
.npm-err{margin-top:12px;font-size:14px;color:#D0342C;padding:0 4px;line-height:1.45}

.npm-items{margin-top:14px;background:var(--card);border-radius:var(--r);overflow:hidden}
.npm-item{display:flex;align-items:center;gap:12px;padding:14px 18px;position:relative;
  animation:npm-rise .45s var(--spring) both}
@keyframes npm-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.npm-item+.npm-item::before{content:'';position:absolute;left:18px;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.npm-item .inf{flex:1;min-width:0}
.npm-item .nm{font-size:16px;font-weight:500;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.npm-item .pr{font-size:13.5px;color:var(--ink-2);margin-top:1px;font-variant-numeric:tabular-nums}
.npm-stp{display:flex;align-items:center;background:rgba(30,24,18,.05);border-radius:10px;flex-shrink:0}
.npm-stp button{width:34px;height:32px;border:0;background:none;cursor:pointer;color:var(--ink);
  font-size:17px;font-weight:500;display:grid;place-items:center;transition:opacity .1s}
.npm-stp button:active{opacity:.35}
.npm-stp .q{min-width:26px;text-align:center;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.npm-amt{font-size:15.5px;font-weight:600;min-width:78px;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-.01em}

.npm-bar{position:absolute;left:0;right:0;bottom:0;z-index:30;
  padding:12px 20px calc(14px + env(safe-area-inset-bottom));
  background:rgba(245,242,238,.8);backdrop-filter:blur(20px) saturate(1.4);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);display:flex;align-items:center;gap:16px}
.npm-bar::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:var(--hair);transform:scaleY(.5)}
.npm-tot{min-width:80px}
.npm-tot .k{font-size:12.5px;font-weight:500;color:var(--ink-2)}
.npm-tot .v{font-size:20px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.npm-cta{flex:1;height:52px;border:0;border-radius:16px;font-size:16.5px;font-weight:600;letter-spacing:-.01em;
  color:#fff;background:var(--tint);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  transition:transform .18s var(--spring),background .3s,opacity .3s}
.npm-cta:active{transform:scale(.97);background:var(--tint-press)}
.npm-cta:disabled{opacity:.35;pointer-events:none}
.npm-cta .npm-ring{width:19px;height:19px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:npm-sp .7s linear infinite}

.npm-scrim{position:absolute;inset:0;z-index:80;background:rgba(20,15,10,.4);opacity:0;pointer-events:none;transition:opacity .35s var(--ease)}
.npm-scrim.show{opacity:1;pointer-events:auto}
.npm-sheet{position:absolute;left:0;right:0;bottom:0;z-index:90;background:var(--bg);border-radius:24px 24px 0 0;
  padding:10px 20px calc(22px + env(safe-area-inset-bottom));transform:translateY(105%);
  transition:transform .45s var(--sheet);box-shadow:0 -10px 40px rgba(20,15,10,.18);max-height:88dvh;overflow-y:auto}
.npm-sheet.show{transform:translateY(0)}
.npm-grab{width:36px;height:4.5px;border-radius:3px;background:rgba(30,24,18,.18);margin:0 auto 16px}
.npm-sheet h3{font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0 0 16px}
.npm-field{background:var(--card);border-radius:14px;padding:12px 16px;margin-bottom:10px;transition:box-shadow .2s}
.npm-field:focus-within{box-shadow:0 0 0 2px var(--tint)}
.npm-field label{display:block;font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:2px}
.npm-field input{width:100%;border:0;background:none;font:inherit;font-size:17px;font-weight:500;color:var(--ink);outline:none}
.npm-field input::placeholder{color:var(--ink-3);font-weight:400}
.npm-frow{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.npm-units{display:flex;gap:6px;margin:4px 0 14px;flex-wrap:wrap}
.npm-units button{border:0;background:var(--card);font-size:14px;font-weight:500;color:var(--ink-2);
  padding:8px 16px;border-radius:999px;cursor:pointer;transition:all .2s}
.npm-units button.on{background:var(--ink);color:#fff;font-weight:600}
.npm-hint2{font-size:13px;color:var(--ink-2);margin:-4px 2px 14px}
.npm-acts{display:flex;gap:10px;margin-top:6px}
.npm-b2{flex:1;height:50px;border:0;border-radius:15px;font-size:16px;font-weight:600;cursor:pointer;
  transition:transform .15s var(--spring),opacity .15s}
.npm-b2:active{transform:scale(.97)}
.npm-b2.ghost{background:rgba(30,24,18,.06);color:var(--ink)}
.npm-b2.pri{background:var(--tint);color:#fff}
.npm-b2.pri:disabled{opacity:.35;pointer-events:none}
.npm-b2.danger{background:none;color:#D0342C}
.npm-dsheet p{font-size:14.5px;color:var(--ink-2);line-height:1.5;margin:0 0 18px}

.npm-toast{position:absolute;left:50%;top:calc(14px + env(safe-area-inset-top));transform:translate(-50%,-160%);
  z-index:130;background:var(--ink);color:#fff;font-size:14px;font-weight:600;padding:11px 20px;border-radius:999px;
  transition:transform .45s var(--spring);white-space:nowrap;box-shadow:0 10px 30px -8px rgba(0,0,0,.35)}
.npm-toast.show{transform:translate(-50%,0)}

@media (prefers-reduced-motion:reduce){
  .npm-w *,.npm-w *::before,.npm-w *::after{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;

/* ── the browser's own recogniser — the same one the quick start uses ── */
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const UNITS = ['Nos', 'bag', 'ton', 'kg', 'load', 'sq ft', 'litre'];

export interface MobileLine { id: string; name: string; unit: string; qty: number; rate: number; total: number }
export interface MobileOption { id: string; name: string; sub: string }

export interface NewPoMobileProps {
  mode: 'po' | 'rfq';
  onMode: (m: 'po' | 'rfq') => void;
  vendors: MobileOption[];
  vendorId: string;
  onVendor: (id: string) => void;
  projects: MobileOption[];
  projectId: string;
  onProject: (id: string) => void;
  dateLabel: string;
  deliverTo: string;
  lines: MobileLine[];
  onQty: (id: string, delta: number) => void;
  total: number;
  busy: boolean;
  error: string | null;
  onSpoken: (text: string) => void;
  onFile: (file: File) => void;
  onManualAdd: (item: { name: string; qty: number; unit: string; rate: number }) => void;
  /** Items named but not yet matched to the catalogue. The desktop resolves these in the item
   *  grid, which this screen does not render — so it asks instead of dead-ending. */
  unresolved: number;
  onSubmitAsTyped: () => void;
  onSubmit: () => void;
  submitting: boolean;
  onBack: () => void;
}

export default function NewPoMobile(p: NewPoMobileProps) {
  const [drawer, setDrawer] = useState<'v' | 'p' | null>(null);
  const [sheet, setSheet] = useState<'add' | 'discard' | 'typed' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rec, setRec] = useState(false);
  const [heard, setHeard] = useState('');
  const [secs, setSecs] = useState(0);
  const [fName, setFName] = useState(''); const [fQty, setFQty] = useState(''); const [fRate, setFRate] = useState('');
  const [unit, setUnit] = useState('Nos');
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef('');
  const camRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState({ left: 3, width: 0 });
  const canSpeak = typeof window !== 'undefined' && !!recognitionCtor();

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(t => (t === m ? null : t)), 2000); };

  // the sliding pill measures the tab it belongs under, so the two labels can be any length
  useEffect(() => {
    const el = segRef.current; if (!el) return;
    const b = el.querySelectorAll('button')[p.mode === 'po' ? 0 : 1] as HTMLElement | undefined;
    if (b) setPill({ left: b.offsetLeft, width: b.offsetWidth });
  }, [p.mode, p.vendors.length]);

  useEffect(() => {
    if (!rec) return;
    const t = window.setInterval(() => setSecs(s => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [rec]);
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* already stopped */ } }, []);

  const stopRec = () => { try { recRef.current?.stop(); } catch { /* already stopped */ } setRec(false); };

  const toggleRec = () => {
    if (rec) {
      const text = (finalRef.current + ' ' + heard).trim() || heard.trim();
      stopRec();
      if (text) p.onSpoken(text); else say('Nothing was heard');
      return;
    }
    const Ctor = recognitionCtor(); if (!Ctor) return;
    finalRef.current = ''; setHeard(''); setSecs(0);
    const r = new Ctor();
    recRef.current = r;
    r.lang = 'en-IN'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]; const txt = res[0]?.transcript ?? '';
        if (res.isFinal) finalRef.current += txt + ' '; else interim += txt;
      }
      setHeard((finalRef.current + interim).trim());
    };
    r.onerror = (e) => {
      setRec(false);
      if (e?.error === 'not-allowed') say('Microphone permission is off');
      else if (e?.error !== 'aborted' && e?.error !== 'no-speech') say('Could not hear that');
    };
    r.onend = () => setRec(false);
    try { r.start(); setRec(true); } catch { say('Could not start the microphone'); }
  };

  // The waveform wants to look irregular, not to BE random: a deterministic jitter keeps every
  // render (and every device) identical, which Math.random in a component cannot promise.
  const bars = useMemo(() => Array.from({ length: 20 }, (_, i) => {
    const j = (n: number) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    return { h: 7 + j(1) * 15, d: j(2) * 0.9, dur: 0.55 + j(3) * 0.7 };
  }), []);

  const vendorName = p.vendors.find(v => v.id === p.vendorId)?.name;
  const projectName = p.projects.find(x => x.id === p.projectId)?.name;
  const count = p.lines.reduce((s, l) => s + l.qty, 0);
  // Requesting quotes is how you find a vendor, so it cannot require one — it needs a project
  // and something to ask about. Placing an order needs the vendor as well.
  const canSubmit = !!p.projectId && p.lines.length > 0 && !p.submitting && (p.mode === 'rfq' || !!p.vendorId);
  const dirty = !!p.vendorId || !!p.projectId || p.lines.length > 0;
  const closeSheets = () => setSheet(null);

  const addManual = (again: boolean) => {
    const name = fName.trim(); const qty = parseInt(fQty, 10) || 0;
    if (!name || !qty) { say('Add an item name and quantity'); return; }
    p.onManualAdd({ name, qty, unit, rate: parseInt(fRate, 10) || 0 });
    setFName(''); setFQty(''); setFRate('');
    if (again) say('Added — keep going'); else closeSheets();
  };

  const chev = (
    <svg className="npm-chev" width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
      <path d="M1.5 1.5L6.5 7l-5 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const tick = (
    <svg className="ck" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const pickRow = (
    which: 'v' | 'p', label: string, value: string | undefined, opts: MobileOption[],
    selId: string, onPick: (id: string) => void, emptyText: string,
  ) => (
    <>
      <button type="button" className={`npm-row${value ? ' set' : ''}${drawer === which ? ' open' : ''}`}
        onClick={() => setDrawer(d => (d === which ? null : which))} aria-expanded={drawer === which}>
        <span className="lb">{label}</span>
        <span className="vl">{value ?? 'Select'}</span>
        {chev}
      </button>
      <div className={`npm-drawer${drawer === which ? ' open' : ''}`}>
        {opts.length === 0 && <div className="npm-empty">{emptyText}</div>}
        {opts.map(o => (
          <button type="button" key={o.id} className={`npm-opt${selId === o.id ? ' sel' : ''}`}
            onClick={() => { onPick(o.id); window.setTimeout(() => setDrawer(null), 300); }}>
            <span className="nm">{o.name}</span>
            <span className="sb">{o.sub}</span>
            {tick}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="npm-w">
      <style>{CSS}</style>

      <div className="npm-nav">
        <button type="button" className="npm-back" onClick={() => (dirty ? setSheet('discard') : p.onBack())}>
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none" aria-hidden="true">
            <path d="M10 2L3 10l7 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div className="npm-sp" />
        <div className="npm-seg" ref={segRef} role="tablist">
          <div className="npm-pill" style={{ left: pill.left, width: pill.width }} />
          <button type="button" role="tab" aria-selected={p.mode === 'po'} className={p.mode === 'po' ? 'on' : ''} onClick={() => p.onMode('po')}>Place PO</button>
          <button type="button" role="tab" aria-selected={p.mode === 'rfq'} className={p.mode === 'rfq' ? 'on' : ''} onClick={() => p.onMode('rfq')}>Request quotes</button>
        </div>
      </div>

      <main className="npm-main">
        <h1 className="npm-title">New order</h1>
        <p className="npm-sub">Start the quickest way — everything stays editable.</p>

        <section className="npm-sect">
          <div className="npm-sect-h">Order details</div>
          <div className="npm-group">
            {pickRow('v', 'Vendor', vendorName ?? (p.mode === 'rfq' ? 'Not needed for quotes' : undefined),
                     p.vendors, p.vendorId, p.onVendor, 'No vendors yet.')}
            {pickRow('p', 'Project', projectName, p.projects, p.projectId, p.onProject, 'No projects yet.')}
            <div className="npm-row set" style={{ cursor: 'default' }}>
              <span className="lb">Date</span><span className="vl">{p.dateLabel}</span>
            </div>
            <div className={`npm-row${p.deliverTo ? ' set' : ''}`} style={{ cursor: 'default' }}>
              <span className="lb">Deliver to</span><span className="vl">{p.deliverTo || 'From project'}</span>
            </div>
          </div>
        </section>

        <section className="npm-sect">
          <div className="npm-sect-h">Items</div>

          {canSpeak && (
            <button type="button" className={`npm-voice${rec ? ' rec' : ''}`} onClick={toggleRec} aria-pressed={rec}>
              <span className="npm-mesh" aria-hidden="true" />
              <span className="npm-voice-in">
                <span className="npm-mic">
                  {rec
                    ? <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7.5" y="7.5" width="9" height="9" rx="2" /></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>}
                </span>
                <span className="npm-vt">
                  <span className="t1" style={{ display: 'block' }}>{rec ? 'Listening' : 'Say the order'}</span>
                  <span className="t2" style={{ display: 'block' }}>{rec ? 'Tap to finish' : '“20 bags cement, 5 ton 16 mm rod”'}</span>
                  <span className="npm-wave" aria-hidden="true">
                    {bars.map((b, i) => <i key={i} style={{ ['--h' as string]: `${b.h}px`, animationDelay: `${b.d}s`, animationDuration: `${b.dur}s` }} />)}
                  </span>
                </span>
                <span className="npm-timer">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
              </span>
              <span className="npm-live">{heard}<span className="npm-cursor" /></span>
            </button>
          )}

          <div className="npm-alt">
            <button type="button" disabled={p.busy} onClick={() => setSheet('add')}>Type items</button>
            <span>·</span>
            <button type="button" disabled={p.busy} onClick={() => camRef.current?.click()}>Scan a quote</button>
            <span>·</span>
            <button type="button" disabled={p.busy} onClick={() => docRef.current?.click()}>Upload file</button>
          </div>

          {p.busy && (
            <div className="npm-parsing">
              <div className="npm-pl"><div className="npm-ring" /><span>Understanding your order…</span></div>
            </div>
          )}
          {p.error && <p className="npm-err">{p.error}</p>}

          {p.lines.length > 0 && (
            <div className="npm-items">
              {p.lines.map((l, i) => (
                <div className="npm-item" key={l.id} style={{ animationDelay: `${Math.min(i, 8) * 0.06}s` }}>
                  <div className="inf">
                    <div className="nm">{l.name || 'Untitled item'}</div>
                    <div className="pr">{l.rate > 0 ? `${inr(l.rate)} per ${l.unit}` : `Rate to be confirmed · ${l.unit}`}</div>
                  </div>
                  <div className="npm-stp">
                    <button type="button" aria-label={`One less ${l.name}`} onClick={() => p.onQty(l.id, -1)}>−</button>
                    <div className="q">{l.qty}</div>
                    <button type="button" aria-label={`One more ${l.name}`} onClick={() => p.onQty(l.id, 1)}>+</button>
                  </div>
                  <div className="npm-amt">{l.total > 0 ? inr(l.total) : '—'}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onFile(f); }} />
      <input ref={docRef} type="file" accept="image/*,.pdf,.txt" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onFile(f); }} />

      <div className="npm-bar">
        <div className="npm-tot">
          <div className="k">{count} {count === 1 ? 'item' : 'items'}</div>
          <div className="v">{inr(p.total)}</div>
        </div>
        <button type="button" className="npm-cta" disabled={!canSubmit} aria-busy={p.submitting}
          onClick={() => (p.mode === 'po' && p.unresolved > 0 ? setSheet('typed') : p.onSubmit())}>
          {p.submitting ? <span className="npm-ring" aria-hidden="true" /> : null}
          <span>{p.submitting ? 'Placing…' : p.mode === 'rfq' ? 'Request quotes' : 'Create purchase order'}</span>
        </button>
      </div>

      <div className={`npm-scrim${sheet ? ' show' : ''}`} onClick={closeSheets} />

      <div className={`npm-sheet${sheet === 'add' ? ' show' : ''}`} role="dialog" aria-label="Add item">
        <div className="npm-grab" />
        <h3>Add item</h3>
        <div className="npm-field">
          <label htmlFor="npm-name">Item</label>
          <input id="npm-name" value={fName} onChange={e => setFName(e.target.value)} placeholder="OPC 53 cement" autoComplete="off" />
        </div>
        <div className="npm-frow">
          <div className="npm-field">
            <label htmlFor="npm-qty">Quantity</label>
            <input id="npm-qty" value={fQty} onChange={e => setFQty(e.target.value.replace(/[^\d]/g, ''))} placeholder="20" inputMode="numeric" autoComplete="off" />
          </div>
          <div className="npm-field">
            <label htmlFor="npm-rate">Rate — optional</label>
            <input id="npm-rate" value={fRate} onChange={e => setFRate(e.target.value.replace(/[^\d]/g, ''))} placeholder="Last price fills in" inputMode="numeric" autoComplete="off" />
          </div>
        </div>
        <div className="npm-units">
          {UNITS.map(u => <button type="button" key={u} className={u === unit ? 'on' : ''} onClick={() => setUnit(u)}>{u}</button>)}
        </div>
        <p className="npm-hint2">Leave the rate empty — the price is confirmed against the vendor before the order goes out.</p>
        <div className="npm-acts">
          <button type="button" className="npm-b2 ghost" onClick={() => addManual(true)}>Add another</button>
          <button type="button" className="npm-b2 pri" onClick={() => addManual(false)}>Add to order</button>
        </div>
      </div>

      <div className={`npm-sheet npm-dsheet${sheet === 'typed' ? ' show' : ''}`} role="dialog" aria-label="Unmatched items">
        <div className="npm-grab" />
        <h3>{p.unresolved === 1 ? 'One item is not in your catalogue' : `${p.unresolved} items are not in your catalogue`}</h3>
        <p>Matching an item to the catalogue keeps spend comparable across orders. You can place this
          order with the names exactly as they were said or typed, and match them later.</p>
        <div className="npm-acts" style={{ flexDirection: 'column' }}>
          <button type="button" className="npm-b2 pri" onClick={() => { closeSheets(); p.onSubmitAsTyped(); }}>Place with names as typed</button>
          <button type="button" className="npm-b2 ghost" onClick={closeSheets}>Go back and edit</button>
        </div>
      </div>

      <div className={`npm-sheet npm-dsheet${sheet === 'discard' ? ' show' : ''}`} role="dialog" aria-label="Leave this order">
        <div className="npm-grab" />
        <h3>Leave this order?</h3>
        <p>You&rsquo;ve started an order. Nothing is saved until you place it — go back and it is gone.</p>
        <div className="npm-acts" style={{ flexDirection: 'column' }}>
          <button type="button" className="npm-b2 danger" onClick={() => { closeSheets(); p.onBack(); }}>Discard order</button>
          <button type="button" className="npm-b2 ghost" onClick={closeSheets}>Keep editing</button>
        </div>
      </div>

      <div className={`npm-toast${toast ? ' show' : ''}`} role="status">{toast}</div>
    </div>
  );
}
