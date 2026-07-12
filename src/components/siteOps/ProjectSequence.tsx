// ProjectSequence — the engine-driven sequence view, ported from the approved siteops_final.html
// at full fidelity and wired to the REAL engine + React Query data flow.
//
// ONE ENGINE: renders the ProjectVM that buildProjectVM emits (src/lib/siteOps/engine); recomputes
// NOTHING about status / ordering / why / freedom / %. Drag legality is a thin renderer over
// engine-supplied hardPreds/hardDeps. This file contains no constraint ruleset of its own.
//
// ONE TASK COMPONENT: tapping a task opens the SHARED <TaskDetail> (the same surface the List view
// uses) in a right-side slide-in drawer — operational features first, engine context below. There
// is no Sequence-only task panel. Drag is DISPLAY-ONLY (dry-run); persist is Step-5.
//
// The timeline CSS is scoped under `.sov` (dark theme); the drawer is the app's light theme.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { buildProjectVM, LIBRARY, fanOutQc } from '../../lib/siteOps/engine'
import { inferUnitNames, type NameFloor } from '../../lib/siteOps/unitNaming'
import type { BlockVM, FloorVM, ProjectVM, TaskVM } from '../../lib/siteOps/engine'
import TaskDetail, { type Task, type EngineCtx } from './TaskDetail'

// ── scoped stylesheet (the approved design; every selector under `.sov`) ──────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;450;500;600&display=swap');
.sov{--bg:#0e0e10;--bg2:#141417;--surf:#19191d;--surf2:#202026;--line:#2a2a31;--line2:#34343c;
 --ink:#f4f3f1;--ink2:#a8a6a3;--mut:#6c6a68;--accent:#e0734a;--accent-soft:rgba(224,115,74,.14);
 --struct:#7b8794;--serv:#c98a52;--fin:#6b9bc4;--done:#5f8a5f;--warn:#d4a23c;--dest:#e08a4a;--imp:#d8635a;
 --ease:cubic-bezier(.22,.61,.36,1);
 background:radial-gradient(120% 70% at 50% 0%,#16161a 0%,var(--bg) 55%);color:var(--ink);
 font-family:'Inter',sans-serif;font-size:15px;line-height:1.5;border-radius:16px;padding:4px 0 28px;overflow:hidden;position:relative}
.sov *{box-sizing:border-box;margin:0;padding:0}
.sov .wrap{max-width:660px;margin:0 auto;padding:0 22px}
.sov header{padding:24px 0 4px;display:flex;align-items:flex-start;justify-content:space-between}
.sov .name{font-family:'Fraunces',serif;font-size:24px;font-weight:500;letter-spacing:-.01em;line-height:1.1}
.sov .meta{font-size:13px;color:var(--mut);margin-top:5px}
.sov .h-r{text-align:right}.sov .h-r .big{font-family:'Fraunces',serif;font-size:24px;font-weight:500;font-variant-numeric:tabular-nums}
.sov .h-r .lbl{font-size:10.5px;color:var(--mut);text-transform:uppercase;letter-spacing:.12em;margin-top:1px}
.sov .dryflag{display:inline-block;margin-left:8px;font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--warn);border:1px solid rgba(212,162,60,.4);border-radius:5px;padding:2px 6px;vertical-align:middle}
.sov .tl{margin:22px 0 4px}
.sov .tl-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
.sov .tl-h .l{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--ink2)}
.sov .tl-h .r{font-size:12.5px;color:var(--mut)}.sov .tl-h .r b{color:var(--ink);font-weight:500}
.sov .vp{position:relative;height:136px;overflow:hidden}
.sov .ground{position:absolute;left:0;right:0;bottom:38px;height:1px;background:linear-gradient(90deg,transparent,var(--line2) 12%,var(--line2) 88%,transparent);z-index:0}
.sov .ground::after{content:'';position:absolute;left:0;right:0;top:1px;height:8px;background:linear-gradient(180deg,rgba(0,0,0,.18),transparent)}
.sov .nowm{position:absolute;left:50%;top:8px;bottom:38px;width:0;border-left:1.5px dashed rgba(224,115,74,.55);transform:translateX(-50%);z-index:3}
.sov .nowm::after{content:'TODAY';position:absolute;top:-3px;left:50%;transform:translateX(-50%);font-size:7.5px;font-weight:700;letter-spacing:.16em;color:var(--accent)}
.sov .nowm::before{content:'';position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px 1px rgba(224,115,74,.6)}
/* the building is laid out to FIT every floor across the width (no sliding); flex:1 stops share the
   space evenly and shrink to fit any count / screen, with room at the edges for the nav arrows. */
.sov .track{position:absolute;left:0;right:0;bottom:38px;display:flex;align-items:flex-end;justify-content:center;padding:0 24px;z-index:2}
.sov .stop{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;cursor:pointer;position:relative}
/* floor stack — a glass tower per floor: frosted unbuilt volume, gradient built fill, a roof cap
   sheen, and a floor-slab plate at the base that reads architecturally. */
.sov .bar{width:min(44px,82%);position:relative;display:flex;flex-direction:column-reverse;overflow:hidden;will-change:transform;transform-origin:bottom center;
  border-radius:7px 7px 2px 2px;border:1px solid var(--line);border-bottom:none;
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.012));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 1px 0 0 rgba(255,255,255,.03)}
.sov .bar .ghost{position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:7px 7px 0 0;
  background:repeating-linear-gradient(180deg,transparent 0 12px,rgba(255,255,255,.05) 12px 12.6px)}
.sov .bar .cap{position:absolute;top:0;left:0;right:0;height:4px;z-index:3;pointer-events:none;border-radius:7px 7px 0 0;
  background:linear-gradient(180deg,rgba(255,255,255,.18),transparent)}
.sov .seg{width:100%;position:relative;z-index:1;transition:height 1s var(--ease);box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
.sov .seg.struct{background:linear-gradient(180deg,#9aa7b5,#5c6672)}
.sov .seg.serv{background:linear-gradient(180deg,#e2ab70,#9e6838)}
.sov .seg.fin{background:linear-gradient(180deg,#92b9e0,#4b769f)}
.sov .seg.done{background:linear-gradient(180deg,#80ab80,#4c714c)}
.sov .plate{position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:min(53px,118%);height:3px;border-radius:2px;z-index:4;
  background:linear-gradient(90deg,transparent,var(--line2) 18%,var(--line2) 82%,transparent)}
.sov .stop .nm{position:absolute;bottom:-24px;left:50%;transform:translateX(-50%);font-size:10.5px;color:var(--mut);font-weight:500;white-space:nowrap;letter-spacing:.01em}
.sov .stop .pc{position:absolute;bottom:-37px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--mut);font-variant-numeric:tabular-nums;opacity:.85}
/* mobile: shrink the towers + labels so every floor and its stages still fit edge to edge */
@media (max-width:600px){
  .sov .track{padding:0 14px}
  .sov .bar{width:min(30px,88%)}
  .sov .plate{width:min(34px,112%)}
  .sov .stop .nm{font-size:8px;bottom:-21px;letter-spacing:0}
  .sov .stop .pc{font-size:7px;bottom:-31px}
}
.sov .leg{display:flex;gap:15px;margin-top:8px;font-size:10.5px;color:var(--mut);justify-content:center}
.sov .leg span{display:flex;align-items:center;gap:6px}.sov .lw{width:9px;height:9px;border-radius:3px}
.sov .lw.s{background:var(--struct)}.sov .lw.v{background:var(--serv)}.sov .lw.f{background:var(--fin)}.sov .lw.d{background:var(--done)}
.sov .hint{text-align:center;font-size:10.5px;color:var(--mut);margin-top:7px;font-style:italic;opacity:.8}
.sov .fd-h{display:flex;align-items:baseline;gap:11px;margin:26px 0 16px;padding:0 1px}
.sov .fd-name{font-family:'Fraunces',serif;font-size:21px;font-weight:500;letter-spacing:-.01em}
.sov .fd-blocks{font-size:12px;color:var(--mut);margin-left:auto}
.sov .blk{background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:17px 17px 8px;margin-bottom:14px}
.sov .blk-h{display:flex;align-items:center;gap:9px;margin-bottom:15px}
.sov .blk-n{font-size:14px;font-weight:600;letter-spacing:-.005em}
.sov .blk-n-edit-able{cursor:text;border-radius:5px;padding:1px 4px;margin:-1px -4px;transition:background .15s}
.sov .blk-n-edit-able:hover{background:var(--surf2)}
.sov .blk-edit-hint{margin-left:5px;font-size:10px;color:var(--mut);opacity:0;transition:.15s}
.sov .blk-n-edit-able:hover .blk-edit-hint{opacity:.6}
.sov .blk-n-edit{font-size:14px;font-weight:600;letter-spacing:-.005em;border:1px solid var(--imp);border-radius:6px;padding:2px 7px;outline:none;background:var(--surf);color:var(--ink);width:120px}
.sov .blk-s{font-size:11.5px;color:var(--mut);margin-left:auto;font-variant-numeric:tabular-nums}
.sov .lbars{display:flex;flex-direction:column;gap:7px;margin-bottom:4px}
.sov .lbar{display:flex;align-items:center;gap:10px}.sov .lbar .n{width:62px;font-size:11px;color:var(--mut)}
.sov .lbar .t{flex:1;height:3px;background:var(--line);border-radius:99px;overflow:hidden}
.sov .lbar .f{height:100%;border-radius:99px;transition:width 1s var(--ease)}
.sov .lbar .p{width:30px;text-align:right;font-size:10.5px;color:var(--mut);font-variant-numeric:tabular-nums}
.sov .lsec{margin-top:18px}.sov .lsec-h{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.sov .ldot{width:6px;height:6px;border-radius:50%}.sov .lname{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--ink2)}
.sov .lfree{font-size:10px;color:var(--fin);opacity:.8}.sov .lrule{flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
.sov .lcount{font-size:10.5px;color:var(--mut);font-variant-numeric:tabular-nums}
.sov .task{display:flex;align-items:center;gap:12px;padding:9px 4px;border-radius:8px;transition:background .18s;cursor:pointer}
.sov .task:hover{background:var(--surf2)}.sov .grip{width:11px;color:var(--mut);font-size:11px;opacity:0;cursor:grab;transition:.15s;flex-shrink:0}
.sov .task:hover .grip{opacity:.4}
.sov .node{width:18px;height:18px;flex-shrink:0;position:relative;display:flex;align-items:center;justify-content:center}
.sov .ring{width:15px;height:15px;border-radius:50%;border:1.5px solid var(--line2);transition:.3s}
.sov .t-available .ring{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.sov .t-active .ring{border-color:var(--accent);background:conic-gradient(var(--accent) 0 60%,transparent 60%)}
.sov .t-active .node::after{content:'';position:absolute;width:4px;height:4px;border-radius:50%;background:var(--accent);animation:sovtp 2s ease-in-out infinite}
@keyframes sovtp{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
.sov .t-done .ring{border-color:var(--done);background:var(--done)}
.sov .t-done .node::after{content:'✓';position:absolute;color:#fff;font-size:9px;font-weight:700}
.sov .t-blocked .ring{border-color:var(--line2);border-style:dashed;opacity:.6}
.sov .tn{font-size:13.5px;font-weight:450;letter-spacing:-.005em}.sov .t-done .tn,.sov .t-blocked .tn{color:var(--mut)}
.sov .tg{flex:1}.sov .taf{font-size:11px;color:var(--mut)}.sov .taf b{color:var(--ink2);font-weight:500}
.sov .ttr{font-size:9.5px;color:var(--mut);letter-spacing:.03em}
.sov .trv{font-size:8.5px;font-weight:700;letter-spacing:.06em;color:var(--warn);border:1px solid rgba(212,162,60,.4);border-radius:4px;padding:1px 4px;margin-left:6px}
.sov .reveal{width:100%;padding:9px;margin:6px 0 4px;font-size:11.5px;color:var(--ink2);background:transparent;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-family:inherit;transition:.2s}
.sov .reveal:hover{border-color:var(--line2);background:var(--surf2);color:var(--ink)}
/* add-task-here: a thin Notion-style insert line (a "+" with a hairline) that surfaces in the gap
   below a task on hover; clicking opens an inline composer. */
.sov .task-wrap{position:relative}
.sov .add-here{position:absolute;left:14px;right:6px;bottom:-7px;height:14px;z-index:3;display:flex;align-items:center;gap:10px;justify-content:center;background:transparent;border:none;padding:0;cursor:pointer;opacity:0;transition:opacity .12s}
.sov .task-wrap:hover .add-here{opacity:1}
.sov .ah-line{flex:1;height:1.5px;border-radius:2px;background:var(--accent);opacity:.4;transition:opacity .12s}
.sov .ah-label{font-size:10px;font-weight:600;letter-spacing:.02em;color:var(--accent);white-space:nowrap;flex-shrink:0}
.sov .add-here:hover .ah-line{opacity:.7}
.sov .add-composer{display:flex;align-items:center;gap:8px;padding:7px 4px;animation:sovfade .18s ease}
.sov .add-composer .node{width:18px;flex-shrink:0;display:flex;justify-content:center}
.sov .add-composer input{flex:1;min-width:0;background:var(--surf2);border:1px solid var(--line2);border-radius:8px;padding:8px 11px;color:var(--ink);font-size:13px;font-family:inherit;outline:none}
.sov .add-composer input:focus{border-color:var(--accent)}
.sov .add-composer button{font-size:12px;font-weight:600;padding:7px 13px;border-radius:8px;border:none;background:var(--accent);color:#fff;cursor:pointer;flex-shrink:0}
.sov .add-composer button:disabled{opacity:.4;cursor:default}
.sov .add-composer button.ghost{background:transparent;color:var(--mut);border:1px solid var(--line2)}
@keyframes sovfade{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.sov .task-manual .ring{border-style:dashed}
.sov .man-tag{margin-left:8px;font-size:8.5px;font-weight:800;letter-spacing:.06em;color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:1px 5px;opacity:.85}
.sov .man-del{opacity:0;margin-left:6px;width:18px;height:18px;flex-shrink:0;border:none;background:transparent;color:var(--mut);font-size:11px;cursor:pointer;border-radius:50%}
.sov .task-manual:hover .man-del{opacity:.5}
.sov .man-del:hover{opacity:1;color:var(--imp)}
.sov .task-x{opacity:0;margin-left:6px;width:18px;height:18px;flex-shrink:0;border:none;background:transparent;color:var(--mut);font-size:12px;cursor:pointer;border-radius:50%;transition:.15s}
.sov .task:hover .task-x{opacity:.45}
.sov .task-x:hover{opacity:1;color:var(--imp);background:var(--surf2)}
.sov .sup-strip{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--line)}
.sov .sup-strip .lbl{font-size:11px;color:var(--mut)}
.sov .sup-chip{font-size:11.5px;color:var(--mut);background:var(--surf2);border:1px solid var(--line);border-radius:20px;padding:3px 9px;cursor:pointer}
.sov .sup-chip:hover{color:var(--ink);border-color:var(--mut)}
.sov .reveal-done{color:var(--done);border-color:transparent;background:rgba(95,138,95,0.07);text-align:left;font-weight:600}
.sov .reveal-done:hover{color:var(--done);border-color:rgba(95,138,95,0.4);background:rgba(95,138,95,0.12)}
.sov .blk-done{display:flex;align-items:center;width:100%;background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:15px 17px;margin-bottom:14px;cursor:pointer;text-align:left;transition:border-color .15s}
.sov .blk-done:hover{border-color:var(--line2)}
.sov .blk-done .blk-s{margin-left:auto}
.sov .task.dragging{opacity:.35}
.sov .task.d-ok{box-shadow:inset 0 1.5px 0 var(--done)}.sov .task.d-warn{box-shadow:inset 0 1.5px 0 var(--warn)}
.sov .task.d-dest{box-shadow:inset 0 1.5px 0 var(--dest)}.sov .task.d-forbid{box-shadow:inset 0 1.5px 0 var(--imp)}
.sov .empty{padding:60px 22px;text-align:center;color:var(--mut);font-size:14px}
.sov .tl-arrow{position:absolute;top:calc(50% - 15px);z-index:4;width:30px;height:30px;border-radius:50%;border:1px solid var(--line2);background:rgba(20,20,24,.66);backdrop-filter:blur(6px);color:var(--ink2);font-size:19px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,border-color .15s,background .15s;padding:0}
.sov .tl-arrow:hover{color:var(--accent);border-color:var(--accent);background:rgba(20,20,24,.85)}
.sov-verdict{position:fixed;z-index:1200;pointer-events:none;font-size:12.5px;font-weight:500;padding:9px 14px;border-radius:11px;opacity:0;transition:opacity .12s;max-width:250px;box-shadow:0 12px 32px -8px rgba(0,0,0,.7);backdrop-filter:blur(8px)}
.sov-verdict.show{opacity:1}
.sov-verdict.v-ok{background:rgba(40,58,40,.92);color:#a8d0a0;border:1px solid rgba(95,138,95,.5)}
.sov-verdict.v-warn{background:rgba(58,50,32,.92);color:#e8cf7a;border:1px solid rgba(212,162,60,.5)}
.sov-verdict.v-dest{background:rgba(58,44,32,.92);color:#f0b488;border:1px solid rgba(224,138,74,.5)}
.sov-verdict.v-forbid{background:rgba(58,34,34,.92);color:#f0a0a0;border:1px solid rgba(216,99,90,.5)}
.sov-verdict .vsub{font-weight:400;font-size:11px;opacity:.85;margin-top:2px}
.sov-applybar{position:fixed;left:50%;bottom:24px;transform:translate(-50%,140%);z-index:1100;display:flex;align-items:center;gap:14px;padding:12px 14px 12px 18px;border-radius:14px;background:rgba(30,30,34,.95);border:1px solid #34343c;backdrop-filter:blur(14px);box-shadow:0 16px 40px -10px rgba(0,0,0,.7);transition:transform .4s cubic-bezier(.22,.61,.36,1);max-width:calc(100% - 32px)}
.sov-applybar.show{transform:translate(-50%,0)}
.sov-applybar .at{font-size:13px;color:#f4f3f1}.sov-applybar .at b{font-weight:600}
.sov-applybar .au{font-size:11.5px;color:#6c6a68;margin-top:1px}
.sov-applybar button{font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 14px;border-radius:9px;cursor:pointer;border:none;margin-left:7px}
.sov-applybar .apply{background:#e0734a;color:#fff}.sov-applybar .dismiss{background:transparent;color:#a8a6a3;border:1px solid #34343c}
`

const STCLS: Record<string, string> = { done: 't-done', active: 't-active', available: 't-available', blocked: 't-blocked' }
const LCOL: Record<string, string> = { structure: 'var(--struct)', services: 'var(--serv)', finishes: 'var(--fin)' }
const LAYERS: [keyof BlockVM['layerPct'], string][] = [['structure', 'Structure'], ['services', 'Services'], ['finishes', 'Finishes']]
const RANK: Record<string, number> = { IMPOSSIBLE: 4, DESTRUCTIVE: 3, STRONG_PREF: 2, WEAK_PREF: 1, INDIFFERENT: 0 }

function deriveRise(n: number): number[] {
  if (n <= 1) return [88]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.round(44 + (120 - 44) * i / (n - 1)))
  return out
}

interface MoveVerdict { v: string; msg: string; sub?: string; cls: string }

/** Thin drag-legality renderer over engine-supplied hardPreds/hardDeps (NOT a UI ruleset). */
function checkMove(T: string, TGT: string, order: string[], byType: Record<string, TaskVM>): MoveVerdict | null {
  if (T === TGT) return null
  const ti = order.indexOf(TGT)
  const t = byType[T]
  let w: { pre: string; nat: string; reason: string; fwd?: boolean } | null = null
  for (const p of t.hardPreds) {
    const pi = order.indexOf(p.taskType)
    if (pi >= 0 && pi >= ti && (!w || RANK[p.nature] > RANK[w.nat])) w = { pre: p.label, nat: p.nature, reason: p.reason }
  }
  if (!w) for (const d of t.hardDeps) {
    const di = order.indexOf(d.taskType)
    if (di >= 0 && di <= ti && (!w || RANK[d.nature] > RANK[w.nat])) w = { pre: d.label, nat: d.nature, reason: d.reason, fwd: true }
  }
  if (!w) { const fs = t.freedomSet; return { v: 'ok', msg: fs ? `Free — ${fs}` : 'Fits here', cls: 'ok' } }
  const rt = ({ structural: 'structural', concealment: 'would get covered', curing_time: 'needs curing', logistics: 'access / order', quality: 'finish quality', policy: 'policy' } as Record<string, string>)[w.reason] || w.reason
  if (w.nat === 'IMPOSSIBLE') return { v: 'forbid', msg: `Needs ${w.pre} first`, sub: rt, cls: 'forbid' }
  if (w.nat === 'DESTRUCTIVE') return { v: 'dest', msg: `${w.pre} ${w.fwd ? 'depends on this' : 'must come first'}`, sub: `${rt} — costly to undo`, cls: 'dest' }
  return { v: 'warn', msg: `Usually after ${w.pre}`, sub: rt, cls: 'warn' }
}

const RICH = 'task_id, task_no, phase, trade, floor_label, unit_label, name, description, seq_no, status, source, duration_days, owner_id, owner_source, status_history, updated_at, node_key, task_type_id, site_task_qc(id, question, is_critical, seq, qc_status, answer, answered_at, source_narration_id)'

// Warm the cache for a project's view BEFORE it's opened (call on hover/focus) so selecting it shows
// the tasks instantly. Same query keys the view uses → its useQuery reads the cached data with no
// loading gate (then revalidates in the background). staleTime guards against re-hammering on hover.
// eslint-disable-next-line react-refresh/only-export-components -- prefetch helper co-located with the view it warms
export function prefetchProjectQueries(qc: QueryClient, projectId: string) {
  if (!projectId) return
  const opts = { staleTime: 30_000 }
  qc.prefetchQuery({
    queryKey: ['seq_project', projectId], ...opts,
    queryFn: async () => {
      const sel = 'name, construction_stack, has_common_areas, common_systems, suppressed_tasks, unit_labels, org_id'
      let res = await supabase.from('projects').select(sel).eq('project_id', projectId).single()
      if (res.error) res = await supabase.from('projects').select('name, construction_stack, has_common_areas, org_id').eq('project_id', projectId).single()
      if (res.error) throw res.error
      return res.data as { name?: string; construction_stack?: unknown; has_common_areas?: boolean; common_systems?: string[]; suppressed_tasks?: string[]; unit_labels?: Record<string, string[]>; org_id?: string }
    },
  })
  qc.prefetchQuery({
    queryKey: ['seq_task_status', projectId], ...opts,
    queryFn: async () => {
      const tryCols = async (cols: string) => supabase.from('site_tasks').select(cols).eq('project_id', projectId)
      let res = await tryCols('node_key, status')
      if (res.error) res = await tryCols('status')
      if (res.error) return [] as { node_key?: string | null; status?: string }[]
      return (res.data ?? []) as unknown as { node_key?: string | null; status?: string }[]
    },
  })
  qc.prefetchQuery({
    queryKey: ['project_tasks_v2', projectId], ...opts,
    queryFn: async () => {
      const { data, error } = await supabase.from('site_tasks').select(RICH).eq('project_id', projectId).order('seq_no').order('task_no')
      if (error) return [] as Task[]
      return (data ?? []) as unknown as Task[]
    },
  })
}

export default function ProjectSequence({ projectId, headerSlot }: { projectId: string; headerSlot?: React.ReactNode }) {
  const { data: project, isLoading: pLoading } = useQuery({
    queryKey: ['seq_project', projectId],
    queryFn: async () => {
      const sel = 'name, construction_stack, has_common_areas, common_systems, suppressed_tasks, unit_labels, org_id'
      let res = await supabase.from('projects').select(sel).eq('project_id', projectId).single()
      if (res.error) res = await supabase.from('projects').select('name, construction_stack, has_common_areas, org_id').eq('project_id', projectId).single()
      if (res.error) throw res.error
      return res.data as { name?: string; construction_stack?: unknown; has_common_areas?: boolean; common_systems?: string[]; suppressed_tasks?: string[]; unit_labels?: Record<string, string[]>; org_id?: string }
    },
    enabled: !!projectId,
  })

  // statuses for the VM (lightweight) …
  const { data: statusRows = [], isLoading: tLoading } = useQuery({
    queryKey: ['seq_task_status', projectId],
    queryFn: async () => {
      const tryCols = async (cols: string) => supabase.from('site_tasks').select(cols).eq('project_id', projectId)
      let res = await tryCols('node_key, status')
      if (res.error) res = await tryCols('status')
      if (res.error) return [] as { node_key?: string | null; status?: string }[]
      return (res.data ?? []) as unknown as { node_key?: string | null; status?: string }[]
    },
    enabled: !!projectId,
  })

  // … and the FULL operational rows, sharing the List view's cache key so QC/owner edits made in
  // the drawer reflect in the List instantly (and vice-versa). The drawer maps a VM task to its row.
  const { data: richRows = [] } = useQuery({
    queryKey: ['project_tasks_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_tasks').select(RICH).eq('project_id', projectId).order('seq_no').order('task_no')
      if (error) return [] as Task[]
      return (data ?? []) as unknown as Task[]
    },
    enabled: !!projectId,
  })

  const vm: ProjectVM | null = useMemo(() => {
    const stack = project?.construction_stack as { levels?: unknown[] } | undefined
    if (!stack?.levels?.length) return null
    const state = new Map<string, 'not_started' | 'active' | 'done'>()
    for (const r of statusRows) if (r.node_key && (r.status === 'active' || r.status === 'done')) state.set(r.node_key, r.status)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb stack ↔ ConstructionStack
    return buildProjectVM(projectId, stack as any, state, {
      name: project?.name ?? projectId, dryRun: true,
      hasCommonAreas: !!project?.has_common_areas, hasExternalWorks: !!project?.has_common_areas,
      commonSystems: project?.common_systems ?? [],
      suppressedTasks: project?.suppressed_tasks ?? [],
    })
  }, [projectId, project, statusRows])

  // index real rows by (task_type_id | floor | unit) so a folded VM task finds its operational row
  // index operational rows by node_key — the stable id every VM task carries (sel.t.nodeKey). This
  // is REACTIVE: ctx mutations optimistically update this cache, so the open drawer reflects status /
  // owner / cascade changes instead of showing a stale snapshot.
  const rowByKey = useMemo(() => {
    const m = new Map<string, Task>()
    for (const r of richRows) if (r.node_key) m.set(r.node_key, r)
    return m
  }, [richRows])

  if (pLoading || tLoading) return <div className="sov"><style>{CSS}</style><div className="empty">Loading…</div></div>
  if (!vm) return <div className="sov"><style>{CSS}</style><div className="empty">No construction plan yet — set up the build type to see the sequence.</div></div>
  return <SequenceView vm={vm} rowByKey={rowByKey} headerSlot={headerSlot} orgId={project?.org_id ?? ''} />
}

// ── the renderer ──────────────────────────────────────────────────────────────
function SequenceView({ vm, rowByKey, headerSlot, orgId }: { vm: ProjectVM; rowByKey: Map<string, Task>; headerSlot?: React.ReactNode; orgId: string }) {
  const FLOORS = vm.floors
  const RISE = useMemo(() => deriveRise(FLOORS.length), [FLOORS.length])
  const firstUnbuilt = FLOORS.findIndex((f) => f.pc < 100)
  const [focusIdx, setFocusIdx] = useState(firstUnbuilt < 0 ? Math.max(0, FLOORS.length - 1) : firstUnbuilt)
  const [orders, setOrders] = useState<Record<string, string[]>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<{ t: TaskVM; block: BlockVM } | null>(null)
  const [apply, setApply] = useState<{ T: string; TGT: string; targets: string[]; label: string } | null>(null)

  // Deep-link focus: the WhatsApp confirm's "View task" button links to
  // /projects/:id/tasks?task=<node_key>. Find that task in the VM, focus its floor, and open its
  // drawer — once (mirrors the Day Book "View →" focus into the Ledger).
  const didFocusTask = useRef(false)
  useEffect(() => {
    if (didFocusTask.current || !FLOORS.length) return
    const want = new URLSearchParams(window.location.search).get('task')
    if (!want) return
    for (let fi = 0; fi < FLOORS.length; fi++) {
      for (const b of FLOORS[fi].blocks) {
        const t = b.tasks.find((tk) => tk.nodeKey === want)
        if (t) { didFocusTask.current = true; setFocusIdx(fi); setSel({ t, block: b }); return }
      }
    }
  }, [FLOORS])
  const queryClient = useQueryClient()
  const [addingKey, setAddingKey] = useState<string | null>(null)

  // 'Not applicable here' — a per-project suppression list. Toggling rebuilds the VM (the engine
  // skips suppressed task-types, so dependents reflow) and is fully restorable.
  const projData = queryClient.getQueryData(['seq_project', vm.projectId]) as { suppressed_tasks?: string[]; unit_labels?: Record<string, string[]> } | undefined
  const suppressed = projData?.suppressed_tasks ?? []
  const unitLabels = projData?.unit_labels ?? {}
  const toggleSuppress = useCallback(async (taskType: string, add: boolean) => {
    const cur = (queryClient.getQueryData(['seq_project', vm.projectId]) as { suppressed_tasks?: string[] } | undefined)?.suppressed_tasks ?? []
    const next = add ? [...new Set([...cur, taskType])] : cur.filter((s) => s !== taskType)
    const { error } = await supabase.from('projects').update({ suppressed_tasks: next }).eq('project_id', vm.projectId)
    if (!error) queryClient.invalidateQueries({ queryKey: ['seq_project', vm.projectId] })
  }, [queryClient, vm.projectId])

  // Smart unit naming — type one unit's name; infer the scheme + propagate across all units/floors
  // (display-only; the engine keeps stable keys). Synthetic Foundation/Common stages are excluded.
  const renameUnit = useCallback(async (floorIndex: number, unitIndex: number, typed: string) => {
    const realFloors: NameFloor[] = FLOORS.filter((f) => f.index >= 0 && f.index < 9999).map((f) => ({ label: f.name, index: f.index, units: f.blocks.length }))
    const map = inferUnitNames(typed, floorIndex, unitIndex, realFloors)
    if (!Object.keys(map).length) return
    const cur = (queryClient.getQueryData(['seq_project', vm.projectId]) as { unit_labels?: Record<string, string[]> } | undefined)?.unit_labels ?? {}
    const { error } = await supabase.from('projects').update({ unit_labels: { ...cur, ...map } }).eq('project_id', vm.projectId)
    if (!error) queryClient.invalidateQueries({ queryKey: ['seq_project', vm.projectId] })
  }, [queryClient, vm.projectId, FLOORS])

  // user-added ("manual") tasks, grouped by the anchor they were inserted after — encoded in their
  // node_key as `manual:<afterNodeKey>::<rand>`.
  const manualByAfter = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const r of rowByKey.values()) {
      if (r.source !== 'manual' || !r.node_key?.startsWith('manual:')) continue
      const after = r.node_key.slice(7).split('::')[0]
      const arr = m.get(after); if (arr) arr.push(r); else m.set(after, [r])
    }
    return m
  }, [rowByKey])
  const addManual = (afterT: TaskVM, b: BlockVM, name: string) => {
    setAddingKey(null)
    const unit = b.name === 'Whole floor' ? null : b.name
    const nk = `manual:${afterT.nodeKey}::${Math.random().toString(36).slice(2, 9)}`
    void (async () => {
      const { error } = await supabase.from('site_tasks').insert({
        org_id: orgId, project_id: vm.projectId, node_key: nk, task_type_id: null,
        floor_label: FLOORS[focusIdx]?.name ?? null, unit_label: unit, name, seq_no: afterT.seqNo,
        phase: afterT.layer, trade: 'Added on site', status: 'not_started',
        source: 'manual', placement_source: 'authored', order_source: 'manual',
      })
      if (error) { console.error('add task:', error.message); return }
      queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', vm.projectId] })
    })()
  }
  const delManual = (r: Task) => {
    void (async () => {
      const { error } = await supabase.from('site_tasks').delete().eq('task_id', r.task_id)
      if (error) { console.error('del task:', error.message); return }
      queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', vm.projectId] })
    })()
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef<HTMLDivElement>(null)
  const vdRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef(focusIdx)
  useEffect(() => { focusRef.current = focusIdx }, [focusIdx])
  // imperative handle for the arrow buttons to drive the same scrub
  const navRef = useRef<{ goTo: (i: number) => void } | null>(null)

  // ── STATIC building: every floor is laid out to fit the width (CSS flex), nothing auto-slides. The
  //    TODAY line follows the cursor and highlights the box physically under it (hit-test on the REAL
  //    rendered positions → exact, no drift). Arrows / clicks step the focus; the line eases onto that
  //    box. Box centres are measured from the DOM, so the same code fits any floor count / screen size.
  useEffect(() => {
    const vp = vpRef.current, root = rootRef.current
    if (!vp || !root) return
    const nowm = root.querySelector<HTMLElement>('.nowm')
    let markerX = 0, tMarkerX = 0, rafOn = false, lastFocus = -1
    const W = () => vp.clientWidth
    const stopEls = Array.from(root.querySelectorAll<HTMLElement>('.stop'))
    const bars = stopEls.map((el) => el.querySelector<HTMLElement>('.bar')!)
    const nms = stopEls.map((el) => el.querySelector<HTMLElement>('.nm')!)
    const plates = stopEls.map((el) => el.querySelector<HTMLElement>('.plate')!)
    let centers: number[] = [], SP = 60
    const measure = () => {
      centers = stopEls.map((el) => el.offsetLeft + el.offsetWidth / 2)
      SP = stopEls.length > 1 ? Math.max(24, Math.abs(centers[1] - centers[0])) : W()
    }
    const nearestTo = (x: number) => { let best = 0, bd = 1e9; for (let i = 0; i < centers.length; i++) { const dd = Math.abs(centers[i] - x); if (dd < bd) { bd = dd; best = i } } return best }
    const paint = () => {
      for (let i = 0; i < stopEls.length; i++) {
        const d = Math.abs(centers[i] - markerX) / SP   // distance from the TODAY line
        const k = d > 1 ? 0 : 1 - d
        bars[i].style.transform = `scaleX(${(1 + 0.09 * k).toFixed(3)}) scaleY(${(1 + 0.13 * k).toFixed(3)})`
        bars[i].style.borderColor = k > 0.4 ? 'rgba(224,115,74,' + (0.25 + 0.6 * k).toFixed(2) + ')' : ''
        bars[i].style.boxShadow = k > 0.4 ? `0 14px 30px -12px rgba(224,115,74,${(0.55 * k).toFixed(2)})` : ''
        bars[i].style.background = k > 0.4 ? `linear-gradient(180deg,rgba(224,115,74,${(0.13 * k).toFixed(2)}),transparent)` : ''
        plates[i].style.background = k > 0.4 ? 'linear-gradient(90deg,transparent,var(--accent) 18%,var(--accent) 82%,transparent)' : ''
        plates[i].style.boxShadow = k > 0.4 ? `0 3px 12px -3px rgba(224,115,74,${(0.65 * k).toFixed(2)})` : ''
        nms[i].style.color = k > 0.4 ? 'var(--accent)' : 'var(--mut)'
        nms[i].style.fontWeight = k > 0.4 ? '600' : '500'
        stopEls[i].style.opacity = Math.max(.34, 1 - 0.32 * d).toFixed(3)
      }
      if (nowm) nowm.style.left = markerX.toFixed(1) + 'px'
    }
    const render = () => {
      paint()
      const nf = nearestTo(markerX)
      if (nf !== lastFocus) { lastFocus = nf; setFocusIdx(nf) }
    }
    // rAF runs only to ease the line onto a box after an arrow/click/leave — never to slide the building.
    const loop = () => {
      markerX += (tMarkerX - markerX) * 0.34
      if (Math.abs(tMarkerX - markerX) < 0.4) { markerX = tMarkerX; render(); rafOn = false; return }
      render(); requestAnimationFrame(loop)
    }
    const startRAF = () => { if (!rafOn) { rafOn = true; requestAnimationFrame(loop) } }
    const goTo = (i: number) => { const j = Math.max(0, Math.min(centers.length - 1, i)); setFocusIdx(j); focusRef.current = j; lastFocus = j; tMarkerX = centers[j]; startRAF() }
    navRef.current = { goTo }
    // hover → the TODAY line is exactly the cursor; the box under it focuses (real hit-test, no offset).
    const moveTo = (clientX: number) => {
      const x = Math.max(0, Math.min(W(), clientX - vp.getBoundingClientRect().left))
      markerX = tMarkerX = x
      const sel = nearestTo(x)
      if (sel !== focusRef.current) { setFocusIdx(sel); focusRef.current = sel }
      lastFocus = sel
      render()
    }
    const onMove = (e: MouseEvent) => moveTo(e.clientX)
    const onLeave = () => { tMarkerX = centers[focusRef.current] ?? markerX; startRAF() } // line settles onto the focused box
    const onTouchMove = (e: TouchEvent) => { const t = e.touches[0]; if (!t) return; moveTo(t.clientX); e.preventDefault() }
    const onTouchEnd = () => { tMarkerX = centers[focusRef.current] ?? markerX; startRAF() }
    vp.addEventListener('mousemove', onMove); vp.addEventListener('mouseleave', onLeave)
    vp.addEventListener('touchmove', onTouchMove, { passive: false })
    vp.addEventListener('touchend', onTouchEnd)
    stopEls.forEach((el, i) => { el.onclick = () => goTo(i) })
    const place = () => { measure(); markerX = tMarkerX = centers[focusRef.current] ?? 0; render() }
    const onResize = place
    window.addEventListener('resize', onResize)
    place()
    return () => {
      vp.removeEventListener('mousemove', onMove); vp.removeEventListener('mouseleave', onLeave)
      vp.removeEventListener('touchmove', onTouchMove); vp.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', onResize)
    }
  }, [FLOORS])

  const floor = FLOORS[focusIdx]
  const orderFor = (b: BlockVM): string[] => orders[b.zoneId] ?? b.tasks.map((t) => t.taskType)
  const byTypeFor = (b: BlockVM): Record<string, TaskVM> => Object.fromEntries(b.tasks.map((t) => [t.taskType, t]))

  // drag
  const dragRef = useRef<{ task: string; block: string } | null>(null)
  const showVerdict = (res: MoveVerdict | null, e: React.DragEvent) => {
    const vd = vdRef.current; if (!vd) return
    if (!res) { vd.classList.remove('show'); return }
    vd.className = 'sov-verdict show v-' + res.cls
    vd.innerHTML = `${res.msg}${res.sub ? `<div class="vsub">${res.sub}</div>` : ''}`
    vd.style.left = Math.min(e.clientX + 14, window.innerWidth - 260) + 'px'
    vd.style.top = (e.clientY + 16) + 'px'
  }
  const sameRelative = (order: string[], T: string, TGT: string) => order.indexOf(T) === order.indexOf(TGT) - 1
  const placed = (order: string[], T: string, TGT: string) => { const o = order.slice(); const f = o.indexOf(T); if (f < 0) return o; o.splice(f, 1); let t = o.indexOf(TGT); if (t < 0) t = o.length; o.splice(t, 0, T); return o }
  const commitMove = (b: BlockVM, from: string, to: string) => {
    setOrders((o) => ({ ...o, [b.zoneId]: placed(orderFor(b), from, to) }))   // DISPLAY-ONLY (dry-run)
    // offer apply-to-all when other units on this floor could take the same valid reorder
    const others = floor.blocks.filter((bb) => bb.zoneId !== b.zoneId)
    const targets = others.filter((bb) => {
      const bt = byTypeFor(bb); if (!bt[from] || !bt[to]) return false
      if (sameRelative(orderFor(bb), from, to)) return false
      const res = checkMove(from, to, orderFor(bb), bt); return !(res && res.v === 'forbid')
    }).map((bb) => bb.zoneId)
    if (targets.length) setApply({ T: from, TGT: to, targets, label: byTypeFor(b)[from]?.label ?? from }); else setApply(null)
  }
  const applyAll = () => {
    if (!apply) return
    setOrders((o) => { const next = { ...o }; for (const z of apply.targets) { const b = floor.blocks.find((bb) => bb.zoneId === z)!; next[z] = placed(orders[z] ?? b.tasks.map((t) => t.taskType), apply.T, apply.TGT) } return next })
    setApply(null)
  }

  // resolve a tapped VM task to its real operational row (by task_type_id | floor | unit)
  const realTaskOf = (t: TaskVM): Task | undefined => rowByKey.get(t.nodeKey)

  return (
    <>
      <div className="sov" ref={rootRef}>
        <style>{CSS}</style>
        <div className="wrap">
          <header>
            <div><div className="name">{vm.name}</div><div className="meta">{FLOORS.length} floors · {FLOORS.reduce((s, f) => s + f.blocks.reduce((a, b) => a + b.tasks.length, 0), 0)} tasks</div>{headerSlot && <div style={{ marginTop: 8 }}>{headerSlot}</div>}</div>
            <div className="h-r"><div className="big">{vm.overallPct}%{vm.dryRun && <span className="dryflag">DRY RUN</span>}</div><div className="lbl">Complete</div></div>
          </header>

          <div className="tl">
            <div className="tl-h"><span className="l">Foundation → Finishing</span><span className="r"><b>{floor?.name}</b> in focus</span></div>
            <div className="vp" ref={vpRef}>
              <div className="ground" /><div className="nowm" />
              <div className="track" ref={trackRef}>{FLOORS.map((f, i) => <Stop key={f.id + i} f={f} slot={RISE[i]} />)}</div>
              {/* clickable nav arrows — appear when there are floors beyond the focus */}
              {focusIdx > 0 && <button className="tl-arrow" style={{ left: 6 }} aria-label="Lower floor" onClick={() => navRef.current?.goTo(focusIdx - 1)}>‹</button>}
              {focusIdx < FLOORS.length - 1 && <button className="tl-arrow" style={{ right: 6 }} aria-label="Higher floor" onClick={() => navRef.current?.goTo(focusIdx + 1)}>›</button>}
            </div>
            <div className="leg">
              <span><i className="lw s" />Structure</span><span><i className="lw v" />Services</span>
              <span><i className="lw f" />Finishes</span><span><i className="lw d" />Done</span>
            </div>
            <div className="hint">the building rising, left to right · move across to focus a stage</div>
          </div>

          <div className="fd-h"><span className="fd-name">{floor && (floor.name === 'Foundation' || floor.name === 'Common areas') ? floor.name : `${floor?.name} Floor`}</span><span className="fd-blocks">{floor && floor.blocks.length > 1 ? `${floor.blocks.length} blocks` : ''}</span></div>
          <div>
            {floor?.blocks.map((b, bi) => {
              // a fully-done block collapses to a quiet summary row (click to reopen)
              const blkKey = `blk:${b.zoneId}`
              const dn = (floor && unitLabels[floor.name]?.[bi]) || b.name   // custom display name (or default)
              const canRename = !!floor && floor.index >= 0 && floor.index < 9999 && floor.blocks.length > 1
              if (b.overallPct === 100 && !revealed.has(blkKey)) {
                return (
                  <button key={b.zoneId} className="blk blk-done" onClick={() => setRevealed((s) => new Set(s).add(blkKey))}>
                    <span className="blk-n">{dn}</span>
                    <span className="blk-s" style={{ color: 'var(--done)' }}>✓ Done · 100%</span>
                    <span style={{ color: 'var(--mut)', fontSize: 17, marginLeft: 8 }}>›</span>
                  </button>
                )
              }
              return (
              <Block key={b.zoneId} b={b} order={orderFor(b)} byType={byTypeFor(b)}
                onOpen={(t) => setSel({ t, block: b })}
                onDragStart={(tt) => { dragRef.current = { task: tt, block: b.zoneId } }}
                onDragOverTask={(tt, e) => { const d = dragRef.current; if (!d || d.task === tt) return; e.preventDefault(); showVerdict(checkMove(d.task, tt, orderFor(b), byTypeFor(b)), e) }}
                onDropTask={(tt) => { const d = dragRef.current; if (!d) return; const res = checkMove(d.task, tt, orderFor(b), byTypeFor(b)); vdRef.current?.classList.remove('show'); dragRef.current = null
                  if (!res) { commitMove(b, d.task, tt); return }
                  if (res.v === 'forbid') return
                  if (res.v === 'dest') { if (window.confirm(`${res.msg} — ${res.sub}.\nMove anyway?`)) commitMove(b, d.task, tt); return }
                  commitMove(b, d.task, tt) }}
                onDragEnd={() => { dragRef.current = null; vdRef.current?.classList.remove('show') }}
                manualByAfter={manualByAfter} addingKey={addingKey} setAddingKey={setAddingKey} onAddTask={addManual} onDeleteTask={delManual}
                onSuppress={(tt) => toggleSuppress(tt, true)}
                displayName={dn} onRename={canRename ? (typed) => renameUnit(floor!.index, bi, typed) : undefined} />
              )
            })}
            {suppressed.length > 0 && (
              <div className="sup-strip">
                <span className="lbl">Not applicable here:</span>
                {suppressed.map((tt) => (
                  <button key={tt} className="sup-chip" title="Restore to this project" onClick={() => toggleSuppress(tt, false)}>
                    {LIBRARY.taskTypes.get(tt)?.label ?? tt} ↺
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sov-verdict" ref={vdRef} />
      </div>

      {/* apply-to-all-units bar (slides up after a cross-unit-valid reorder) */}
      <div className={`sov-applybar${apply ? ' show' : ''}`}>
        <div><div className="at">Move <b>{apply?.label}</b> earlier in the other {(apply?.targets.length ?? 0) > 1 ? 'units' : 'unit'} too?</div><div className="au">Same order across the floor</div></div>
        <div><button className="apply" onClick={applyAll}>Apply to all</button><button className="dismiss" onClick={() => setApply(null)}>Dismiss</button></div>
      </div>

      {/* right slide-in drawer — the SHARED TaskDetail (operational first, engine context below) */}
      <TaskDrawer sel={sel} floorName={floor?.name ?? ''} projectId={vm.projectId} orgId={orgId} initialRow={sel ? realTaskOf(sel.t) : undefined} onClose={() => setSel(null)} />
    </>
  )
}

function Stop({ f, slot }: { f: FloorVM; slot: number }) {
  const builtH = slot * f.pc / 100
  const fillsH = f.fills.map((x) => x[1]).reduce((a, b) => a + b, 0) || 1
  return (
    <div className="stop">
      <div className="bar" style={{ height: slot }}>
        <div className="ghost" />
        {f.fills.map((x, i) => <div key={i} className={`seg ${x[0]}`} style={{ height: Number((builtH * x[1] / fillsH).toFixed(1)) }} />)}
        <div className="cap" />
      </div>
      <div className="plate" />
      <div className="nm">{f.name}</div><div className="pc">{f.pc}%</div>
    </div>
  )
}

// Editable unit name — click to rename; on commit the parent infers the scheme and propagates it
// to every unit on every floor (smart fill). Read-only (a plain label) when onRename is absent.
function BlockName({ name, onRename }: { name: string; onRename?: (typed: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(name)
  if (!onRename) return <span className="blk-n">{name}</span>
  if (editing) {
    const commit = () => { const t = val.trim(); if (t && t !== name) onRename(t); setEditing(false) }
    return <input className="blk-n-edit" autoFocus value={val} onClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
  }
  return (
    <span className="blk-n blk-n-edit-able" title="Rename units — type one, the rest auto-fill"
      onClick={(e) => { e.stopPropagation(); setVal(name); setEditing(true) }}>
      {name}<span className="blk-edit-hint">✎</span>
    </span>
  )
}

function Block({ b, order, byType, onOpen, onDragStart, onDragOverTask, onDropTask, onDragEnd,
  manualByAfter, addingKey, setAddingKey, onAddTask, onDeleteTask, onSuppress, displayName, onRename }: {
  b: BlockVM; order: string[]; byType: Record<string, TaskVM>; onSuppress?: (taskType: string) => void
  displayName?: string; onRename?: (typed: string) => void
  onOpen: (t: TaskVM) => void; onDragStart: (tt: string) => void; onDragOverTask: (tt: string, e: React.DragEvent) => void
  onDropTask: (tt: string) => void; onDragEnd: () => void
  manualByAfter: Map<string, Task[]>; addingKey: string | null; setAddingKey: (k: string | null) => void
  onAddTask: (afterT: TaskVM, b: BlockVM, name: string) => void; onDeleteTask: (r: Task) => void
}) {
  return (
    <div className="blk">
      <div className="blk-h"><BlockName name={displayName ?? b.name} onRename={onRename} /><span className="blk-s">{b.stage.label} · {b.overallPct}%</span></div>
      <div className="lbars">
        {LAYERS.map(([k, n]) => (
          <div className="lbar" key={k}><span className="n">{n}</span>
            <span className="t"><span className="f" style={{ width: `${b.layerPct[k]}%`, background: LCOL[k] }} /></span>
            <span className="p">{b.layerPct[k]}%</span></div>
        ))}
      </div>
      {LAYERS.map(([lk, ln]) => {
        const ts = order.filter((tt) => byType[tt] && byType[tt].layer === lk).map((tt) => byType[tt])
        if (!ts.length) return null
        const doneCount = ts.filter((t) => t.status === 'done').length
        // each task carries a hover "+ add task here" affordance; the composer + any added manual
        // tasks render directly beneath it.
        const row = (t: TaskVM) => (
          <div key={t.taskType}>
            <div className="task-wrap">
              <TaskRow t={t} onOpen={onOpen} onDragStart={onDragStart} onDragOverTask={onDragOverTask} onDropTask={onDropTask} onDragEnd={onDragEnd} onSuppress={onSuppress} />
              <button className="add-here" title="Add a task here" onClick={() => setAddingKey(addingKey === t.nodeKey ? null : t.nodeKey)}>
                <span className="ah-line" /><span className="ah-label">+ add task here</span><span className="ah-line" />
              </button>
            </div>
            {addingKey === t.nodeKey && <AddComposer onSubmit={(name) => onAddTask(t, b, name)} onCancel={() => setAddingKey(null)} />}
            {(manualByAfter.get(t.nodeKey) ?? []).map((mr) => <ManualRow key={mr.task_id} r={mr} onOpen={() => onOpen(synthManual(mr))} onDelete={() => onDeleteTask(mr)} />)}
          </div>
        )
        return (
          <div className="lsec" key={lk}>
            <div className="lsec-h"><span className="ldot" style={{ background: LCOL[lk] }} />
              <span className="lname">{ln}</span>{lk !== 'structure' && <span className="lfree">parallel</span>}
              <span className="lrule" /><span className="lcount">{doneCount}/{ts.length}</span></div>
            {/* all tasks shown in sequence — done, live and upcoming (no confusing within-block collapse) */}
            {ts.map(row)}
          </div>
        )
      })}
    </div>
  )
}

function TaskRow({ t, onOpen, onDragStart, onDragOverTask, onDropTask, onDragEnd, onSuppress }: {
  t: TaskVM; onOpen: (t: TaskVM) => void
  onDragStart: (tt: string) => void; onDragOverTask: (tt: string, e: React.DragEvent) => void
  onDropTask: (tt: string) => void; onDragEnd: () => void; onSuppress?: (taskType: string) => void
}) {
  const drag = t.status !== 'done'
  return (
    <div className={`task ${STCLS[t.status]}`} draggable={drag}
      onClick={(e) => { if (!(e.target as HTMLElement).classList.contains('grip')) onOpen(t) }}
      onDragStart={() => onDragStart(t.taskType)}
      onDragOver={(e) => onDragOverTask(t.taskType, e)}
      onDrop={(e) => { e.preventDefault(); onDropTask(t.taskType) }}
      onDragEnd={onDragEnd}>
      <span className="grip">⠿</span><span className="node"><span className="ring" /></span>
      <span className="tn">{t.label}{t.needsReview && <span className="trv">REVIEW</span>}</span><span className="tg" />
      {t.status === 'blocked' && t.why?.length ? <span className="taf">after <b>{t.why[0].afterLabel}</b></span> : null}
      <span className="ttr">{t.trade}</span>
      {onSuppress && <button className="task-x" title="Not applicable here — hide from this project"
        onClick={(e) => { e.stopPropagation(); onSuppress(t.taskType) }}>✕</button>}
    </div>
  )
}

// a user-added ("manual") task — not an engine node; rendered inline after its anchor task. We
// synthesise a minimal TaskVM so it opens the SAME drawer (no engine preds/deps).
function synthManual(r: Task): TaskVM {
  const status = (r.status === 'done' ? 'done' : r.status === 'active' ? 'active' : 'available') as TaskVM['status']
  return {
    nodeKey: r.node_key ?? '', taskType: 'manual', label: r.name, trade: r.trade || 'Added on site',
    layer: ((r.phase as TaskVM['layer']) || 'finishes'), status, seqNo: r.seq_no ?? 0,
    placementSource: 'authored', hardPreds: [], hardDeps: [],
  }
}
function ManualRow({ r, onOpen, onDelete }: { r: Task; onOpen: () => void; onDelete: () => void }) {
  const cls = r.status === 'done' ? 't-done' : r.status === 'active' ? 't-active' : 't-available'
  return (
    <div className={`task task-manual ${cls}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('.man-del')) onOpen() }}>
      <span className="grip" style={{ opacity: 0 }}>⠿</span><span className="node"><span className="ring" /></span>
      <span className="tn">{r.name}<span className="man-tag">ADDED</span></span><span className="tg" />
      <span className="ttr">{r.trade || 'Added on site'}</span>
      <button className="man-del" title="Remove this task" onClick={onDelete}>✕</button>
    </div>
  )
}
function AddComposer({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('')
  const go = () => { const n = v.trim(); if (n) { onSubmit(n); setV('') } }
  return (
    <div className="add-composer">
      <span className="node"><span className="ring" style={{ borderStyle: 'dashed' }} /></span>
      <input autoFocus value={v} placeholder="Name this task…" onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') onCancel() }} />
      <button disabled={!v.trim()} onClick={go}>Add</button>
      <button className="ghost" onClick={onCancel}>Cancel</button>
    </div>
  )
}

// ── right-side slide-in drawer (light theme; renders the SHARED TaskDetail) ───
function TaskDrawer({ sel, floorName, projectId, orgId, initialRow, onClose }: {
  sel: { t: TaskVM; block: BlockVM } | null; floorName: string; projectId: string; orgId: string
  initialRow: Task | undefined; onClose: () => void
}) {
  const queryClient = useQueryClient()
  // cache of lazily-materialized rows, keyed by node_key (so reopening is instant)
  const [createdByKey, setCreatedByKey] = useState<Record<string, Task | null>>({})
  const key = sel?.t.nodeKey ?? ''
  const row: Task | null = initialRow ?? (key ? createdByKey[key] : undefined) ?? null
  const loading = !!sel && !initialRow && !(key in createdByKey)

  useEffect(() => {
    if (!sel) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sel, onClose])

  // LAZY MATERIALIZE: find-or-create a task's engine row (keyed by node_key), so the drawer is fully
  // operational without a full graph persist. The row carries node_key + task_type_id, so a later
  // persistGraph reconciles it. Reused to mark prerequisite tasks done (the dependency prompt below).
  const materializeRow = useCallback(async (t: TaskVM, blockUnit: string | null): Promise<Task | null> => {
    const unit = t.nodeKey.includes('/') ? blockUnit : null   // per-floor tasks have no unit
    const found = await supabase.from('site_tasks').select(RICH).eq('project_id', projectId).eq('node_key', t.nodeKey).maybeSingle()
    let r = (found.data as Task | null) ?? null
    if (!r && !found.error && orgId) {
      const ins = await supabase.from('site_tasks').insert({
        org_id: orgId, project_id: projectId, node_key: t.nodeKey, task_type_id: t.taskType,
        floor_label: floorName, unit_label: unit, name: t.label, seq_no: t.seqNo, phase: t.layer, trade: t.trade,
        status: t.status === 'done' ? 'done' : t.status === 'active' ? 'active' : 'not_started',
        source: 'generated', placement_source: 'authored',
      }).select(RICH).single()
      r = (ins.data as Task | null) ?? null
      if (r) {
        // THE THIRD DOOR (2026-07-11). A task materialized HERE is a task like any other, and it must carry
        // its type's authored QC checks — a row created by clicking a node in the sequence had none, so the
        // whole services/finishes half of a project could exist without a single check on it. fanOutQc is a
        // project-scoped TOP-UP (it only inserts for tasks holding none, and never rewrites an answered
        // check), so calling it here is safe, idempotent, and also repairs anything an older path missed.
        try {
          await fanOutQc(supabase, { project_id: projectId, org_id: orgId })
        } catch (e) {
          console.error('[siteops] QC fan-out failed for materialized row:', (e as Error).message)
        }
        queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
        queryClient.invalidateQueries({ queryKey: ['seq_task_status', projectId] })
      }
    }
    return r
  }, [projectId, orgId, floorName, queryClient])

  useEffect(() => {
    if (!sel || initialRow || (key in createdByKey)) return
    const blockUnit = sel.block.name === 'Whole floor' ? null : sel.block.name
    let cancelled = false
    void (async () => {
      const r = await materializeRow(sel.t, blockUnit)
      if (!cancelled) setCreatedByKey((m) => ({ ...m, [key]: r }))
    })()
    return () => { cancelled = true }
  }, [sel, initialRow, key, createdByKey, materializeRow])

  const open = !!sel
  const t = sel?.t
  const where = sel ? `${floorName}${sel.block.name !== 'Whole floor' ? ` · ${sel.block.name}` : ''}` : ''
  const engine: EngineCtx | null = t ? {
    status: t.status, seqNo: t.seqNo, stage: sel!.block.stage,
    why: t.why, freedomSet: t.freedomSet,
    hardPreds: t.hardPreds.map((e) => ({ label: e.label, reason: e.reason, nature: e.nature })),
    hardDeps: t.hardDeps.map((e) => ({ label: e.label, nature: e.nature })),
    placementSource: t.placementSource, needsReview: t.needsReview, where,
  } : null

  return (
    <>
      {/* backdrop dims the timeline but keeps it visible */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(14,14,16,0.42)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .28s', zIndex: 1000 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(620px, 100vw)', boxShadow: '-30px 0 80px -30px rgba(43,33,26,.45)', zIndex: 1001, transform: open ? 'translateX(0)' : 'translateX(102%)', transition: 'transform .42s cubic-bezier(.2,.75,.2,1)', background: '#F6F1E8', overflow: 'hidden' }}>
        {sel && t && (
          row ? (
            <TaskDetail key={row.task_id} task={row} engine={engine ?? undefined} showStatusControl onClose={onClose} />
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#F6F1E8', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
              <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 22px', borderBottom: '1px solid #EBE2D4' }}>
                <button onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: '#5A4E43', background: '#fff', border: '1px solid #EBE2D4', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
              </header>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: '#9A8E81', fontSize: 14 }}>
                {loading ? 'Opening task…' : 'Couldn’t open this task’s record.'}
              </div>
            </div>
          )
        )}
      </aside>
    </>
  )
}
