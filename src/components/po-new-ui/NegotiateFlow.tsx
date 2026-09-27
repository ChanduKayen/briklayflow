// NegotiateFlow — the "Ask {vendor} for a better price" screen, built to the reference design.
//
// A full-screen, six-step wizard launched from a vendor column on the RFQ compare page. It reads the real
// comparison (this vendor's total vs the cheapest OTHER vendor, item by item), lets the buyer set a target,
// pick which rates to bring down, add conditions, preview the exact WhatsApp message (English / Telugu), and
// send. The composed message never names the competitor — only that someone quoted lower.
//
// It sends by calling back `onSend(note)`; the parent wires that to send-rfq's NEGOTIATE mode (which stores
// the note on the vendor's quote page and WhatsApps them their link).
import { useMemo, useState } from 'react';

export interface NegItem { line: number; name: string; qtyLabel: string; qty: number; vendorRate: number; compRate: number }
export interface NegBest { name: string; qtyLabel: string; rate: number }
export interface NegotiateFlowProps {
  vendorName: string;
  vendorTotal: number;
  competitorName: string | null;
  competitorTotal: number | null;
  askItems: NegItem[];
  bestItems: NegBest[];
  builderName: string;
  onClose: () => void;
  onSend: (note: string) => Promise<{ ok: boolean; error?: string }>;
}

// ₹ with Indian digit grouping.
const fmt = (n: number) => {
  n = Math.round(Number(n) || 0);
  let x = String(Math.abs(n)); const last = x.slice(-3); let rest = x.slice(0, -3);
  let out = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last : last;
  return (n < 0 ? '-₹' : '₹') + out;
};
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (s: string) => s.trim().split(/\s+/).slice(0, 2).join(' ');

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@500;600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
.negx{position:fixed;inset:0;z-index:120;overflow-y:auto;-webkit-overflow-scrolling:touch;
  --page:#ECE7DE;--sheet:#FBF9F5;--ink:#2B2521;--ink-2:#6B635B;--ink-3:#9F978E;
  --line:#E8E2D8;--line-2:#D6CFC4;--clay:#C4552C;--clay-ink:#9E4322;--clay-tint:#F7EAE3;
  --green:#3F7A55;--green-tint:#E7F0E9;--wa:#128C4E;--wa-bubble:#E9FBEF;
  --serif:"Source Serif 4",Georgia,serif;--sans:"Inter",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,monospace;
  background:var(--page);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
.negx *{box-sizing:border-box;margin:0}
.negx button{font:inherit;cursor:pointer;color:inherit}
.negx :focus-visible{outline:2px solid var(--clay);outline-offset:2px}
.negx .stage{padding:40px 16px 60px;max-width:1160px;margin:0 auto;min-height:100%;display:grid;justify-items:center;align-content:start;gap:28px}
.negx .card{width:min(430px,100%);background:var(--sheet);border-radius:22px;box-shadow:0 30px 80px rgba(43,37,33,.22),0 2px 6px rgba(43,37,33,.08);padding:22px 24px;position:relative}
.negx .top{display:flex;align-items:center;justify-content:space-between;font-size:13.5px;color:var(--ink-3);margin-bottom:14px;min-height:22px}
.negx .top button{border:0;background:transparent;color:var(--ink-2);padding:0;font-size:14.5px}
.negx .bar{height:4px;border-radius:2px;background:var(--line);margin-bottom:18px;overflow:hidden}
.negx .bar i{display:block;height:100%;background:var(--clay);border-radius:2px;transition:width .3s}
.negx h1{font:600 23px/1.25 var(--serif);letter-spacing:-.01em}
.negx .sub{margin-top:6px;color:var(--ink-2);font-size:15px}
.negx .say{margin-top:14px;font-size:16px;line-height:1.6}
.negx .m{font-family:var(--mono);font-weight:500}
.negx .up{color:var(--clay-ink)}.negx .g{color:var(--green)}
.negx .why{margin-top:14px;padding:12px 14px;border-radius:12px;background:#F3EFE7;font-size:14.5px;color:var(--ink-2);line-height:1.55}
.negx .why b{color:var(--ink);font-weight:500;font-family:var(--mono)}
.negx .why div+div{margin-top:4px}
.negx .opts{margin-top:18px;display:grid;gap:10px}
.negx .opt{width:100%;text-align:left;border:1.5px solid var(--line-2);background:#fff;border-radius:14px;padding:13px 16px;font-size:16px;display:flex;align-items:center;gap:12px;transition:border-color .15s,background .15s}
.negx .opt:hover{border-color:var(--ink-3)}
.negx .opt.main{background:var(--clay);border-color:var(--clay);color:#fff}
.negx .opt small{display:block;font-size:13.5px;opacity:.75;margin-top:1px}
.negx .opt .ic{width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.06);display:inline-flex;align-items:center;justify-content:center;flex:none;font-size:16px}
.negx .opt.main .ic{background:rgba(255,255,255,.2)}
.negx .opt .box{margin-left:auto;width:22px;height:22px;border-radius:6px;border:1.5px solid var(--line-2);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:13px;flex:none}
.negx .opt .rad{margin-left:auto;width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line-2);flex:none;position:relative}
.negx .opt[aria-pressed="true"]{border-color:var(--green);background:var(--green-tint)}
.negx .opt[aria-pressed="true"] .box{background:var(--green);border-color:var(--green)}
.negx .opt[aria-pressed="true"] .rad{border-color:var(--green)}
.negx .opt[aria-pressed="true"] .rad::after{content:"";position:absolute;inset:4px;border-radius:50%;background:var(--green)}
.negx .opt .r{margin-left:auto;text-align:right;font-family:var(--mono);font-size:15px;white-space:nowrap}
.negx .opt .r small{font-family:var(--sans);opacity:.7}
.negx .tag{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:999px;background:var(--green);color:#fff;margin-left:6px;vertical-align:2px;font-family:var(--sans);font-weight:500}
.negx .custom{margin-top:10px;display:none;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid var(--green);border-radius:14px;background:var(--green-tint)}
.negx .custom.show{display:flex}
.negx .step{display:inline-flex;align-items:center;border:1.5px solid var(--line-2);border-radius:12px;background:#fff;overflow:hidden}
.negx .step button{width:44px;height:48px;border:0;background:transparent;font-size:22px;color:var(--ink-2)}
.negx .step .v{min-width:64px;text-align:center;font:500 20px var(--mono)}
.negx .custom .becomes{font-size:14px;color:var(--ink-2)}
.negx .custom .becomes b{display:block;font:500 18px var(--mono);color:var(--ink)}
.negx .items{margin-top:14px;display:grid;gap:8px}
.negx .it{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px 14px;border:1.5px solid var(--line-2);border-radius:14px;background:#fff}
.negx .it .nm{font-size:15.5px}
.negx .it .nm small{display:block;color:var(--ink-3);font-size:13px}
.negx .it .ask{text-align:right;font-family:var(--mono);font-size:15px}
.negx .it .ask s{color:var(--ink-3);font-size:13px;margin-right:6px}
.negx .it .ask b{color:var(--green);font-weight:500}
.negx .it .ch{grid-column:2;justify-self:end;border:0;background:transparent;font-size:13px;color:var(--clay-ink);padding:0}
.negx .it.best{background:transparent;border-style:dashed}
.negx .it.best .ask{color:var(--ink-3);font-size:14px}
.negx .it .ed{grid-column:1/-1;display:none;align-items:center;gap:10px;padding-top:8px;border-top:1px solid var(--line);margin-top:4px}
.negx .it.editing .ed{display:flex}
.negx .it .ed .step button{height:40px;width:40px;font-size:18px}
.negx .it .ed .step .v{font-size:17px;min-width:56px}
.negx .it .ed span{font-size:13px;color:var(--ink-3)}
.negx .grp{margin-top:16px;font-size:13.5px;color:var(--ink-3)}
.negx .sumry{margin-top:14px;display:grid;gap:8px}
.negx .sumry .ln{display:flex;justify-content:space-between;gap:12px;font-size:15px;padding:8px 0;border-bottom:1px solid var(--line)}
.negx .sumry .ln .m{color:var(--green)}
.negx .sumry .ln button{border:0;background:transparent;color:var(--clay-ink);font-size:13.5px;padding:0;flex:none}
.negx .notsent{margin-top:16px;display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink-3)}
.negx .notsent i{width:8px;height:8px;border-radius:50%;background:var(--ink-3);opacity:.5}
.negx .wa{margin-top:8px;background:#EFEBE3;border-radius:14px;padding:12px;background-image:radial-gradient(#E2DCD1 .8px,transparent .8px);background-size:14px 14px}
.negx .bubble{background:var(--wa-bubble);border-radius:12px 12px 12px 3px;padding:10px 13px 8px;box-shadow:0 1px 1px rgba(0,0,0,.06);font-size:14.5px;line-height:1.55}
.negx .bubble .from{font-weight:600;color:var(--wa);font-size:12.5px;margin-bottom:3px}
.negx .bubble p+p{margin-top:8px}
.negx .bubble .btn{display:inline-block;margin-top:9px;padding:6px 11px;border-radius:8px;background:#fff;color:var(--wa);font-weight:500;font-size:13.5px}
.negx .lang{display:flex;gap:6px;margin-top:10px;justify-content:flex-end}
.negx .lang button{border:1px solid var(--line-2);background:transparent;border-radius:999px;padding:4px 11px;font-size:13px;color:var(--ink-2)}
.negx .lang button[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}
.negx .safe{margin-top:12px;display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--ink-2);line-height:1.5}
.negx .safe span{flex:none;width:22px;height:22px;border-radius:50%;background:var(--green-tint);color:var(--green);display:inline-flex;align-items:center;justify-content:center;font-size:12px;margin-top:1px}
.negx .cta{margin-top:18px;width:100%;border:0;background:var(--clay);color:#fff;font-weight:500;font-size:16.5px;padding:15px;border-radius:14px}
.negx .cta:hover{background:var(--clay-ink)}
.negx .cta:disabled{opacity:.6;cursor:default}
.negx .skip{border:0;background:transparent;color:var(--ink-3);font-size:14.5px;padding:12px 0 0;width:100%;text-align:center}
.negx .wait{margin-top:18px;padding:14px 16px;border-radius:14px;background:#F3EFE7;display:flex;gap:12px;align-items:center}
.negx .wait i{width:9px;height:9px;border-radius:50%;background:var(--clay);animation:negBreathe 1.6s ease-in-out infinite;flex:none}
@keyframes negBreathe{50%{transform:scale(.6);opacity:.5}}
@media (prefers-reduced-motion:reduce){.negx .wait i{animation:none}}
.negx .wait small{display:block;color:var(--ink-3);font-size:13px}
`;

export default function NegotiateFlow(props: NegotiateFlowProps) {
  const { vendorName, vendorTotal: QUOTE, competitorName, competitorTotal, askItems, bestItems, builderName, onClose, onSend } = props;
  const hasComp = !!competitorName && competitorTotal != null && competitorTotal > 0;
  const LOWEST = hasComp ? (competitorTotal as number) : Math.round(QUOTE * 0.95);

  const [page, setPage] = useState<'p1' | 'p2' | 'p3' | 'p4' | 'p5' | 'p6'>('p1');
  const [ov, setOv] = useState<'match' | 'p5' | 'p7' | 'custom'>(hasComp ? 'match' : 'p5');
  const [pct, setPct] = useState(5);
  const [includeItems, setIncludeItems] = useState(true);
  const [asks, setAsks] = useState<number[]>(askItems.map((i) => i.compRate));
  const [editing, setEditing] = useState(-1);
  const [add, setAdd] = useState<Set<string>>(new Set());
  const [by, setBy] = useState<'today' | 'tomorrow' | 'third'>('tomorrow');
  const [lang, setLang] = useState<'en' | 'te'>('en');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = (p: typeof page) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const target = ov === 'match' ? LOWEST : ov === 'p5' ? Math.round(QUOTE * 0.95) : ov === 'p7' ? Math.round(QUOTE * 0.93) : Math.round(QUOTE * (1 - pct / 100));
  const tPct = ((QUOTE - target) / QUOTE * 100).toFixed(1);
  const gap = QUOTE - LOWEST;

  // reply-by + a delivery date, from the real calendar
  const { byLabel, byWord, byTe, deliveryLabel, gstOnTop } = useMemo(() => {
    const now = new Date();
    const tm = new Date(now); tm.setDate(now.getDate() + 1);
    const th = new Date(now); th.setDate(now.getDate() + 3);
    const fri = new Date(now); fri.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7 || 7));
    return {
      byLabel: { today: 'today', tomorrow: `tomorrow (${DOW[tm.getDay()]})`, third: DOW[th.getDay()] } as Record<string, string>,
      byWord: { today: 'today', tomorrow: 'tomorrow', third: DOW[th.getDay()] } as Record<string, string>,
      byTe: { today: 'Ee roju', tomorrow: `Repu (${DOW[tm.getDay()]})`, third: DOW[th.getDay()] } as Record<string, string>,
      deliveryLabel: `${DOW[fri.getDay()]} ${fri.getDate()} ${MON[fri.getMonth()]}`,
      gstOnTop: Math.round(QUOTE * 0.18),
    };
  }, [QUOTE]);

  const addLbl: Record<string, string> = {
    transport: 'Transport to site included', unload: 'Loading and unloading included', gstin: 'GST included in the rates',
    gstbill: 'Proper GST bill', credit: '30 days credit', delivery: `Delivery by ${deliveryLabel}`, hold: 'Rates held for 15 days',
  };
  const addMsg: Record<string, string> = {
    transport: 'transport to site included', unload: 'loading and unloading included', gstin: 'GST included in the rates',
    gstbill: 'a proper GST bill', credit: '30 days credit', delivery: `delivery by ${deliveryLabel}`, hold: 'rates held for 15 days',
  };
  const addTe: Record<string, string> = {
    transport: 'transport tho kalipi', unload: 'loading unloading tho kalipi', gstin: 'GST kalipina rates',
    gstbill: 'GST bill', credit: '30 days credit', delivery: `${deliveryLabel} lopu delivery`, hold: '15 days rates hold',
  };

  const changed = useMemo(() => askItems.map((it, k) => ({ ...it, ask: asks[k] })).filter((it) => it.ask < it.vendorRate), [askItems, asks]);
  const adds = [...add];

  // compose the message (plain paragraphs) — never names the competitor
  const paras = useMemo(() => {
    const ch = includeItems ? changed : [];
    if (lang === 'en') {
      let p1 = `${vendorName} garu, thanks for the quote. We got a lower rate from another vendor for the same list.`;
      if (ch.length) {
        p1 += ` Mainly on ${ch.slice(0, 3).map((i) => i.name.toLowerCase()).join(', ')} — could you do ${ch.slice(0, 3).map((i) => '₹' + i.ask).join(', ')}?`;
        if (bestItems.length) p1 += ` Your ${bestItems.slice(0, 2).map((b) => short(b.name).toLowerCase()).join(' and ')} rates are fine.`;
      }
      const p2 = `If the total can come to about ${fmt(target)}${adds.length ? ', with ' + adds.map((a) => addMsg[a]).join(', ') : ''}, we'll place the full order with you. Please revise your rates below by ${byWord[by]} — we're deciding then.`;
      return [p1, p2];
    }
    let p1 = `${vendorName} garu, quote ki thanks. Ide list ki vere vendor thakkuva rate icharu.`;
    if (ch.length) {
      p1 += ` Mukhyanga ${ch.slice(0, 3).map((i) => short(i.name).toLowerCase()).join(', ')} — ${ch.slice(0, 3).map((i) => '₹' + i.ask).join(', ')} ki cheyagalara?`;
      if (bestItems.length) p1 += ` Mee ${bestItems.slice(0, 2).map((b) => short(b.name).toLowerCase()).join(', ')} rates baagunnayi.`;
    }
    const p2 = `Total ${fmt(target)} varaku vaste${adds.length ? ', ' + adds.map((a) => addTe[a]).join(', ') + ' tho' : ''} full order mee ke istham. ${byTe[by]} lopu kinda rates change cheyandi — appudu decide chestham.`;
    return [p1, p2];
  }, [lang, includeItems, changed, bestItems, vendorName, target, adds, by, byWord, byTe, addMsg, addTe]);

  const send = async () => {
    setErr(null); setSending(true);
    const res = await onSend(paras.join('\n\n'));
    setSending(false);
    if (!res.ok) { setErr(res.error || 'Could not send'); return; }
    go('p6');
  };

  const summaryRows: { label: string; meta: string; go: typeof page }[] = [
    { label: `Total down to ${fmt(target)}`, meta: `${tPct}% less`, go: 'p2' },
  ];
  if (includeItems && changed.length) summaryRows.push({ label: `${changed.slice(0, 3).map((i) => short(i.name)).join(', ')} at lower rates`, meta: `${changed.length} items`, go: 'p3' });
  adds.forEach((a) => summaryRows.push({ label: addLbl[a], meta: '', go: 'p4' }));

  return (
    <div className="negx">
      <style>{CSS}</style>
      <div className="stage">
        <section className="card">

          {page === 'p1' && (
            <>
              <div className="top"><span /><span>{vendorName}</span><span /></div>
              {hasComp
                ? <>
                    <h1>{vendorName} is charging more than {competitorName}</h1>
                    <p className="say">{vendorName}'s total <b className="m">{fmt(QUOTE)}</b>. {competitorName} <b className="m g">{fmt(LOWEST)}</b> for the same list — {vendorName} is <b className="m up">{fmt(gap)} ({tPct}%) more</b>.</p>
                    {(changed.length > 0 || bestItems.length > 0) && (
                      <div className="why">
                        {changed.length > 0 && (() => { const t = [...changed].sort((a, b) => (b.vendorRate - b.compRate) * b.qty - (a.vendorRate - a.compRate) * a.qty)[0]; return <div><b>{fmt((t.vendorRate - t.compRate) * t.qty)}</b> of it is {t.name.toLowerCase()} ({vendorName} ₹{t.vendorRate}, {competitorName} ₹{t.compRate}).</div>; })()}
                        <div>{changed.length > 1 ? `Rest is ${changed.slice(1).map((i) => short(i.name).toLowerCase()).join(', ')}. ` : ''}{bestItems.length ? `On ${bestItems.slice(0, 2).map((b) => short(b.name).toLowerCase()).join(' and ')}, ${vendorName} is the cheapest.` : ''}</div>
                      </div>
                    )}
                  </>
                : <>
                    <h1>Ask {vendorName} for a better price</h1>
                    <p className="say">{vendorName}'s total <b className="m">{fmt(QUOTE)}</b>. Ask them to sharpen it — Briklay writes and sends the message.</p>
                  </>}
              <div className="opts">
                <button className="opt main" onClick={() => go('p2')}><span className="ic">💬</span><span>Ask {vendorName} for a better price<small>A few quick questions. Briklay writes and sends the message.</small></span></button>
                <button className="opt" onClick={onClose}><span className="ic">📞</span><span>I'll call {vendorName} myself</span></button>
                {hasComp && <button className="opt" onClick={onClose}><span className="ic">✓</span><span>Leave it, go with {competitorName}</span></button>}
              </div>
            </>
          )}

          {page === 'p2' && (
            <>
              <div className="top"><button onClick={() => go('p1')}>‹ Back</button><span>1 of 4</span><span /></div>
              <div className="bar"><i style={{ width: '25%' }} /></div>
              <h1>How much less should {vendorName}'s total be?</h1>
              <div className="opts">
                {hasComp && <button className={`opt${ov === 'match' ? '' : ''}`} aria-pressed={ov === 'match'} onClick={() => setOv('match')}><span>Match {competitorName}<span className="tag">Usual</span><small>{vendorName} has to come to their total</small></span><span className="r">{fmt(LOWEST)}<br /><small>{tPctOf(QUOTE, LOWEST)}% less</small></span></button>}
                <button className="opt" aria-pressed={ov === 'p5'} onClick={() => setOv('p5')}><span>5% less<small>A round number, easy to ask</small></span><span className="r">{fmt(Math.round(QUOTE * 0.95))}<br /><small>{fmt(Math.round(QUOTE * 0.05))} less</small></span></button>
                <button className="opt" aria-pressed={ov === 'p7'} onClick={() => setOv('p7')}><span>7% less<small>Push harder. They may go partway</small></span><span className="r">{fmt(Math.round(QUOTE * 0.93))}<br /><small>{fmt(Math.round(QUOTE * 0.07))} less</small></span></button>
                <button className="opt" aria-pressed={ov === 'custom'} onClick={() => setOv('custom')}><span>I'll set the number</span><span className="rad" /></button>
              </div>
              <div className={`custom${ov === 'custom' ? ' show' : ''}`}>
                <div className="step"><button onClick={() => setPct((p) => Math.max(1, p - 1))}>−</button><span className="v">{pct}%</span><button onClick={() => setPct((p) => Math.min(30, p + 1))}>+</button></div>
                <div className="becomes">{vendorName}'s total becomes<b>{fmt(Math.round(QUOTE * (1 - pct / 100)))}</b></div>
              </div>
              <button className="cta" onClick={() => go('p3')}>Next: which items</button>
            </>
          )}

          {page === 'p3' && (
            <>
              <div className="top"><button onClick={() => go('p2')}>‹ Back</button><span>2 of 4</span><span /></div>
              <div className="bar"><i style={{ width: '50%' }} /></div>
              <h1>Which rates to ask {vendorName} to bring down?</h1>
              <p className="sub">{hasComp ? `We've filled in ${competitorName}'s rates. Change any if you want.` : 'Set a target rate for any line.'}</p>
              <div className="items">
                {askItems.map((i, k) => (
                  <div className={`it${editing === k ? ' editing' : ''}`} key={i.line}>
                    <div className="nm">{i.name}<small>{i.qtyLabel} · {vendorName} ₹{i.vendorRate}</small></div>
                    <div className="ask"><s>₹{i.vendorRate}</s><b>₹{asks[k]}</b></div>
                    <button className="ch" onClick={() => setEditing((e) => (e === k ? -1 : k))}>{editing === k ? 'done' : 'change'}</button>
                    <div className="ed">
                      <div className="step">
                        <button onClick={() => setAsks((a) => a.map((v, j) => (j === k ? Math.max(1, v - 1) : v)))}>−</button>
                        <span className="v">₹{asks[k]}</span>
                        <button onClick={() => setAsks((a) => a.map((v, j) => (j === k ? v + 1 : v)))}>+</button>
                      </div>
                      {hasComp && <span>{competitorName} ₹{i.compRate}</span>}
                    </div>
                  </div>
                ))}
                {askItems.length === 0 && <p className="sub">Every line is already at or below the other quotes — you can still ask on the total.</p>}
              </div>
              {bestItems.length > 0 && <>
                <div className="grp">Already cheapest at {vendorName} — we'll tell them these are fine:</div>
                <div className="items">
                  {bestItems.map((i, k) => <div className="it best" key={k}><div className="nm">{i.name}<small>{i.qtyLabel}</small></div><div className="ask">₹{i.rate} · keep</div></div>)}
                </div>
              </>}
              <button className="cta" onClick={() => { setIncludeItems(true); go('p4'); }}>Next: anything else</button>
              <button className="skip" onClick={() => { setIncludeItems(false); go('p4'); }}>Skip — just ask on the total</button>
            </>
          )}

          {page === 'p4' && (
            <>
              <div className="top"><button onClick={() => go('p3')}>‹ Back</button><span>3 of 4</span><span /></div>
              <div className="bar"><i style={{ width: '75%' }} /></div>
              <h1>Anything else to ask for?</h1>
              <p className="sub">Tap what you want. All optional.</p>
              <div className="opts">
                {([
                  ['transport', 'Transport to site included', 'If not in the quote'],
                  ['unload', 'Loading and unloading included', ''],
                  ['gstin', 'GST included in these rates', `18% on top would be ${fmt(gstOnTop)}`],
                  ['gstbill', 'Proper GST bill', 'So you can claim input credit'],
                  ['credit', '30 days credit', ''],
                  ['delivery', `Deliver by ${deliveryLabel}`, ''],
                  ['hold', 'Hold these rates for 15 days', ''],
                ] as const).map(([key, title, note]) => (
                  <button key={key} className="opt" aria-pressed={add.has(key)} onClick={() => setAdd((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; })}>
                    <span>{title}{note ? <small>{note}</small> : null}</span><span className="box">✓</span>
                  </button>
                ))}
              </div>
              <button className="cta" onClick={() => go('p5')}>Next: check and send</button>
              <button className="skip" onClick={() => go('p5')}>Skip</button>
            </>
          )}

          {page === 'p5' && (
            <>
              <div className="top"><button onClick={() => go('p4')}>‹ Back</button><span>4 of 4</span><span /></div>
              <div className="bar"><i style={{ width: '100%' }} /></div>
              <h1>You're asking {vendorName} for</h1>
              <div className="sumry">
                {summaryRows.map((r, i) => (
                  <div className="ln" key={i}><span>{r.label}{r.meta ? <> <span className="m">{r.meta}</span></> : null}</span><button onClick={() => go(r.go)}>change</button></div>
                ))}
              </div>
              <div className="opts" style={{ marginTop: 14 }}>
                <button className="opt" style={{ padding: '10px 14px', fontSize: 15 }} onClick={() => setBy((b) => (b === 'today' ? 'tomorrow' : b === 'tomorrow' ? 'third' : 'today'))}>
                  <span>Reply by <b>{byLabel[by]}</b></span><span className="r" style={{ fontFamily: 'var(--sans)', fontSize: 13.5, color: 'var(--clay-ink)' }}>change</span>
                </button>
              </div>
              <div className="notsent"><i />Not sent yet. {vendorName} will get this:</div>
              <div className="wa"><div className="bubble">
                <div className="from">{builderName} · via Briklay</div>
                {paras.map((p, i) => <p key={i}>{p}</p>)}
                <span className="btn">Change my rates ↗</span>
              </div></div>
              <div className="lang">
                <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
                <button aria-pressed={lang === 'te'} onClick={() => setLang('te')}>Telugu</button>
              </div>
              <div className="safe"><span>✓</span><div>{vendorName} will <b>not</b> see {hasComp ? `${competitorName}'s name or rates` : 'any other quote'} — only that someone quoted lower.</div></div>
              <div className="safe"><span>✓</span><div>{vendorName}'s current quote stays until they change it. You can cancel this request any time.</div></div>
              {err && <p className="say" style={{ color: 'var(--clay-ink)', fontSize: 14 }}>{err}</p>}
              <button className="cta" disabled={sending} onClick={send}>{sending ? 'Sending…' : `Send to ${vendorName} on WhatsApp`}</button>
            </>
          )}

          {page === 'p6' && (
            <>
              <div className="top"><span /><span>Sent</span><span /></div>
              <h1>Sent to {vendorName}</h1>
              <p className="sub">{new Date().toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · WhatsApp</p>
              <div className="wait"><i /><div>Waiting for {vendorName}<small>Asked to reply by {byWord[by]}. We'll message you on WhatsApp when they do.</small></div></div>
              <p className="say" style={{ fontSize: 15, color: 'var(--ink-2)' }}>Nothing else to do now. {vendorName}'s current quote stays in the comparison until they revise it.</p>
              <div className="opts">
                <button className="opt" onClick={onClose}><span className="ic">📋</span><span>Back to the comparison</span></button>
                <button className="opt" disabled={sending} onClick={send}><span className="ic">🔔</span><span>Remind {vendorName}</span></button>
              </div>
            </>
          )}

        </section>
      </div>
    </div>
  );
}

const tPctOf = (from: number, to: number) => (from > 0 ? ((from - to) / from * 100).toFixed(1) : '0');
