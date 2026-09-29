// Bills → stock · confirm a delivery from the Bills page (a bill with NO PO).
// Same three cards as the PO receive, prefilled from the bill's own lines: what reached the
// site (billed vs received, short allowed), proof, then save. Writes a bill receipt → stock,
// then triages so clean lines land and doubtful ones fall to the clarify panel.
// Design ported from the reference confirm panel (scoped .brcv); mobile-first.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSnackbar } from './Snackbar'

export interface BillReceiveLine { name: string; unit: string | null; qty: number; rate: number | null }
export interface ReceiveBill { id: string; bill_no: string | null; vendor: string; site?: string | null; project_id: string | null; lines: BillReceiveLine[] }

const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const clamp = (v: number) => Math.max(0, Math.round(v * 100) / 100)

const CSS = `
.brcv{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;--sand:#F1ECE1;
  --cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;--sage-wash:#E7F0E6;--amber:#8A6A2E;--wa:#25A65B;
  --serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;--ease:cubic-bezier(.2,.7,.2,1);--spring:cubic-bezier(.34,1.4,.64,1);
  position:fixed;inset:0;z-index:60;font-family:var(--sans);font-size:14.5px;line-height:1.4;color:var(--ink)}
.brcv *{box-sizing:border-box}
.brcv button,.brcv input{font:inherit;color:inherit}.brcv button{cursor:pointer}
.brcv .scrim{position:absolute;inset:0;background:rgba(43,33,26,.3);backdrop-filter:blur(1px)}
.brcv .panel{position:absolute;top:0;right:0;bottom:0;width:560px;max-width:100%;background:var(--ground);box-shadow:-24px 0 60px -30px rgba(43,33,26,.5);display:flex;flex-direction:column;animation:brcvin .34s var(--ease)}
@keyframes brcvin{from{transform:translateX(24px);opacity:.7}to{transform:none;opacity:1}}
.brcv .top{padding:22px 30px 16px;display:flex;align-items:flex-start;gap:14px;border-bottom:1px solid var(--line)}
.brcv .top h2{margin:0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.1}
.brcv .top .sub{margin-top:5px;font-size:13.5px;color:var(--ink-3)}.brcv .top .sub b{font-weight:500;color:var(--ink-2);font-family:var(--mono);font-size:12.5px}
.brcv .top .x{margin-left:auto;width:36px;height:36px;border-radius:18px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center;flex:none}
.brcv .top .x:hover{background:var(--wash)}
.brcv .top .x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.brcv .body{flex:1;overflow:auto;padding:16px 30px 30px}
.brcv .track{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink-3);margin-bottom:4px}
.brcv .track .k{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px dashed var(--line-2);color:var(--ink-3);font-size:12.5px;font-weight:500}
.brcv .master{display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px 14px;border-radius:14px;background:var(--sand)}
.brcv .master .t{flex:1;font-size:14.5px;color:var(--ink-2)}.brcv .master .t b{color:var(--ink);font-weight:600}
.brcv .master.allok{background:var(--sage-wash)}.brcv .master.allok .t{color:var(--sage)}
.brcv .btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line-2);background:var(--paper);font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;transition:background .2s,border-color .2s,transform .14s var(--ease),box-shadow .2s}
.brcv .btn:hover{border-color:var(--ink-3)}.brcv .btn:active{transform:scale(.98)}
.brcv .btn.pri{background:var(--clay);border-color:var(--clay);color:#fff;box-shadow:0 10px 20px -12px rgba(181,71,42,.9)}
.brcv .btn.pri:hover{background:var(--clay-hi)}
.brcv .btn.sm{height:36px;padding:0 12px;font-size:13.5px}
.brcv .btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.brcv .btn svg.wa{fill:var(--wa);stroke:none}
.brcv .btn.busy{position:relative;color:transparent}
.brcv .btn.busy::after{content:"";position:absolute;width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:brcvspin .7s linear infinite}
@keyframes brcvspin{to{transform:rotate(360deg)}}
.brcv .lines{margin-top:14px;background:var(--paper);border:1px solid var(--line);border-radius:18px}
.brcv .ln{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px;border-top:1px solid var(--rule)}
.brcv .ln:first-child{border-top:0}.brcv .ln.short{background:#FFFCF4}
.brcv .ln .nm b{display:block;font-size:15px;font-weight:600}
.brcv .ln .nm span{display:block;font-size:12.5px;color:var(--ink-3);margin-top:1px}
.brcv .ln .nm span em{font-style:normal;font-family:var(--mono);color:var(--ink-2)}
.brcv .ln .nm span.warn,.brcv .ln .nm span.warn em{color:var(--amber)}
.brcv .ln .fld{display:inline-flex;align-items:center;height:42px;border:1.5px solid var(--line-2);border-radius:12px;background:var(--paper);padding:0 4px;gap:2px;transition:border-color .2s,box-shadow .2s}
.brcv .ln .fld:focus-within{border-color:var(--ink-2);box-shadow:0 0 0 4px rgba(43,33,26,.06)}
.brcv .ln .fld.ok{border-color:var(--sage-wash);background:var(--sage-wash)}.brcv .ln .fld.ok input{color:var(--sage)}
.brcv .ln .fld .stp{width:32px;height:32px;border-radius:9px;border:0;background:var(--wash);color:var(--ink-2);font-size:17px;font-weight:600;display:grid;place-items:center}
.brcv .ln .fld.ok .stp{background:rgba(255,255,255,.6)}
.brcv .ln .fld input{width:66px;height:36px;border:0;background:none;text-align:center;font-family:var(--mono);font-size:18px;font-weight:500;outline:none;padding:0}
.brcv .ln .fld .u{font-size:12.5px;color:var(--ink-3);padding:0 8px 0 2px}
.brcv .one{margin-top:14px;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:16px 18px}
.brcv .one h3{margin:0;font-size:15px;font-weight:600}.brcv .one h3 small{font-weight:400;color:var(--ink-3);margin-left:8px;font-size:13px}
.brcv .prf{display:flex;gap:10px;margin-top:12px;align-items:center;flex-wrap:wrap}
.brcv .chal{display:flex;align-items:center;gap:10px;flex:1;min-width:180px;height:52px;border:1.5px solid var(--line-2);border-radius:14px;background:var(--paper);padding:0 14px}
.brcv .chal:focus-within{border-color:var(--ink-2)}
.brcv .chal label{font-size:13.5px;color:var(--ink-3);white-space:nowrap}
.brcv .chal input{flex:1;border:0;background:none;outline:none;font-family:var(--mono);font-size:15px;min-width:0}
.brcv .foot{padding:14px 30px;border-top:1px solid var(--line);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.brcv .foot .s{flex:1;font-size:13.5px;color:var(--ink-3);min-width:0}.brcv .foot .s b{color:var(--ink-2);font-weight:600}
.brcv .foot .btn.pri{height:44px;padding:0 20px;border-radius:22px}
.brcv .done{position:absolute;inset:0;background:var(--ground);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px}
.brcv .done .big{width:72px;height:72px;border-radius:36px;background:var(--sage-wash);color:var(--sage);display:grid;place-items:center}
.brcv .done .big svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.brcv .done h3{margin:18px 0 0;font-family:var(--serif);font-weight:600;font-size:24px}
.brcv .done p{margin:8px 0 0;color:var(--ink-2);max-width:360px}
@media (max-width:640px){.brcv .panel{width:100%}.brcv .top,.brcv .body,.brcv .foot{padding-left:16px;padding-right:16px}.brcv .ln{grid-template-columns:1fr;gap:10px}.brcv .ln .fld{height:48px;justify-self:start}.brcv .foot .s{display:none}.brcv .foot .btn.pri{flex:1;justify-content:center}}
`
const TICK = <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>

export default function BillReceivePanel({ open, onClose, orgId, bill, onReceived }: { open: boolean; onClose: () => void; orgId: string; bill: ReceiveBill | null; onReceived: () => void }) {
  const { show } = useSnackbar()
  const [qtys, setQtys] = useState<number[]>([])
  const [challan, setChallan] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [seeded, setSeeded] = useState<string | null>(null)

  if (open && bill && seeded !== bill.id) {
    setQtys(bill.lines.map((l) => l.qty)); setChallan(''); setDone(null); setSeeded(bill.id)
  }
  if (!open || !bill) return null

  const lines = bill.lines
  const step = (l: BillReceiveLine) => (l.unit === 'MT' ? 0.5 : l.qty >= 50 ? 5 : 1)
  const allOk = qtys.every((q, i) => Math.abs(q - lines[i].qty) < 0.001)
  const nRecv = qtys.filter((q) => q > 0).length
  const summary = () => allOk ? 'Everything on the bill reached the site.' : lines.map((l, i) => ({ l, q: qtys[i] })).filter(({ l, q }) => q < l.qty - 0.001).map(({ l, q }) => q <= 0 ? l.name + " didn't come" : l.name + ' ' + fmt(l.qty - q) + ' ' + (l.unit ?? '') + ' short').join(' · ') + " — we'll flag the difference on the bill."
  const setQ = (i: number, v: number) => setQtys((qs) => qs.map((q, j) => (j === i ? clamp(v) : q)))

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const items = lines.map((l, i) => ({ name: l.name, unit: l.unit, qty: qtys[i], rate: l.rate }))
      const { data, error } = await supabase.rpc('receive_bill_lines', { p_bill_id: bill.id, p_items: items, p_challan: challan.trim() || null, p_notes: null })
      const r = data as { ok?: boolean; error?: string; project_id?: string }
      if (error || !r?.ok) throw new Error(r?.error || error?.message || 'Could not save')
      const triageItems = lines.map((l, i) => ({ item_name: l.name, unit: l.unit, qty: qtys[i], rate: l.rate })).filter((x) => (x.qty || 0) > 0)
      if (triageItems.length) { try { await supabase.functions.invoke('stock-triage', { body: { org_id: orgId, project_id: r.project_id ?? bill.project_id, source: 'bill', source_ref: bill.id, items: triageItems } }) } catch { /* best-effort */ } }
      setDone(nRecv ? (allOk ? 'Everything on the bill is in stock.' : summary()) : 'Nothing came — the bill stays flagged.')
      onReceived()
    } catch (e) { show((e as Error).message || 'Could not save', { type: 'error' }) }
    finally { setSaving(false) }
  }

  const siteShort = (bill.site || '').split(' ').slice(0, 2).join(' ') || 'the site'

  return (
    <div className="brcv" role="dialog" aria-modal="true">
      <style>{CSS}</style>
      <div className="scrim" onClick={onClose} />
      <aside className="panel">
        <div className="top">
          <div><h2>Did this reach {siteShort}?</h2><div className="sub"><b>{bill.bill_no || 'Bill'}</b> · {bill.vendor} · no PO</div></div>
          <button className="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        {done ? (
          <div className="done"><div className="big">{TICK}</div><h3>{nRecv ? `${nRecv} line${nRecv === 1 ? '' : 's'} into stock` : 'Noted'}</h3><p>{done}</p><div style={{ marginTop: 22 }}><button className="btn pri" onClick={onClose}>Done</button></div></div>
        ) : (
          <>
            <div className="body">
              <div className="track"><span className="k">No PO</span><span>Nothing was ordered through Briklay — we check the site against the bill.</span></div>
              <div className={`master${allOk ? ' allok' : ''}`}>
                <div className="t">{allOk ? <><b>All as billed reached the site.</b> Change a line only if the site got less.</> : <b>{summary()}</b>}</div>
                {!allOk && <button className="btn sm" onClick={() => setQtys(lines.map((l) => l.qty))}>All as billed</button>}
              </div>
              <div className="lines">
                {lines.map((l, i) => {
                  const q = qtys[i] ?? 0, short = q < l.qty - 0.001
                  return (
                    <div className={`ln${short ? ' short' : ''}`} key={i}>
                      <div className="nm"><b>{l.name}</b><span className={short ? 'warn' : ''}>billed <em>{fmt(l.qty)} {l.unit}</em>{short ? (q <= 0 ? " · didn't come" : <> · <em>{fmt(l.qty - q)}</em> short</>) : ''}</span></div>
                      <div className={`fld${!short ? ' ok' : ''}`}>
                        <button className="stp" onClick={() => setQ(i, q - step(l))}>−</button>
                        <input inputMode="decimal" value={q || ''} placeholder="0" onChange={(e) => setQ(i, parseFloat(e.target.value) || 0)} />
                        <button className="stp" onClick={() => setQ(i, q + step(l))}>+</button>
                        <span className="u">{l.unit}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="one">
                <h3>Proof<small>optional</small></h3>
                <div className="prf"><div className="chal"><label>Challan no.</label><input placeholder="optional" value={challan} onChange={(e) => setChallan(e.target.value)} /></div></div>
              </div>
            </div>
            <div className="foot">
              <div className="s">Receipt goes on the bill · stock goes up today</div>
              <button className={`btn pri${saving ? ' busy' : ''}`} disabled={saving} onClick={save}>{TICK}{allOk ? 'Yes, all reached' : 'Confirm what reached'}</button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
