// Receiving a PO delivery — the office panel. Three questions: what came (ordered vs received,
// short/over), any problem, and the proof (challan no + photo) — then save. Nothing blocks the
// save. Writes a GRN (create_grn) → stock; doubtful lines fall to the clarify panel via triage.
// Design ported from the reference (scoped .rcv); mobile-first.
import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSnackbar } from './Snackbar'

export interface POLine { po_line_item_id: string; item_name: string; unit: string | null; quantity_ordered: number; unit_rate: number | null; received_so_far?: number; step?: number }
const remaining = (l: POLine) => Math.max(0, l.quantity_ordered - (l.received_so_far || 0))
export interface ReceivePO { po_id: string; project_id: string; stakeholder_id: string; vendor: string; site?: string | null; lines: POLine[] }

const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
const clamp = (v: number) => Math.max(0, Math.round(v * 100) / 100)

const CSS = `
.rcv{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;--sand:#F1ECE1;
  --night:#15100C;--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;--sage-wash:#E7F0E6;--amber:#8A6A2E;--wa:#25A65B;
  --serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;--ease:cubic-bezier(.2,.7,.2,1);--spring:cubic-bezier(.34,1.4,.64,1);
  position:fixed;inset:0;z-index:60;font-family:var(--sans);font-size:14.5px;line-height:1.4;color:var(--ink)}
.rcv *{box-sizing:border-box}
.rcv button,.rcv input,.rcv textarea{font:inherit;color:inherit}.rcv button{cursor:pointer}
.rcv .scrim{position:absolute;inset:0;background:rgba(43,33,26,.3);backdrop-filter:blur(1px)}
.rcv .panel{position:absolute;top:0;right:0;bottom:0;width:560px;max-width:100%;background:var(--ground);box-shadow:-24px 0 60px -30px rgba(43,33,26,.5);display:flex;flex-direction:column;animation:rcvin .34s var(--ease)}
@keyframes rcvin{from{transform:translateX(24px);opacity:.7}to{transform:none;opacity:1}}
.rcv .top{padding:22px 30px 16px;display:flex;align-items:flex-start;gap:14px;border-bottom:1px solid var(--line);background:var(--ground)}
.rcv .top h2{margin:0;font-family:var(--serif);font-weight:600;font-size:25px;line-height:1.1}
.rcv .top .sub{margin-top:6px;font-size:13.5px;color:var(--ink-3)}
.rcv .top .sub b{font-weight:500;color:var(--ink-2);font-family:var(--mono);font-size:12.5px}
.rcv .top .x{margin-left:auto;width:36px;height:36px;border-radius:18px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center;flex:none;transition:background .15s}
.rcv .top .x:hover{background:var(--wash)}
.rcv .top .x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.rcv .body{flex:1;overflow:auto;padding:16px 30px 30px}
.rcv .master{display:flex;align-items:center;gap:12px;margin-top:4px;padding:12px 14px;border-radius:14px;background:var(--sand)}
.rcv .master .t{flex:1;font-size:14.5px;color:var(--ink-2)}.rcv .master .t b{color:var(--ink);font-weight:600}
.rcv .master.allok{background:var(--sage-wash)}.rcv .master.allok .t{color:var(--sage)}
.rcv .btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line-2);background:var(--paper);font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap;transition:background .2s,border-color .2s,transform .14s var(--ease),box-shadow .2s,color .2s}
.rcv .btn:hover{border-color:var(--ink-3);background:#FFFDF9}.rcv .btn:active{transform:scale(.98)}
.rcv .btn.pri{background:var(--clay);border-color:var(--clay);color:#fff;box-shadow:0 10px 20px -12px rgba(181,71,42,.9)}
.rcv .btn.pri:hover{background:var(--clay-hi)}
.rcv .btn.sm{height:36px;padding:0 12px;font-size:13.5px}
.rcv .btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.rcv .btn svg.wa{fill:var(--wa);stroke:none}
.rcv .btn.busy{position:relative;color:transparent}
.rcv .btn.busy::after{content:"";position:absolute;width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:rcvspin .7s linear infinite}
@keyframes rcvspin{to{transform:rotate(360deg)}}
.rcv .lines{margin-top:14px;background:var(--paper);border:1px solid var(--line);border-radius:18px;overflow:visible}
.rcv .ln{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid var(--rule)}
.rcv .ln:first-child{border-top:0}.rcv .ln.short{background:#FFFCF4}
.rcv .ln .nm b{display:block;font-size:15px;font-weight:600}
.rcv .ln .nm span{display:block;font-size:12.5px;color:var(--ink-3);margin-top:1px}
.rcv .ln .nm span em{font-style:normal;font-family:var(--mono);color:var(--ink-2)}
.rcv .ln .nm span.warn{color:var(--amber)}.rcv .ln .nm span.warn em{color:var(--amber)}
.rcv .ln .fld{display:inline-flex;align-items:center;height:42px;border:1.5px solid var(--line-2);border-radius:12px;background:var(--paper);padding:0 4px;gap:2px;transition:border-color .2s,box-shadow .2s}
.rcv .ln .fld:focus-within{border-color:var(--ink-2);box-shadow:0 0 0 4px rgba(43,33,26,.06)}
.rcv .ln .fld.ok{border-color:var(--sage-wash);background:var(--sage-wash)}.rcv .ln .fld.ok input{color:var(--sage)}
.rcv .ln .fld .stp{width:32px;height:32px;border-radius:9px;border:0;background:var(--wash);color:var(--ink-2);font-size:17px;font-weight:600;display:grid;place-items:center;transition:background .15s}
.rcv .ln .fld.ok .stp{background:rgba(255,255,255,.6)}.rcv .ln .fld .stp:hover{background:var(--line)}
.rcv .ln .fld input{width:66px;height:36px;border:0;background:none;text-align:center;font-family:var(--mono);font-size:18px;font-weight:500;outline:none;padding:0}
.rcv .ln .fld .u{font-size:12.5px;color:var(--ink-3);padding:0 8px 0 2px}
.rcv .ln .pb{height:32px;padding:0 10px;border-radius:16px;border:1px solid transparent;background:none;font-size:13px;font-weight:500;color:var(--ink-3);white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
.rcv .ln .pb:hover{background:var(--wash);color:var(--ink)}
.rcv .ln .pb.on{background:var(--clay-wash);color:var(--clay);border-color:var(--clay-wash)}
.rcv .ln .probtxt{grid-column:1/-1;height:40px;border:1.5px solid var(--clay-wash);border-radius:11px;background:var(--clay-wash);padding:0 12px;outline:none;font-size:14px;margin-top:-2px}
.rcv .ln .probtxt:focus{border-color:var(--clay)}
.rcv .one{margin-top:18px;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:16px 18px}
.rcv .one h3{margin:0;font-size:16px;font-weight:600;color:var(--ink)}
.rcv .one h3 small{font-weight:400;color:var(--ink-3);margin-left:8px;font-size:13.5px}
.rcv .prf{display:flex;gap:10px;margin-top:14px;align-items:stretch;flex-wrap:wrap}
.rcv .tile{flex:none;width:150px;height:64px;border:1.5px dashed var(--line-2);border-radius:14px;background:var(--paper);display:flex;align-items:center;justify-content:center;gap:8px;color:var(--ink-3);font-size:13.5px;font-weight:500;cursor:pointer;transition:border-color .18s,background .18s,color .18s;position:relative;overflow:hidden}
.rcv .tile:hover{border-color:var(--ink-3);color:var(--ink);background:#FFFDF9}
.rcv .tile svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.rcv .tile.has{border-style:solid;border-color:var(--sage);background:var(--sage-wash);color:var(--sage)}
.rcv .tile input[type=file]{display:none}
.rcv .chal{display:flex;align-items:center;gap:10px;flex:1;min-width:180px;height:64px;border:1.5px solid var(--line-2);border-radius:14px;background:var(--paper);padding:0 14px;transition:border-color .2s,box-shadow .2s}
.rcv .chal:focus-within{border-color:var(--ink-2);box-shadow:0 0 0 4px rgba(43,33,26,.06)}
.rcv .chal label{font-size:13.5px;color:var(--ink-3);white-space:nowrap}
.rcv .chal input{flex:1;border:0;background:none;outline:none;font-family:var(--mono);font-size:15px;min-width:0}
.rcv .chal input::placeholder{font-family:var(--sans);color:var(--line-2);font-weight:500}
.rcv .ask2{margin-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13.5px;color:var(--ink-3);flex-wrap:wrap}
.rcv .more{margin-top:16px}
.rcv .more>button{background:none;border:0;padding:0;font-size:14px;color:var(--ink-2);display:inline-flex;align-items:center;gap:8px;font-weight:500}
.rcv .more .fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.rcv .more .fields input{height:42px;border:1px solid var(--line-2);border-radius:11px;background:var(--paper);padding:0 12px;outline:none;font-size:14px;width:100%}
.rcv .more .fields input:focus{border-color:var(--ink-2)}
.rcv .foot{padding:14px 30px;border-top:1px solid var(--line);background:var(--ground);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.rcv .foot .s{flex:1;font-size:13.5px;color:var(--ink-3);min-width:0}.rcv .foot .s b{color:var(--ink-2);font-weight:600}
.rcv .foot .btn.pri{height:44px;padding:0 20px;border-radius:22px}
.rcv .done{position:absolute;inset:0;background:var(--ground);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px}
.rcv .done .big{width:72px;height:72px;border-radius:36px;background:var(--sage-wash);color:var(--sage);display:grid;place-items:center;animation:rcvpop .5s var(--spring) both}
@keyframes rcvpop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
.rcv .done .big svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.rcv .done h3{margin:18px 0 0;font-family:var(--serif);font-weight:600;font-size:24px}
.rcv .done p{margin:8px 0 0;color:var(--ink-2);max-width:380px}
.rcv .done .dacts{display:flex;gap:8px;margin-top:22px}
@media (max-width:640px){
  .rcv .panel{width:100%}
  .rcv .top,.rcv .body,.rcv .foot{padding-left:16px;padding-right:16px}
  .rcv .ln{grid-template-columns:1fr;gap:10px}
  .rcv .ln .fld{height:48px;justify-self:start}.rcv .ln .fld .stp{width:38px;height:38px}.rcv .ln .fld input{width:80px;height:40px;font-size:20px}
  .rcv .ln .pb{justify-self:start}
  .rcv .prf{flex-direction:column}.rcv .tile{width:100%}.rcv .chal{width:100%}
  .rcv .foot .s{display:none}.rcv .foot .btn.pri{flex:1;justify-content:center}
  .rcv .more .fields{grid-template-columns:1fr}
}
`
const TICK = <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>
const CAM = <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
const WA = <svg className="wa" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z" /></svg>

interface LineState { qty: number; prob: string | null }

export default function ReceiveDeliveryPanel({ open, onClose, orgId, po, receivedBy, onReceived }: { open: boolean; onClose: () => void; orgId: string; po: ReceivePO | null; receivedBy?: string | null; onReceived: () => void }) {
  const { show } = useSnackbar()
  const [lines, setLines] = useState<LineState[]>([])
  const [challan, setChallan] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [notes, setNotes] = useState('')
  const [more, setMore] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ grn: string; text: string } | null>(null)
  const [seededFor, setSeededFor] = useState<string | null>(null)

  // Seed line state from the PO once it opens.
  if (open && po && seededFor !== po.po_id) {
    setLines(po.lines.map((l) => ({ qty: remaining(l), prob: null })))
    setChallan(''); setVehicle(''); setNotes(''); setMore(false); setPhoto(null); setDone(null)
    setSeededFor(po.po_id)
  }
  if (!open || !po) return null

  const step = (l: POLine) => l.step || (remaining(l) >= 100 ? 5 : remaining(l) >= 10 ? 1 : 0.5)
  const allOk = lines.every((x, i) => Math.abs(x.qty - remaining(po.lines[i])) < 0.001)
  const nRecv = lines.filter((x) => x.qty > 0).length
  const summary = () => {
    if (allOk) return 'Everything came as expected.'
    const shorts = lines.map((x, i) => ({ x, l: po.lines[i], i })).filter(({ x, l }) => x.qty < remaining(l) - 0.001)
    if (lines.every((x) => x.qty <= 0)) return 'Nothing came.'
    return shorts.map(({ x, l }) => x.qty <= 0 ? l.item_name + " didn't come" : l.item_name + ' ' + fmt(remaining(l) - x.qty) + ' ' + (l.unit ?? '') + ' short').join(' · ') + ' — the PO stays open for the rest.'
  }
  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      let photoUrl: string | null = null
      if (photo) {
        try {
          const path = `${orgId}/${po.po_id}/${Date.now()}-${photo.name}`.replace(/\s+/g, '_')
          const up = await supabase.storage.from('documents').upload(path, photo, { upsert: true })
          if (!up.error) photoUrl = supabase.storage.from('documents').getPublicUrl(path).data.publicUrl
        } catch { /* proof photo is best-effort */ }
      }
      const remarksBase = [notes, photoUrl ? `challan photo: ${photoUrl}` : ''].filter(Boolean).join(' · ')
      const items = po.lines.map((l, i) => ({
        po_line_item_id: l.po_line_item_id, item_name: l.item_name, unit: l.unit,
        qty_ordered: l.quantity_ordered, qty_received: lines[i].qty, unit_rate: l.unit_rate,
        condition: 'good', remarks: lines[i].prob || null,
      }))
      const { data, error } = await supabase.rpc('create_grn', {
        p_org_id: orgId, p_po_id: po.po_id, p_project_id: po.project_id, p_stakeholder_id: po.stakeholder_id,
        p_receipt_date: new Date().toISOString().slice(0, 10), p_dc_number: challan.trim() || null,
        p_vehicle_number: vehicle.trim() || null, p_driver_name: null, p_remarks: remarksBase || null,
        p_received_by: receivedBy ?? null, p_items: items,
      })
      const r = (Array.isArray(data) ? data[0] : data) as { grn_id?: string; success?: boolean; error?: string }
      if (error || !r?.success) throw new Error(r?.error || error?.message || 'Could not save the receipt')

      // Triage the received good lines so clean ones land in stock and doubtful ones queue.
      const triageItems = po.lines.map((l, i) => ({ item_name: l.item_name, unit: l.unit, qty: lines[i].qty, rate: l.unit_rate })).filter((x) => (x.qty || 0) > 0)
      if (triageItems.length) { try { await supabase.functions.invoke('stock-triage', { body: { org_id: orgId, project_id: po.project_id, source: 'grn', source_ref: r.grn_id, items: triageItems } }) } catch { /* best-effort */ } }

      setDone({ grn: r.grn_id || '', text: nRecv ? (nRecv === po.lines.length ? `All ${nRecv} items are in stock.` : `${nRecv} of ${po.lines.length} items are in stock.`) + ' ' + summary() : 'The PO stays open and the vendor can be chased.' })
      onReceived()
    } catch (e) { show((e as Error).message || 'Could not save the receipt', { type: 'error' }) }
    finally { setSaving(false) }
  }

  const nWord = useMemo(() => nRecv === 0 ? 'Save — nothing came' : nRecv === po.lines.length ? `Receive all ${nRecv} items` : `Receive ${nRecv} of ${po.lines.length} items`, [nRecv, po.lines.length])

  return (
    <div className="rcv" role="dialog" aria-modal="true">
      <style>{CSS}</style>
      <div className="scrim" onClick={onClose} />
      <aside className="panel">
        <div className="top">
          <div>
            <h2>{po.vendor} delivery arrived?</h2>
            <div className="sub"><b>{po.po_id}</b> · {po.lines.length} item{po.lines.length === 1 ? '' : 's'}{po.site ? ` · ${po.site}` : ''} · today</div>
          </div>
          <button className="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>

        {done ? (
          <div className="done">
            <div className="big">{TICK}</div>
            <h3>{nRecv ? `${nRecv} item${nRecv === 1 ? '' : 's'} received` : 'Noted — nothing came'}</h3>
            <p>{done.grn ? <>Receipt <b style={{ fontFamily: 'var(--mono)' }}>{done.grn}</b> on {po.po_id}<br /></> : null}{done.text}</p>
            <div className="dacts"><button className="btn pri" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <>
            <div className="body">
              <div className={`master${allOk ? ' allok' : ''}`}>
                <div className="t">{allOk ? <><b>Everything came as ordered.</b> Change any line below if not.</> : <b>{summary()}</b>}</div>
                {!allOk && <button className="btn sm" onClick={() => setLines(po.lines.map((l) => ({ qty: remaining(l), prob: null })))}>All came</button>}
              </div>

              <div className="lines">
                {po.lines.map((l, i) => {
                  const x = lines[i] ?? { qty: 0, prob: null }
                  const rem = remaining(l), short = x.qty < rem - 0.001
                  return (
                    <div className={`ln${short ? ' short' : ''}`} key={l.po_line_item_id || i}>
                      <div className="nm"><b>{l.item_name}</b><span className={short ? 'warn' : ''}>{(l.received_so_far || 0) > 0 ? <>due <em>{fmt(rem)} {l.unit}</em> · {fmt(l.received_so_far || 0)} already in</> : <>ordered <em>{fmt(l.quantity_ordered)} {l.unit}</em></>}{short ? (x.qty <= 0 ? " · didn't come" : <> · <em>{fmt(rem - x.qty)}</em> short</>) : ''}</span></div>
                      <div className={`fld${!short ? ' ok' : ''}`}>
                        <button className="stp" onClick={() => setLine(i, { qty: clamp(x.qty - step(l)) })}>−</button>
                        <input inputMode="decimal" value={x.qty || ''} placeholder="0" onChange={(e) => setLine(i, { qty: parseFloat(e.target.value) || 0 })} />
                        <button className="stp" onClick={() => setLine(i, { qty: clamp(x.qty + step(l)) })}>+</button>
                        <span className="u">{l.unit}</span>
                      </div>
                      <button className={`pb${x.prob !== null ? ' on' : ''}`} onClick={() => setLine(i, { prob: x.prob === null ? '' : null })}>{x.prob !== null ? 'Problem' : 'Problem?'}</button>
                      {x.prob !== null && <input className="probtxt" autoFocus placeholder={`What's wrong with the ${l.item_name.toLowerCase()}? e.g. 5 bags torn`} value={x.prob} onChange={(e) => setLine(i, { prob: e.target.value })} />}
                    </div>
                  )
                })}
              </div>

              <div className="one">
                <h3>Proof<small>a photo of the challan is enough</small></h3>
                <div className="prf">
                  <label className={`tile${photo ? ' has' : ''}`}>
                    <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                    {photo ? <>{TICK} Photo added</> : <>{CAM} Add photo</>}
                  </label>
                  <div className="chal"><label>Challan no.</label><input placeholder="optional" value={challan} onChange={(e) => setChallan(e.target.value)} /></div>
                </div>
                <div className="ask2"><span>Not at site? Raju can do this from his phone.</span><button className="btn sm" onClick={() => show('Supervisor link on WhatsApp — coming soon')}>{WA}Ask Raju</button></div>
              </div>

              <div className="more">
                <button onClick={() => setMore((v) => !v)}>{more ? 'Hide vehicle & notes' : 'Vehicle, notes…'}</button>
                {more && <div className="fields"><input placeholder="Vehicle number" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /><input placeholder="Note" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>}
              </div>
            </div>

            <div className="foot">
              <div className="s">{challan || photo ? <>Today · {nRecv} item{nRecv === 1 ? '' : 's'} into stock</> : <>Today · saves as <b>unverified</b> until there's a photo</>}</div>
              <button className={`btn pri${saving ? ' busy' : ''}`} disabled={saving} onClick={save}>{TICK}{nWord}</button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
