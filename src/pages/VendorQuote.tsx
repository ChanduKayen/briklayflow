// Public, no-login vendor quote page — opened from the WhatsApp RFQ link
// (www.briklay.app/quote/<token>). The vendor works through the builder's item list in a
// bottom-sheet, item by item, then reviews terms and sends. Rendered OUTSIDE the auth shell
// (App.tsx). Exact port of the vendor-quote mockup, scoped under `.vq`; the data + submit
// flow (rfq_by_token / submit_rfq_quote, closed-state, prior-quote prefill) is unchanged.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface RfqItem { line: number; item_name: string; spec?: string; qty?: number | string; unit?: string }
interface RfqData {
  ok: boolean; ref?: string; status?: string; builder_name?: string; vendor_name?: string;
  delivery_location?: string | null; quote_by?: string | null; items?: RfqItem[];
  already_quoted?: boolean; error?: string;
  extras?: { transport_included?: boolean | null; gst_included?: boolean | null; valid_days?: number | null; vendor_note?: string | null };
  existing?: { line: number; unit_rate: number | null; supplied: boolean; variant_note: string | null }[];
}
interface LineState { rate: number; skip: boolean; varTxt: string }

const fmt = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const per = (u?: string) => (u === 'box' ? 'per box' : u === 'bag' ? 'per bag' : 'per piece');
const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
.vq{--bg:#F6F6F7;--card:#FFFFFF;--soft:#F0F0F2;--ink:#111318;--ink2:#5C616B;--ink3:#9A9FA8;--line:#E7E8EB;
  --acc:#E0603A;--acc-d:#C74F2C;--acc-t:#FDEEE8;--ok:#1F9D5C;--ok-t:#E7F6EE;--warn:#D48A1E;--warn-t:#FDF3E3;
  --ease:cubic-bezier(.2,.7,.2,1);--spring:cubic-bezier(.34,1.4,.64,1);--sh:0 1px 2px rgba(17,19,24,.04),0 8px 24px -16px rgba(17,19,24,.18);
  min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.4 "Inter",-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior-y:none;font-variant-numeric:tabular-nums}
.vq *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.vq input,.vq button,.vq select{font:inherit;color:inherit}
.vq input::placeholder{color:var(--ink3)}
.vq .num{font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.vq .app{max-width:480px;margin:0 auto;min-height:100vh;padding-bottom:116px}

.vq .bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;padding:14px 18px 8px;background:rgba(246,246,247,.88);backdrop-filter:saturate(1.4) blur(14px)}
.vq .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;letter-spacing:-.01em}
.vq .brand i{width:22px;height:22px;border-radius:7px;background:var(--acc);display:grid;place-items:center}
.vq .brand i::after{content:"";width:10px;height:6px;background:#fff;border-radius:1.5px}
.vq .lang{margin-left:auto;display:inline-flex;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px}
.vq .lang button{border:0;background:transparent;padding:5px 11px;border-radius:999px;font-size:12.5px;font-weight:600;color:var(--ink3);cursor:pointer}
.vq .lang button.on{background:var(--ink);color:#fff}

.vq .hero{position:relative;margin:6px 18px 14px;padding:18px 18px 16px;border-radius:22px;background:#15171C;color:#fff;overflow:hidden;box-shadow:0 18px 40px -22px rgba(17,19,24,.6)}
.vq .hero .glow{position:absolute;right:-60px;top:-80px;width:260px;height:260px;border-radius:50%;background:radial-gradient(closest-side,rgba(224,96,58,.75),rgba(224,96,58,0));filter:blur(8px);animation:vqbreathe 6s ease-in-out infinite}
@keyframes vqbreathe{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.12);opacity:1}}
.vq .hero .bricks{position:absolute;inset:0;opacity:.07;background:repeating-linear-gradient(0deg,transparent 0 14px,#fff 14px 15px),repeating-linear-gradient(90deg,transparent 0 30px,#fff 30px 31px);mask-image:radial-gradient(circle at 85% 20%,#000 0,transparent 55%)}
.vq .hero>*:not(.glow):not(.bricks){position:relative}
.vq .hero .top{display:flex;align-items:center;justify-content:space-between}
.vq .hero .eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.62)}
.vq .hero .live{width:7px;height:7px;border-radius:50%;background:#FF8A5B;box-shadow:0 0 0 0 rgba(255,138,91,.6);animation:vqpulse 2s infinite}
@keyframes vqpulse{0%{box-shadow:0 0 0 0 rgba(255,138,91,.6)}70%{box-shadow:0 0 0 7px rgba(255,138,91,0)}100%{box-shadow:0 0 0 0 rgba(255,138,91,0)}}
.vq .hero .who .av{width:34px;height:34px;border-radius:11px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);display:grid;place-items:center;font-size:12px;font-weight:800;letter-spacing:.02em}
.vq .hero h1{margin:14px 0 8px;font-size:27px;line-height:1.12;font-weight:800;letter-spacing:-.03em}
.vq .hero .site{display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.72);font-size:14px}
.vq .hero .site svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8}
.vq .hero .foot-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1);font-size:13px;color:rgba(255,255,255,.62)}
.vq .hero .foot-line b{color:#fff;font-weight:600;font-variant-numeric:tabular-nums}
.vq .hero .foot-line .sep{opacity:.5}
.vq .hero .foot-line .tick{display:inline-block;width:6px;height:6px;border-radius:50%;background:#FFB84D;margin-right:7px;vertical-align:1px}

.vq .prog{margin:0 18px 12px;display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px 14px;box-shadow:var(--sh)}
.vq .ring{width:52px;height:52px;flex:none;position:relative}
.vq .ring svg{width:52px;height:52px;transform:rotate(-90deg)}
.vq .ring circle{fill:none;stroke-width:5;stroke-linecap:round}
.vq .ring .t{stroke:var(--soft)}
.vq .ring .f{stroke:var(--ok);stroke-dasharray:144.5;stroke-dashoffset:144.5;transition:stroke-dashoffset .6s var(--ease)}
.vq .ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:12.5px;font-weight:700}
.vq .prog .txt b{display:block;font-size:15.5px;font-weight:700;letter-spacing:-.01em}
.vq .prog .txt small{color:var(--ink2);font-size:13px}

.vq .list{padding:0 18px}
.vq .row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 14px 14px 16px;margin-bottom:8px;cursor:pointer;transition:transform .15s var(--ease),border-color .2s,background .2s;position:relative;box-shadow:var(--sh)}
.vq .row:active{transform:scale(.985)}
.vq .row.done{border-color:#CDEBD9}
.vq .row.done::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:2px;background:var(--ok)}
.vq .row.varied::before{background:var(--warn)}
.vq .row.skip{opacity:.55;box-shadow:none;background:var(--soft)}
.vq .row .nm{font-weight:600;font-size:16px;line-height:1.3;letter-spacing:-.015em}
.vq .row .sub{display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap}
.vq .row .spec{color:var(--ink3);font-size:13px}
.vq .row .qty{font-size:12px;font-weight:600;color:var(--ink2);background:var(--soft);padding:3px 7px;border-radius:6px}
.vq .row .var{font-size:12px;color:var(--warn);font-weight:600}
.vq .row .var::before{content:"◆ "}
.vq .row .right{text-align:right;min-width:92px}
.vq .row .rate{font-size:18px;font-weight:700;color:var(--ink);letter-spacing:-.01em}
.vq .row .rate small{font-size:11.5px;font-weight:500;color:var(--ink3);display:block;margin-top:1px}
.vq .row .cta{display:inline-flex;align-items:center;gap:2px;font-size:13px;font-weight:500;color:var(--ink2);background:transparent;border:1px solid var(--line);padding:7px 10px 7px 12px;border-radius:10px;transition:border-color .15s,color .15s,background .15s}
.vq .row .cta::after{content:"›";font-size:16px;line-height:1;margin-left:3px;color:var(--ink3)}
.vq .row:hover .cta{border-color:var(--ink3);color:var(--ink)}
.vq .row .skipped{font-size:13px;color:var(--ink3);font-weight:500}
.vq .row.pop{animation:vqpop .35s var(--spring)}
@keyframes vqpop{0%{transform:scale(1)}40%{transform:scale(1.02)}100%{transform:scale(1)}}
.vq .empty{padding:34px 16px;text-align:center;color:var(--ink3);font-size:14.5px}

.vq .foot{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.4) blur(16px);border-top:1px solid var(--line)}
.vq .foot .in{max-width:480px;margin:0 auto;padding:12px 18px calc(12px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px}
.vq .foot .tot b{display:block;font-size:20px;font-weight:800;letter-spacing:-.02em}
.vq .foot .tot small{color:var(--ink2);font-size:12.5px}
.vq .btn{height:52px;padding:0 20px;border-radius:14px;border:0;background:var(--ink);color:#fff;font-weight:700;font-size:15.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:transform .12s var(--ease),opacity .15s,background .15s}
.vq .btn:active{transform:scale(.97)}
.vq .btn:disabled{background:var(--soft);color:var(--ink3);cursor:not-allowed}
.vq .btn.ghost{background:var(--card);color:var(--ink);border:1.5px solid var(--line)}
.vq .btn.acc{background:var(--acc)}
.vq .btn.ok{background:var(--ok)}
.vq .btn .ar{font-size:18px;line-height:1}
.vq .foot .btn{margin-left:auto}

.vq .scrim{position:fixed;inset:0;background:rgba(17,19,24,.4);opacity:0;pointer-events:none;transition:opacity .25s;z-index:40}
.vq .scrim.on{opacity:1;pointer-events:auto}
.vq .sheet{position:fixed;left:0;right:0;bottom:0;z-index:50;max-width:480px;margin:0 auto;background:var(--card);border-radius:24px 24px 0 0;box-shadow:0 -12px 40px -20px rgba(17,19,24,.35);transform:translateY(105%);transition:transform .38s var(--ease);padding:8px 20px calc(16px + env(safe-area-inset-bottom))}
.vq .sheet.on{transform:none}
.vq .handle{width:40px;height:5px;border-radius:3px;background:var(--line);margin:4px auto 14px}
.vq .sh-top{display:flex;align-items:center;gap:10px}
.vq .sh-top .k{font-size:12px;font-weight:600;color:var(--ink3);letter-spacing:.04em}
.vq .sh-top .dots{display:flex;gap:3px;margin-left:6px}
.vq .sh-top .dots i{width:5px;height:5px;border-radius:50%;background:var(--line)}
.vq .sh-top .dots i.d{background:var(--ok)}.vq .sh-top .dots i.c{background:var(--ink);transform:scale(1.3)}
.vq .sh-top .close{margin-left:auto;width:34px;height:34px;border-radius:50%;border:0;background:var(--soft);color:var(--ink2);font-size:15px;cursor:pointer}
.vq .sw{transition:opacity .18s,transform .18s var(--ease)}
.vq .sw.out{opacity:0;transform:translateX(-10px)}
.vq .sw.in{opacity:0;transform:translateX(10px);transition:none}
.vq .sh-name{font-size:23px;font-weight:800;letter-spacing:-.025em;margin:6px 0 3px;line-height:1.2}
.vq .sh-spec{color:var(--ink2);font-size:14.5px}
.vq .sh-spec b{color:var(--ink);font-weight:600}
.vq .entry{display:flex;align-items:stretch;gap:12px;margin:18px 0 8px}
.vq .bigin{flex:1;min-width:0;display:flex;align-items:baseline;gap:6px;border-bottom:2.5px solid var(--line);padding-bottom:8px;transition:border-color .2s}
.vq .go{height:auto;align-self:stretch;flex:none;padding:0 18px;border-radius:16px;gap:6px;box-shadow:0 10px 22px -12px rgba(224,96,58,.75)}
.vq .go .go-l{font-size:15px}
.vq .go .ar{font-size:20px;transition:transform .2s var(--spring)}
.vq .go:hover .ar{transform:translateX(3px)}
.vq .bigin:focus-within{border-color:var(--acc)}
.vq .bigin .cur{font-size:28px;font-weight:600;color:var(--ink3)}
.vq .bigin input{flex:1;border:0;background:transparent;outline:none;font-size:46px;line-height:1;font-weight:800;letter-spacing:-.04em;min-width:0;padding:0;color:var(--ink)}
.vq .bigin input::placeholder{color:var(--line);font-weight:700}
.vq .bigin .per{font-size:14px;color:var(--ink2);white-space:nowrap;font-weight:500}
.vq .calc{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--ink2);min-height:22px}
.vq .calc b{color:var(--ink);font-weight:700}
.vq .quick{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0 2px}
.vq .act{--c:var(--ink2);--t:var(--soft);display:flex;align-items:center;gap:9px;height:46px;padding:0 10px;border:1px solid var(--line);border-radius:12px;background:transparent;text-align:left;cursor:pointer;transition:border-color .18s,background .18s,transform .15s var(--spring),box-shadow .18s}
.vq .act .ic{width:26px;height:26px;border-radius:8px;background:var(--t);display:grid;place-items:center;flex:none;transition:background .18s,transform .3s var(--spring)}
.vq .act .ic svg{width:15px;height:15px;stroke:var(--c);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:stroke .18s}
.vq .act .tx{min-width:0}
.vq .act .tx b{display:block;font-size:13px;font-weight:500;color:var(--ink2);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vq .act .tx small{display:none}
.vq .act:hover{border-color:var(--c);box-shadow:0 4px 14px -10px rgba(17,19,24,.25)}
.vq .act:hover .ic{transform:rotate(-8deg) scale(1.06)}
.vq .act:active{transform:scale(.97)}
.vq .act.warn{--c:var(--warn);--t:var(--warn-t)}
.vq .act.no{--c:#D64545;--t:#FDEBEB}
.vq .act.on{border-color:var(--c);background:var(--t)}
.vq .act.on .ic{background:var(--c)}
.vq .act.on .ic svg{stroke:#fff}
.vq .act.on .tx b{color:var(--c);font-weight:600}
.vq .act.no:hover .ic{transform:none}
.vq .act.no:active .ic{transform:scale(.9)}
.vq .varbox{display:none;margin-top:10px}
.vq .varbox.on{display:block}
.vq .varbox input{width:100%;height:46px;border:1.5px solid #F1D9AE;background:var(--warn-t);border-radius:12px;padding:0 12px;outline:none;font-size:15px}
.vq .varbox input::placeholder{color:#C89A55}
.vq .sh-hint{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12.5px;color:var(--ink3);margin-top:14px}
.vq .sh-hint .prev{border:0;background:transparent;padding:6px 0;color:var(--ink2);font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap;flex:none}
.vq .sh-hint span{text-align:right}
.vq .sh-hint .prev:hover{color:var(--ink)}
.vq .sh-hint .prev[hidden]{visibility:hidden;display:inline-block}

.vq .screen{padding:0 18px}
.vq #review{animation:vqslide .3s var(--ease)}
@keyframes vqslide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.vq #success{text-align:center;padding-top:44px;animation:vqup .45s var(--spring)}
@keyframes vqup{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.vq .rv-h{display:flex;align-items:center;gap:10px;margin:6px 0 14px}
.vq .rv-h button{background:var(--card);border:1px solid var(--line);width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1}
.vq .rv-h h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em}
.vq .card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--sh);margin-bottom:12px;overflow:hidden}
.vq .card .ttl{padding:12px 16px 6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.vq .rline{display:flex;align-items:center;gap:10px;padding:11px 16px;border-top:1px solid var(--line);font-size:14.5px}
.vq .rline .n{flex:1;min-width:0}
.vq .rline .n b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vq .rline .n small{color:var(--ink3);font-size:12.5px}
.vq .rline .n small.v{color:var(--warn);font-weight:600}
.vq .rline .a b{display:block;font-weight:700}
.vq .rline .ed{border:0;background:transparent;color:var(--acc);font-weight:600;font-size:13px;cursor:pointer;padding:6px}
.vq .rline.dim{color:var(--ink3)}
.vq .term{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line)}
.vq .term .l{flex:1}.vq .term .l small{display:block;color:var(--ink3);font-size:12.5px}
.vq .tgl{width:50px;height:30px;border-radius:999px;background:#D9DBDF;border:0;position:relative;cursor:pointer;transition:background .2s;flex:none}
.vq .tgl::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .22s var(--spring)}
.vq .tgl[aria-checked=true]{background:var(--ok)}
.vq .tgl[aria-checked=true]::after{transform:translateX(20px)}
.vq .term select,.vq .term input{height:42px;border:1.5px solid var(--line);border-radius:12px;background:var(--card);padding:0 12px;outline:none}
.vq .term input{flex:1}
.vq .total{display:flex;justify-content:space-between;align-items:baseline;padding:14px 16px;border-top:1px solid var(--line);background:var(--soft);font-weight:700}
.vq .total b{font-size:22px;font-weight:800;letter-spacing:-.02em}
.vq .bigok{width:88px;height:88px;border-radius:50%;background:var(--ok);margin:0 auto 18px;display:grid;place-items:center;box-shadow:0 16px 36px -16px rgba(31,157,92,.7)}
.vq .bigok svg{width:42px;height:42px;stroke:#fff;fill:none;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:vqdraw .55s .2s var(--ease) forwards}
@keyframes vqdraw{to{stroke-dashoffset:0}}
.vq #success h2{margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.02em}
.vq #success p{margin:0 0 8px;color:var(--ink2)}
.vq .conf{position:fixed;width:10px;height:10px;border-radius:3px;pointer-events:none;z-index:70}
.vq .toast{position:fixed;left:50%;bottom:124px;transform:translate(-50%,10px);background:var(--ink);color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;font-weight:500;opacity:0;pointer-events:none;transition:opacity .2s,transform .3s var(--ease);z-index:60;white-space:nowrap}
.vq .toast.show{opacity:1;transform:translate(-50%,0)}
.vq .center{max-width:480px;margin:0 auto;padding:80px 24px;text-align:center;color:var(--ink2)}
@media (prefers-reduced-motion:reduce){.vq *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function VendorQuote({ token }: { token: string }) {
  const [data, setData] = useState<RfqData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [transport, setTransport] = useState(true);
  const [gst, setGst] = useState(false);
  const [valid, setValid] = useState('7 days');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const [screen, setScreen] = useState<'list' | 'review' | 'success'>('list');
  const [sent, setSent] = useState<{ done: number; tot: number; skipped: number; varied: number } | null>(null);

  // bottom-sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cur, setCur] = useState(-1);
  const [sheetVal, setSheetVal] = useState('');
  const [varOpen, setVarOpen] = useState(false);
  const [sheetVar, setSheetVar] = useState('');
  const [swCls, setSwCls] = useState('');

  const [lang, setLang] = useState<'en' | 'te'>('en');
  const [cd, setCd] = useState('—');
  const [toastMsg, setToastMsg] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);
  const varRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = (m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1800);
  };

  useEffect(() => {
    (async () => {
      // A valid token is a UUID. A literal "{{1}}" (Static Meta button) or junk lands here.
      if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(token)) {
        setErr('This quote link looks broken — please ask your contact to resend it.'); return;
      }
      const { data: d, error } = await supabase.rpc('rfq_by_token', { p_token: token });
      if (error) { setErr('This link is no longer valid.'); return; }
      const r = d as RfqData;
      if (!r?.ok) { setErr(r?.error === 'not_found' ? 'This link is no longer valid.' : (r?.error || 'Could not load the enquiry.')); return; }
      const its = r.items ?? [];
      const ex = r.existing ?? [];
      setLines(its.map((it) => {
        const prev = ex.find((e) => e.line === it.line);
        return { rate: prev?.unit_rate != null ? Number(prev.unit_rate) : 0, skip: prev ? prev.supplied === false : false, varTxt: prev?.variant_note ?? '' };
      }));
      if (r.extras) {
        if (r.extras.transport_included != null) setTransport(r.extras.transport_included);
        if (r.extras.gst_included != null) setGst(r.extras.gst_included);
        if (r.extras.valid_days) setValid(`${r.extras.valid_days} days`);
        if (r.extras.vendor_note) setNote(r.extras.vendor_note);
      }
      setData(r);
    })();
  }, [token]);

  // countdown to the deadline (quote_by, else tomorrow 6 pm)
  useEffect(() => {
    if (!data) return;
    const target = data.quote_by ? new Date(data.quote_by) : (() => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(18, 0, 0, 0); return t; })();
    const tick = () => {
      const ms = +target - Date.now();
      if (ms <= 0) { setCd('now'); return; }
      const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
      setCd(h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m).padStart(2, '0')}m`);
    };
    tick(); const id = setInterval(tick, 30000); return () => clearInterval(id);
  }, [data]);

  const items = data?.items ?? [];

  const c = useMemo(() => {
    let tot = 0, done = 0, skipped = 0;
    lines.forEach((l, i) => {
      if (l.skip) { skipped++; return; }
      if (l.rate > 0) { done++; tot += l.rate * Number(items[i]?.qty ?? 0); }
    });
    const need = items.length - skipped;
    return { tot, done, skipped, need, todo: Math.max(0, need - done) };
  }, [lines, items]);

  // ---- sheet flow (local-array commits so navigation sees fresh state) ----
  const commitInto = (arr: LineState[], i: number, val: string, vo: boolean, vt: string): LineState[] => {
    const v = num(val);
    const n = arr.slice();
    n[i] = { ...n[i], rate: v, skip: v > 0 ? false : n[i].skip, varTxt: vo ? vt.trim() : '' };
    return n;
  };
  const nextIdx = (arr: LineState[], i: number) => {
    for (let k = i + 1; k < items.length; k++) if (!arr[k].skip && !arr[k].rate) return k;
    for (let k = 0; k < items.length; k++) if (!arr[k].skip && !arr[k].rate) return k;
    return -1;
  };
  const focusInput = () => setTimeout(() => inpRef.current?.focus(), reduced ? 0 : 10);
  const show = (i: number, src: LineState[] = lines) => {
    const doFill = () => {
      setCur(i);
      const l = src[i];
      setSheetVal(l.rate ? String(l.rate) : '');
      setVarOpen(!!l.varTxt);
      setSheetVar(l.varTxt);
      focusInput();
    };
    if (!reduced) {
      setSwCls('out');
      setTimeout(() => { doFill(); setSwCls('in'); requestAnimationFrame(() => setSwCls('')); }, 120);
    } else doFill();
  };
  const openSheet = (i: number) => { setSheetOpen(true); show(i); };
  const closeSheet = (nl?: LineState[]) => { if (nl) setLines(nl); setSheetOpen(false); setCur(-1); };

  const saveNext = () => {
    if (cur < 0) return;
    const nl = commitInto(lines, cur, sheetVal, varOpen, sheetVar);
    setLines(nl);
    const k = nextIdx(nl, cur);
    if (k === -1) { closeSheet(nl); if (nl.some((l) => l.rate > 0 && !l.skip)) toast('All priced — review and send'); return; }
    show(k, nl);
  };
  const prev = () => { if (cur <= 0) return; const nl = commitInto(lines, cur, sheetVal, varOpen, sheetVar); setLines(nl); show(cur - 1, nl); };
  const closeFromSheet = () => { const nl = cur >= 0 ? commitInto(lines, cur, sheetVal, varOpen, sheetVar) : lines; closeSheet(nl); };
  const skipItem = () => {
    if (cur < 0) return;
    const nl = lines.slice(); nl[cur] = { ...nl[cur], skip: true, rate: 0 }; setLines(nl);
    toast('Marked as not supplying');
    const k = nextIdx(nl, cur);
    if (k === -1) { closeSheet(nl); return; }
    show(k, nl);
  };
  const toggleVar = () => {
    const on = !varOpen; setVarOpen(on);
    if (on) setTimeout(() => varRef.current?.focus(), 10);
    else { setSheetVar(''); focusInput(); }
  };

  // ---- confetti (scoped to the .vq root) ----
  const confetti = (x: number, y: number) => {
    if (reduced || !rootRef.current) return;
    const cs = ['#E0603A', '#1F9D5C', '#D48A1E', '#111318', '#F4B7A2'];
    for (let i = 0; i < 28; i++) {
      const b = document.createElement('span');
      b.className = 'conf';
      b.style.cssText = `background:${cs[i % 5]};left:${x}px;top:${y}px`;
      rootRef.current.appendChild(b);
      const a = -Math.PI / 2 + (Math.random() - .5) * 1.7, sp = 220 + Math.random() * 240;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, rot = (Math.random() - .5) * 720;
      b.animate([
        { transform: 'translate(0,0)', opacity: 1 },
        { transform: `translate(${vx * .6}px,${vy * .6 + 140}px) rotate(${rot}deg)`, opacity: 1, offset: .6 },
        { transform: `translate(${vx}px,${vy + 520}px) rotate(${rot * 1.4}deg)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 400, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => b.remove();
    }
  };

  const send = async () => {
    setSending(true);
    // Skipped → not supplied; priced → supplied with rate; un-priced lines are left out.
    const p_lines = items.flatMap((it, i) => {
      const l = lines[i];
      if (l.skip) return [{ line: it.line, item_name: it.item_name, supplied: false }];
      if (l.rate > 0) return [{ line: it.line, item_name: it.item_name, unit_rate: l.rate, supplied: true, variant_note: l.varTxt.trim() || null }];
      return [];
    });
    const p_extras = { transport_included: transport, gst_included: gst, valid_days: parseInt(valid, 10) || 7, vendor_note: note.trim() || null, quoted_total: c.tot };
    const { data: res, error } = await supabase.rpc('submit_rfq_quote', { p_token: token, p_lines, p_extras });
    setSending(false);
    const r = res as any;
    if (error || !r?.ok) { setErr(error?.message || (r?.error === 'closed' ? 'This enquiry was just closed by the buyer — the order is placed.' : 'Could not send. Try again.')); return; }
    const varied = lines.filter((l) => !l.skip && l.rate > 0 && l.varTxt.trim()).length;
    setSent({ done: c.done, tot: c.tot, skipped: c.skipped, varied });
    setScreen('success');
    window.scrollTo(0, 0);
    setTimeout(() => confetti(window.innerWidth / 2, 180), 60);
  };

  // ---------- gating states ----------
  if (err) return <div className="vq" ref={rootRef}><style>{CSS}</style><div className="center">{err}</div></div>;
  if (!data) return <div className="vq" ref={rootRef}><style>{CSS}</style><div className="center">Loading enquiry…</div></div>;

  if (data.status && data.status !== 'open') {
    return (
      <div className="vq" ref={rootRef}><style>{CSS}</style>
        <div className="app">
          <div className="bar"><span className="brand"><i />Briklay</span></div>
          <div id="success" className="screen">
            <div className="bigok" style={{ background: 'var(--ink3)' }}><svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 6" /></svg></div>
            <h2>This enquiry is closed</h2>
            <p>{data.builder_name} has placed the order.</p>
            <p style={{ fontSize: 14, color: 'var(--ink3)' }}>Thanks for quoting.</p>
          </div>
        </div>
      </div>
    );
  }

  const builder = data.builder_name || 'The builder';
  const builderInitials = builder.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·';
  const pct = c.need ? c.done / c.need : 0;
  const curItem = cur >= 0 ? items[cur] : null;
  const curCalc = curItem ? num(sheetVal) * Number(curItem.qty ?? 0) : 0;

  return (
    <div className="vq" ref={rootRef}><style>{CSS}</style>
      <div className="app">
        {/* app bar */}
        <div className="bar">
          <span className="brand"><i />Briklay</span>
          <div className="lang">
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            <button className={lang === 'te' ? 'on' : ''} onClick={() => { setLang('te'); toast('తెలుగు వెర్షన్ త్వరలో'); }}>తె</button>
          </div>
        </div>

        {screen === 'list' && (
          <>
            {/* hero */}
            <div className="hero">
              <div className="glow" /><div className="bricks" />
              <div className="top">
                <span className="eyebrow"><i className="live" />Rate enquiry · {data.ref}</span>
                <span className="who"><span className="av">{builderInitials}</span></span>
              </div>
              <h1>{builder}<br />needs your rates</h1>
              {data.delivery_location && (
                <div className="site"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>{data.delivery_location}</div>
              )}
              <div className="foot-line">
                <span><i className="tick" /><b>{cd}</b> left to quote</span>
                <span className="sep">·</span>
                <span>Prepared for <b>{data.vendor_name}</b></span>
              </div>
            </div>

            {/* progress */}
            <div className="prog">
              <div className="ring">
                <svg viewBox="0 0 52 52"><circle className="t" cx="26" cy="26" r="23" /><circle className="f" cx="26" cy="26" r="23" style={{ strokeDashoffset: 144.5 * (1 - pct) }} /></svg>
                <b>{Math.round(pct * 100)}%</b>
              </div>
              <div className="txt">
                <b>{c.done === 0 ? 'Start with any item' : c.todo === 0 ? 'All done — review and send' : `${c.done} of ${c.need} priced`}</b>
                <small>{c.done === 0 ? `Type a rate, hit next — we’ll take you through all ${items.length}` : c.todo === 0 ? 'Check terms on the next screen, then send.' : `${c.todo} left · tap any to continue`}</small>
              </div>
            </div>

            {/* rows */}
            <div className="list">
              {items.map((it, i) => {
                const l = lines[i] ?? { rate: 0, skip: false, varTxt: '' };
                const cls = ['row', l.skip ? 'skip' : l.rate ? 'done' : '', l.varTxt && !l.skip ? 'varied' : ''].filter(Boolean).join(' ');
                return (
                  <div className={cls} key={i} onClick={() => openSheet(i)}>
                    <div>
                      <div className="nm">{it.item_name}</div>
                      <div className="sub">
                        {it.spec && <span className="spec">{it.spec}</span>}
                        <span className="qty">{it.qty} {it.unit}</span>
                        {l.varTxt && !l.skip && <span className="var">{l.varTxt}</span>}
                      </div>
                    </div>
                    <div className="right">
                      {l.skip ? <span className="skipped">Not supplying</span>
                        : l.rate ? <div className="rate">{fmt(l.rate)}<small>{fmt(l.rate * Number(it.qty ?? 0))} total</small></div>
                        : <span className="cta">Add rate</span>}
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && <div className="empty">No items on this enquiry.</div>}
            </div>
          </>
        )}

        {screen === 'review' && (
          <div id="review" className="screen">
            <div className="rv-h"><button aria-label="Back" onClick={() => setScreen('list')}>‹</button><h2>Review before sending</h2></div>
            <div className="card">
              <div className="ttl">Your rates</div>
              <div>
                {items.map((it, i) => {
                  const l = lines[i];
                  if (l.skip) return <div className="rline dim" key={i}><span className="n"><b>{it.item_name}</b><small>not supplying</small></span><button className="ed" onClick={() => openSheet(i)}>Edit</button></div>;
                  if (!l.rate) return <div className="rline dim" key={i}><span className="n"><b>{it.item_name}</b><small>no rate given</small></span><button className="ed" onClick={() => openSheet(i)}>Add</button></div>;
                  return (
                    <div className="rline" key={i}>
                      <span className="n"><b>{it.item_name}</b><small className={l.varTxt ? 'v' : ''}>{l.varTxt ? '◆ ' + l.varTxt : `${it.qty} ${it.unit} × ${fmt(l.rate)}`}</small></span>
                      <span className="a"><b>{fmt(l.rate * Number(it.qty ?? 0))}</b></span>
                      <button className="ed" onClick={() => openSheet(i)}>Edit</button>
                    </div>
                  );
                })}
              </div>
              <div className="total"><span>Total quoted</span><b>{fmt(c.tot)}</b></div>
            </div>
            <div className="card">
              <div className="ttl">Terms</div>
              <div className="term" style={{ borderTop: 0 }}>
                <span className="l">Transport included<small>off = you'll bill it separately</small></span>
                <button className="tgl" role="switch" aria-checked={transport} onClick={() => setTransport((v) => !v)} />
              </div>
              <div className="term">
                <span className="l">GST included<small>off = GST extra as applicable</small></span>
                <button className="tgl" role="switch" aria-checked={gst} onClick={() => setGst((v) => !v)} />
              </div>
              <div className="term">
                <span className="l">Rates valid for</span>
                <select value={valid} onChange={(e) => setValid(e.target.value)}><option>3 days</option><option>7 days</option><option>15 days</option><option>30 days</option></select>
              </div>
              <div className="term"><input value={note} placeholder="Anything else? e.g. delivery in 2 days" onChange={(e) => setNote(e.target.value)} /></div>
            </div>
          </div>
        )}

        {screen === 'success' && sent && (
          <div id="success" className="screen">
            <div className="bigok"><svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 6" /></svg></div>
            <h2>Rates sent</h2>
            <p>
              <b style={{ fontSize: 18 }}>{sent.done} items · {fmt(sent.tot)}</b><br />
              <span style={{ fontSize: 14, color: 'var(--ink2)' }}>
                Transport {transport ? 'included' : 'extra'} · GST {gst ? 'included' : 'extra'} · valid {valid}
                {sent.skipped ? ` · ${sent.skipped} not supplied` : ''}{sent.varied ? ` · ${sent.varied} with a change` : ''}
              </span>
            </p>
            <p style={{ fontSize: 14, color: 'var(--ink3)' }}>{builder} will confirm the order on WhatsApp.<br />You can change your rates until the deadline.</p>
            <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => { setSent(null); setScreen('list'); }}>Change my rates</button>
          </div>
        )}
      </div>

      {/* footer (hidden on success) */}
      {screen !== 'success' && (
        <div className="foot"><div className="in">
          <div className="tot">
            <b>{fmt(c.tot)}</b>
            <small>{screen === 'review'
              ? `${c.done} items${c.skipped ? ` · ${c.skipped} not supplied` : ''}`
              : c.done ? `${c.done} item${c.done > 1 ? 's' : ''} priced${c.todo ? ` · ${c.todo} left` : ''}` : 'Nothing priced yet'}</small>
          </div>
          {screen === 'review'
            ? <button className="btn ok" disabled={sending} onClick={send}><span>{sending ? 'Sending…' : 'Send rates'}</span><span className="ar">→</span></button>
            : <button className="btn" disabled={!c.done} onClick={() => { setScreen('review'); window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); }}><span>Review &amp; send</span><span className="ar">→</span></button>}
        </div></div>
      )}

      {/* one persistent sheet */}
      <div className={`scrim${sheetOpen ? ' on' : ''}`} onClick={closeFromSheet} />
      <div className={`sheet${sheetOpen ? ' on' : ''}`} role="dialog">
        <div className="handle" />
        <div className="sh-top">
          <span className="k">ITEM {cur + 1} OF {items.length}</span>
          <span className="dots">{items.map((_, k) => <i key={k} className={k === cur ? 'c' : (lines[k]?.rate && !lines[k]?.skip) ? 'd' : ''} />)}</span>
          <button className="close" aria-label="Close" onClick={closeFromSheet}>✕</button>
        </div>
        <div className={`sw ${swCls}`}>
          <div className="sh-name">{curItem?.item_name}</div>
          <div className="sh-spec">{curItem?.spec ? curItem.spec + ' · ' : ''}<b>{curItem?.qty} {curItem?.unit}</b> needed</div>
        </div>
        <div className="entry">
          <div className="bigin">
            <span className="cur">₹</span>
            <input ref={inpRef} inputMode="decimal" enterKeyHint="next" placeholder="0" autoComplete="off"
              value={sheetVal} onChange={(e) => setSheetVal(e.target.value.replace(/[^0-9.]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNext(); } }} />
            <span className="per">{curItem ? per(curItem.unit) : 'per piece'}</span>
          </div>
          <button className="btn acc go" aria-label="Save and next" onClick={saveNext}><span className="go-l">Next</span><span className="ar">→</span></button>
        </div>
        <div className="calc"><span>{num(sheetVal) ? `${curItem?.qty} × ${fmt(num(sheetVal))}` : 'Line total appears here'}</span><b>{num(sheetVal) ? fmt(curCalc) : ''}</b></div>
        <div className="quick">
          <button className={`act warn${varOpen ? ' on' : ''}`} onClick={toggleVar}>
            <span className="ic"><svg viewBox="0 0 24 24"><path d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3" /></svg></span>
            <span className="tx"><b>Different item</b><small>other brand or size</small></span>
          </button>
          <button className="act no" onClick={skipItem}>
            <span className="ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></svg></span>
            <span className="tx"><b>Can't supply</b><small>skip this one</small></span>
          </button>
        </div>
        <div className={`varbox${varOpen ? ' on' : ''}`}>
          <input ref={varRef} value={sheetVar} placeholder="What are you offering instead? e.g. No. 8 size / Cera brand" onChange={(e) => setSheetVar(e.target.value)} />
        </div>
        <div className="sh-hint"><button className="prev" hidden={cur <= 0} onClick={prev}>‹ Previous</button><span>Enter also saves &amp; moves on</span></div>
      </div>

      <div className={`toast${toastMsg ? ' show' : ''}`}>{toastMsg}</div>
    </div>
  );
}
