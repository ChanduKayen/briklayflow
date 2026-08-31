/**
 * CardSplitPanel — split ONE Day Book capture into several transactions, right on the review card.
 * Table layout (per the design): Paid-to · Site · For · Amount rows, a segmented allocation that must
 * sum to the entry total, quick presets (Two/Three ways · One per site), and Auto-split (reads the
 * message/proof). Files atomically via fileRoughEntrySplit → insert_split_transactions; every row
 * becomes its own transaction, all pointing back at this capture.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import type { RoughEntry } from '../../types';
import { V, font, nums } from './tokens';
import { searchPayees } from '../../lib/payeeSearch';
import { supabase } from '../../lib/supabase';
import { fileRoughEntrySplit } from './fileEntry';
import type { StakeholderLite, ProjectLite } from './ReviewCard';

interface Row { id: string; payeeId: string; payeeName: string; payeeSearch: string; projectId: string; amount: number | ''; description: string; }
const uid = () => Math.random().toString(36).slice(2, 8);
const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const DOTS = ['#C75E32', '#C79A2E', '#4C6B47', '#6366F1', '#0EA5E9'];
const GRID = '26px minmax(130px,1.4fr) minmax(120px,1fr) minmax(120px,1.2fr) 96px 30px';

export function CardSplitPanel({
  entry, orgId, stakeholders, projects, base, onFiled, onClose, onError,
}: {
  entry: RoughEntry;
  orgId: string;
  stakeholders: StakeholderLite[];
  projects: ProjectLite[];
  base: { payeeId: string; payeeName: string; projectId: string; amount: number; description: string };
  onFiled: (ids: string[]) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const total = base.amount;
  const docRef = `DB-${entry.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}`;
  const blank = (over: Partial<Row> = {}): Row => ({ id: uid(), payeeId: '', payeeName: '', payeeSearch: '', projectId: '', amount: '', description: '', ...over });
  const [rows, setRows] = useState<Row[]>(() => [
    blank({ id: 's1', payeeId: base.payeeId, payeeName: base.payeeName, payeeSearch: base.payeeName, projectId: base.projectId, description: base.description }),
    blank({ id: 's2' }),
  ]);
  const [openPayee, setOpenPayee] = useState<string | null>(null);
  // The suggestion list is PORTALED to <body> (fixed position) so it floats above the rows below it,
  // instead of being clipped/covered inside the scrolling table.
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const anchorTo = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setAnchor({ left: r.left, top: r.bottom + 4, width: r.width }); };
  const [auto, setAuto] = useState(false);
  const [filing, setFiling] = useState(false);

  const up = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, blank({ projectId: rs[rs.length - 1]?.projectId || '' })]);
  const rm = (id: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = total - sum;
  const over = remaining < -0.005;
  const balanced = Math.abs(remaining) < 0.005 && total > 0;
  const valid = rows.length >= 2 && rows.every((r) => r.payeeId && r.projectId && Number(r.amount) > 0) && balanced;
  const canAuto = !!(entry.raw_text || entry.raw_image_url);
  const fileCount = rows.filter((r) => r.payeeId).length || rows.length;

  // Even-split N rows across the total (last row soaks up the rounding remainder).
  const evenAmounts = (n: number) => { const each = Math.floor(total / n); const a = Array(n).fill(each); a[n - 1] += total - each * n; return a; };
  const preset = (kind: 'two' | 'three' | 'perSite') => {
    if (kind === 'perSite') {
      const ps = projects.slice(0, Math.max(2, Math.min(projects.length, 6)));
      const amts = evenAmounts(ps.length);
      setRows(ps.map((p, i) => blank({
        projectId: p.project_id, amount: amts[i],
        ...(i === 0 ? { payeeId: base.payeeId, payeeName: base.payeeName, payeeSearch: base.payeeName, description: base.description } : {}),
      })));
      return;
    }
    const n = kind === 'two' ? 2 : 3;
    const amts = evenAmounts(n);
    setRows(Array.from({ length: n }, (_, i) => blank({
      amount: amts[i],
      ...(i === 0 ? { payeeId: base.payeeId, payeeName: base.payeeName, payeeSearch: base.payeeName, projectId: base.projectId, description: base.description } : {}),
    })));
  };

  const autoSplit = async () => {
    if (auto) return;
    setAuto(true);
    try {
      const { data, error } = await supabase.functions.invoke('split-daybook-entry', {
        body: { text: entry.raw_text || '', image_url: entry.raw_image_url || null, total },
      });
      if (error) throw error;
      const parts = ((data as any)?.splits ?? []) as { payee_name?: string; amount?: number; project_name?: string; description?: string }[];
      if (!parts.length) { onError('Could not read separate payments from this entry'); return; }
      const seeded: Row[] = parts.map((p) => {
        const pm = p.payee_name ? searchPayees(stakeholders as any, p.payee_name)[0] : null;
        const proj = p.project_name ? projects.find((pr) => (pr.name || '').toLowerCase() === p.project_name!.toLowerCase()) : null;
        return blank({
          payeeId: (pm as any)?.stakeholder_id || '', payeeName: (pm as any)?.name || '', payeeSearch: (pm as any)?.name || p.payee_name || '',
          projectId: proj?.project_id || base.projectId || '', amount: p.amount && p.amount > 0 ? p.amount : '', description: p.description || '',
        });
      });
      setRows(seeded.length >= 2 ? seeded : [...seeded, blank()]);
    } catch (e: any) {
      onError(e.message || 'Could not auto-split this entry');
    } finally { setAuto(false); }
  };

  const file = async () => {
    if (!valid || filing) return;
    setFiling(true);
    try {
      const ids = await fileRoughEntrySplit(
        entry, orgId,
        { payeeId: base.payeeId, amount: total, description: base.description, generalExpense: false },
        rows.map((r) => ({ projectId: r.projectId, amount: Number(r.amount), payeeId: r.payeeId, description: r.description.trim() || undefined })),
      );
      onFiled(ids);
    } catch (e: any) { setFiling(false); onError(e.message || "Couldn't file the split, try again"); }
  };

  const cellInput = { ...font, fontSize: 13.5, background: 'transparent', border: 'none', outline: 'none', color: V.ink, width: '100%' } as const;
  const chip = (label: React.ReactNode, on: boolean, onClick: () => void, dashed = false) => (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold transition-colors"
      style={{ ...font, fontSize: 12, whiteSpace: 'nowrap',
        color: dashed ? V.terra : on ? V.terra : V.sys,
        background: dashed ? V.terraWash : on ? V.terraWash : V.field,
        border: dashed ? `1px dashed ${V.terra}66` : `1px solid ${on ? 'transparent' : V.line}` }}>
      {label}
    </button>
  );

  return (
    <div style={{ paddingTop: 2 }} onClick={(e) => e.stopPropagation()}>
      {/* header: Split ₹X · presets · Auto-split · close */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <span className="font-semibold" style={{ ...font, ...nums, fontSize: 14.5, color: V.ink }}>Split ₹{inr(total)}</span>
        {canAuto && chip(<>{auto ? <Loader2 size={12} className="animate-spin" /> : <span style={{ fontWeight: 700 }}>+</span>} Auto-split from message</>, false, autoSplit, true)}
        {chip('Two ways', rows.length === 2, () => preset('two'))}
        {chip('Three ways', rows.length === 3, () => preset('three'))}
        {chip('One per site', false, () => preset('perSite'))}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="grid place-items-center rounded-lg" style={{ width: 28, height: 28, color: V.faint }} aria-label="Close"><X size={16} /></button>
      </div>

      {/* perforation */}
      <div style={{ borderTop: `1.5px dashed ${V.line}`, margin: '10px 0 8px' }} />

      {/* allocation status */}
      <div className="flex items-center justify-between px-1 mb-2" style={{ ...font, fontSize: 12.5 }}>
        <span style={{ color: V.faint, ...nums }}>Allocated ₹{inr(sum)} of ₹{inr(total)}</span>
        <span className="font-semibold" style={{ ...nums, color: over ? V.terraDeep : balanced ? V.sage : V.terra }}>
          {over ? `₹${inr(Math.abs(remaining))} over` : balanced ? 'All placed' : `₹${inr(remaining)} left to place`}
        </span>
      </div>

      {/* table */}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${V.line}`, overflowX: 'auto' }}>
        <div style={{ minWidth: 620 }}>
          {/* head */}
          <div style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', background: V.field, borderBottom: `1px solid ${V.line}` }}>
            {['#', 'Paid to', 'Site', 'For', 'Amount', ''].map((h, i) => (
              <div key={i} className="px-3 py-2" style={{ ...font, fontSize: 11, fontWeight: 600, letterSpacing: '.02em', color: V.faint, textAlign: i === 4 ? 'right' : 'left', borderLeft: i > 0 && i < 5 ? `1px solid ${V.line}` : 'none' }}>{h}</div>
            ))}
          </div>
          {/* rows */}
          {rows.map((r, i) => {
            const cellBorder = `1px solid ${V.line}`;
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'stretch', borderTop: i > 0 ? cellBorder : 'none', background: V.surface }}>
                <div className="grid place-items-center"><span style={{ width: 7, height: 7, borderRadius: '50%', background: DOTS[i % DOTS.length] }} /></div>
                {/* Paid to */}
                <div className="px-3 py-2 flex items-center" style={{ borderLeft: cellBorder }}>
                  <input value={r.payeeSearch}
                    onChange={(e) => { up(r.id, { payeeSearch: e.target.value, payeeId: '', payeeName: '' }); setOpenPayee(r.id); anchorTo(e.currentTarget); }}
                    onFocus={(e) => { setOpenPayee(r.id); anchorTo(e.currentTarget); }}
                    onBlur={() => setTimeout(() => setOpenPayee((o) => (o === r.id ? null : o)), 150)}
                    placeholder="Who was paid…"
                    style={{ ...cellInput, fontWeight: r.payeeId ? 600 : 400 }} />
                </div>
                {/* Site */}
                <div className="px-2 py-2 flex items-center" style={{ borderLeft: cellBorder }}>
                  <select value={r.projectId} onChange={(e) => up(r.id, { projectId: e.target.value })}
                    style={{ ...cellInput, color: r.projectId ? V.ink : V.faint, appearance: 'none', cursor: 'pointer' }}>
                    <option value="">Select site…</option>
                    {/* a site may repeat across rows — different payees can be paid for the same site */}
                    {projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                  </select>
                </div>
                {/* For */}
                <div className="px-3 py-2 flex items-center" style={{ borderLeft: cellBorder }}>
                  <input value={r.description} onChange={(e) => up(r.id, { description: e.target.value })}
                    placeholder="What for? (optional)" style={{ ...cellInput, color: r.description ? V.ink : V.faint }} />
                </div>
                {/* Amount */}
                <div className="px-3 py-2 flex items-center gap-1" style={{ borderLeft: cellBorder }}>
                  <span style={{ color: V.faint, fontSize: 12 }}>₹</span>
                  <input inputMode="numeric" value={r.amount === '' ? '' : String(r.amount)}
                    onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); up(r.id, { amount: v === '' ? '' : Number(v) }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && i === rows.length - 1) { e.preventDefault(); add(); } }}
                    placeholder="0" style={{ ...cellInput, ...nums, textAlign: 'right', color: Number(r.amount) > 0 ? V.ink : V.faint }} />
                </div>
                {/* remove */}
                <div className="grid place-items-center" style={{ borderLeft: cellBorder }}>
                  <button type="button" onClick={() => rm(r.id)} disabled={rows.length <= 1} className="grid place-items-center rounded disabled:opacity-20" style={{ width: 22, height: 22, color: V.faint }} aria-label="Remove row"><X size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* add another / put remaining on the last */}
      <div className="flex items-center justify-between px-1 mt-2" style={{ ...font, fontSize: 12.5 }}>
        <button type="button" onClick={add} className="inline-flex items-center gap-1.5" style={{ color: V.inkSoft }}>
          <span style={{ fontWeight: 700, color: V.terra }}>+</span> Add another
          <kbd style={{ ...font, fontSize: 10.5, padding: '1px 5px', borderRadius: 4, border: `1px solid ${V.line}`, color: V.faint, background: V.field }}>Enter</kbd>
          <span style={{ color: V.faint }}>on the last row</span>
        </button>
        {remaining > 0.005 && (
          <button type="button" onClick={() => { const last = rows[rows.length - 1]; up(last.id, { amount: (Number(last.amount) || 0) + remaining }); }}
            className="font-medium" style={{ color: V.terra, textDecoration: 'underline', textUnderlineOffset: 2, ...nums }}>
            Put ₹{inr(remaining)} on the last row
          </button>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center gap-3 mt-3.5 px-1">
        <span style={{ ...font, fontSize: 12, color: V.faint }}>Each row becomes its own transaction, all linked back to {docRef}.</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="font-semibold rounded-[10px]" style={{ ...font, fontSize: 13.5, padding: '9px 14px', color: V.inkSoft, background: 'transparent', border: 'none', cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={file} disabled={!valid || filing}
          className="inline-flex items-center gap-1.5 rounded-[10px] transition-opacity"
          style={{ ...font, fontWeight: 600, fontSize: 13.5, padding: '9px 16px', border: 'none',
            color: '#FFF6EF', background: V.terra, opacity: valid && !filing ? 1 : 0.5, cursor: valid && !filing ? 'pointer' : 'default' }}>
          {filing ? <Loader2 size={14} className="animate-spin" /> : <span style={{ fontWeight: 700 }}>✓</span>}
          {filing ? 'Filing…' : `File ${fileCount} transaction${fileCount !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* payee suggestions — SAME matcher (searchPayees) and SAME item layout as the Approve/Edit
          picker: name over a "type · category" sub-line, top 8. Portaled to <body> so it floats. */}
      {(() => {
        const row = openPayee ? rows.find((r) => r.id === openPayee) : null;
        const matches = row ? searchPayees(stakeholders as any, row.payeeSearch || '').slice(0, 8) : [];
        if (!row || !anchor || matches.length === 0) return null;
        return createPortal(
          <div style={{ position: 'fixed', left: anchor.left, top: anchor.top, width: Math.max(anchor.width, 220), maxHeight: 224, overflowY: 'auto', zIndex: 9999, background: V.surface, border: `1px solid ${V.line}`, borderRadius: 12, boxShadow: '0 12px 30px rgba(42,27,18,.18)' }}>
            {matches.map((m: any) => (
              <button key={m.stakeholder_id} type="button"
                onMouseDown={(e) => { e.preventDefault(); up(row.id, { payeeId: m.stakeholder_id, payeeName: m.name, payeeSearch: m.name }); setOpenPayee(null); }}
                className="w-full text-left px-3 py-2" style={{ borderBottom: `1px solid ${V.line}` }}>
                <p className="truncate" style={{ ...font, fontSize: 13, fontWeight: 600, color: V.ink }}>{m.name}</p>
                {(m.type || m.category) && (
                  <p className="truncate" style={{ ...font, fontSize: 11, color: V.faint }}>{[m.type, m.category].filter(Boolean).join(' · ')}</p>
                )}
              </button>
            ))}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
