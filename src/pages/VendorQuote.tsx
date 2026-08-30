// Public, no-login vendor quote page — opened from the WhatsApp RFQ link
// (www.briklay.app/quote/<token>). The vendor sees the builder's item list and enters
// their rates; submitting writes the quote back. Rendered OUTSIDE the auth shell (App.tsx).
// Faithful port of the vendor-quote mockup, scoped under `.vq`.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface RfqItem { line: number; item_name: string; spec?: string; qty?: number | string; unit?: string }
interface RfqData {
  ok: boolean; ref?: string; builder_name?: string; vendor_name?: string;
  delivery_location?: string | null; quote_by?: string | null; items?: RfqItem[];
  already_quoted?: boolean; error?: string;
  extras?: { transport_included?: boolean | null; gst_included?: boolean | null; valid_days?: number | null; vendor_note?: string | null };
  existing?: { line: number; unit_rate: number | null; supplied: boolean; variant_note: string | null }[];
}
interface LineState { rate: string; skip: boolean; varying: boolean; varTxt: string }

const fmt = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const perUnit = (u?: string) => (u === 'box' ? 'box' : u === 'bag' ? 'bag' : 'piece');

const CSS = `
.vq{--cream:#F6F2EA;--paper:#FFFDF9;--paper-2:#FBF8F2;--ink:#2F2622;--ink-2:#6E635B;--ink-3:#A39A91;--line:#E4DCD0;--line-2:#EFE9DF;--terra:#C4613A;--terra-deep:#A94E2B;--terra-tint:#F8E7DE;--sage:#5F7F5B;--sage-tint:#E7EFE4;--gold:#B8862E;--gold-tint:#F7EEDA;--ease:cubic-bezier(.2,.7,.2,1);
  background:var(--cream);color:var(--ink);font:16px/1.45 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.vq *{box-sizing:border-box}
.vq input,.vq button,.vq select{font:inherit;color:inherit}
.vq input::placeholder{color:var(--ink-3)}
.vq .mono{font-family:"DM Mono",ui-monospace,monospace;font-feature-settings:"tnum"}
.vq .wrap{max-width:520px;margin:0 auto;padding:16px 14px 130px}
.vq .head{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 2px rgba(47,38,34,.04)}
.vq .head .from{font-size:13px;color:var(--ink-2);letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.vq .head h1{margin:4px 0 2px;font:700 21px/1.25 "DM Sans"}
.vq .head .site{color:var(--ink-2);font-size:14.5px}
.vq .head .you{margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2);display:flex;align-items:center;gap:10px;font-size:14.5px;color:var(--ink-2)}
.vq .head .you .av{width:34px;height:34px;border-radius:50%;background:var(--terra-tint);color:var(--terra);display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}
.vq .head .you b{color:var(--ink)}
.vq .due{display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:var(--gold-tint);color:var(--gold);font-weight:600;font-size:13.5px;padding:6px 10px;border-radius:999px}
.vq .due i{width:6px;height:6px;border-radius:50%;background:var(--gold)}
.vq .steps{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:10px;background:rgba(246,242,234,.92);backdrop-filter:blur(8px);margin:0 -14px 12px;padding:10px 18px;font-size:13.5px;color:var(--ink-2)}
.vq .steps b{color:var(--ink)}
.vq .pbar{flex:1;height:5px;border-radius:3px;background:var(--line-2);overflow:hidden}
.vq .pbar i{display:block;height:100%;width:0;background:var(--sage);border-radius:3px;transition:width .35s var(--ease)}
.vq .item{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:10px;transition:border-color .2s,opacity .2s,box-shadow .2s;position:relative;cursor:text}
.vq .item:focus-within{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.vq .item.done{border-color:var(--sage)}
.vq .item.done::after{content:"✓";position:absolute;top:10px;right:12px;width:20px;height:20px;border-radius:50%;background:var(--sage);color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;animation:vqpop .25s var(--ease)}
@keyframes vqpop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
.vq .item.skip{opacity:.55;background:var(--paper-2)}
.vq .item .top{display:flex;gap:10px;align-items:baseline;padding-right:26px}
.vq .item .nm{font-weight:600;font-size:16.5px;line-height:1.3}
.vq .item .spec{color:var(--ink-3);font-size:13.5px;margin-top:1px}
.vq .item .qty{margin-left:auto;flex:none;font:500 13px "DM Mono";color:var(--ink-2);background:var(--paper-2);border:1px solid var(--line-2);padding:4px 8px;border-radius:6px;white-space:nowrap}
.vq .item .row{display:flex;gap:10px;align-items:center;margin-top:12px}
.vq .rate{position:relative;flex:1}
.vq .rate .pre{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--ink-3);font-size:17px}
.vq .rate input{width:100%;height:56px;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);padding:0 84px 0 34px;font:500 20px "DM Mono";outline:none;transition:border-color .15s,box-shadow .15s}
.vq .rate input:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.vq .rate .per{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:var(--ink-3);font-size:13px;pointer-events:none}
.vq .item .amt{flex:none;text-align:right;min-width:86px}
.vq .item .amt small{display:block;font-size:11px;color:var(--ink-3);letter-spacing:.06em;text-transform:uppercase}
.vq .item .amt .mono{font-weight:500;font-size:16px}
.vq .rowlinks{display:flex;gap:16px}
.vq .skipbtn,.vq .varbtn{border:0;background:transparent;color:var(--ink-3);font-size:13px;padding:6px 0 0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.vq .varbtn:hover{color:var(--gold)}
.vq .var{display:none;margin-top:10px}
.vq .item.varying .var{display:block}
.vq .item.varying .varbtn{display:none}
.vq .var input{width:100%;height:44px;border:1.5px solid #EBD9B4;background:var(--gold-tint);border-radius:9px;padding:0 12px;outline:none;font-size:15px}
.vq .var input:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-tint)}
.vq .var input::placeholder{color:#C4A25E}
.vq .item.varied{border-color:#EBD9B4}
.vq .var small{display:block;font-size:11.5px;font-weight:600;letter-spacing:.05em;color:var(--gold);margin-bottom:5px}.vq .var small::before{content:"◆ "}
.vq .skipbtn:hover{color:var(--terra)}
.vq .item.skip .rowlinks,.vq .item.skip .row{display:none}
.vq .unskip{display:none;margin-top:10px;font-size:14px;color:var(--ink-2)}
.vq .item.skip .unskip{display:block}
.vq .unskip button{border:0;background:transparent;color:var(--terra);font-weight:600;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px}
.vq .extras{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:6px 16px;margin:16px 0 10px}
.vq .ex{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--line-2)}
.vq .ex:last-child{border-bottom:0}
.vq .ex .lbl{flex:1;font-size:15.5px}
.vq .ex .lbl small{display:block;color:var(--ink-3);font-size:13px}
.vq .tgl{width:46px;height:27px;border-radius:999px;background:var(--line);border:0;position:relative;cursor:pointer;transition:background .2s;flex:none}
.vq .tgl::after{content:"";position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s var(--ease)}
.vq .tgl[aria-checked=true]{background:var(--sage)}
.vq .tgl[aria-checked=true]::after{transform:translateX(19px)}
.vq .ex select,.vq .ex input{height:42px;border:1.5px solid var(--line);border-radius:9px;background:var(--paper);padding:0 12px;outline:none}
.vq .ex input:focus,.vq .ex select:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.vq .ex input.note{flex:1}
.vq .bar{position:fixed;left:0;right:0;bottom:0;background:rgba(255,253,249,.92);backdrop-filter:blur(10px);border-top:1px solid var(--line);z-index:40}
.vq .bar .in{max-width:520px;margin:0 auto;padding:12px 14px calc(12px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px}
.vq .bar .tot{flex:1;line-height:1.3}
.vq .bar .tot .mono{font-size:20px;font-weight:600;display:block}
.vq .bar .tot small{color:var(--ink-2);font-size:12.5px}
.vq .bar .tot small b{color:var(--gold)}
.vq .jump{border:0;background:var(--gold-tint);color:var(--gold);font-weight:600;font-size:12.5px;border-radius:999px;padding:5px 10px;cursor:pointer;transition:transform .12s}
.vq .jump:active{transform:scale(.95)}
.vq .send{height:52px;padding:0 22px;border-radius:12px;border:0;background:var(--terra);color:#fff;font-weight:700;font-size:16.5px;cursor:pointer;position:relative;overflow:hidden;transition:background .16s,transform .12s var(--ease),box-shadow .16s;box-shadow:0 6px 16px -8px rgba(196,97,58,.7)}
.vq .send:hover{background:var(--terra-deep)}
.vq .send:active{transform:scale(.97)}
.vq .send:disabled{background:var(--line);color:var(--ink-3);box-shadow:none;cursor:not-allowed}
.vq .send .lbl{transition:opacity .15s}.vq .send.loading .lbl{opacity:0}
.vq .send .spin{position:absolute;inset:0;display:none;place-items:center}.vq .send.loading .spin{display:grid}
.vq .spinner{width:20px;height:20px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:vqspin .7s linear infinite}
@keyframes vqspin{to{transform:rotate(360deg)}}
.vq .foot{font-size:12.5px;color:var(--ink-3);text-align:center;margin-top:16px;line-height:1.6}
.vq .foot a{color:var(--ink-2)}
.vq .doneScr{text-align:center;padding:60px 20px}
.vq .doneScr .big{width:74px;height:74px;border-radius:50%;background:var(--sage);margin:0 auto 18px;display:grid;place-items:center}
.vq .doneScr .big svg{width:36px;height:36px;stroke:#fff;fill:none;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:30;stroke-dashoffset:30;animation:vqdraw .5s .2s var(--ease) forwards}
@keyframes vqdraw{to{stroke-dashoffset:0}}
.vq .doneScr h2{font:700 22px "DM Sans";margin:0 0 6px}
.vq .doneScr p{color:var(--ink-2);margin:0 0 6px}
.vq .doneScr .mono{font-weight:600}
.vq .doneScr .edit{margin-top:20px;height:46px;padding:0 18px;border-radius:10px;border:1.5px solid var(--line);background:var(--paper);font-weight:600;cursor:pointer}
.vq .doneScr .edit:hover{border-color:var(--terra);color:var(--terra)}
.vq .shake{animation:vqshake .4s var(--ease)}
@keyframes vqshake{20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
.vq .center{max-width:520px;margin:0 auto;padding:80px 24px;text-align:center;color:var(--ink-2)}
@media (prefers-reduced-motion:reduce){.vq *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

const num = (s: string) => Number(String(s).replace(/[^0-9.]/g, '')) || 0;

export default function VendorQuote({ token }: { token: string }) {
  const [data, setData] = useState<RfqData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [transport, setTransport] = useState(true);
  const [gst, setGst] = useState(false);
  const [valid, setValid] = useState('7 days');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ done: number; tot: number; skipped: number; varied: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data: d, error } = await supabase.rpc('rfq_by_token', { p_token: token });
      if (error) { setErr(error.message); return; }
      const r = d as RfqData;
      if (!r?.ok) { setErr(r?.error === 'not_found' ? 'This link is no longer valid.' : (r?.error || 'Could not load the enquiry.')); return; }
      const items = r.items ?? [];
      const ex = r.existing ?? [];
      setLines(items.map((it) => {
        const prev = ex.find((e) => e.line === it.line);
        return { rate: prev?.unit_rate != null ? String(prev.unit_rate) : '', skip: prev ? prev.supplied === false : false, varying: !!prev?.variant_note, varTxt: prev?.variant_note ?? '' };
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

  const items = data?.items ?? [];
  const setLine = (i: number, patch: Partial<LineState>) => setLines((L) => L.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const calc = useMemo(() => {
    let tot = 0, done = 0, skipped = 0;
    lines.forEach((l, i) => {
      if (l.skip) { skipped++; return; }
      const r = num(l.rate);
      if (r > 0) { done++; tot += r * Number(items[i]?.qty ?? 0); }
    });
    const need = items.length - skipped;
    return { tot, done, skipped, need, left: Math.max(0, need - done) };
  }, [lines, items]);

  const focusLine = (i: number) => {
    const el = wrapRef.current?.querySelector<HTMLInputElement>(`input[data-i="${i}"]`);
    if (!el) return;
    el.closest('.item')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.focus({ preventScroll: true }), 220);
  };
  const firstUnpriced = () => lines.findIndex((l, i) => !l.skip && num(l.rate) === 0 && i < items.length);

  const onEnter = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    for (let k = i + 1; k < items.length; k++) if (!lines[k].skip && num(lines[k].rate) === 0) { focusLine(k); return; }
    const k = firstUnpriced(); if (k > -1) { focusLine(k); return; }
    (e.target as HTMLInputElement).blur();
    wrapRef.current?.querySelector('.extras')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const send = async () => {
    if (calc.left > 0) {
      const k = firstUnpriced();
      if (k > -1) { const el = wrapRef.current?.querySelector(`.item[data-item="${k}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.classList.add('shake'); setTimeout(() => el?.classList.remove('shake'), 450); focusLine(k); }
      return;
    }
    setSending(true);
    const p_lines = items.map((it, i) => {
      const l = lines[i];
      if (l.skip) return { line: it.line, item_name: it.item_name, supplied: false };
      return { line: it.line, item_name: it.item_name, unit_rate: num(l.rate), supplied: true, variant_note: l.varTxt.trim() || null };
    });
    const p_extras = { transport_included: transport, gst_included: gst, valid_days: parseInt(valid, 10) || 7, vendor_note: note.trim() || null, quoted_total: calc.tot };
    const { data: res, error } = await supabase.rpc('submit_rfq_quote', { p_token: token, p_lines, p_extras });
    setSending(false);
    if (error || !(res as any)?.ok) { setErr(error?.message || (res as any)?.error || 'Could not send. Try again.'); return; }
    const varied = lines.filter((l) => !l.skip && num(l.rate) > 0 && l.varTxt.trim()).length;
    setSent({ done: calc.done, tot: calc.tot, skipped: calc.skipped, varied });
    window.scrollTo(0, 0);
  };

  if (err) return <div className="vq"><style>{CSS}</style><div className="center">{err}</div></div>;
  if (!data) return <div className="vq"><style>{CSS}</style><div className="center">Loading enquiry…</div></div>;

  if (sent) {
    return (
      <div className="vq"><style>{CSS}</style>
        <div className="wrap"><div className="doneScr">
          <div className="big"><svg viewBox="0 0 24 24"><path d="M4 12l6 6L20 6" /></svg></div>
          <h2>Rates sent to {data.builder_name}</h2>
          <p><span className="mono">{sent.done} items · {fmt(sent.tot)}</span></p>
          <p style={{ fontSize: 14 }}>
            Transport {transport ? 'included' : 'extra'} · GST {gst ? 'included' : 'extra'} · valid {valid}
            {sent.skipped ? ` · ${sent.skipped} not supplied` : ''}{sent.varied ? ` · ${sent.varied} quoted with a change` : ''}
          </p>
          <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>They'll confirm the order on WhatsApp.</p>
          <button className="edit" onClick={() => setSent(null)}>Change my rates</button>
        </div></div>
      </div>
    );
  }

  const vendorInitials = (data.vendor_name ?? '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·';
  const dueLabel = data.quote_by ? `Please quote by ${new Date(data.quote_by).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null;

  return (
    <div className="vq"><style>{CSS}</style>
      <div className="wrap" ref={wrapRef}>
        <div className="head">
          <div className="from">Rate enquiry · {data.ref}</div>
          <h1>{data.builder_name} needs your rates</h1>
          {data.delivery_location && <div className="site">Delivery to {data.delivery_location}</div>}
          {dueLabel && <div className="due"><i />{dueLabel}</div>}
          <div className="you"><span className="av">{vendorInitials}</span><span>Quoting as <b>{data.vendor_name}</b> — no login needed. Skip anything you don't supply.</span></div>
        </div>

        <p className="steps">
          <span><b>{calc.done}</b>/<b>{calc.need}</b> priced</span>
          <span className="pbar"><i style={{ width: `${calc.need ? (calc.done / calc.need) * 100 : 0}%` }} /></span>
          <span className="mono">{fmt(calc.tot)}</span>
        </p>

        <div>
          {items.map((it, i) => {
            const l = lines[i] ?? { rate: '', skip: false, varying: false, varTxt: '' };
            const amt = num(l.rate) * Number(it.qty ?? 0);
            const cls = ['item', l.skip ? 'skip' : '', !l.skip && num(l.rate) > 0 ? 'done' : '', l.varying ? 'varying' : '', l.varTxt.trim() ? 'varied' : ''].filter(Boolean).join(' ');
            return (
              <div className={cls} key={i} data-item={i} onClick={(e) => { if (!l.skip && (e.target as HTMLElement).tagName !== 'INPUT' && !(e.target as HTMLElement).closest('button')) focusLine(i); }}>
                <div className="top">
                  <div><div className="nm">{it.item_name}</div>{it.spec && <div className="spec">{it.spec}</div>}</div>
                  <span className="qty">{it.qty} {it.unit}</span>
                </div>
                {!l.skip && (
                  <div className="row">
                    <div className="rate">
                      <span className="pre">₹</span>
                      <input inputMode="decimal" enterKeyHint="next" data-i={i} value={l.rate} placeholder="rate"
                        onChange={(e) => setLine(i, { rate: e.target.value })} onKeyDown={(e) => onEnter(e, i)} />
                      <span className="per">per {perUnit(it.unit)}</span>
                    </div>
                    <div className="amt"><small>Total</small><span className="mono">{num(l.rate) ? fmt(amt) : '—'}</span></div>
                  </div>
                )}
                {!l.skip && (
                  <div className="rowlinks">
                    <button className="skipbtn" onClick={() => { setLine(i, { skip: true }); }}>✕ Don't supply</button>
                    {!l.varying && <button className="varbtn" onClick={() => setLine(i, { varying: true })}>≠ Offering different</button>}
                  </div>
                )}
                {!l.skip && (
                  <div className="var">
                    <small>Offering instead of what was asked</small>
                    <input value={l.varTxt} placeholder="What instead? e.g. No. 8 size / Cera brand / packet of 100" onChange={(e) => setLine(i, { varTxt: e.target.value })} />
                  </div>
                )}
                {l.skip && <div className="unskip">Not supplying · <button onClick={() => setLine(i, { skip: false })}>undo</button></div>}
              </div>
            );
          })}
        </div>

        <div className="extras">
          <div className="ex"><span className="lbl">Transport included in rates<small>off = billed separately</small></span>
            <button className="tgl" role="switch" aria-checked={transport} onClick={() => setTransport((v) => !v)} /></div>
          <div className="ex"><span className="lbl">GST included<small>off = GST extra as applicable</small></span>
            <button className="tgl" role="switch" aria-checked={gst} onClick={() => setGst((v) => !v)} /></div>
          <div className="ex"><span className="lbl">Rates valid for</span>
            <select value={valid} onChange={(e) => setValid(e.target.value)}>
              <option>3 days</option><option>7 days</option><option>15 days</option><option>30 days</option>
            </select></div>
          <div className="ex"><input className="note" value={note} placeholder="Anything else? e.g. delivery in 2 days" onChange={(e) => setNote(e.target.value)} /></div>
        </div>

        <p className="foot">This link is only for {data.vendor_name} · sent by {data.builder_name} via Briklay</p>
      </div>

      <div className="bar"><div className="in">
        <div className="tot">
          <span className="mono">{fmt(calc.tot)}</span>
          <small>{calc.left === 0 && calc.need > 0 ? 'All priced — ready to send' : calc.need === 0 ? 'Everything skipped' : <><b>{calc.left}</b> item{calc.left > 1 ? 's' : ''} left to price</>}</small>
          {calc.left > 0 && calc.done > 0 && <button className="jump" onClick={() => { const k = firstUnpriced(); if (k > -1) focusLine(k); }}> next ↓</button>}
        </div>
        <button className={`send${sending ? ' loading' : ''}`} disabled={calc.done === 0 || sending} onClick={send}>
          <span className="lbl">Send rates</span><span className="spin"><span className="spinner" /></span>
        </button>
      </div></div>
    </div>
  );
}
