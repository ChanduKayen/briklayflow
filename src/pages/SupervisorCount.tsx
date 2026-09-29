// Public, no-login page the supervisor opens from WhatsApp (/count/<token>).
// "How much is on site right now?" — type the count for each material, send. count_token_submit
// posts an adjustment so on-hand matches. Rendered OUTSIDE the auth shell. Mobile-first, .sup.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Item { inventory_id: string; item_name: string; unit: string | null }
interface Data { ok: boolean; used?: boolean; site?: string | null; scope?: string; items?: Item[]; error?: string }

const CSS = `
.supc{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;
  --clay:#B5472A;--clay-hi:#D4633E;--sage:#2F5D3A;--sage-wash:#E7F0E6;--cream:250,248,243;
  --serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;--spring:cubic-bezier(.34,1.4,.64,1);
  min-height:100vh;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.4;-webkit-font-smoothing:antialiased}
.supc *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.supc button,.supc input{font:inherit;color:inherit}.supc button{cursor:pointer}
.supc .m{max-width:520px;margin:0 auto;padding:26px 18px 120px}
.supc .brand{display:flex;align-items:baseline;gap:2px;font-family:var(--serif);font-weight:600;font-size:18px}.supc .brand i{width:5px;height:5px;border-radius:50%;background:var(--clay);display:inline-block}
.supc h1{margin:14px 0 0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.15}
.supc .who{margin-top:6px;font-size:14px;color:var(--ink-3)}.supc .who b{color:var(--ink-2);font-weight:600}
.supc .card{margin-top:16px;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:6px 16px}
.supc .ml{display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid var(--rule)}.supc .ml:first-child{border-top:0}
.supc .ml .nm{flex:1;min-width:0;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.supc .ml .fld{display:inline-flex;align-items:center;height:52px;border:1.5px solid var(--line-2);border-radius:14px;background:var(--paper);padding:0 6px 0 14px;gap:6px}
.supc .ml .fld.set{border-color:var(--sage-wash);background:var(--sage-wash)}.supc .ml .fld.set input{color:var(--sage)}
.supc .ml .fld input{width:78px;height:44px;border:0;background:none;text-align:center;font-family:var(--mono);font-size:22px;font-weight:500;outline:none;padding:0}
.supc .ml .fld input::placeholder{color:var(--line-2);font-size:15px;font-family:var(--sans)}
.supc .ml .fld .u{font-size:13px;color:var(--ink-3);padding-right:6px}
.supc .foot{position:fixed;left:0;right:0;bottom:0;padding:12px 18px 22px;background:linear-gradient(180deg,rgba(250,248,243,0),var(--ground) 30%)}
.supc .foot .in{max-width:520px;margin:0 auto}
.supc .send{width:100%;height:56px;border-radius:18px;border:0;background:var(--clay);color:#fff;font-size:17px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 14px 26px -14px rgba(181,71,42,.9);position:relative}
.supc .send:disabled{opacity:.6}.supc .send.busy{color:transparent}
.supc .send.busy::after{content:"";position:absolute;width:20px;height:20px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;animation:supcspin .7s linear infinite}
@keyframes supcspin{to{transform:rotate(360deg)}}
.supc .send svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.supc .mid{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 28px}
.supc .mid .big{width:88px;height:88px;border-radius:44px;background:var(--sage-wash);color:var(--sage);display:grid;place-items:center;animation:supcpop .5s var(--spring) both}
@keyframes supcpop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
.supc .mid .big svg{width:40px;height:40px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.supc .mid h2{margin:20px 0 0;font-family:var(--serif);font-weight:600;font-size:26px}.supc .mid p{margin:8px 0 0;color:var(--ink-2);font-size:15px}
`
const TICK = <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>

export default function SupervisorCount({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => { (async () => { const { data: d } = await supabase.rpc('count_token_load', { p_token: token }); setData((d ?? { ok: false, error: 'Could not load this link.' }) as Data) })() }, [token])

  if (!data) return <div className="supc"><style>{CSS}</style><div className="mid"><p>Loading…</p></div></div>
  if (!data.ok) return <div className="supc"><style>{CSS}</style><div className="mid"><h2>Link not valid</h2><p>{data.error}</p></div></div>
  if (data.used || done) return <div className="supc"><style>{CSS}</style><div className="mid"><div className="big">{TICK}</div><h2>Sent</h2><p>Thanks — the office has your count.<br />You can close this.</p></div></div>

  const items = data.items ?? []
  const nSet = items.filter((it) => (vals[it.inventory_id] ?? '').trim() !== '').length
  const send = async () => {
    if (sending) return
    setSending(true)
    try {
      const counts = items.filter((it) => (vals[it.inventory_id] ?? '').trim() !== '').map((it) => ({ inventory_id: it.inventory_id, item_name: it.item_name, unit: it.unit, counted: parseFloat(vals[it.inventory_id]) || 0 }))
      const { data: r, error } = await supabase.rpc('count_token_submit', { p_token: token, p_counts: counts })
      if (error || !(r as any)?.ok) throw new Error((r as any)?.error || error?.message || 'Could not send')
      setDone(true)
    } catch (e) { setSending(false); alert((e as Error).message || 'Could not send — try again') }
  }

  return (
    <div className="supc">
      <style>{CSS}</style>
      <div className="m">
        <div className="brand">Briklay<i /></div>
        <h1>How much is on site right now?</h1>
        <div className="who">{data.site ? <><b>{data.site}</b> · </> : null}{data.scope === 'one' ? 'this material' : items.length + ' materials'} · count what you can see</div>
        <div className="card">
          {items.map((it) => {
            const v = vals[it.inventory_id] ?? ''
            return (
              <div className="ml" key={it.inventory_id}>
                <span className="nm">{it.item_name}</span>
                <div className={`fld${v.trim() !== '' ? ' set' : ''}`}>
                  <input inputMode="decimal" placeholder="—" value={v} onChange={(e) => setVals((s) => ({ ...s, [it.inventory_id]: e.target.value }))} />
                  <span className="u">{it.unit}</span>
                </div>
              </div>
            )
          })}
          {items.length === 0 && <div className="ml"><span className="nm" style={{ color: 'var(--ink-3)', fontWeight: 400 }}>Nothing to count here yet.</span></div>}
        </div>
      </div>
      <div className="foot"><div className="in">
        <button className={`send${sending ? ' busy' : ''}`} disabled={sending || nSet === 0} onClick={send}>{TICK}Send {nSet ? `${nSet} count${nSet === 1 ? '' : 's'}` : 'to office'}</button>
      </div></div>
    </div>
  )
}
