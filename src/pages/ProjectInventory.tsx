// Stock — the site's materials, built to the reference design (scoped .stkx), wired to real stock data.
//
// Rows, value, category rail and the per-material ledger come from v_stock_material / stock_ledger. The
// +Arrived / −Used pills write real movements via record_stock_movement. Categories group by the supplying
// vendor's category. The snapshot-count flow, the bill-line resolve queue and consumables are in the design
// but have no backend yet, so the snapshot button is inert (coming soon) and the other two are omitted until
// their data exists — nothing here shows fabricated numbers.
import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useOrgId } from '../lib/auth/AuthProvider'
import { useSnackbar } from '../components/Snackbar'

interface StockRow {
  item_key: string; item_name: string; unit: string | null
  on_hand: number; total_in: number; total_out: number; stock_value: number; avg_rate: number | null
  last_movement_at: string | null; last_delivery_at: string | null; last_delivery_qty: number | null
  category: string | null; spec: string | null; brand: string | null
}
interface Move { entry_id: string; qty: number; direction: string; kind: string; unit: string | null; unit_rate: number | null; note: string | null; created_at: string; ref_id: string | null }

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const dstr = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')
const qfmt = (n: number, step: number) => { const v = Number(n) || 0; return (step < 1 ? v.toFixed(1) : String(Math.round(v))) }
const stepFor = (unit: string | null) => (/^(t|ton|tons|tonne|tonnes|unit|units|load|loads|brass)$/i.test((unit || '').trim()) ? 0.5 : 1)

const CSS = `
.stkx{--cream:#F4EFE7;--paper:#FBF8F2;--paper-2:#F8F3EA;--rule:#E4DCCF;--rule-soft:#EFE9DE;--ink:#2C1C13;--ink-2:#6B5B50;--mute:#9A8B7F;--clay:#C4552F;--clay-2:#B04B28;--clay-soft:#F7E6DE;--sage:#6F8065;--sage-soft:#E8ECE3;--shadow:0 18px 50px rgba(44,28,19,.16);--shadow-s:0 6px 18px -8px rgba(44,28,19,.25);--sans:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--serif:"Playfair Display",Georgia,"Times New Roman",serif;--mono:"DM Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--ease:cubic-bezier(.2,.7,.2,1);background:var(--cream);color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh}
.stkx *{box-sizing:border-box}
.stkx button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
.stkx .num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.stkx .page{max-width:1180px;margin:0 auto;padding:36px 32px 120px}
.stkx .crumb{color:var(--mute);font-size:13.5px;margin-bottom:22px}
.stkx .crumb a{color:var(--ink-2);text-decoration:none;cursor:pointer}
.stkx .crumb b{color:var(--ink);font-weight:500}
.stkx h1{font:500 46px/1.05 var(--serif);margin:0 0 12px;letter-spacing:-.01em}
.stkx .lede{color:var(--ink-2);max-width:60ch;margin:0}
.stkx .head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:40px;row-gap:18px}
.stkx .head-r{display:flex;flex-direction:column;align-items:flex-end;gap:10px;padding-top:6px}
.stkx .snapmeta{color:var(--mute);font-size:12.5px;white-space:nowrap}
.stkx .snapmeta b{color:var(--ink-2);font-weight:500}
.stkx .snapb{display:inline-flex;align-items:center;gap:10px;height:46px;padding:0 18px;border-radius:999px;background:var(--clay);color:#fff;font-weight:600;font-size:15px;box-shadow:0 8px 24px -10px rgba(196,85,47,.7);border:1px solid var(--clay);transition:background .2s,transform .15s}
.stkx .snapb:hover{background:var(--clay-2)}
.stkx .snapb:active{transform:scale(.985)}
.stkx .snapb.soon{background:var(--paper);color:var(--sage);border-color:var(--sage);box-shadow:none;pointer-events:none}
.stkx .band{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:end;column-gap:48px;margin:44px 0 26px}
.stkx .band .big{font-size:44px;font-weight:500;letter-spacing:-.015em;line-height:1}
.stkx .band .big small{font-size:15px;color:var(--ink-2);font-family:var(--sans);font-weight:400;margin-left:10px}
.stkx .band .sub{color:var(--ink-2);font-size:14px;margin-top:10px}
.stkx .band .sub b{color:var(--ink);font-weight:600}
.stkx .bh{display:flex;justify-content:space-between;align-items:baseline;font-size:14px;margin-bottom:12px}
.stkx .bh span{color:var(--mute);font-size:12.5px}
.stkx .bars{display:flex;gap:4px;align-items:flex-start}
.stkx .bars .g{cursor:pointer;min-width:0;transition:opacity .2s;padding:4px 0;border-radius:6px}
.stkx .bars .g .bar{height:9px;border-radius:5px;background:var(--rule);transition:background .2s,transform .2s;transform-origin:left center}
.stkx .bars .g:hover .bar{background:var(--ink-2);transform:scaleY(1.25)}
.stkx .bars .g.on .bar{background:var(--clay)}
.stkx .bars .g .gv{font-family:var(--mono);font-size:14px;margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stkx .bars .g .gn{font-size:12.5px;color:var(--ink-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stkx .bars .g .gp{font-size:12px;color:var(--mute);white-space:nowrap}
.stkx .bars.filtered .g:not(.on){opacity:.4}
.stkx .body{display:grid;grid-template-columns:168px minmax(0,1fr);column-gap:28px;align-items:start;margin-top:8px}
.stkx .rail{position:sticky;top:18px;display:flex;flex-direction:column;gap:2px;padding-top:36px}
.stkx .rt{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;font-size:14px;color:var(--ink-2);text-align:left;transition:background .15s,color .15s}
.stkx .rt span{color:var(--mute);font-size:12px}
.stkx .rt:hover{background:var(--rule-soft);color:var(--ink)}
.stkx .rt.on{background:var(--ink);color:var(--cream)}.stkx .rt.on span{color:var(--cream);opacity:.7}
.stkx .group{margin-top:26px}.stkx .group.hide{display:none}.stkx .lists .group:first-child{margin-top:0}
.stkx .group-h{display:flex;align-items:baseline;gap:12px;padding:0 18px 10px;color:var(--ink-2);font-size:13.5px}
.stkx .group-h b{color:var(--ink);font-weight:600;font-size:14px}
.stkx .tbl{background:var(--paper);border:1px solid var(--rule);border-radius:12px;overflow:hidden}
.stkx .hd,.stkx .row{display:grid;grid-template-columns:minmax(0,1fr) 200px 180px auto;align-items:center;gap:20px;padding:0 18px}
.stkx .hd{height:38px;color:var(--mute);font-size:12.5px;border-bottom:1px solid var(--rule-soft)}
.stkx .hd>div:nth-child(2),.stkx .hd>div:nth-child(3){text-align:right}
.stkx .row{min-height:64px;padding-top:11px;padding-bottom:11px;border-bottom:1px solid var(--rule-soft);cursor:pointer;transition:background .18s;position:relative}
.stkx .row:last-child{border-bottom:0}
.stkx .row:hover{background:var(--paper-2)}
.stkx .row[aria-current="true"]{background:var(--rule-soft)}
.stkx .row.flash{animation:stkFlash 1.2s var(--ease)}
@keyframes stkFlash{0%{background:var(--sage-soft)}100%{background:transparent}}
.stkx .row .name{font-weight:600;font-size:15.5px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.stkx .row .attr{color:var(--mute);font-size:13px;margin-top:2px}
.stkx .row .left{text-align:right}
.stkx .row .left .base{font-size:19px;font-weight:500;color:var(--ink);white-space:nowrap}
.stkx .row .left .base u{text-decoration:none;color:var(--mute);font-size:13px;font-family:var(--sans);margin-left:4px;font-weight:400}
.stkx .row .left .ev{display:inline-flex;align-items:center;gap:5px;color:var(--mute);font-size:12px;margin-top:2px;white-space:nowrap}
.stkx .row .left .lv.bump{color:var(--clay);transition:color .6s}
.stkx .row .arr{text-align:right;color:var(--ink-2);font-size:13.5px;white-space:nowrap}
.stkx .row .arr .q{color:var(--ink);margin-left:8px}
.stkx .pmw{display:flex;gap:6px;justify-self:end}
.stkx .pill{display:inline-flex;align-items:center;height:34px;padding:0 11px;border:1px solid var(--rule);border-radius:999px;font-size:13px;color:var(--ink-2);background:var(--paper);white-space:nowrap;cursor:pointer;user-select:none;transition:border-color .22s,color .22s,background .22s,opacity .22s,transform .12s}
.stkx .pill:hover{border-color:var(--clay);color:var(--clay)}
.stkx .pill .lb{font-weight:500}
.stkx .pill .ex{display:inline-flex;align-items:center;gap:6px;max-width:0;opacity:0;overflow:hidden;margin-left:0;transition:max-width .34s var(--ease),opacity .18s,margin-left .34s var(--ease)}
.stkx .pill.open{border-color:var(--ink);color:var(--ink);cursor:default;box-shadow:var(--shadow-s)}
.stkx .pill.open .ex{max-width:230px;opacity:1;margin-left:8px;overflow:visible}
.stkx .pill .st{width:26px;height:26px;border-radius:50%;border:1px solid var(--rule);display:grid;place-items:center;font-size:16px;color:var(--ink-2);transition:background .15s,border-color .15s,transform .1s}
.stkx .pill .st:hover{border-color:var(--ink);color:var(--ink)}
.stkx .pill .st:active{transform:scale(.9);background:var(--rule-soft)}
.stkx .pill .ex input{width:52px;height:26px;font:500 15px var(--mono);text-align:center;border:0;border-bottom:1.5px solid var(--rule);background:none;color:var(--ink);padding:0 2px}
.stkx .pill .ex input:focus{outline:0;border-bottom-color:var(--clay)}
.stkx .pill .ex .u{color:var(--mute);font-size:12.5px}
.stkx .pill .ex .go{width:26px;height:26px;border-radius:50%;background:var(--ink);display:grid;place-items:center;cursor:pointer;transition:background .2s,transform .12s,opacity .2s}
.stkx .pill .ex .go svg{width:12px;height:12px;fill:none;stroke:var(--cream);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.stkx .pill .ex .go:hover{background:var(--clay)}.stkx .pill .ex .go:active{transform:scale(.9)}
.stkx .pill.busy{opacity:.5;pointer-events:none}
.stkx .pill.done{border-color:var(--sage);color:var(--sage);pointer-events:none}
.stkx .pill.done .ex{max-width:40px;opacity:1;margin-left:8px}
.stkx .pill.done .ex>*{display:none}
.stkx .pill.done .ex .okw{display:inline-flex;align-items:center}
.stkx .tick{width:18px;height:18px}
.stkx .tick circle{stroke:var(--sage);stroke-width:1.8;fill:none;stroke-dasharray:70;stroke-dashoffset:70;animation:stkRing .32s ease-out forwards}
.stkx .tick path{stroke:var(--sage);stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:20;stroke-dashoffset:20;animation:stkRing .26s .22s ease-out forwards}
@keyframes stkRing{to{stroke-dashoffset:0}}
.stkx .pmw.hasopen .pill:not(.open):not(.done){opacity:.3;pointer-events:none}
.stkx .empty{padding:70px 20px;text-align:center;color:var(--mute)}
.stkx .scrim{position:fixed;inset:0;background:rgba(44,28,19,.22);opacity:0;pointer-events:none;transition:opacity .25s;z-index:20}
.stkx .scrim.on{opacity:1;pointer-events:auto}
.stkx .peek{position:fixed;top:0;right:0;bottom:0;width:min(540px,100%);background:var(--paper);border-left:1px solid var(--rule);box-shadow:var(--shadow);transform:translateX(104%);transition:transform .32s var(--ease);overflow:auto;z-index:21}
.stkx .peek.on{transform:none}
.stkx .peek-in{padding:26px 28px 40px}
.stkx .peek .top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.stkx .peek .kind{color:var(--mute);font-size:13px}
.stkx .peek h2{font:500 28px/1.1 var(--serif);margin:4px 0 0}
.stkx .peek .x{color:var(--mute);font-size:22px;line-height:1;padding:4px 10px;border-radius:50%;transition:background .15s}
.stkx .peek .x:hover{background:var(--rule-soft);color:var(--ink)}
.stkx .hero{margin:22px 0 6px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.stkx .hero .base{font-size:38px;font-weight:500;letter-spacing:-.01em}
.stkx .hero .base u{text-decoration:none;font-family:var(--sans);font-size:16px;color:var(--ink-2);margin-left:6px}
.stkx .meta{display:flex;gap:26px;color:var(--ink-2);font-size:14px;margin:14px 0 22px;flex-wrap:wrap}
.stkx .meta b{color:var(--ink);font-weight:500}
.stkx .ledger h3{font-size:14px;font-weight:600;margin:0 0 6px;color:var(--ink-2)}
.stkx .mv{display:grid;grid-template-columns:64px 1fr auto auto;gap:14px;align-items:baseline;padding:11px 0;border-bottom:1px solid var(--rule-soft)}
.stkx .mv:last-child{border-bottom:0}
.stkx .mv.new{animation:stkFlash 1.4s var(--ease)}
.stkx .mv .d{color:var(--mute);font-size:12.5px}
.stkx .mv .w b{font-weight:500}.stkx .mv .w span{display:block;color:var(--mute);font-size:12.5px;margin-top:1px}
.stkx .mv .q{text-align:right;font-weight:500}.stkx .mv .q.minus{color:var(--ink-2)}
.stkx .mv .bal{text-align:right;color:var(--mute);font-size:12.5px;min-width:56px}
@media (max-width:1000px){.stkx .body{grid-template-columns:1fr}
  .stkx .rail{position:sticky;top:0;z-index:3;background:var(--cream);flex-direction:row;gap:6px;padding:10px 0;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px;padding-left:16px;padding-right:16px}
  .stkx .rt{flex:none;padding:8px 13px;border:1px solid var(--rule);border-radius:999px;font-size:13.5px;gap:6px;min-height:40px;background:var(--paper)}
  .stkx .rt.on{border-color:var(--ink)}}
@media (max-width:860px){.stkx .page{padding:18px 16px 100px}.stkx h1{font-size:34px}
  .stkx .head{grid-template-columns:1fr;row-gap:16px}.stkx .head-r{align-items:stretch;padding-top:0}.stkx .snapb{width:100%;justify-content:center}
  .stkx .band{grid-template-columns:1fr;margin:24px 0 16px}.stkx .band .big{font-size:36px}.stkx .band-r{display:none}
  .stkx .group-h{padding:0 4px 8px}.stkx .hd{display:none}
  .stkx .row{grid-template-columns:1fr auto;grid-template-areas:"name left" "arr arr" "pm pm";row-gap:8px;padding:14px 14px;min-height:0}
  .stkx .row .m{grid-area:name}.stkx .row .left{grid-area:left}.stkx .row .arr{grid-area:arr;text-align:left;font-size:13px}.stkx .pmw{grid-area:pm;justify-self:stretch}
  .stkx .row .name{font-size:16px}.stkx .row .left .base{font-size:21px}
  .stkx .pmw .pill{flex:1;justify-content:center;height:44px;font-size:14px}
  .stkx .pill.open{flex:2.4}.stkx .pill .st{width:34px;height:34px;font-size:18px}.stkx .pill .ex input{width:56px;height:34px;font-size:17px}.stkx .pill .ex .go{width:34px;height:34px}
  .stkx .peek{top:auto;bottom:0;left:0;right:0;width:100%;max-height:88vh;border-left:0;border-top:1px solid var(--rule);border-radius:22px 22px 0 0;transform:translateY(104%)}
  .stkx .peek.on{transform:none}.stkx .peek-in{padding:16px 18px 34px}}
`

const Tick = () => (<svg className="tick" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>)

export default function ProjectInventory({ session: _session }: { session: Session }) {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const orgId = useOrgId()
  const qc = useQueryClient()
  const { show } = useSnackbar()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await supabase.from('projects').select('name').eq('project_id', projectId!).single()).data,
    enabled: !!projectId,
  })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['project_stock_material', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_material')
        .select('item_key, item_name, unit, on_hand, total_in, total_out, stock_value, avg_rate, last_movement_at, last_delivery_at, last_delivery_qty, category, spec, brand')
        .eq('project_id', projectId!).order('item_name')
      if (error) throw error
      return (data ?? []) as StockRow[]
    },
  })

  const materials = useMemo(() => rows.filter((r) => Number(r.on_hand) > 0.0001), [rows])
  const catName = (r: StockRow) => (r.category?.trim() || 'Uncategorised')

  // categories present in the data (by vendor category), with counts
  const cats = useMemo(() => {
    const m = new Map<string, number>()
    materials.forEach((r) => m.set(catName(r), (m.get(catName(r)) ?? 0) + 1))
    return [...m.entries()].map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c || a.n.localeCompare(b.n))
  }, [materials])

  // value bars: top-5 categories by value + "Other"
  const bars = useMemo(() => {
    const m = new Map<string, number>()
    materials.forEach((r) => m.set(catName(r), (m.get(catName(r)) ?? 0) + (Number(r.stock_value) || 0)))
    const arr = [...m.entries()].map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v)
    const top = arr.slice(0, 5), rest = arr.slice(5)
    const out = [...top]
    if (rest.length) out.push({ n: 'Other', v: rest.reduce((a, g) => a + g.v, 0) })
    return out
  }, [materials])
  const totalValue = materials.reduce((a, r) => a + (Number(r.stock_value) || 0), 0)
  const notCounted = materials.filter((r) => r.total_out === 0 && r.last_delivery_at).length

  const [filter, setFilter] = useState<string>('')
  const [peek, setPeek] = useState<StockRow | null>(null)
  const [snapSoon, setSnapSoon] = useState(false)
  const [pill, setPill] = useState<{ key: string; kind: 'in' | 'out'; val: number } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [doneKey, setDoneKey] = useState<string | null>(null)
  const [flashKey, setFlashKey] = useState<string | null>(null)

  const ledger = useQuery({
    queryKey: ['stock_ledger_item', projectId, peek?.item_key],
    enabled: !!peek && !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from('stock_ledger')
        .select('entry_id, qty, direction, kind, unit, unit_rate, note, created_at, ref_id')
        .eq('project_id', projectId!).eq('unit', peek!.unit ?? '')
        .ilike('item_name', peek!.item_name)
        .order('created_at', { ascending: true })
      return (data ?? []) as Move[]
    },
  })

  const commit = async (r: StockRow, kind: 'in' | 'out', qty: number) => {
    if (!qty || qty <= 0) return
    const key = r.item_key + kind
    setBusyKey(key)
    try {
      const { data, error } = await supabase.rpc('record_stock_movement', {
        p_org_id: orgId, p_project_id: projectId, p_item_name: r.item_name, p_unit: r.unit,
        p_qty: qty, p_direction: kind, p_unit_rate: kind === 'in' ? (r.avg_rate ?? null) : null,
      })
      if (error || !(data as any)?.ok) throw new Error((data as any)?.error || error?.message || 'Could not record it')
      setPill(null); setDoneKey(key)
      setFlashKey(r.item_key); setTimeout(() => setFlashKey(null), 1200)
      await qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] })
      await qc.invalidateQueries({ queryKey: ['stock_ledger_item', projectId, r.item_key] })
      setTimeout(() => setDoneKey(null), 1500)
    } catch (e) { show((e as Error).message || 'Could not record it', { type: 'error' }) }
    finally { setBusyKey(null) }
  }

  const shown = filter ? materials.filter((r) => catName(r) === filter) : materials

  return (
    <div className="stkx">
      <style>{CSS}</style>
      <main className="page">
        <div className="crumb"><a onClick={() => navigate(`/projects/${projectId}`)}>{project?.name ?? 'Project'}</a> &nbsp;/&nbsp; <b>Stock</b></div>

        <header className="head">
          <div className="head-l">
            <h1>Stock</h1>
            <p className="lede">Materials at this site. Quantities come in from bills and POs; they go out when the site sends a count.</p>
          </div>
          <div className="head-r">
            <button className={`snapb${snapSoon ? ' soon' : ''}`} onClick={() => { setSnapSoon(true); setTimeout(() => setSnapSoon(false), 2200) }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5h2.2l1-1.5h5.6l1 1.5H15v8H3z" /><circle cx="9" cy="9.3" r="2.4" /></svg>
              {snapSoon ? 'Snapshot requests — coming soon' : 'Ask the site for a snapshot'}
            </button>
            {materials.length > 0 && <div className="snapmeta">Last movement <b>{dstr(materials.map((m) => m.last_movement_at).sort().reverse()[0] ?? null)}</b> · {materials.length} materials</div>}
          </div>
        </header>

        {isLoading ? <div className="empty">Loading stock…</div>
          : materials.length === 0 ? (
            <div className="empty" style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12, marginTop: 24 }}>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px' }}>No stock yet</p>
              <p style={{ maxWidth: 340, margin: '0 auto', lineHeight: 1.6 }}>When you receive a purchase order at this site, the goods appear here as stock on hand.</p>
            </div>
          ) : (
          <>
            <section className="band">
              <div className="band-l">
                <div className="big num">{inr(totalValue)}<small>in stock</small></div>
                <div className="sub">across <b>{materials.length}</b> materials{notCounted > 0 ? <> · <b>{notCounted}</b> not counted since delivery</> : null}</div>
              </div>
              <div className="band-r">
                <div className="bh">Where the value sits<span>{filter ? 'one category · tap again for all' : 'tap a category to filter'}</span></div>
                <div className={`bars${filter ? ' filtered' : ''}`}>
                  {bars.map((g) => (
                    <div key={g.n} className={`g${filter === g.n ? ' on' : ''}`} title={g.n} style={{ flex: Math.max(g.v / (totalValue || 1), 0.08) }}
                      onClick={() => { if (g.n !== 'Other') setFilter(filter === g.n ? '' : g.n) }}>
                      <div className="bar" /><div className="gv">{inr(g.v)}</div><div className="gn">{g.n}</div><div className="gp">{Math.round(g.v / (totalValue || 1) * 100)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="body">
              <nav className="rail" aria-label="Categories">
                <button className={`rt${filter === '' ? ' on' : ''}`} onClick={() => setFilter('')}>All<span>{materials.length}</span></button>
                {cats.map((c) => <button key={c.n} className={`rt${filter === c.n ? ' on' : ''}`} onClick={() => setFilter(filter === c.n ? '' : c.n)}>{c.n}<span>{c.c}</span></button>)}
              </nav>

              <div className="lists">
                {(filter ? cats.filter((c) => c.n === filter) : cats).map((c) => {
                  const its = shown.filter((r) => catName(r) === c.n)
                  if (!its.length) return null
                  return (
                    <section className="group" key={c.n}>
                      <div className="group-h"><b>{c.n}</b><span>{its.length} {its.length === 1 ? 'item' : 'items'}</span></div>
                      <div className="tbl">
                        <div className="hd"><div>Material</div><div>In stock</div><div>Last delivery</div><div /></div>
                        {its.map((r) => {
                          const step = stepFor(r.unit)
                          const attr = [r.brand, r.spec].filter(Boolean).join(' · ')
                          return (
                            <div className={`row${flashKey === r.item_key ? ' flash' : ''}`} key={r.item_key} aria-current={peek?.item_key === r.item_key || undefined}
                              onClick={(e) => { if ((e.target as HTMLElement).closest('.pmw')) return; setPeek(r) }}>
                              <div className="m"><div className="name">{r.item_name}</div>{attr && <div className="attr">{attr}</div>}</div>
                              <div className="left">
                                <div className="base"><span className="lv num">{qfmt(r.on_hand, step)}</span><u>{r.unit}</u></div>
                                <div className="ev">received {dstr(r.last_delivery_at) || dstr(r.last_movement_at)}</div>
                              </div>
                              <div className="arr">{r.last_delivery_at ? <><span className="d">{dstr(r.last_delivery_at)}</span><span className="q num">{qfmt(r.last_delivery_qty ?? 0, step)} {r.unit}</span></> : <span className="d">—</span>}</div>
                              <div className={`pmw${pill?.key === r.item_key ? ' hasopen' : ''}`}>
                                {(['out', 'in'] as const).map((kind) => {
                                  const key = r.item_key + kind
                                  const open = pill?.key === r.item_key && pill?.kind === kind
                                  const done = doneKey === key
                                  const busy = busyKey === key
                                  return (
                                    <span key={kind} className={`pill${open ? ' open' : ''}${done ? ' done' : ''}${busy ? ' busy' : ''}`}
                                      onClick={() => { if (!open && !done) setPill({ key: r.item_key, kind, val: 0 }) }}>
                                      <span className="lb">{kind === 'out' ? '− Used' : '+ Arrived'}</span>
                                      <span className="ex">
                                        <button className="st" onClick={(e) => { e.stopPropagation(); setPill((p) => (p ? { ...p, val: Math.max(0, p.val - step) } : p)) }} aria-label="less">−</button>
                                        <input className="num" inputMode="decimal" value={open ? qfmt(pill!.val, step) : '0'} onChange={(e) => setPill((p) => (p ? { ...p, val: parseFloat(e.target.value.replace(/[^\d.]/g, '')) || 0 } : p))} onClick={(e) => e.stopPropagation()} aria-label={kind === 'out' ? 'Used' : 'Arrived'} />
                                        <button className="st" onClick={(e) => { e.stopPropagation(); setPill((p) => (p ? { ...p, val: p.val + step } : p)) }} aria-label="more">+</button>
                                        <span className="u">{r.unit}</span>
                                        <span className="go" role="button" aria-label="Add to ledger" onClick={(e) => { e.stopPropagation(); if (open) commit(r, kind, pill!.val) }}><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.4 2.4L9.8 4" /></svg></span>
                                        <span className="okw"><Tick /></span>
                                      </span>
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </main>

      <div className={`scrim${peek ? ' on' : ''}`} onClick={() => setPeek(null)} />
      <aside className={`peek${peek ? ' on' : ''}`} aria-hidden={!peek}>
        {peek && (() => {
          const step = stepFor(peek.unit)
          const attr = [peek.brand, peek.spec].filter(Boolean).join(' · ')
          const moves = ledger.data ?? []
          let bal = 0
          const withBal = moves.map((mv) => { bal += mv.direction === 'in' ? Number(mv.qty) : -Number(mv.qty); return { ...mv, bal } })
          return (
            <div className="peek-in">
              <div className="top"><div><div className="kind">{catName(peek)}{attr ? ` · ${attr}` : ''}</div><h2>{peek.item_name}</h2></div><button className="x" aria-label="Close" onClick={() => setPeek(null)}>×</button></div>
              <div className="hero"><div className="base num">{qfmt(peek.on_hand, step)}<u>{peek.unit}</u></div></div>
              <div className="meta">
                {peek.last_delivery_at && <span>Last delivery <b>{dstr(peek.last_delivery_at)}, {qfmt(peek.last_delivery_qty ?? 0, step)} {peek.unit}</b></span>}
                <span>Used since <b className="num">{qfmt(peek.total_out, step)}</b></span>
                {peek.avg_rate != null && <span>Avg rate <b className="num">{inr(peek.avg_rate)} / {peek.unit}</b></span>}
                <span>Value <b className="num">{inr(peek.stock_value)}</b></span>
              </div>
              <div className="ledger">
                <h3>Ledger</h3>
                {ledger.isLoading ? <p style={{ color: 'var(--mute)', fontSize: 13 }}>Loading…</p>
                  : withBal.length === 0 ? <p style={{ color: 'var(--mute)', fontSize: 13 }}>No movements yet.</p>
                  : [...withBal].reverse().map((mv) => {
                    const isIn = mv.direction === 'in'
                    const label = mv.kind === 'grn_receipt' ? `Arrived ${qfmt(mv.qty, step)} ${mv.unit ?? peek.unit}` : mv.kind === 'manual_in' ? `Arrived ${qfmt(mv.qty, step)} ${mv.unit ?? peek.unit}` : `Used ${qfmt(mv.qty, step)} ${mv.unit ?? peek.unit}`
                    const sub = mv.ref_id ? `Receipt ${mv.ref_id}${mv.unit_rate ? ` · ${inr(mv.unit_rate)}/${mv.unit ?? peek.unit}` : ''}` : (mv.note || (isIn ? 'from the Stock page' : 'issued from the Stock page'))
                    return (
                      <div className="mv" key={mv.entry_id}><div className="d">{dstr(mv.created_at)}</div><div className="w"><b>{label}</b><span>{sub}</span></div><div className={`q num${isIn ? '' : ' minus'}`}>{isIn ? '+' : '−'}{qfmt(mv.qty, step)}</div><div className="bal num">{qfmt(mv.bal, step)}</div></div>
                    )
                  })}
              </div>
            </div>
          )
        })()}
      </aside>
    </div>
  )
}
