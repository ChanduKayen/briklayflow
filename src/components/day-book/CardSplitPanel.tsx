/**
 * CardSplitPanel — split ONE Day Book capture into several transactions, right on the review card
 * (no popup). Each row is its own transaction: payee · site · note · amount. The balance bar makes
 * the rows sum exactly to the entry total before filing. "Auto-split" reads the original message/
 * proof and seeds the rows. Files atomically via fileRoughEntrySplit → insert_split_transactions.
 */
import { useState } from 'react';
import { X, Plus, Check, Loader2, Sparkles } from 'lucide-react';
import type { RoughEntry } from '../../types';
import { V, font, nums, T } from './tokens';
import { searchPayees } from '../../lib/payeeSearch';
import { supabase } from '../../lib/supabase';
import { fileRoughEntrySplit } from './fileEntry';
import type { StakeholderLite, ProjectLite } from './ReviewCard';

interface Row { id: string; payeeId: string; payeeName: string; payeeSearch: string; projectId: string; amount: number | ''; description: string; }
const uid = () => Math.random().toString(36).slice(2, 8);
const inr = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const COLORS = ['#C75E32', '#4C6B47', '#6366F1', '#0EA5E9', '#C79A2E'];

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
  const [rows, setRows] = useState<Row[]>(() => [
    { id: 's1', payeeId: base.payeeId, payeeName: base.payeeName, payeeSearch: base.payeeName, projectId: base.projectId, amount: '', description: base.description },
    { id: 's2', payeeId: '', payeeName: '', payeeSearch: '', projectId: '', amount: '', description: '' },
  ]);
  const [openPayee, setOpenPayee] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [filing, setFiling] = useState(false);

  const up = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { id: uid(), payeeId: '', payeeName: '', payeeSearch: '', projectId: rs[rs.length - 1]?.projectId || '', amount: '', description: '' }]);
  const rm = (id: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = total - sum;
  const over = remaining < -0.005;
  const balanced = Math.abs(remaining) < 0.005 && total > 0;
  const used = new Set(rows.map((r) => r.projectId).filter(Boolean));
  const valid = rows.length >= 2 && rows.every((r) => r.payeeId && r.projectId && Number(r.amount) > 0) && balanced;
  const canAuto = !!(entry.raw_text || entry.raw_image_url);

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
        return {
          id: uid(),
          payeeId: (pm as any)?.stakeholder_id || '',
          payeeName: (pm as any)?.name || '',
          payeeSearch: (pm as any)?.name || p.payee_name || '',
          projectId: proj?.project_id || base.projectId || '',
          amount: p.amount && p.amount > 0 ? p.amount : '',
          description: p.description || '',
        };
      });
      setRows(seeded.length >= 2 ? seeded : [...seeded, { id: uid(), payeeId: '', payeeName: '', payeeSearch: '', projectId: '', amount: '', description: '' }]);
    } catch (e: any) {
      onError(e.message || 'Could not auto-split this entry');
    } finally {
      setAuto(false);
    }
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
    } catch (e: any) {
      setFiling(false);
      onError(e.message || "Couldn't file the split, try again");
    }
  };

  const inputStyle = (ok: boolean) => ({ ...font, background: V.field, border: `1px solid ${ok ? V.line : '#E6C9BC'}`, color: V.ink });

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${V.line}`, background: V.surface }} onClick={(e) => e.stopPropagation()}>
      {/* header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: `1px solid ${V.line}` }}>
        <span className="font-semibold" style={{ color: V.ink, ...font, ...T.sm }}>Split into transactions</span>
        <span className="flex-1" />
        {canAuto && (
          <button type="button" onClick={autoSplit} disabled={auto}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold disabled:opacity-60"
            style={{ ...font, fontSize: 12, color: V.terra, background: V.terraWash }}>
            {auto ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Auto-split
          </button>
        )}
        <button type="button" onClick={onClose} className="grid place-items-center rounded-lg" style={{ width: 28, height: 28, color: V.faint }} aria-label="Close"><X size={15} /></button>
      </div>

      <div className="p-3.5">
        {/* balance bar */}
        <div className="rounded-lg p-2.5 mb-2.5" style={{ background: V.field, border: `1px solid ${V.line}` }}>
          <div className="flex h-2 w-full rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.06)' }}>
            {rows.map((r, i) => {
              const pct = total > 0 ? ((Number(r.amount) || 0) / total) * 100 : 0;
              return pct > 0 ? <div key={r.id} style={{ width: `${Math.min(100, pct)}%`, background: COLORS[i % COLORS.length], transition: 'width .3s' }} /> : null;
            })}
            {remaining > 0.005 && <div style={{ width: `${(remaining / total) * 100}%`, background: 'rgba(0,0,0,0.08)' }} />}
          </div>
          <div className="flex items-center justify-between mt-2" style={{ ...font, ...nums, fontSize: 11.5, fontWeight: 600 }}>
            <span style={{ color: V.faint }}>Total ₹{inr(total)}</span>
            <span className="inline-flex items-center gap-1" style={{ color: over ? V.terraDeep : balanced ? V.sage : V.terra }}>
              {balanced && <Check size={12} strokeWidth={3} />}
              {over ? `₹${inr(Math.abs(remaining))} over` : balanced ? 'Balanced' : `₹${inr(remaining)} left`}
            </span>
          </div>
        </div>

        {/* rows */}
        <div className="space-y-2">
          {rows.map((r, i) => {
            const matches = openPayee === r.id ? searchPayees(stakeholders as any, r.payeeSearch || '').slice(0, 5) : [];
            return (
              <div key={r.id} className="rounded-lg p-2.5" style={{ background: V.field, border: `1px solid ${V.line}` }}>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <div className="relative flex-1 min-w-0">
                    <input
                      value={r.payeeSearch}
                      onChange={(e) => { up(r.id, { payeeSearch: e.target.value, payeeId: '', payeeName: '' }); setOpenPayee(r.id); }}
                      onFocus={() => setOpenPayee(r.id)}
                      onBlur={() => setTimeout(() => setOpenPayee((o) => (o === r.id ? null : o)), 150)}
                      placeholder="Who was paid…"
                      className="w-full rounded-lg pl-2.5 pr-7 py-2 outline-none"
                      style={{ ...inputStyle(!!r.payeeId), fontSize: 13 }}
                    />
                    {r.payeeId && <Check size={14} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: V.sage }} strokeWidth={3} />}
                    {openPayee === r.id && matches.length > 0 && (
                      <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-lg" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                        {matches.map((m: any) => (
                          <button key={m.stakeholder_id} type="button"
                            onMouseDown={(e) => { e.preventDefault(); up(r.id, { payeeId: m.stakeholder_id, payeeName: m.name, payeeSearch: m.name }); setOpenPayee(null); }}
                            className="w-full text-left px-2.5 py-1.5" style={{ ...font, fontSize: 13, color: V.ink }}>
                            {m.name}{m.category ? <span style={{ color: V.faint, fontSize: 11 }}> · {m.category}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => rm(r.id)} disabled={rows.length <= 1} className="shrink-0 grid place-items-center rounded-lg disabled:opacity-25" style={{ width: 28, height: 28, color: V.faint }} aria-label="Remove"><X size={15} /></button>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <select value={r.projectId} onChange={(e) => up(r.id, { projectId: e.target.value })}
                    className="flex-1 min-w-0 rounded-lg px-2.5 py-2 outline-none appearance-none"
                    style={{ ...inputStyle(!!r.projectId), fontSize: 13 }}>
                    <option value="">Select site…</option>
                    {projects.map((p) => <option key={p.project_id} value={p.project_id} disabled={used.has(p.project_id) && p.project_id !== r.projectId}>{p.name}</option>)}
                  </select>
                  <div className="relative shrink-0" style={{ width: 100 }}>
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: V.faint, fontSize: 12 }}>₹</span>
                    <input inputMode="numeric" value={r.amount === '' ? '' : String(r.amount)}
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); up(r.id, { amount: v === '' ? '' : Number(v) }); }}
                      placeholder="0" className="w-full rounded-lg pl-5 pr-2 py-2 outline-none text-right"
                      style={{ ...inputStyle(Number(r.amount) > 0), ...nums, fontSize: 13 }} />
                  </div>
                </div>

                <input value={r.description} onChange={(e) => up(r.id, { description: e.target.value })}
                  placeholder="What for? (optional)" className="w-full mt-2 rounded-lg px-2.5 py-2 outline-none"
                  style={{ ...inputStyle(true), fontSize: 13 }} />
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 mt-2.5">
          <button type="button" onClick={add} className="inline-flex items-center gap-1 font-semibold" style={{ ...font, fontSize: 12, color: V.terra }}>
            <Plus size={14} /> Add another
          </button>
          {remaining > 0.005 && (
            <button type="button" onClick={() => { const last = rows[rows.length - 1]; up(last.id, { amount: (Number(last.amount) || 0) + remaining }); }}
              className="font-medium" style={{ ...font, fontSize: 12, color: V.faint }}>
              put ₹{inr(remaining)} on the last
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3.5">
          <button type="button" onClick={file} disabled={!valid || filing}
            className="inline-flex items-center gap-1.5 rounded-[10px] disabled:opacity-50"
            style={{ ...font, fontWeight: 600, fontSize: 13.5, padding: '9px 16px', color: '#FFF6EF', background: V.terra, border: 'none', cursor: valid && !filing ? 'pointer' : 'default' }}>
            {filing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2.6} />}
            {filing ? 'Filing…' : `File ${rows.length} transactions`}
          </button>
          <button type="button" onClick={onClose} className="font-semibold rounded-[10px]" style={{ ...font, fontSize: 13.5, padding: '9px 14px', color: V.inkSoft, background: 'transparent', border: `1px solid ${V.line}` }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
