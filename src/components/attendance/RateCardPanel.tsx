// RateCardPanel — the day rates that produce the labour figures on the payment run.
//
// The rates live on the Attendance sheet, so on Payables the numbers arrived with no way to
// see (let alone correct) what produced them. This puts the card on the page that spends it:
// collapsed to a one-line summary, opened to a list, and editable in place by a manager.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { saveRate, SUPERVISOR_KEY } from '../../lib/attendanceApi';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

type Row = { trade: string | null; kind: 'skilled' | 'hm' | 'hf'; rate: number };
type Line = { key: string; label: string; kind: 'skilled' | 'hm' | 'hf'; rate: number | null };

const KIND_LABEL: Record<string, string> = { skilled: 'skilled', hm: 'man', hf: 'woman' };

export function RateCardPanel({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['labour_rate_card', orgId],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.from('labour_rate_card').select('trade,kind,rate').eq('org_id', orgId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

  // one flat list: supervisor, then unskilled, then every trade — each with its own day rate
  const lines: Line[] = [];
  const byTrade = new Map<string, Partial<Record<'skilled' | 'hm' | 'hf', number>>>();
  let supervisor: number | null = null;
  for (const r of rows) {
    if (r.trade === SUPERVISOR_KEY) { supervisor = Number(r.rate); continue; }
    const k = r.trade || '';
    const e = byTrade.get(k) ?? {};
    e[r.kind] = Number(r.rate);
    byTrade.set(k, e);
  }
  if (supervisor != null) lines.push({ key: `${SUPERVISOR_KEY}.skilled`, label: 'Supervisor', kind: 'skilled', rate: supervisor });
  for (const [trade, kinds] of [...byTrade.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])))) {
    for (const kind of ['skilled', 'hm', 'hf'] as const) {
      if (kinds[kind] == null) continue;
      lines.push({ key: `${trade}.${kind}`, label: `${trade || 'Unskilled'} · ${KIND_LABEL[kind]}`, kind, rate: kinds[kind]! });
    }
  }

  const commit = async (line: Line) => {
    const v = Math.round(Number(draft.replace(/[^\d.]/g, '')) || 0);
    setEditing(null);
    if (!v || v === line.rate) return;
    setBusy(true);
    try {
      await saveRate(orgId, line.key.split('.')[0] || '', line.kind, v);
      await qc.invalidateQueries({ queryKey: ['labour_rate_card', orgId] });
    } finally { setBusy(false); }
  };

  if (isLoading || lines.length === 0) return null;

  return (
    <section className="ratecard">
      <button type="button" className="rc-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="rc-t">Rate card</span>
        <span className="rc-s">{lines.length} day rate{lines.length !== 1 ? 's' : ''} behind these figures</span>
        <span className={`rc-chev${open ? ' on' : ''}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="rc-body">
          {lines.map(l => (
            <div className="rc-row" key={l.key}>
              <span className="rc-n">{l.label}</span>
              {editing === l.key ? (
                <input
                  className="rc-in mono" autoFocus inputMode="numeric" value={draft}
                  onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => commit(l)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
                />
              ) : (
                <button
                  type="button" className={`rc-v mono${isManager ? ' edit' : ''}`} disabled={!isManager || busy}
                  onClick={() => { setDraft(String(l.rate ?? '')); setEditing(l.key); }}
                  title={isManager ? 'Tap to change this day rate' : undefined}
                >
                  {inr(l.rate ?? 0)}<span className="rc-per">/day</span>
                </button>
              )}
            </div>
          ))}
          {isManager && <p className="rc-foot">A new rate applies from today — figures already paid keep the rate they were paid at.</p>}
        </div>
      )}
    </section>
  );
}
