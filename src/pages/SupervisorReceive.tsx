// Public, no-login page the site supervisor opens from WhatsApp (/receive/<token>).
// Did the delivery all come? Confirm each line (or tap "yes, all of it"), note any problem,
// send. Writes a GRN → stock via receive_token_submit. Rendered OUTSIDE the auth shell.
// Port of the reference phone screen, scoped .sup; mobile-first.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Item { po_line_item_id: string; item_name: string; unit: string; quantity_ordered: number; unit_rate: number | null; received_so_far: number }
interface Data { ok: boolean; used?: boolean; vendor?: string; site?: string | null; po_id?: string; items?: Item[]; error?: string }
interface LS { qty: number; prob: string | null }

const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const clamp = (v: number) => Math.max(0, Math.round(v * 100) / 100)
const remaining = (l: Item) => Math.max(0, l.quantity_ordered - (l.received_so_far || 0))

const CSS = `
.sup{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;
  --cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;--sage-wash:#E7F0E6;--amber:#8A6A2E;
  --serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;--ease:cubic-bezier(.2,.7,.2,1);--spring:cubic-bezier(.34,1.4,.64,1);
  min-height:100vh;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.4;-webkit-font-smoothing:antialiased}
.sup *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.sup button,.sup input{font:inherit;color:inherit}.sup button{cursor:pointer}
.sup .m{max-width:520px;margin:0 auto;padding:26px 18px 120px}
.sup .brand{display:flex;align-items:baseline;gap:2px;font-family:var(--serif);font-weight:600;font-size:18px;color:var(--ink)}
.sup .brand i{width:5px;height:5px;border-radius:50%;background:var(--clay);display:inline-block}
.sup h1{margin:14px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.15}
.sup .who{margin-top:6px;font-size:14px;color:var(--ink-3)}.sup .who b{color:var(--ink-2);font-weight:600}
.sup .card{margin-top:16px;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:16px}
.sup .card h2{margin:0;font-size:16px;font-weight:600}.sup .card h2 small{display:block;font-weight:400;font-size:13px;color:var(--ink-3);margin-top:2px}
.sup .mall{margin-top:16px;height:62px;border-radius:18px;border:0;background:var(--sage);color:#fff;font-size:16.5px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-shadow:0 14px 26px -14px rgba(47,93,58,.9);transition:transform .12s,background .2s}
.sup .mall:active{transform:scale(.98)}
.sup .mall svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.sup .mall.done{background:var(--sage-wash);color:var(--sage);box-shadow:none}
.sup .or{margin-top:14px;font-size:13px;color:var(--ink-3);text-align:center}
.sup .ml{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 0;border-top:1px solid var(--rule)}
.sup .ml:first-child{border-top:0;padding-top:2px}
.sup .ml .nm b{display:block;font-size:15.5px;font-weight:600}
.sup .ml .nm span{display:block;font-size:12.5px;color:var(--ink-3)}.sup .ml .nm span.warn{color:var(--amber);font-weight:500}
.sup .ml .fld{display:inline-flex;align-items:center;height:48px;border:1.5px solid var(--line-2);border-radius:14px;background:var(--paper);padding:0 4px;gap:2px}
.sup .ml .fld.ok{border-color:var(--sage-wash);background:var(--sage-wash)}.sup .ml .fld.ok input{color:var(--sage)}
.sup .ml .fld .stp{width:40px;height:40px;border-radius:11px;border:0;background:var(--wash);font-size:20px;font-weight:600;color:var(--ink);display:grid;place-items:center}
.sup .ml .fld .stp:active{background:var(--line)}
.sup .ml .fld input{width:62px;height:40px;border:0;background:none;text-align:center;font-family:var(--mono);font-size:20px;font-weight:500;outline:none;padding:0}
.sup .ml .fld .u{font-size:12.5px;color:var(--ink-3);padding:0 8px 0 2px}
.sup .ml .pb{grid-column:1/-1;justify-self:start;height:34px;padding:0 12px;border-radius:17px;border:1px solid var(--line-2);background:var(--paper);font-size:13.5px;font-weight:500;color:var(--ink-2)}
.sup .ml .pb.on{background:var(--clay-wash);border-color:var(--clay);color:var(--clay)}
.sup .ml .probtxt{grid-column:1/-1;height:46px;border:1.5px solid var(--clay-wash);border-radius:12px;background:var(--clay-wash);padding:0 12px;outline:none;font-size:15px}
.sup .chal{margin-top:12px;display:flex;align-items:center;gap:10px;height:52px;border:1.5px solid var(--line-2);border-radius:14px;background:var(--paper);padding:0 14px}
.sup .chal label{font-size:14px;color:var(--ink-3);white-space:nowrap}
.sup .chal input{flex:1;border:0;background:none;outline:none;font-family:var(--mono);font-size:16px;min-width:0}
.sup .chal input::placeholder{font-family:var(--sans);color:var(--line-2);font-weight:500;font-size:14px}
.sup .foot{position:fixed;left:0;right:0;bottom:0;padding:12px 18px 22px;background:linear-gradient(180deg,rgba(250,248,243,0),var(--ground) 30%)}
.sup .foot .in{max-width:520px;margin:0 auto}
.sup .send{width:100%;height:56px;border-radius:18px;border:0;background:var(--clay);color:#fff;font-size:17px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 14px 26px -14px rgba(181,71,42,.9);transition:transform .12s;position:relative}
.sup .send:active{transform:scale(.98)}
.sup .send:disabled{opacity:.6}
.sup .send.busy{color:transparent}
.sup .send.busy::after{content:"";position:absolute;width:20px;height:20px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:supspin .7s linear infinite}
@keyframes supspin{to{transform:rotate(360deg)}}
.sup .send svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.sup .send small{position:absolute;bottom:-22px;left:0;right:0;text-align:center;font-size:12.5px;color:var(--ink-3);font-weight:500}
.sup .mid{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 28px}
.sup .mid .big{width:88px;height:88px;border-radius:44px;background:var(--sage-wash);color:var(--sage);display:grid;place-items:center;animation:suppop .5s var(--spring) both}
@keyframes suppop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
.sup .mid .big svg{width:40px;height:40px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.sup .mid h2{margin:20px 0 0;font-family:var(--serif);font-weight:600;font-size:26px}
.sup .mid p{margin:8px 0 0;color:var(--ink-2);font-size:15px}
`
const TICK = <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>

export default function SupervisorReceive({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [lines, setLines] = useState<LS[]>([])
  const [master, setMaster] = useState(false)
  const [challan, setChallan] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ text: string } | null>(null)

  useEffect(() => {
    (async () => {
      const { data: d } = await supabase.rpc('receive_token_load', { p_token: token })
      const r = (d ?? { ok: false, error: 'Could not load this link.' }) as Data
      setData(r)
      if (r.ok && r.items) setLines(r.items.map((l) => ({ qty: remaining(l), prob: null })))
    })()
  }, [token])

  if (!data) return <div className="sup"><style>{CSS}</style><div className="mid"><p>Loading…</p></div></div>
  if (!data.ok) return <div className="sup"><style>{CSS}</style><div className="mid"><h2>Link not valid</h2><p>{data.error}</p></div></div>
  if (data.used || sent) return <div className="sup"><style>{CSS}</style><div className="mid"><div className="big">{TICK}</div><h2>Sent</h2><p>{sent?.text || 'This delivery was already confirmed.'}<br />The office can see it now. You can close this.</p></div></div>

  const items = data.items ?? []
  const allOk = lines.every((x, i) => Math.abs(x.qty - remaining(items[i])) < 0.001)
  const setLine = (i: number, patch: Partial<LS>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const step = (l: Item) => (remaining(l) >= 100 ? 5 : remaining(l) >= 10 ? 1 : 0.5)
  const nRecv = lines.filter((x) => x.qty > 0).length
  const summary = () => {
    if (allOk) return `All ${items.length} items, as expected.`
    if (lines.every((x) => x.qty <= 0)) return 'Nothing came.'
    return lines.map((x, i) => ({ x, l: items[i] })).filter(({ x, l }) => x.qty < remaining(l) - 0.001).map(({ x, l }) => x.qty <= 0 ? l.item_name + " didn't come" : l.item_name + ' ' + fmt(remaining(l) - x.qty) + ' ' + l.unit + ' short').join(' · ')
  }

  const send = async () => {
    if (sending) return
    setSending(true)
    try {
      const payload = items.map((l, i) => ({ po_line_item_id: l.po_line_item_id, item_name: l.item_name, unit: l.unit, qty_ordered: l.quantity_ordered, qty_received: lines[i].qty, unit_rate: l.unit_rate, remarks: lines[i].prob || null }))
      const { data: r, error } = await supabase.rpc('receive_token_submit', { p_token: token, p_items: payload, p_challan: challan.trim() || null, p_notes: null })
      if (error || !(r as any)?.ok) throw new Error((r as any)?.error || error?.message || 'Could not send')
      setSent({ text: summary() })
    } catch (e) { setSending(false); alert((e as Error).message || 'Could not send — try again') }
  }

  return (
    <div className="sup">
      <style>{CSS}</style>
      <div className="m">
        <div className="brand">Briklay<i /></div>
        <h1>{data.vendor} lorry — did it all come?</h1>
        <div className="who">{data.site ? <><b>{data.site}</b> · </> : null}{items.length} item{items.length === 1 ? '' : 's'}</div>

        <button className={`mall${master && allOk ? ' done' : ''}`} onClick={() => { setLines(items.map((l) => ({ qty: remaining(l), prob: null }))); setMaster(true) }}>{TICK}Yes, everything came as expected</button>
        <div className="or">{master && allOk ? 'Good. Fix a line below only if something was short.' : 'Or check each one:'}</div>

        <div className="card">
          {items.map((l, i) => {
            const x = lines[i] ?? { qty: 0, prob: null }; const rem = remaining(l); const short = x.qty < rem - 0.001
            return (
              <div className="ml" key={l.po_line_item_id || i}>
                <div className="nm"><b>{l.item_name}</b><span className={short ? 'warn' : ''}>{short ? (x.qty <= 0 ? "didn't come" : fmt(rem - x.qty) + ' ' + l.unit + ' short') : 'ordered ' + fmt(l.quantity_ordered) + ' ' + l.unit}</span></div>
                <div className={`fld${!short ? ' ok' : ''}`}>
                  <button className="stp" onClick={() => { setLine(i, { qty: clamp(x.qty - step(l)) }); setMaster(false) }}>−</button>
                  <input inputMode="decimal" value={x.qty || ''} placeholder="0" onChange={(e) => { setLine(i, { qty: parseFloat(e.target.value) || 0 }); setMaster(false) }} />
                  <button className="stp" onClick={() => { setLine(i, { qty: clamp(x.qty + step(l)) }); setMaster(false) }}>+</button>
                  <span className="u">{l.unit}</span>
                </div>
                {x.prob !== null ? <input className="probtxt" autoFocus placeholder="What's wrong?" value={x.prob} onChange={(e) => setLine(i, { prob: e.target.value })} /> : <button className="pb" onClick={() => setLine(i, { prob: '' })}>Problem with this?</button>}
              </div>
            )
          })}
        </div>

        <div className="chal"><label>Challan no.</label><input placeholder="optional" value={challan} onChange={(e) => setChallan(e.target.value)} /></div>
      </div>

      <div className="foot"><div className="in">
        <button className={`send${sending ? ' busy' : ''}`} disabled={sending} onClick={send}>{TICK}Send to office<small>{nRecv ? 'The office sees it the moment you tap' : 'Sending: nothing came'}</small></button>
      </div></div>
    </div>
  )
}
