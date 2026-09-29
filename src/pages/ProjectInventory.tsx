// Stock — fact first (how much is on site, in a supervisor's words), then the story
// (arrived → used → left), then the action (say "used 10" on the row). Ledger drawer per
// material; hover-select → merge / edit / delete; low-stock alerts. Design ported from the
// reference (scoped .stk2), wired to v_stock_material + stock_ledger + the identity RPCs.
import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useOrgId } from '../lib/auth/AuthProvider'
import { useSnackbar } from '../components/Snackbar'
import BillResolvePanel from '../components/BillResolvePanel'

interface Mat {
  item_key: string; inventory_id: string | null; item_name: string; unit: string | null
  on_hand: number; total_out: number; used_since: number; avg_rate: number | null
  last_delivery_at: string | null; last_delivery_qty: number | null; last_movement_at: string | null
  category: string | null; alert_qty: number | null; aliases: string[] | null; stock_value: number
}
interface LEntry { entry_id: string; direction: string; kind: string; qty: number; unit_rate: number | null; note: string | null; created_at: string; ref_type: string | null; ref_id: string | null }

const UNITS = ['nos', 'bag', 'kg', 'ltr', 'cft', 'ton', 'MT', 'sqft', 'rft', 'unit', 'trip', 'pair', 'bundle', 'box', 'roll', 'set']
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const fmt = (n: number) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
const dstr = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')
const dayNo = (s: string | null) => (s ? new Date(s).setHours(0, 0, 0, 0) : 0)
const DAY = 86400000
const isLow = (m: Mat) => m.alert_qty != null && m.alert_qty > 0 && m.on_hand <= m.alert_qty
function lasts(m: Mat): { text: string; sub: string; kind: string; days: number | null } | null {
  if (!m.last_delivery_at) return null
  const today = new Date().setHours(0, 0, 0, 0), li = dayNo(m.last_delivery_at)
  const used = m.used_since || 0, days = Math.max(1, Math.round((today - li) / DAY))
  if (!used) return { text: li >= today ? 'Arrived today' : 'Nothing used since it arrived', sub: 'No usage recorded since ' + dstr(m.last_delivery_at), kind: li >= today ? 'new' : 'dim', days: null }
  const perDay = used / days, left = m.on_hand / perDay
  return { text: 'About ' + (left < 1 ? 'a day' : Math.round(left) + ' days') + ' left', sub: 'at ~' + fmt(perDay) + ' ' + (m.unit ?? '') + ' a day since ' + dstr(m.last_delivery_at), kind: left < 5 ? 'low' : left < 12 ? '' : 'ok', days: left }
}

const CSS = `
.stk2{--ground:#FAF8F3;--paper:#FFFFFF;--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line:#E9E1D6;--line-2:#DCD2C4;--rule:#F0E9DF;--wash:#F3EEE5;--sand:#F1ECE1;
  --night:#15100C;--cream:250,248,243;--clay:#B5472A;--clay-hi:#D4633E;--clay-wash:#FBEDE6;--sage:#2F5D3A;--sage-hi:#8FC79A;--sage-wash:#E7F0E6;--amber:#8A6A2E;--amber-wash:#F6EEDC;--wa:#25A65B;
  --serif:'Playfair Display',Georgia,serif;--sans:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'DM Mono',ui-monospace,Menlo,monospace;--ease:cubic-bezier(.2,.7,.2,1);--spring:cubic-bezier(.34,1.4,.64,1);
  background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:14.5px;line-height:1.4;min-height:100%}
.stk2 *{box-sizing:border-box}
.stk2 button,.stk2 input{font:inherit;color:inherit}.stk2 button{cursor:pointer}
.stk2 .wrap{max-width:1240px;margin:0 auto;padding:28px 40px 100px}
.stk2 .top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}
.stk2 .top h1{margin:0;font-family:var(--serif);font-weight:600;font-size:34px;letter-spacing:-.01em;line-height:1.1}
.stk2 .acts{display:flex;gap:8px}
.stk2 .btn{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line-2);background:var(--paper);font-size:14px;font-weight:600;color:var(--ink);transition:background .2s,border-color .2s,transform .14s var(--ease),box-shadow .2s,color .2s;white-space:nowrap}
.stk2 .btn:hover{border-color:var(--ink-3);background:#FFFDF9}.stk2 .btn:active{transform:scale(.98)}
.stk2 .btn.pri{background:var(--clay);border-color:var(--clay);color:#fff;box-shadow:0 10px 20px -12px rgba(181,71,42,.9)}
.stk2 .btn.pri:hover{background:var(--clay-hi);border-color:var(--clay-hi)}
.stk2 .btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
.stk2 .btn svg.wa{fill:var(--wa);stroke:none}
.stk2 .hero{margin-top:22px}
.stk2 .hero .big{display:flex;align-items:baseline;gap:12px;font-family:var(--mono);font-size:36px;font-weight:500;letter-spacing:-.01em}
.stk2 .hero .big small{font-family:var(--sans);font-size:14px;color:var(--ink-3);font-weight:500}
.stk2 .hero .sub{margin-top:6px;font-size:14px;color:var(--ink-3);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.stk2 .hero .sub b{font-weight:500;color:var(--ink-2);font-family:var(--mono);font-size:13.5px}
.stk2 .hero .sub .sep{color:var(--line-2)}.stk2 .hero .sub .low b{color:var(--clay)}
.stk2 .needs{margin:24px -16px 0;padding:6px 16px;border-radius:24px;background:var(--sand)}
.stk2 .needs .line{display:grid;grid-template-columns:28px 1fr max-content;gap:12px;align-items:center;padding:12px 8px;border-top:1px dashed var(--line-2);color:var(--ink-2);font-size:14.5px}
.stk2 .needs .line:first-child{border-top:0}.stk2 .needs .line b{font-weight:600;color:var(--ink)}
.stk2 .needs .line .ic{width:28px;height:28px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.7)}
.stk2 .needs .line .ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.stk2 .needs .line .ic.clay{color:var(--clay)}.stk2 .needs .line .ic.amber{color:var(--amber)}
.stk2 .needs .line a{color:var(--ink-2);text-decoration:underline;text-decoration-color:var(--line-2);text-underline-offset:4px;cursor:pointer;font-weight:600;transition:text-decoration-color .15s}
.stk2 .needs .line a:hover{text-decoration-color:var(--ink-2)}
.stk2 .filters{display:flex;align-items:center;gap:10px;margin-top:26px;flex-wrap:wrap}
.stk2 .chip{height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line-2);background:var(--paper);font-size:14.5px;color:var(--ink);display:inline-flex;align-items:center;gap:8px;font-weight:500;white-space:nowrap;transition:background .18s,border-color .18s,color .18s}
.stk2 .chip:hover{border-color:var(--ink-3)}
.stk2 .chip.on{background:var(--clay-wash);border-color:var(--clay-wash);color:var(--clay)}
.stk2 .chip em{font-style:normal;font-family:var(--mono);font-size:12.5px;color:var(--ink-3)}.stk2 .chip.on em{color:var(--clay)}
.stk2 .search{flex:1;min-width:200px;height:50px;border:1px solid var(--line-2);background:var(--paper);border-radius:25px;display:flex;align-items:center;gap:12px;padding:0 20px;color:var(--ink-3);font-size:15px;transition:border-color .18s,box-shadow .18s}
.stk2 .search:focus-within{border-color:var(--ink-2);box-shadow:0 0 0 4px rgba(43,33,26,.05)}
.stk2 .search svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.stk2 .search input{border:0;background:none;outline:none;flex:1;font-size:15px;color:var(--ink);padding:0}
.stk2 .ledger{margin-top:32px}
.stk2 .grp{display:flex;align-items:baseline;justify-content:space-between;padding:0 16px 12px;border-bottom:1px solid var(--line)}
.stk2 .grp h3{margin:0;font-family:var(--serif);font-weight:600;font-size:20px;color:var(--ink)}
.stk2 .grp h3 span{font-family:var(--sans);font-weight:400;font-size:14px;color:var(--ink-3);margin-left:8px}
.stk2 .grp .r{font-size:13.5px;color:var(--ink-3)}.stk2 .grp .r b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.stk2 .card{background:var(--paper);border:1px solid var(--line);border-radius:18px;margin:14px 0 30px;box-shadow:0 1px 0 rgba(43,33,26,.03)}
.stk2 .tr{display:grid;grid-template-columns:36px minmax(0,1fr) 150px 150px 200px max-content;gap:16px;align-items:center;padding:14px 20px;border-top:1px solid var(--rule);cursor:pointer;transition:background .2s;position:relative}
.stk2 .tr:first-child{border-top:0}.stk2 .tr:hover{background:#FFFDF9}
.stk2 .tr::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 2px 2px 0;background:var(--clay);opacity:0;transform:scaleY(.4);transition:opacity .2s,transform .25s var(--ease)}
.stk2 .tr:hover::before{opacity:.35;transform:none}.stk2 .tr.low::before{opacity:.9;transform:none}
.stk2 .tr.flash{animation:s2fl 1.6s var(--ease)}
@keyframes s2fl{0%{background:var(--sage-wash)}100%{background:transparent}}
.stk2 .tr .av{width:36px;height:36px;border-radius:18px;background:var(--wash);display:grid;place-items:center;font-size:11.5px;font-weight:700;color:var(--ink-2);transition:background .2s,color .2s}
.stk2 .tr:hover .av{background:var(--sand);color:var(--ink)}
.stk2 .tr .nm{min-width:0}
.stk2 .tr .nm b{display:flex;align-items:center;gap:6px;font-size:15.5px;font-weight:600;color:var(--ink)}
.stk2 .tr .nm b .txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.stk2 .tr .nm span{display:block;margin-top:2px;font-size:13.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk2 .tr .nm span b{display:inline;font-size:13.5px;font-weight:500;color:var(--ink-2)}
.stk2 .tr .nm span b.low{color:var(--clay);font-weight:600}.stk2 .tr .nm span b.ok{color:var(--sage)}.stk2 .tr .nm span b.new{color:var(--sage)}
.stk2 .tr .mini{min-width:0}
.stk2 .tr .mini .bar{display:flex;height:4px;border-radius:2px;overflow:hidden;background:var(--wash)}
.stk2 .tr .mini .bar i{display:block;height:100%;transition:width .6s var(--ease)}
.stk2 .tr .mini .bar .u{background:var(--clay-hi);opacity:.85}.stk2 .tr .mini .bar .l{background:var(--sage-hi)}
.stk2 .tr .mini small{display:block;margin-top:6px;font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk2 .tr .mini small b{font-family:var(--mono);font-weight:500;color:var(--ink-2)}
.stk2 .tr .st{text-align:right;white-space:nowrap}
.stk2 .tr .st b{font-family:var(--mono);font-size:19px;font-weight:500;color:var(--ink);display:inline-block}
.stk2 .tr .st b.low{color:var(--clay)}
.stk2 .tr .st span{font-size:13px;color:var(--ink-3);margin-left:4px}
.stk2 .tr .st small{display:block;font-size:12.5px;color:var(--ink-3);margin-top:1px}
.stk2 .tr .st small.used{color:var(--clay)}.stk2 .tr .st small.in{color:var(--sage)}
.stk2 .tr .ac{display:flex;justify-content:flex-end;gap:8px;min-width:0}
.stk2 .pill{height:36px;padding:0 14px;border-radius:18px;border:1px solid transparent;background:none;font-size:14px;font-weight:600;color:var(--ink-3);display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .18s,border-color .18s,color .18s,transform .14s var(--ease),opacity .2s}
.stk2 .tr:hover .pill{color:var(--ink);border-color:var(--line-2);background:var(--paper)}
.stk2 .pill:hover{border-color:var(--ink-3)!important;background:var(--wash)!important}.stk2 .pill:active{transform:scale(.97)}
.stk2 .tr:hover .pill.out{color:var(--clay)}.stk2 .tr:hover .pill.in{color:var(--sage)}
.stk2 .pill.out:hover{background:var(--clay-wash)!important;border-color:var(--clay)!important;color:var(--clay)!important}
.stk2 .pill.in:hover{background:var(--sage-wash)!important;border-color:var(--sage)!important;color:var(--sage)!important}
.stk2 .entry{position:relative;display:flex;align-items:center;gap:4px;height:40px;padding:0 4px;border-radius:20px;border:1.5px solid var(--ink-2);background:var(--paper);box-shadow:0 8px 24px -14px rgba(43,33,26,.5),0 0 0 4px rgba(43,33,26,.05)}
.stk2 .entry.out{border-color:var(--clay);box-shadow:0 8px 24px -14px rgba(181,71,42,.6),0 0 0 4px var(--clay-wash)}
.stk2 .entry.in{border-color:var(--sage);box-shadow:0 8px 24px -14px rgba(47,93,58,.6),0 0 0 4px var(--sage-wash)}
.stk2 .entry .k{font-size:13.5px;font-weight:600;padding:0 6px 0 10px;white-space:nowrap}
.stk2 .entry.out .k{color:var(--clay)}.stk2 .entry.in .k{color:var(--sage)}
.stk2 .entry .stp{width:28px;height:28px;border-radius:14px;border:0;background:var(--wash);color:var(--ink-2);display:grid;place-items:center;font-size:15px;font-weight:600;line-height:1;transition:background .15s,transform .12s var(--ease)}
.stk2 .entry .stp:hover{background:var(--line)}.stk2 .entry .stp:active{transform:scale(.9)}
.stk2 .entry input{width:70px;height:34px;border:0;background:none;text-align:center;font-family:var(--mono);font-size:17px;font-weight:500;outline:none;padding:0;color:var(--ink)}
.stk2 .entry input::placeholder{color:var(--line-2);font-size:13.5px;font-family:var(--sans);font-weight:500}
.stk2 .entry .u{font-size:13px;color:var(--ink-3);padding-right:4px}
.stk2 .entry .save{width:32px;height:32px;border-radius:16px;border:0;background:var(--line);color:var(--ink-3);display:grid;place-items:center;transition:background .25s,color .25s,transform .18s var(--spring);flex:none}
.stk2 .entry .save.ready{background:var(--ink);color:rgb(var(--cream));transform:scale(1.04)}
.stk2 .entry.out .save.ready{background:var(--clay)}.stk2 .entry.in .save.ready{background:var(--sage)}
.stk2 .entry .save:active{transform:scale(.92)}
.stk2 .entry .save svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.stk2 .entry .x{width:26px;height:26px;border:0;background:none;color:var(--ink-3);border-radius:13px;display:grid;place-items:center;flex:none;transition:background .15s,color .15s}
.stk2 .entry .x:hover{background:var(--wash);color:var(--ink)}
.stk2 .entry .x svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.stk2 .tr .lead{position:relative;width:36px;height:36px}
.stk2 .tr .lead .av{position:absolute;inset:0;transition:opacity .18s,transform .18s var(--ease)}
.stk2 .tr .pick{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transform:scale(.8);transition:opacity .18s,transform .2s var(--spring);cursor:pointer}
.stk2 .tr .pick .box{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-2);background:var(--paper);display:grid;place-items:center;transition:background .18s,border-color .18s,transform .15s var(--spring)}
.stk2 .tr .pick .box svg{width:12px;height:12px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:scale(.6);transition:opacity .15s,transform .2s var(--spring)}
.stk2 .tr .pick:hover .box{border-color:var(--ink-3)}
.stk2 .tr:hover .av,.stk2 .ledger.has-sel .av,.stk2 .tr.sel .av{opacity:0;transform:scale(.9)}
.stk2 .tr:hover .pick,.stk2 .ledger.has-sel .pick,.stk2 .tr.sel .pick{opacity:1;transform:none}
.stk2 .tr.sel .pick .box{background:var(--clay);border-color:var(--clay)}
.stk2 .tr.sel .pick .box svg{opacity:1;transform:none}
.stk2 .tr.sel{background:#FFFBF5}.stk2 .tr.sel::before{opacity:1;transform:none;background:var(--clay)}
.stk2 .tr .nm .pen{width:24px;height:24px;border-radius:12px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center;opacity:0;transform:translateX(-4px);transition:opacity .18s,transform .2s var(--ease),background .15s,color .15s;flex:none}
.stk2 .tr:hover .nm .pen{opacity:1;transform:none}
.stk2 .tr .nm .pen:hover{background:var(--wash);color:var(--ink)}
.stk2 .tr .nm .pen svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.stk2 .tr .nm input.rn{height:30px;border:0;border-bottom:1.5px solid var(--ink-2);background:none;padding:0;font-size:15.5px;font-weight:600;color:var(--ink);outline:none;width:100%;max-width:280px}
.stk2 .tr.bye{animation:s2bye .4s var(--ease) forwards}
@keyframes s2bye{to{opacity:0;transform:translateX(-12px);max-height:0;padding-top:0;padding-bottom:0;border-top-color:transparent}}
.stk2 .selbar{position:fixed;left:50%;bottom:30px;transform:translate(-50%,24px);opacity:0;pointer-events:none;background:var(--night);color:rgb(var(--cream));border-radius:18px;padding:8px 8px 8px 18px;display:flex;align-items:center;gap:6px;box-shadow:0 24px 50px -20px rgba(21,16,12,.7);z-index:45;transition:transform .32s var(--spring),opacity .22s;white-space:nowrap}
.stk2 .selbar.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}
.stk2 .selbar .n{font-size:14px;font-weight:600;margin-right:10px}
.stk2 .selbar .n b{font-family:var(--mono);font-weight:500;color:var(--clay-hi);margin-right:2px}
.stk2 .selbar button{height:36px;padding:0 14px;border-radius:12px;border:0;background:none;color:rgba(var(--cream),.85);font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;transition:background .15s,color .15s,opacity .15s;position:relative}
.stk2 .selbar button:hover{background:rgba(var(--cream),.1);color:rgb(var(--cream))}
.stk2 .selbar button[disabled]{opacity:.35;cursor:not-allowed}.stk2 .selbar button[disabled]:hover{background:none}
.stk2 .selbar button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.stk2 .selbar button.del:hover{color:#F3B4A4;background:rgba(212,99,62,.15)}
.stk2 .selbar .sep{width:1px;height:20px;background:rgba(var(--cream),.15);margin:0 4px}
.stk2 .selbar .xb{width:36px;padding:0;justify-content:center}
.stk2 .selbar .pop{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);background:var(--paper);color:var(--ink);border-radius:16px;padding:14px 16px;min-width:340px;box-shadow:0 24px 50px -20px rgba(21,16,12,.6),0 0 0 1px var(--line);white-space:normal;text-align:left;cursor:default;font-weight:400}
.stk2 .selbar .pop h5{margin:0;font-size:15px;font-weight:600;color:var(--ink)}
.stk2 .selbar .pop p{margin:6px 0 0;font-size:13.5px;color:var(--ink-2);line-height:1.45}
.stk2 .selbar .pop .into{display:flex;flex-direction:column;gap:6px;margin-top:12px}
.stk2 .selbar .pop .into label{display:flex;align-items:center;gap:10px;height:38px;padding:0 12px;border:1px solid var(--line);border-radius:11px;background:var(--ground);font-size:14px;font-weight:500;color:var(--ink);cursor:pointer;transition:border-color .15s,background .15s}
.stk2 .selbar .pop .into label:hover{border-color:var(--ink-3)}
.stk2 .selbar .pop .into label.on{border-color:var(--clay);background:#FFFBF5}
.stk2 .selbar .pop .into label i{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--line-2);display:grid;place-items:center;flex:none}
.stk2 .selbar .pop .into label.on i{border-color:var(--clay)}
.stk2 .selbar .pop .into label.on i::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--clay)}
.stk2 .selbar .pop .into label small{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.stk2 .selbar .pop .pacts{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.stk2 .selbar .pop .pacts button{color:var(--ink);background:none;border:1px solid var(--line-2);height:36px;padding:0 14px}
.stk2 .selbar .pop .pacts button:hover{background:var(--wash);color:var(--ink)}
.stk2 .selbar .pop .pacts button.go,.stk2 .selbar .pop .pacts button.danger{background:var(--clay);border-color:var(--clay);color:#fff}
.stk2 .selbar .pop .pacts button.go:hover,.stk2 .selbar .pop .pacts button.danger:hover{background:var(--clay-hi)}
.stk2 .tr.merging{animation:s2mo .5s var(--ease) forwards}
@keyframes s2mo{to{opacity:0;transform:translateY(-14px) scale(.98);max-height:0;padding-top:0;padding-bottom:0;border-top-color:transparent}}
.stk2 .scrim{position:fixed;inset:0;background:rgba(43,33,26,.28);opacity:0;pointer-events:none;transition:opacity .3s;z-index:50}
.stk2 .scrim.on{opacity:1;pointer-events:auto}
.stk2 .drawer{position:fixed;top:0;right:0;bottom:0;width:620px;max-width:100%;background:var(--ground);box-shadow:-24px 0 60px -30px rgba(43,33,26,.5);transform:translateX(100%);transition:transform .4s var(--ease);display:flex;flex-direction:column;z-index:51}
.stk2 .drawer.on{transform:none}
.stk2 .dtop{padding:24px 34px 0;display:flex;align-items:flex-start;gap:14px}
.stk2 .dtop .cat{font-size:13px;color:var(--ink-3)}
.stk2 .dtop h2{margin:2px 0 0;font-family:var(--serif);font-weight:600;font-size:30px;line-height:1.1}
.stk2 .dtop .rr{margin-left:auto;display:flex;gap:8px;align-items:center}
.stk2 .dtop .x{width:36px;height:36px;border-radius:18px;border:0;background:none;color:var(--ink-3);display:grid;place-items:center;transition:background .15s}
.stk2 .dtop .x:hover{background:var(--wash)}
.stk2 .dtop .x svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.stk2 .unitc{display:inline-flex;align-items:center;gap:6px;margin-top:8px;height:28px;padding:0 10px 0 12px;border-radius:14px;border:1px solid var(--line-2);background:var(--paper);font-size:12.5px;color:var(--ink-2);cursor:pointer;position:relative;transition:border-color .15s}
.stk2 .unitc:hover{border-color:var(--ink-3)}
.stk2 .unitc svg{width:11px;height:11px;fill:none;stroke:var(--ink-3);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.stk2 .drawer .body{flex:1;overflow:auto;padding:0 34px 70px}
.stk2 .dhero{margin-top:22px;display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap}
.stk2 .dhero .big{font-family:var(--mono);font-size:54px;font-weight:500;line-height:1;letter-spacing:-.02em}
.stk2 .dhero .big.low{color:var(--clay)}
.stk2 .dhero .big small{font-family:var(--sans);font-size:15px;color:var(--ink-3);font-weight:500;margin-left:10px;letter-spacing:0}
.stk2 .dhero .lasts{font-size:14.5px;color:var(--ink-2);padding-bottom:6px}
.stk2 .dhero .lasts b{font-weight:600;color:var(--ink)}.stk2 .dhero .lasts.warn b{color:var(--clay)}.stk2 .dhero .lasts.ok b{color:var(--sage)}
.stk2 .dhero .lasts small{display:block;font-size:12.5px;color:var(--ink-3);margin-top:2px}
.stk2 .dacts{display:flex;gap:8px;margin-top:20px;align-items:center;flex-wrap:wrap}
.stk2 .dacts .pill{color:var(--ink);border-color:var(--line-2);background:var(--paper)}
.stk2 .dacts .pill.out{color:var(--clay)}.stk2 .dacts .pill.in{color:var(--sage)}
.stk2 .dacts .pill svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.stk2 .dacts .pill svg.wa{fill:var(--wa);stroke:none}
.stk2 .since{margin-top:26px;padding:16px 18px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}
.stk2 .since h4{margin:0;font-size:12.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3)}
.stk2 .since .bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--wash);margin-top:12px}
.stk2 .since .bar i{display:block;height:100%;transition:width .7s var(--ease)}
.stk2 .since .bar .u{background:var(--clay-hi)}.stk2 .since .bar .l{background:var(--sage-hi)}
.stk2 .since .legs{display:grid;grid-template-columns:1fr 1fr 1fr;margin-top:10px;font-size:13.5px;color:var(--ink-2)}
.stk2 .since .legs b{font-family:var(--mono);font-weight:500;color:var(--ink);display:block}
.stk2 .since .legs .u b{color:var(--clay)}.stk2 .since .legs .l b{color:var(--sage)}
.stk2 .since .legs span{display:block;font-size:12px;color:var(--ink-3)}.stk2 .since .legs small{font-size:12px;color:var(--ink-3)}
.stk2 .facts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px}
.stk2 .fact{padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.stk2 .fact span{display:block;font-size:12px;color:var(--ink-3)}
.stk2 .fact b{display:block;margin-top:3px;font-size:15px;font-weight:600}.stk2 .fact b.dim{color:var(--ink-3);font-weight:500}
.stk2 .fact small{display:block;font-size:12px;color:var(--ink-3);margin-top:1px}
.stk2 .alert{margin-top:12px;display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px dashed var(--line-2);border-radius:14px;font-size:13.5px;color:var(--ink-2)}
.stk2 .alert:focus-within{border-color:var(--ink-3);background:var(--paper)}
.stk2 .alert input{width:64px;height:30px;border:1px solid var(--line-2);border-radius:8px;text-align:center;font-family:var(--mono);background:var(--paper);outline:none}
.stk2 .alert input:focus{border-color:var(--ink-2)}
.stk2 .alert .on{margin-left:auto;font-size:12.5px;color:var(--sage);font-weight:600;opacity:0;transition:opacity .2s}.stk2 .alert.set .on{opacity:1}
.stk2 .lg{margin-top:28px}
.stk2 .lg .hd{display:flex;align-items:center;gap:12px}
.stk2 .lg h4{margin:0;font-family:var(--serif);font-weight:600;font-size:19px}
.stk2 .lg .fl{margin-left:auto;display:flex;gap:4px;background:var(--wash);padding:3px;border-radius:12px}
.stk2 .lg .fl button{height:28px;padding:0 12px;border:0;border-radius:9px;background:none;font-size:13px;font-weight:500;color:var(--ink-3);transition:background .18s,color .18s}
.stk2 .lg .fl button.on{background:var(--paper);color:var(--ink);box-shadow:0 1px 2px rgba(43,33,26,.08)}
.stk2 .lg .day{margin-top:18px;font-family:var(--serif);font-weight:600;font-size:15px;color:var(--ink);padding-bottom:6px;border-bottom:1px solid var(--line)}
.stk2 .lg .day span{font-family:var(--sans);font-weight:400;font-size:12.5px;color:var(--ink-3);margin-left:8px}
.stk2 .lg .row{display:grid;grid-template-columns:1fr 90px 70px;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid var(--rule)}
.stk2 .lg .row .w{min-width:0;padding-left:6px}
.stk2 .lg .row .w b{font-weight:600;display:flex;align-items:center;gap:8px}
.stk2 .lg .row .w b i{width:8px;height:8px;border-radius:50%;flex:none}
.stk2 .lg .row.in .w b i{background:var(--sage)}.stk2 .lg .row.out .w b i{background:var(--clay-hi)}.stk2 .lg .row.adj .w b i{background:var(--amber)}
.stk2 .lg .row .w small{display:block;font-size:12.5px;color:var(--ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk2 .lg .row .q{text-align:right;font-family:var(--mono);font-size:15px;font-weight:500}
.stk2 .lg .row.in .q{color:var(--sage)}.stk2 .lg .row.out .q{color:var(--clay)}.stk2 .lg .row.adj .q{color:var(--amber)}
.stk2 .lg .row .bal{text-align:right;font-family:var(--mono);font-size:13px;color:var(--ink-3);padding-right:6px}
.stk2 .lg .empty{padding:24px 6px;color:var(--ink-3);font-size:14px}
.stk2 .emptyall{padding:48px 16px;text-align:center;color:var(--ink-3)}
.stk2 .fab{position:fixed;right:26px;bottom:26px;width:60px;height:60px;border-radius:30px;background:var(--clay);color:#fff;border:0;display:grid;place-items:center;box-shadow:0 18px 30px -14px rgba(181,71,42,.9);transition:transform .2s var(--spring),background .2s;z-index:40}
.stk2 .fab:hover{transform:scale(1.05);background:var(--clay-hi)}
.stk2 .fab svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
@media (max-width:1100px){.stk2 .wrap{padding:20px 16px 100px}.stk2 .tr{grid-template-columns:36px minmax(0,1fr) 150px max-content}.stk2 .tr .mini{display:none}.stk2 .drawer{width:100%}.stk2 .facts{grid-template-columns:1fr 1fr}}
@media (prefers-reduced-motion:reduce){.stk2 *{transition:none!important;animation:none!important}}
`

const I = {
  wa: <svg className="wa" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z" /></svg>,
  tick: <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>,
  x: <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
  ch: <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>,
  pen: <svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" /><path d="m13 7 4 4" /></svg>,
  merge: <svg viewBox="0 0 24 24"><path d="M8 6h8M8 12h8M8 18h8" /><path d="M4 6l2 2-2 2M20 14l-2 2 2 2" /></svg>,
  trash: <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
}

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

  const { data: mats = [], isLoading } = useQuery({
    queryKey: ['project_stock_material', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_material')
        .select('item_key, inventory_id, item_name, unit, on_hand, total_out, used_since, avg_rate, last_delivery_at, last_delivery_qty, last_movement_at, category, alert_qty, aliases, stock_value')
        .eq('project_id', projectId!).order('item_name')
      if (error) throw error
      return (data ?? []) as Mat[]
    },
  })

  const queueQ = useQuery({
    queryKey: ['stock_queue_count', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { count } = await supabase.from('stock_resolution_queue').select('id', { count: 'exact', head: true }).eq('project_id', projectId!)
      return count ?? 0
    },
  })
  const queueCount = queueQ.data ?? 0

  const [cat, setCat] = useState('All')
  const [onlyLow, setOnlyLow] = useState(false)
  const [q, setQ] = useState('')
  const [resolveOpen, setResolveOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [pop, setPop] = useState<'merge' | 'delete' | null>(null)
  const [mergeInto, setMergeInto] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [entry, setEntry] = useState<{ id: string; kind: 'in' | 'out'; qty: string; where: 'row' | 'drawer' } | null>(null)
  const [busyEntry, setBusyEntry] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [open, setOpen] = useState<Mat | null>(null)
  const [dfilter, setDfilter] = useState<'all' | 'in' | 'out'>('all')
  const [alertVal, setAlertVal] = useState<string>('')
  const [unitMenu, setUnitMenu] = useState(false)

  const byKey = (k: string) => mats.find((m) => m.item_key === k)
  const cats = useMemo(() => [...new Set(mats.map((m) => m.category?.trim() || 'Uncategorised'))], [mats])
  const catOf = (m: Mat) => m.category?.trim() || 'Uncategorised'
  const lowList = useMemo(() => mats.filter(isLow), [mats])
  const totalValue = mats.reduce((a, m) => a + (Number(m.stock_value) || 0), 0)
  const visible = useMemo(() => mats.filter((m) => (cat === 'All' || catOf(m) === cat) && (!onlyLow || isLow(m)) && (!q || m.item_name.toLowerCase().includes(q.toLowerCase()))), [mats, cat, onlyLow, q])
  const latest = useMemo(() => mats.map((m) => m.last_delivery_at).filter(Boolean).sort().reverse()[0] ?? null, [mats])

  // drawer ledger
  const ledger = useQuery({
    queryKey: ['stock_ledger_item', projectId, open?.item_key],
    enabled: !!open && !!projectId,
    queryFn: async () => {
      let query = supabase.from('stock_ledger').select('entry_id, direction, kind, qty, unit_rate, note, created_at, ref_type, ref_id').eq('project_id', projectId!)
      query = open!.inventory_id ? query.eq('inventory_id', open!.inventory_id) : query.is('inventory_id', null).eq('unit', open!.unit ?? '').ilike('item_name', open!.item_name)
      const { data } = await query.order('created_at', { ascending: false })
      return (data ?? []) as LEntry[]
    },
  })

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] }); if (open) qc.invalidateQueries({ queryKey: ['stock_ledger_item', projectId, open.item_key] }) }

  const saveEntry = async () => {
    if (!entry || busyEntry) return
    const m = byKey(entry.id); if (!m) return
    const val = parseFloat(entry.qty); if (!(val > 0)) return
    setBusyEntry(true)
    try {
      const { data, error } = await supabase.rpc('record_stock_movement', {
        p_org_id: orgId, p_project_id: projectId, p_item_name: m.item_name, p_unit: m.unit,
        p_qty: val, p_direction: entry.kind, p_unit_rate: entry.kind === 'in' ? (m.avg_rate ?? null) : null, p_inventory_id: m.inventory_id ?? null,
      })
      if (error || !(data as any)?.ok) throw new Error((data as any)?.error || error?.message || 'Could not record it')
      show((entry.kind === 'out' ? 'Used ' : 'Arrived: ') + fmt(val) + ' ' + (m.unit ?? '') + ' of ' + m.item_name)
      setFlashId(m.item_key); setTimeout(() => setFlashId(null), 1600)
      setEntry(null); invalidate()
    } catch (e) { show((e as Error).message || 'Could not record it', { type: 'error' }) }
    finally { setBusyEntry(false) }
  }

  const commitRename = async (m: Mat, save: boolean) => {
    const v = renameVal.trim()
    setRenameId(null)
    if (!save || !v || v === m.item_name || !m.inventory_id) return
    const { data, error } = await supabase.rpc('rename_inventory_item', { p_org_id: orgId, p_inventory_id: m.inventory_id, p_name: v })
    if (error || !(data as any)?.ok) { show((data as any)?.error || error?.message || 'Could not rename', { type: 'error' }); return }
    show('Renamed — bills that say "' + m.item_name + '" will still match')
    qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] })
  }

  const doMerge = async () => {
    const ids = [...sel]; const into = mergeInto || ids[0]
    const others = ids.filter((k) => k !== into).map(byKey).filter(Boolean) as Mat[]
    const target = byKey(into)
    if (!target?.inventory_id || others.some((o) => !o.inventory_id)) { show('These rows aren\'t tracked yet — resolve them first', { type: 'error' }); return }
    try {
      for (const o of others) await supabase.rpc('merge_inventory_items', { p_org_id: orgId, p_from: o.inventory_id, p_into: target.inventory_id })
      show('Merged into ' + target.item_name)
      setSel(new Set()); setPop(null); setMergeInto(null)
      qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] })
    } catch (e) { show((e as Error).message || 'Could not merge', { type: 'error' }) }
  }

  const doDelete = async () => {
    const ids = [...sel].map(byKey).filter(Boolean) as Mat[]
    try {
      for (const m of ids) { if (m.inventory_id) await supabase.rpc('delete_inventory_item', { p_org_id: orgId, p_inventory_id: m.inventory_id }) }
      show('Deleted ' + (ids.length === 1 ? ids[0].item_name : ids.length + ' materials'))
      setSel(new Set()); setPop(null)
      qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] })
    } catch (e) { show((e as Error).message || 'Could not delete', { type: 'error' }) }
  }

  const saveAlert = async (m: Mat, v: string) => {
    if (!m.inventory_id) return
    const n = parseFloat(v) || 0
    await supabase.rpc('set_material_alert', { p_org_id: orgId, p_inventory_id: m.inventory_id, p_alert: n })
    qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] })
    show(n > 0 ? 'You\'ll hear when ' + m.item_name + ' drops below ' + fmt(n) + ' ' + (m.unit ?? '') : 'Alert cleared')
  }

  const changeUnit = async (m: Mat, u: string) => {
    setUnitMenu(false)
    if (!m.inventory_id) return
    await supabase.rpc('set_material_unit', { p_org_id: orgId, p_inventory_id: m.inventory_id, p_unit: u })
    show(m.item_name + ' is now counted in ' + u)
    qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] })
    setOpen((o) => (o ? { ...o, unit: u } : o))
  }

  useEffect(() => { if (open) { const fresh = mats.find((m) => m.item_key === open.item_key); if (fresh) setOpen(fresh) } }, [mats]) // eslint-disable-line
  useEffect(() => { if (open) setAlertVal(open.alert_qty ? String(open.alert_qty) : '') }, [open?.item_key]) // eslint-disable-line

  const toggleSel = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const stepEntry = (d: number) => setEntry((e) => (e ? { ...e, qty: String(Math.max(0, (parseFloat(e.qty) || 0) + d)) } : e))

  const heroTotal = inr(totalValue)

  return (
    <div className="stk2">
      <style>{CSS}</style>
      <div className="wrap">
        <header className="top">
          <div>
            <h1>Stock</h1>
            <div className="hero">
              <div className="big"><span>{heroTotal}</span><small>on site · {project?.name ?? 'this site'}</small></div>
              <div className="sub">
                <span><b>{mats.length}</b> materials</span><span className="sep">·</span>
                <span className={lowList.length ? 'low' : ''}><b>{lowList.length}</b> running low</span><span className="sep">·</span>
                <span>last delivery <b>{latest ? dstr(latest) : '—'}</b></span>
              </div>
            </div>
          </div>
          <div className="acts">
            <button className="btn" onClick={() => show('Sends the site a WhatsApp asking for today\'s count — coming soon')}>{I.wa}Ask for a count</button>
            <button className="btn pri" onClick={() => show('New-material form — coming soon')}>{I.plus}New material</button>
          </div>
        </header>

        {(queueCount > 0 || lowList.length > 0) && (
          <section className="needs">
            {queueCount > 0 && (
              <div className="line">
                <span className="ic clay"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h6M9 16h6" /></svg></span>
                <span><b>{queueCount} arrival{queueCount === 1 ? '' : 's'}</b> came in without a clear material — we couldn't place {queueCount === 1 ? 'it' : 'them'} for sure</span>
                <a onClick={() => setResolveOpen(true)}>Sort {queueCount === 1 ? 'it' : 'them'}</a>
              </div>
            )}
            {lowList.length > 0 && (
              <div className="line">
                <span className="ic amber"><svg viewBox="0 0 24 24"><path d="M12 3v11" /><path d="m7 9 5 5 5-5" /><path d="M4 20h16" /></svg></span>
                <span><b>{lowList.slice(0, 3).map((m) => m.item_name).join(', ')}</b>{lowList.length > 3 ? ` +${lowList.length - 3}` : ''} {lowList.length === 1 ? 'is' : 'are'} running low</span>
                <a onClick={() => navigate(`/projects/${projectId}`)}>Raise a PO</a>
              </div>
            )}
          </section>
        )}

        <div className="filters">
          <button className={`chip${cat === 'All' ? ' on' : ''}`} onClick={() => setCat('All')}>All<em>{mats.length}</em></button>
          {cats.map((c) => <button key={c} className={`chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c}<em>{mats.filter((m) => catOf(m) === c).length}</em></button>)}
          <button className={`chip${onlyLow ? ' on' : ''}`} onClick={() => setOnlyLow((v) => !v)}>Running low<em>{lowList.length}</em></button>
          <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input placeholder="Search materials" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>

        <section className={`ledger${sel.size ? ' has-sel' : ''}`}>
          {isLoading ? <div className="emptyall">Loading stock…</div>
            : mats.length === 0 ? <div className="emptyall">No stock yet. When goods are received at this site, they appear here.</div>
            : (cat === 'All' ? cats : [cat]).map((c) => {
              const its = visible.filter((m) => catOf(m) === c)
              if (!its.length) return null
              const val = its.reduce((a, m) => a + (Number(m.stock_value) || 0), 0)
              return (
                <div key={c}>
                  <div className="grp"><h3>{c}<span>{its.length} {its.length === 1 ? 'material' : 'materials'}</span></h3><span className="r">{val ? <><b>{inr(val)}</b> on site</> : ''}</span></div>
                  <div className="card">
                    {its.map((m) => {
                      const low = isLow(m), lt = lasts(m), s = m.on_hand
                      const li = m.last_delivery_qty ?? 0, us = m.used_since ?? 0
                      const isRen = renameId === m.item_key
                      const ent = entry && entry.id === m.item_key && entry.where === 'row' ? entry : null
                      return (
                        <div className={`tr${low ? ' low' : ''}${sel.has(m.item_key) ? ' sel' : ''}${flashId === m.item_key ? ' flash' : ''}`} key={m.item_key}
                          onClick={(e) => { const el = e.target as HTMLElement; if (el.closest('button,input,label,.entry')) return; setOpen(m) }}>
                          <span className="lead">
                            <span className="av">{initials(m.item_name)}</span>
                            <label className="pick" onClick={(e) => e.stopPropagation()}><input type="checkbox" style={{ position: 'absolute', opacity: 0 }} checked={sel.has(m.item_key)} onChange={() => toggleSel(m.item_key)} /><span className="box">{I.tick}</span></label>
                          </span>
                          <div className="nm">
                            {isRen
                              ? <b><input className="rn" autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onBlur={() => commitRename(m, true)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(m, true) } else if (e.key === 'Escape') setRenameId(null) }} /></b>
                              : <b><span className="txt">{m.item_name}</span>{m.inventory_id && <button className="pen" onClick={(e) => { e.stopPropagation(); setRenameId(m.item_key); setRenameVal(m.item_name) }}>{I.pen}</button>}</b>}
                            <span>{low && <b className="low">Running low</b>}{low && lt ? ' · ' : ''}{lt ? <b className={lt.kind === 'new' ? 'new' : lt.kind === 'ok' ? 'ok' : ''}>{lt.text}</b> : (!low ? 'Nothing has arrived yet' : '')}{lt && lt.kind !== 'dim' && lt.kind !== 'new' ? ' · ' + lt.sub : ''}</span>
                          </div>
                          <div className="mini">{li ? <><div className="bar"><i className="u" style={{ width: Math.min(100, us / li * 100) + '%' }} /><i className="l" style={{ width: Math.max(0, (li - us) / li * 100) + '%' }} /></div><small>arrived <b>{fmt(li)}</b> · used <b>{fmt(us)}</b> since {dstr(m.last_delivery_at)}</small></> : <small>—</small>}</div>
                          <div className="st"><b className={low ? 'low' : ''}>{fmt(s)}</b><span>{m.unit}</span><small>{m.last_delivery_at ? 'last ' + dstr(m.last_delivery_at) : ''}</small></div>
                          <div className="ac" onClick={(e) => e.stopPropagation()}>
                            {ent ? (
                              <div className={`entry ${ent.kind}`}>
                                <span className="k">{ent.kind === 'out' ? '− Used' : '+ Arrived'}</span>
                                <button className="stp" onClick={() => stepEntry(-1)}>−</button>
                                <input autoFocus inputMode="decimal" placeholder="how many" value={ent.qty} onChange={(e) => setEntry({ ...ent, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEntry() } else if (e.key === 'Escape') setEntry(null) }} />
                                <button className="stp" onClick={() => stepEntry(1)}>+</button>
                                <span className="u">{m.unit}</span>
                                <button className={`save${parseFloat(ent.qty) > 0 ? ' ready' : ''}`} disabled={busyEntry} onClick={saveEntry}>{I.tick}</button>
                                <button className="x" onClick={() => setEntry(null)}>{I.x}</button>
                              </div>
                            ) : (
                              <>
                                <button className="pill out" onClick={() => setEntry({ id: m.item_key, kind: 'out', qty: '', where: 'row' })}>− Used</button>
                                <button className="pill in" onClick={() => setEntry({ id: m.item_key, kind: 'in', qty: '', where: 'row' })}>+ Arrived</button>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          {!isLoading && mats.length > 0 && visible.length === 0 && <div className="emptyall">Nothing matches. Clear the filters to see all {mats.length} materials.</div>}
        </section>
      </div>

      {/* selection bar */}
      <div className={`selbar${sel.size ? ' on' : ''}`}>
        {sel.size > 0 && (<>
          <span className="n"><b>{sel.size}</b> selected</span>
          <button disabled={sel.size < 2} onClick={() => { setPop(pop === 'merge' ? null : 'merge'); setMergeInto(null) }}>{I.merge}Merge</button>
          <button disabled={sel.size !== 1} onClick={() => { const k = [...sel][0]; const m = byKey(k); setSel(new Set()); setPop(null); if (m) { setRenameId(k); setRenameVal(m.item_name) } }}>{I.pen}Edit</button>
          <button className="del" onClick={() => setPop(pop === 'delete' ? null : 'delete')}>{I.trash}Delete</button>
          <span className="sep" /><button className="xb" onClick={() => { setSel(new Set()); setPop(null) }}>{I.x}</button>
          {pop === 'merge' && (() => {
            const ms = [...sel].map(byKey).filter(Boolean) as Mat[]; const into = mergeInto || ms[0]?.item_key
            return (
              <div className="pop">
                <h5>Merge {ms.length} materials into one</h5>
                <p>Their ledgers combine, stock adds up, and the other names are kept as aliases so future bills still match.</p>
                <div className="into">{ms.map((m) => <label key={m.item_key} className={m.item_key === into ? 'on' : ''} onClick={() => setMergeInto(m.item_key)}><i />{m.item_name}<small>{fmt(m.on_hand)} {m.unit}</small></label>)}</div>
                <div className="pacts"><button onClick={() => setPop(null)}>Cancel</button><button className="go" onClick={doMerge}>Merge into {byKey(into || '')?.item_name}</button></div>
              </div>
            )
          })()}
          {pop === 'delete' && (() => {
            const ms = [...sel].map(byKey).filter(Boolean) as Mat[]; const withStock = ms.filter((m) => m.on_hand > 0)
            return (
              <div className="pop">
                <h5>Delete {ms.length === 1 ? ms[0].item_name : ms.length + ' materials'}?</h5>
                <p>{withStock.length ? withStock.map((m) => m.item_name + ' still shows ' + fmt(m.on_hand) + ' ' + m.unit).join('; ') + '. This removes the material and its movements at this site.' : 'Nothing is in stock, so nothing is lost.'}</p>
                <div className="pacts"><button onClick={() => setPop(null)}>Keep</button><button className="danger" onClick={doDelete}>Yes, delete</button></div>
              </div>
            )
          })()}
        </>)}
      </div>

      {/* drawer */}
      <div className={`scrim${open ? ' on' : ''}`} onClick={() => { setOpen(null); setEntry(null); setUnitMenu(false) }} />
      <aside className={`drawer${open ? ' on' : ''}`} aria-hidden={!open}>
        {open && (() => {
          const m = open, s = m.on_hand, low = isLow(m), lt = lasts(m), ar = m.avg_rate ?? 0
          const li = m.last_delivery_qty ?? 0, us = m.used_since ?? 0
          const raw = ledger.data ?? []
          let bal = s; const withBal = raw.map((e) => { const r = { ...e, bal }; bal += e.direction === 'in' ? -e.qty : e.qty; return r } ).filter((e) => dfilter === 'all' || (dfilter === 'in' ? e.direction === 'in' : e.direction === 'out'))
          const days = [...new Set(withBal.map((e) => e.created_at.slice(0, 10)))]
          const ent = entry && entry.id === m.item_key && entry.where === 'drawer' ? entry : null
          return (
            <>
              <div className="dtop">
                <div>
                  <div className="cat">{catOf(m)}{m.aliases && m.aliases.length ? ' · also called ' + m.aliases.slice(0, 3).join(', ') : ''}</div>
                  <h2>{m.item_name}</h2>
                  <span className="unitc" onClick={() => setUnitMenu((v) => !v)} style={{ position: 'relative' }}>counted in {m.unit}{I.ch}
                    {unitMenu && <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 5, background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 12, padding: 6, boxShadow: '0 18px 40px -20px rgba(43,33,26,.5)', minWidth: 140 }} onClick={(e) => e.stopPropagation()}>
                      {UNITS.map((u) => <button key={u} onClick={() => changeUnit(m, u)} style={{ display: 'flex', width: '100%', height: 32, padding: '0 10px', border: 0, background: u === m.unit ? 'var(--wash)' : 'none', borderRadius: 8, fontSize: 13.5, textAlign: 'left', alignItems: 'center', cursor: 'pointer' }}>{u}</button>)}
                    </div>}
                  </span>
                </div>
                <div className="rr"><button className="btn" onClick={() => { setRenameId(m.item_key); setRenameVal(m.item_name); setOpen(null) }}>Edit</button><button className="x" onClick={() => { setOpen(null); setEntry(null); setUnitMenu(false) }}>{I.x}</button></div>
              </div>
              <div className="body">
                <div className="dhero"><div className={`big${low ? ' low' : ''}`}>{fmt(s)}<small>{m.unit}{low ? ' · running low' : ' on site'}</small></div>
                  {lt && <div className={`lasts ${lt.kind === 'low' ? 'warn' : lt.kind === 'ok' || lt.kind === 'new' ? 'ok' : ''}`}><b>{lt.text}</b><small>{lt.sub}</small></div>}
                </div>
                <div className="dacts">
                  {ent ? (
                    <div className={`entry ${ent.kind}`}>
                      <span className="k">{ent.kind === 'out' ? '− Used' : '+ Arrived'}</span>
                      <button className="stp" onClick={() => stepEntry(-1)}>−</button>
                      <input autoFocus inputMode="decimal" placeholder="how many" value={ent.qty} onChange={(e) => setEntry({ ...ent, qty: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEntry() } else if (e.key === 'Escape') setEntry(null) }} />
                      <button className="stp" onClick={() => stepEntry(1)}>+</button>
                      <span className="u">{m.unit}</span>
                      <button className={`save${parseFloat(ent.qty) > 0 ? ' ready' : ''}`} disabled={busyEntry} onClick={saveEntry}>{I.tick}</button>
                      <button className="x" onClick={() => setEntry(null)}>{I.x}</button>
                    </div>
                  ) : (<>
                    <button className="pill out" onClick={() => setEntry({ id: m.item_key, kind: 'out', qty: '', where: 'drawer' })}>− Used</button>
                    <button className="pill in" onClick={() => setEntry({ id: m.item_key, kind: 'in', qty: '', where: 'drawer' })}>+ Arrived</button>
                  </>)}
                  <button className="pill" onClick={() => show('Sent the site a WhatsApp: “How much ' + m.item_name + ' is on site now?” — coming soon')}>{I.wa}Ask for a count</button>
                </div>
                {m.last_delivery_at && (
                  <div className="since"><h4>Since the last delivery · {dstr(m.last_delivery_at)}</h4>
                    <div className="bar"><i className="u" style={{ width: Math.min(100, li ? us / li * 100 : 0) + '%' }} /><i className="l" style={{ width: Math.max(0, li ? (li - us) / li * 100 : 0) + '%' }} /></div>
                    <div className="legs"><div><span>Arrived</span><b>{fmt(li)} {m.unit}</b></div><div className="u" style={{ textAlign: 'center' }}><span>Used</span><b>{fmt(us)} {m.unit}</b><small>{li ? Math.round(us / li * 100) + '% of it' : ''}</small></div><div className="l" style={{ textAlign: 'right' }}><span>Left from it</span><b>{fmt(Math.max(0, li - us))} {m.unit}</b></div></div>
                  </div>
                )}
                <div className="facts">
                  <div className="fact"><span>Average rate</span>{ar ? <><b>{inr(ar)} / {m.unit}</b></> : <b className="dim">Not on the bill</b>}</div>
                  <div className="fact"><span>Value on site</span>{ar ? <><b>{inr(ar * s)}</b><small>{fmt(s)} × {inr(ar)}</small></> : <b className="dim">—</b>}</div>
                  <div className="fact"><span>Used since delivery</span><b>{fmt(us)} {m.unit}</b></div>
                </div>
                <div className={`alert${(m.alert_qty ?? 0) > 0 ? ' set' : ''}`}>Tell me when it drops below <input inputMode="numeric" value={alertVal} onChange={(e) => setAlertVal(e.target.value)} onBlur={() => saveAlert(m, alertVal)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /> {m.unit}<span className="on">✓ on</span></div>
                <div className="lg">
                  <div className="hd"><h4>What came and went</h4><div className="fl">{(['all', 'in', 'out'] as const).map((f) => <button key={f} className={dfilter === f ? 'on' : ''} onClick={() => setDfilter(f)}>{f === 'all' ? 'All' : f === 'in' ? 'Arrived' : 'Used'}</button>)}</div></div>
                  {ledger.isLoading ? <div className="empty">Loading…</div>
                    : days.length === 0 ? <div className="empty">Nothing here yet.</div>
                    : days.map((day) => (
                      <div key={day}>
                        <div className="day">{dstr(day)}{day === new Date().toISOString().slice(0, 10) ? <span>today</span> : ''}</div>
                        {withBal.filter((e) => e.created_at.slice(0, 10) === day).map((e) => {
                          const isIn = e.direction === 'in', adj = e.kind === 'adjustment'
                          const sub = isIn ? (e.ref_id ? e.ref_id : 'manual, no bill') + (e.unit_rate ? ' · ' + inr(e.unit_rate) + '/' + (m.unit ?? '') : '') : (e.note || 'entered')
                          return <div className={`row ${adj ? 'adj' : e.direction}`} key={e.entry_id}><div className="w"><b><i />{isIn ? 'Arrived' : adj ? 'Adjusted' : 'Used'}</b><small>{sub}</small></div><div className="q">{isIn ? '+' : '−'}{fmt(e.qty)}</div><div className="bal">{fmt(e.bal)}</div></div>
                        })}
                      </div>
                    ))}
                </div>
              </div>
            </>
          )
        })()}
      </aside>

      <BillResolvePanel open={resolveOpen} onClose={() => setResolveOpen(false)} orgId={orgId} projectId={projectId!} onResolved={() => { qc.invalidateQueries({ queryKey: ['project_stock_material', projectId] }); qc.invalidateQueries({ queryKey: ['stock_queue_count', projectId] }) }} />
    </div>
  )
}
