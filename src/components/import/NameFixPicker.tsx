// The party picker for a blank-name row on the Check step. A row whose sheet cell had no name gets
// the SAME resolve choices as the Names step — search an existing party, add a new one — plus the
// honest third answer the DB allows (stakeholder_id is nullable): file it as a misc expense with no
// party. Self-contained open/query state so the Check table stays simple. Nothing writes until commit.

import { useState } from 'react';
import type { Cand } from './ResolveRow';

export type RowPartyChoice =
  | { kind: 'existing'; id: string; label: string }
  | { kind: 'new'; name: string }
  | { kind: 'none' };

export default function NameFixPicker({ value, search, onChoose, onClear }: {
  value?: RowPartyChoice;
  search: (q: string) => Cand[];
  onChoose: (c: RowPartyChoice) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  // Resolved → show the chosen party as a green chip with an undo, not an input.
  if (value) {
    const label = value.kind === 'existing' ? value.label
      : value.kind === 'new' ? `New party · ${value.name}`
      : 'No party — misc expense';
    return (
      <div className="txt">
        <span><span className="tag ok">✓</span> {label}</span>
        <span className="lnk" onClick={onClear}>change</span>
      </div>
    );
  }

  const cands = q.trim() ? search(q).slice(0, 5) : [];
  return (
    <div className="cellwrap">
      <input className="hascaret" placeholder="search a party, or type a new name…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <div className="dd">
          {cands.map((c) => (
            <div key={c.id} onMouseDown={() => onChoose({ kind: 'existing', id: c.id, label: c.label })}>{c.label}</div>
          ))}
          {q.trim() && (
            <div className="addnew" onMouseDown={() => onChoose({ kind: 'new', name: q.trim() })}>＋ Add “{q.trim()}” as a new party</div>
          )}
          <div className="addnew" onMouseDown={() => onChoose({ kind: 'none' })}>File as misc — no party</div>
        </div>
      )}
    </div>
  );
}
