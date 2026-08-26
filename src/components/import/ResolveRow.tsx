// The importer's resolve ROW — a faithful React port of the prototype's state machine
// (briklay-import-simple.html `state()`): match → pick → form → newdone, with click-to-edit rows, a
// type-ahead pick dropdown carrying an "+ Add … as new" option, ✓/↩ buttons on the create form, and
// the sage "settle" flash after a tick. Controlled: the resolution lives in the parent (for gating +
// commit); this owns only the presentational mode + the dropdown's transient input/highlight state.

import { useEffect, useRef, useState } from 'react';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../../lib/trades';
import type { StakeholderType } from '../../lib/importClassify';

export type Mode = 'match' | 'pick' | 'form' | 'newdone';
export interface Cand { id: string; label: string }
export interface ResolveValue {
  mode: Mode;
  chosenId?: string;
  chosenLabel?: string;
  newName?: string;
  newType?: StakeholderType;
  newTrade?: string;
  createdId?: string;   // set once the parent has inserted this new party/site (insert-on-tick)
}

interface Props {
  src: string;
  count: number;
  doubt: boolean;
  isSite?: boolean;
  hasBest: boolean;
  bestId?: string;
  bestLabel?: string;
  defaultCands: Cand[];              // best + alts — shown when the pick box is empty
  search: (q: string) => Cand[];    // FUZZY-ranked nearest candidates for a query (not substring)
  value: ResolveValue;
  onChange: (v: ResolveValue) => void;
  focused?: boolean;      // parent asks this row's create-form name field to take focus
  onTicked?: () => void;  // fired after ✓ — the parent advances focus to the next to-do row
}

export default function ResolveRow(p: Props) {
  const { value, onChange } = p;
  const [animate, setAnimate] = useState(false);
  const settle = () => { setAnimate(true); setTimeout(() => setAnimate(false), 1400); };

  const editable = value.mode === 'match' || value.mode === 'newdone';
  const onRowClick = () => {
    if (value.mode === 'match') onChange({ ...value, mode: 'pick' });
    else if (value.mode === 'newdone') onChange({ ...value, mode: 'form' });
  };

  return (
    <tr className={editable ? 'editable' : ''} onClick={editable ? onRowClick : undefined}>
      <td>{p.src}{p.doubt && <span className="doubt"> ?</span>}</td>
      <td className={animate ? 'settled' : ''}>
        {value.mode === 'match' && (
          <div className="txt"><span>{value.chosenLabel ?? p.bestLabel}</span><Caret /></div>
        )}
        {value.mode === 'newdone' && (
          <div className="txt">
            <span>{value.newName}{!p.isSite && ` (${(value.newType ?? 'Vendor').toLowerCase()} · ${(value.newTrade ?? '').toLowerCase()})`}
              <span className="tag new">new</span></span>
            <Caret />
          </div>
        )}
        {value.mode === 'pick' && <PickBox {...p} onSettle={settle} />}
        {value.mode === 'form' && <FormBox {...p} onSettle={settle} />}
      </td>
      <td className="num">{p.count}</td>
    </tr>
  );
}

const Caret = () => <span className="caret" title="Show options">▾</span>;

// ── pick: type-ahead dropdown over best+alts (empty) / all (typing) + add-new ────────────────────────
function PickBox(p: Props & { onSettle: () => void }) {
  const { value, onChange } = p;
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const base = q.trim() ? p.search(q) : p.defaultCands;
  const items: { label: string; val: string; addnew?: boolean }[] = base.map((c) => ({ label: c.label, val: c.id }));
  const typed = q.trim();
  items.push({ label: `＋ Add “${typed || p.src}” as new`, val: '__new', addnew: true });
  const clampHi = Math.min(hi, items.length - 1);

  const toMatch = () => onChange({ ...value, mode: p.hasBest ? 'match' : 'form' });
  const choose = (k: number) => {
    const it = items[k]; if (!it) return;
    if (it.val === '__new') {
      onChange({ ...value, mode: 'form', newName: (typed && !base.some((c) => c.label === typed) ? typed : p.src) });
    } else {
      onChange({ ...value, mode: 'match', chosenId: it.val, chosenLabel: it.label });
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef} className="cb"
        value={q || (value.chosenLabel ?? '')}
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setHi((h) => (h + 1) % items.length); e.preventDefault(); }
          else if (e.key === 'ArrowUp') { setHi((h) => (h - 1 + items.length) % items.length); e.preventDefault(); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = base.find((c) => c.label.toLowerCase() === typed.toLowerCase());
            if (hit) onChange({ ...value, mode: 'match', chosenId: hit.id, chosenLabel: hit.label });
            else if (typed) onChange({ ...value, mode: 'form', newName: typed });
            else choose(clampHi);
          } else if (e.key === 'Escape') { toMatch(); }
        }}
        onBlur={() => setTimeout(toMatch, 120)}
        placeholder={`Search ${p.isSite ? 'projects' : 'people'}…`}
      />
      <div className="dd">
        {items.map((it, k) => (
          <div key={k} className={`${it.addnew ? 'addnew' : ''} ${k === clampHi ? 'hi' : ''}`}
            onMouseEnter={() => setHi(k)}
            onMouseDown={(e) => { e.preventDefault(); choose(k); }}>
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── form: create-new (name-combobox + type/trade) with Enter-to-advance, ✓ tick and ↩ undo ────────────
function FormBox(p: Props & { onSettle: () => void }) {
  const { value, onChange } = p;
  const [name, setName] = useState(value.newName ?? p.src);
  const [type, setType] = useState<StakeholderType>(value.newType ?? 'Vendor');
  const [trade, setTrade] = useState(value.newTrade ?? OTHER_TRADE);
  const [open, setOpen] = useState(false);   // name dropdown (nearest existing)
  const [hi, setHi] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const tradeRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { nameRef.current?.focus(); nameRef.current?.select(); }, []);
  // When the parent advances to this row (previous row was just ticked), pull focus to the name field.
  useEffect(() => { if (p.focused) { nameRef.current?.focus(); nameRef.current?.select(); } }, [p.focused]);

  // Nearest existing candidates for the name field — the point of the ▾: "did you actually mean one
  // of these?" Fuzzy-ranked against whatever is typed (or the sheet name), so near matches surface.
  const cands = p.search(name.trim() || p.src).slice(0, 8);
  const clampHi = Math.min(hi, Math.max(0, cands.length - 1));

  const tick = () => {
    onChange({ ...value, mode: 'newdone', newName: name.trim() || p.src, newType: type, newTrade: trade });
    p.onSettle();
    p.onTicked?.();   // parent moves focus to the next unresolved row
  };
  const undo = () => onChange({ mode: 'match', chosenId: p.bestId, chosenLabel: p.bestLabel });
  const pickExisting = (c: Cand) => onChange({ mode: 'match', chosenId: c.id, chosenLabel: c.label });
  const advanceFromName = () => { setOpen(false); if (p.isSite) tick(); else typeRef.current?.focus(); };

  return (
    <div className={`form ${p.isSite ? 'site' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="cellwrap">
        <input
          ref={nameRef} className="hascaret" value={name}
          onChange={(e) => { setName(e.target.value); setOpen(true); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { if (!open) setOpen(true); else setHi((h) => (h + 1) % cands.length); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { setHi((h) => (h - 1 + cands.length) % cands.length); e.preventDefault(); }
            else if (e.key === 'Enter') { e.preventDefault(); if (open && cands[clampHi]) pickExisting(cands[clampHi]); else advanceFromName(); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        <button type="button" className="cellcaret" title="Nearest existing" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); nameRef.current?.focus(); }}>▾</button>
        {open && cands.length > 0 && (
          <div className="dd">
            {cands.map((c, k) => (
              <div key={c.id} className={k === clampHi ? 'hi' : ''}
                onMouseEnter={() => setHi(k)} onMouseDown={(e) => { e.preventDefault(); pickExisting(c); }}>{c.label}</div>
            ))}
          </div>
        )}
      </div>
      {!p.isSite && (
        <>
          <select ref={typeRef} value={type}
            onChange={(e) => { setType(e.target.value as StakeholderType); setTrade(OTHER_TRADE); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tradeRef.current?.focus(); } }}>
            <option>Vendor</option><option>Worker</option><option>Client</option>
          </select>
          <select ref={tradeRef} value={trade} onChange={(e) => setTrade(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); tick(); } }}>
            {tradeOptions(type)}
          </select>
        </>
      )}
      <button className="ib tick" title="Add as new (Enter)" onClick={tick}>✓</button>
      {p.hasBest ? <button className="ib undo" title="Back to match" onClick={undo}>↩</button> : <span />}
    </div>
  );
}

function tradeOptions(type: StakeholderType) {
  if (type === 'Client') return ['Villa buyer', 'Flat buyer', 'Contract work', OTHER_TRADE].map((t) => <option key={t}>{t}</option>);
  const groups = type === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS;
  return groups.map((g) => <optgroup key={g.group} label={g.group}>{g.trades.map((t) => <option key={t}>{t}</option>)}</optgroup>);
}
