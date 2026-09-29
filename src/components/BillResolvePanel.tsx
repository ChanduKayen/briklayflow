// Bills/GRN → stock · the "needs clarification" panel.
// Drains stock_resolution_queue: each ambiguous arrival is one card. Two real answers —
// a material you already have, or a new one (name editable) — plus expense and later.
// Design ported verbatim from the reference (scoped under .brx). Wired to real data.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useSnackbar } from './Snackbar'

interface Canon { item: string; variant: string | null; dimension: string | null; grade: string | null; unit: string | null; category: string | null }
interface Cand { inventory_id: string; display_name: string | null; confidence: number }
interface QueueRow { id: string; raw_name: string; unit: string | null; qty: number | null; source: string; source_ref: string | null; canonical: Canon | null; candidates: Cand[] | null }
interface PickMat { inventory_id: string; label: string; unit: string | null; on_hand: number }
interface RowView { mode: 'new' | 'existing'; name: string; existingId: string | null; existingLabel: string | null; unit: string; editing: boolean; status: 'live' | 'done' | 'expensed'; gone: boolean; stateText: string; order: number }

const UNITS = ['nos', 'bag', 'kg', 'ltr', 'cft', 'sqft', 'rft', 'box', 'roll', 'set', 'mtr', 'MT', 'unit', 'trip', 'pair', 'bundle']
const packOf = (c: Canon | null) => c ? [c.dimension, c.variant, c.grade].filter(Boolean).join(' · ') : ''
const nfmt = (n: number | null) => n == null ? '' : (Math.round(n * 10) / 10).toLocaleString('en-IN')

const CSS = `
.brx{position:fixed;inset:0;z-index:60;
  --ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;
  --night:#15100C;--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;--sage-hi:#8FC79A;--sage-wash:#E7F0E6;
  --serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;
  --ease:cubic-bezier(.2,.7,.2,1);font-family:var(--sans);font-size:14.5px;line-height:1.4;color:var(--ink);-webkit-font-smoothing:antialiased}
.brx *{box-sizing:border-box}
.brx button,.brx input{font:inherit;color:inherit}.brx button{cursor:pointer}
.brx .scrim{position:absolute;inset:0;background:rgba(43,33,26,.28);backdrop-filter:blur(1.5px)}
.brx .panel{position:absolute;top:0;right:0;bottom:0;width:640px;max-width:100%;background:var(--ground);box-shadow:-24px 0 60px -30px rgba(43,33,26,.5);display:flex;flex-direction:column;animation:brxslide .34s var(--ease)}
@keyframes brxslide{from{transform:translateX(30px);opacity:.6}to{transform:none;opacity:1}}
.brx .top{padding:26px 34px 14px;display:flex;align-items:flex-start;gap:16px}
.brx .top .crumbs{font-size:13.5px;color:var(--ink-3)}
.brx .top h2{margin:6px 0 0;font-family:var(--serif);font-weight:600;font-size:30px;line-height:1.1}
.brx .top p{margin:10px 0 0;color:var(--ink-2);font-size:15px;max-width:520px}
.brx .top .x{margin-left:auto;width:34px;height:34px;border-radius:17px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center;flex:none}
.brx .top .x:hover{background:var(--wash)}
.brx .top .x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.brx .progress{display:flex;align-items:center;gap:12px;padding:6px 34px 14px;font-size:13px;color:var(--ink-3)}
.brx .progress .bar{flex:1;height:4px;border-radius:2px;background:var(--line);overflow:hidden}
.brx .progress .bar i{display:block;height:100%;background:var(--sage);transition:width .5s var(--ease)}
.brx .progress b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.brx .list{flex:1;overflow:auto;padding:4px 34px 60px}
.brx .card{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:18px 20px 16px;margin-bottom:14px;box-shadow:0 1px 0 rgba(43,33,26,.03);transition:transform .45s var(--ease),opacity .4s var(--ease),max-height .45s var(--ease),margin .45s var(--ease),padding .45s var(--ease),border-color .3s;max-height:520px;overflow:visible;animation:brxenter .45s var(--ease) both}
@keyframes brxenter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.brx .card.gone{max-height:0;margin-bottom:0;padding-top:0;padding-bottom:0;opacity:0;border-color:transparent;overflow:hidden;transform:translateY(-8px)}
.brx .card .head{display:flex;align-items:baseline;gap:14px}
.brx .card .head b{font-size:16.5px;font-weight:600;color:var(--ink);flex:1;min-width:0}
.brx .card .head .qty{font-family:var(--mono);font-size:16px;color:var(--ink);white-space:nowrap}
.brx .card .head .qty small{font-family:var(--sans);font-size:12.5px;color:var(--ink-3);margin-left:4px;text-transform:lowercase}
.brx .card .src{margin-top:3px;font-size:13px;color:var(--ink-3)}
.brx .q{margin-top:16px;font-size:14px;color:var(--ink-2);font-weight:500}
.brx .opts{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.brx .opt{display:grid;grid-template-columns:22px 118px 1fr;gap:12px;align-items:center;padding:8px 10px 8px 12px;border-radius:14px;border:1.5px solid var(--line);background:var(--paper);cursor:pointer;transition:border-color .22s var(--ease),background .22s,box-shadow .22s,transform .22s,opacity .22s}
.brx .opt:not(.on){opacity:.82}
.brx .opt:not(.on):hover{opacity:1;background:#FFFDF9;transform:translateX(2px)}
.brx .opt.on{border-color:var(--ink-2);background:#FFFDF9;box-shadow:0 0 0 4px rgba(43,33,26,.05)}
.brx .opt .rad{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--line-2);background:var(--paper);display:grid;place-items:center;transition:border-color .2s}
.brx .opt .rad::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--clay);transform:scale(0);transition:transform .22s var(--ease)}
.brx .opt.on .rad{border-color:var(--clay);box-shadow:0 0 0 4px var(--clay-wash)}
.brx .opt.on .rad::after{transform:scale(1)}
.brx .opt .lab{font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap}
.brx .opt .lab small{display:block;font-weight:400;color:var(--ink-3);font-size:12px;margin-top:1px}
.brx .field{display:flex;align-items:center;gap:8px;height:42px;border-radius:11px;border:1px solid var(--line-2);background:var(--paper);padding:0 6px 0 12px;transition:border-color .2s,box-shadow .2s,background .3s;min-width:0}
.brx .opt:not(.on) .field{border-color:var(--rule);background:var(--ground)}
.brx .opt:not(.on) .field .nm{color:var(--ink-2)}
.brx .field.editing{border-color:var(--ink-2);box-shadow:0 0 0 4px rgba(43,33,26,.06)}
.brx .field .nm{flex:1;min-width:0;font-size:15px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brx .field .nm small{font-weight:400;color:var(--ink-3);font-size:13px;margin-left:8px}
.brx .field.ph .nm{color:var(--ink-3);font-weight:500}
.brx .field input.nm{border:0;background:none;padding:0;outline:none;height:100%}
.brx .field .ch{width:14px;height:14px;fill:none;stroke:var(--ink-3);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;flex:none;margin-right:6px;transition:transform .25s var(--ease)}
.brx .field.dd{position:relative;cursor:pointer}
.brx .field.dd:hover{border-color:var(--ink-3)}
.brx .field.dd.open{border-color:var(--ink-2);box-shadow:0 0 0 4px rgba(43,33,26,.06)}
.brx .field.dd.open .ch{transform:rotate(180deg)}
.brx .field .unit{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px 0 10px;border-radius:14px;border:1px solid var(--line-2);background:var(--wash);font-size:12.5px;color:var(--ink-2);white-space:nowrap;position:relative}
.brx .field .unit:hover{border-color:var(--ink-3);background:var(--paper)}
.brx .field .unit .ch{margin:0}
.brx .field .pen{width:32px;height:32px;border-radius:9px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center;flex:none;opacity:.55;transition:background .15s,color .15s,opacity .15s}
.brx .opt:hover .field .pen,.brx .field:hover .pen{opacity:1}
.brx .field .pen:hover{background:var(--wash);color:var(--ink)}
.brx .field .pen svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.brx .act{display:flex;align-items:center;gap:18px;margin-top:14px}
.brx .go{height:42px;border-radius:12px;border:0;background:var(--clay);color:#fff;display:inline-flex;align-items:center;gap:8px;padding:0 18px 0 14px;font-size:14.5px;font-weight:600;box-shadow:0 10px 18px -12px rgba(181,71,42,.9);transition:background .25s,transform .18s var(--ease),box-shadow .25s,opacity .2s,color .2s}
.brx .go:hover{background:var(--clay-hi)}
.brx .go:active{transform:scale(.98)}
.brx .go svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.brx .go .t{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brx .go.wait{background:var(--wash);color:var(--ink-3);box-shadow:none;border:1px solid var(--line-2);cursor:default}
.brx .go.wait:hover{background:var(--wash)}
.brx .go.pop{animation:brxpop .3s var(--ease)}
@keyframes brxpop{0%{transform:scale(.9)}60%{transform:scale(1.06)}100%{transform:scale(1)}}
.brx .alts{display:flex;align-items:center;gap:16px;margin-left:auto;font-size:13.5px;color:var(--ink-3);flex-wrap:wrap}
.brx .alts button{background:none;border:0;padding:0;color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--line-2);text-underline-offset:4px;font-weight:500;transition:color .15s,text-decoration-color .15s}
.brx .alts button:hover{text-decoration-color:var(--ink-2)}
.brx .alts button.exp:hover{color:var(--clay);text-decoration-color:var(--clay)}
.brx .alts .sep{color:var(--line-2)}
.brx .alts .later{text-decoration:none;color:var(--ink-3);font-weight:400}
.brx .menu{position:absolute;z-index:20;top:calc(100% + 6px);left:0;min-width:300px;background:var(--paper);border:1px solid var(--line-2);border-radius:14px;box-shadow:0 22px 46px -22px rgba(43,33,26,.5);padding:6px;animation:brxrise .2s var(--ease) both;transform-origin:top left}
@keyframes brxrise{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
.brx .menu.units{min-width:150px;left:auto;right:0;transform-origin:top right}
.brx .menu input{width:100%;height:38px;border:0;border-bottom:1px solid var(--line);padding:0 10px;margin-bottom:4px;background:none;font-size:14px;outline:none}
.brx .menu h4{margin:6px 10px 4px;font-size:11.5px;font-weight:600;color:var(--ink-3);letter-spacing:.04em}
.brx .menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:7px 10px;border:0;background:none;border-radius:9px;font-size:14px;color:var(--ink);text-align:left}
.brx .menu button:hover{background:var(--wash)}
.brx .menu button small{margin-left:auto;color:var(--ink-3);font-size:12.5px;white-space:nowrap}
.brx .menu button .st{display:inline-flex;width:8px;height:8px;border-radius:50%;background:var(--sage);flex:none}
.brx .menu button.two{flex-direction:column;align-items:flex-start;gap:2px}
.brx .menu button.two small{margin-left:0}
.brx .menu .best{border:1px solid var(--line);border-radius:12px;background:var(--wash);margin:0 0 4px;overflow:hidden}
.brx .menu .best button{border-radius:0}
.brx .menu .best .nm{font-weight:600;font-size:14.5px}
.brx .menu .foot{border-top:1px dashed var(--line-2);margin-top:4px;padding-top:4px}
.brx .menu .foot button{color:var(--clay);font-weight:600}
.brx .menu.units button.sel{background:var(--wash)}
.brx .menu.units button.sel::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--sage);margin-left:auto}
.brx .card.done{border-color:var(--sage-wash);background:var(--sage-wash)}
.brx .card.done .opt{opacity:.4}
.brx .card.done .opt.on{opacity:1;border-color:transparent;background:rgba(255,255,255,.7);box-shadow:none}
.brx .card.done .opt.on .rad{border-color:var(--sage)}
.brx .card.done .opt.on .rad::after{background:var(--sage)}
.brx .card.done .act .go{background:var(--sage);box-shadow:none;transform:none}
.brx .card.done .act .alts{opacity:0;pointer-events:none}
.brx .card.done .head b{color:var(--sage)}
.brx .card.expensed{opacity:1}
.brx .card.expensed .head b{color:var(--ink-2);text-decoration:line-through;text-decoration-color:var(--line-2)}
.brx .state{display:none;margin-top:12px;font-size:13.5px;color:var(--sage);font-weight:500;align-items:center;gap:8px}
.brx .card.done .state,.brx .card.expensed .state{display:flex;animation:brxrise .3s var(--ease) .1s both}
.brx .card.expensed .state{color:var(--ink-2)}
.brx .state svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.brx .empty{padding:50px 10px;text-align:center;color:var(--ink-3)}
.brx .empty .big{width:56px;height:56px;border-radius:28px;background:var(--sage-wash);color:var(--sage);display:grid;place-items:center;margin:0 auto 14px}
.brx .empty .big svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.brx .empty h3{margin:0;font-family:var(--serif);font-weight:600;font-size:22px;color:var(--ink)}
.brx .empty p{margin:8px 0 0;font-size:14px}
.brx .toast{position:absolute;left:50%;bottom:26px;transform:translate(-50%,16px);opacity:0;background:var(--night);color:rgb(var(--cream));padding:11px 16px;border-radius:13px;font-size:13.5px;pointer-events:none;transition:transform .3s var(--ease),opacity .25s;white-space:nowrap;max-width:560px;overflow:hidden;text-overflow:ellipsis;z-index:30}
.brx .toast.on{transform:translate(-50%,0);opacity:1}
@media (max-width:700px){.brx .panel{width:100%}.brx .top,.brx .progress,.brx .list{padding-left:18px;padding-right:18px}.brx .opt{grid-template-columns:22px 1fr;grid-auto-flow:row}.brx .opt .field{grid-column:1/-1}}
@media (prefers-reduced-motion:reduce){.brx *{transition:none!important;animation:none!important}}
`

const TICK = <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>
const CH = (cls = 'ch') => <svg className={cls} viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
const PEN = <svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" /><path d="m13 7 4 4" /></svg>

export default function BillResolvePanel({ open, onClose, orgId, projectId, onResolved }: { open: boolean; onClose: () => void; orgId: string; projectId: string; onResolved: () => void }) {
  const qc = useQueryClient()
  const { show } = useSnackbar()
  const [view, setView] = useState<Record<string, RowView>>({})
  const [sorted, setSorted] = useState(0)
  const [menu, setMenu] = useState<{ id: string; kind: 'unit' | 'pick' } | null>(null)
  const [pickQ, setPickQ] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const toastT = useRef<number | null>(null)
  const orderRef = useRef(0)

  const queueQ = useQuery({
    queryKey: ['stock_queue', projectId],
    enabled: open && !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from('stock_resolution_queue')
        .select('id, raw_name, unit, qty, source, source_ref, canonical, candidates')
        .eq('org_id', orgId).eq('project_id', projectId).order('created_at', { ascending: true })
      return (data ?? []) as QueueRow[]
    },
  })
  const pickerQ = useQuery({
    queryKey: ['stock_picker', projectId],
    enabled: open && !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from('v_stock_material')
        .select('inventory_id, item_name, unit, on_hand').eq('project_id', projectId)
      return (data ?? []).filter((m: any) => m.inventory_id).map((m: any) => ({ inventory_id: m.inventory_id, label: m.item_name, unit: m.unit, on_hand: Number(m.on_hand) || 0 })) as PickMat[]
    },
  })
  const rows = queueQ.data ?? []
  const picker = pickerQ.data ?? []

  // Seed a view for each queue row once; keep local edits across refetches.
  useEffect(() => {
    setView((prev) => {
      let changed = false
      const next = { ...prev }
      for (const r of rows) {
        if (next[r.id]) continue
        const cand = r.candidates?.[0]
        next[r.id] = {
          mode: cand ? 'existing' : 'new',
          name: r.canonical?.item ?? r.raw_name,
          existingId: cand?.inventory_id ?? null,
          existingLabel: cand?.display_name ?? null,
          unit: r.unit ?? r.canonical?.unit ?? 'nos',
          editing: false, status: 'live', gone: false, stateText: '', order: orderRef.current++,
        }
        changed = true
      }
      return changed ? next : prev
    })
  }, [rows])

  const setV = (id: string, patch: Partial<RowView>) => setView((p) => ({ ...p, [id]: { ...p[id], ...patch } }))

  const liveRows = useMemo(() => rows.filter((r) => view[r.id] && !view[r.id].gone).sort((a, b) => view[a.id].order - view[b.id].order), [rows, view])
  const total = liveRows.length + sorted
  const doneN = sorted

  const doToast = (m: string) => { setToast(m); if (toastT.current) window.clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setToast(''), 2600) }

  const finish = (id: string, expensed: boolean, stateText: string, toastMsg: string) => {
    setV(id, { status: expensed ? 'expensed' : 'done', stateText }); doToast(toastMsg)
    window.setTimeout(() => {
      setV(id, { gone: true }); setSorted((s) => s + 1)
      window.setTimeout(async () => { await qc.invalidateQueries({ queryKey: ['stock_queue', projectId] }); onResolved() }, 480)
    }, 1300)
  }

  const runResolve = async (r: QueueRow, action: 'material' | 'expense') => {
    const v = view[r.id]; if (!v || busy) return
    if (action === 'material' && v.mode === 'existing' && !v.existingId) { setMenu({ id: r.id, kind: 'pick' }); return }
    if (action === 'material' && v.mode === 'new' && !v.name.trim()) { setV(r.id, { editing: true }); return }
    setBusy(r.id)
    try {
      const params: Record<string, unknown> = { p_id: r.id, p_action: action }
      if (action === 'material') {
        if (v.mode === 'existing') { params.p_inventory_id = v.existingId }
        else { params.p_item = v.name.trim(); params.p_variant = r.canonical?.variant ?? null; params.p_dimension = r.canonical?.dimension ?? null; params.p_grade = r.canonical?.grade ?? null; params.p_category = r.canonical?.category ?? null; params.p_unit = v.unit }
      }
      const { data, error } = await supabase.rpc('resolve_stock_queue', params)
      if (error || !(data as any)?.ok) throw new Error((data as any)?.error || error?.message || 'Could not save it')
      if (action === 'expense') finish(r.id, true, 'Marked as an expense · won\'t appear in stock', `${r.raw_name} marked as an expense`)
      else if (v.mode === 'existing') finish(r.id, false, `Added to ${v.existingLabel} · ${nfmt(r.qty)} ${v.unit} in`, `${nfmt(r.qty)} ${v.unit} added to ${v.existingLabel}`)
      else finish(r.id, false, `Added to stock · ${v.name} · ${nfmt(r.qty)} ${v.unit} in`, `${v.name} is now a material you track`)
      await pickerQ.refetch()
    } catch (e) { show((e as Error).message || 'Could not save it', { type: 'error' }) }
    finally { setBusy(null) }
  }

  const later = (id: string) => { setV(id, { order: orderRef.current++ }); doToast('Moved to the end — it stays here until you decide') }

  if (!open) return null
  const bestOf = (r: QueueRow) => (r.candidates && r.candidates[0]) || null
  const nWord = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][liveRows.length] ?? String(liveRows.length)
  const filtered = (list: PickMat[]) => { const q = pickQ.trim().toLowerCase(); return q ? list.filter((m) => m.label.toLowerCase().includes(q)) : list }

  return (
    <div className="brx" role="dialog" aria-modal="true">
      <style>{CSS}</style>
      <div className="scrim" onClick={() => { setMenu(null); onClose() }} />
      <aside className="panel">
        <div className="top">
          <div>
            <div className="crumbs">Bills → stock</div>
            <h2>{liveRows.length ? `${nWord} arrival${liveRows.length > 1 ? 's' : ''} need${liveRows.length > 1 ? '' : 's'} a name` : 'All sorted'}</h2>
            <p>These came in but we couldn't place them for sure. Tell us what each one is, and it goes into stock. If it isn't something you keep, mark it as an expense.</p>
          </div>
          <button type="button" className="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        <div className="progress"><span><b>{doneN}</b> of <b>{total}</b> sorted</span><div className="bar"><i style={{ width: `${total ? doneN / total * 100 : 0}%` }} /></div><span>{liveRows.length ? `${liveRows.length} left` : 'done'}</span></div>

        <div className="list">
          {queueQ.isLoading ? <div className="empty"><p>Loading…</p></div>
            : liveRows.length === 0 ? (
              <div className="empty"><div className="big">{TICK}</div><h3>All arrivals sorted</h3><p>Stock is up to date. New arrivals that need a name will appear here.</p></div>
            ) : liveRows.map((r) => {
              const v = view[r.id]; const best = bestOf(r); const pack = packOf(r.canonical)
              const wait = v.mode === 'existing' && !v.existingId
              const goLabel = wait ? 'Pick a material first' : v.mode === 'existing' ? `Add to ${v.existingLabel}` : `Add ${v.name.trim() || '…'}`
              const cardCls = `card${v.status === 'done' ? ' done' : ''}${v.status === 'expensed' ? ' expensed' : ''}${v.gone ? ' gone' : ''}`
              const existingOpt = (
                <div className={`opt${v.mode === 'existing' ? ' on' : ''}`} key="ex" onClick={() => { if (!v.existingId) setMenu({ id: r.id, kind: 'pick' }); else setV(r.id, { mode: 'existing', editing: false }) }}>
                  <span className="rad" />
                  <span className="lab">One I already have<small>pick from your stock</small></span>
                  <div className={`field dd${v.existingId ? '' : ' ph'}${menu?.id === r.id && menu.kind === 'pick' ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); setPickQ(''); setMenu(menu?.id === r.id && menu.kind === 'pick' ? null : { id: r.id, kind: 'pick' }) }}>
                    <span className="nm">{v.existingLabel ? <>{v.existingLabel}<small>in stock</small></> : 'Pick a material…'}</span>{CH()}
                    {menu?.id === r.id && menu.kind === 'pick' && (
                      <div className="menu" onClick={(e) => e.stopPropagation()}>
                        <input autoFocus placeholder="Search your materials…" value={pickQ} onChange={(e) => setPickQ(e.target.value)} />
                        {best && <><h4>Best match</h4><div className="best"><button type="button" className="two" onClick={() => { setV(r.id, { mode: 'existing', existingId: best.inventory_id, existingLabel: best.display_name, editing: false }); setMenu(null) }}><span className="nm">{best.display_name}</span><small>{best.confidence}% match</small></button></div></>}
                        <h4>Your materials</h4>
                        {filtered(picker).map((m) => <button type="button" key={m.inventory_id} onClick={() => { setV(r.id, { mode: 'existing', existingId: m.inventory_id, existingLabel: m.label, editing: false }); setMenu(null) }}><span className="st" />{m.label}<small>{nfmt(m.on_hand)} {m.unit} left</small></button>)}
                        {filtered(picker).length === 0 && <button type="button" disabled style={{ color: 'var(--ink-3)' }}>No match</button>}
                        <div className="foot"><button type="button" onClick={() => { setV(r.id, { mode: 'new', editing: false }); setMenu(null) }}>+ Not here — add “{v.name}” as new</button></div>
                      </div>
                    )}
                  </div>
                </div>
              )
              const newOpt = (
                <div className={`opt${v.mode === 'new' ? ' on' : ''}`} key="new" onClick={() => setV(r.id, { mode: 'new' })}>
                  <span className="rad" />
                  <span className="lab">A new material<small>we'll start tracking it</small></span>
                  <div className={`field${v.editing ? ' editing' : ''}`} onClick={(e) => e.stopPropagation()}>
                    {v.editing
                      ? <input className="nm" autoFocus value={v.name} spellCheck={false} onChange={(e) => setV(r.id, { name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setV(r.id, { editing: false }); runResolve(r, 'material') } else if (e.key === 'Escape') setV(r.id, { editing: false }) }} />
                      : <span className="nm" onClick={() => setV(r.id, { mode: 'new', editing: true })}>{v.name}{pack && <small>{pack}</small>}</span>}
                    <span className="dd">
                      <button type="button" className="unit" onClick={(e) => { e.stopPropagation(); setMenu(menu?.id === r.id && menu.kind === 'unit' ? null : { id: r.id, kind: 'unit' }) }}>{v.unit}{CH()}</button>
                      {menu?.id === r.id && menu.kind === 'unit' && (
                        <div className="menu units" onClick={(e) => e.stopPropagation()}>
                          {UNITS.map((u) => <button type="button" key={u} className={u === v.unit ? 'sel' : ''} onClick={() => { setV(r.id, { unit: u }); setMenu(null) }}>{u}</button>)}
                        </div>
                      )}
                    </span>
                    {!v.editing && <button type="button" className="pen" aria-label="Edit name" onClick={() => setV(r.id, { mode: 'new', editing: true })}>{PEN}</button>}
                  </div>
                </div>
              )
              return (
                <section className={cardCls} key={r.id}>
                  <div className="head"><b>{r.raw_name}</b><span className="qty">{nfmt(r.qty)}<small>{r.unit ?? v.unit}</small></span></div>
                  <div className="src">From {r.source === 'bill' ? 'a bill' : r.source === 'grn' ? 'a delivery' : 'stock'}{r.source_ref ? ` · ${r.source_ref}` : ''}</div>
                  <div className="q">Which material is this?</div>
                  <div className="opts">{best || v.existingLabel ? <>{existingOpt}{newOpt}</> : <>{newOpt}{existingOpt}</>}</div>
                  <div className="act">
                    <button type="button" className={`go${wait ? ' wait' : ''}${busy === r.id ? ' pop' : ''}`} onClick={() => runResolve(r, 'material')}>{TICK}<span className="t">{goLabel}</span></button>
                    <div className="alts">
                      <button type="button" className="exp" onClick={() => runResolve(r, 'expense')}>Not stock, just an expense</button>
                      <span className="sep">·</span>
                      <button type="button" className="later" onClick={() => later(r.id)}>Decide later</button>
                    </div>
                  </div>
                  <div className="state">{TICK}<span>{v.stateText}</span></div>
                </section>
              )
            })}
        </div>
      </aside>
      <div className={`toast${toast ? ' on' : ''}`} role="status">{toast}</div>
    </div>
  )
}
