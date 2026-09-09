/**
 * SearchPicker — a type-to-search "pick or add a name" field, the same interaction as the payee picker on
 * the transaction cards (search box + filtered list + an "Add “X”" create row), styled for the desktop
 * voucher. Used for the vendor on a bill card so picking a vendor works exactly like picking a payee.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { V, font } from './tokens';

export interface PickerItem { id: string; name: string; tag?: string }

export function SearchPicker({
  items, valueName, placeholder, initialQuery, onSelect, onCreate, createKind,
}: {
  items: PickerItem[];
  valueName: string | null;            // the current selection's display name (null → nothing picked)
  placeholder: string;
  initialQuery?: string | null;        // pre-seed the search (e.g. the name the AI read) so a match surfaces at once
  onSelect: (id: string, name: string) => void;
  onCreate?: (name: string) => void;   // omit to disable "add new"
  createKind?: string;                 // e.g. "vendor" → the create row reads "Add “X” as a vendor"
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const openNow = () => { setQ(valueName ? '' : (initialQuery ?? '')); setOpen(true); setTimeout(() => inputRef.current?.focus(), 20); };

  const ql = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const hit = (n: string) => !ql || n.toLowerCase().includes(ql);
    return items.filter((i) => hit(i.name)).slice(0, 8);
  }, [items, ql]);
  const exact = ql.length > 0 && items.some((i) => i.name.toLowerCase() === ql);
  const showCreate = !!onCreate && ql.length > 0 && !exact;

  return (
    <div ref={ref} style={{ position: 'relative', marginTop: 4 }}>
      <button type="button" onClick={() => (open ? setOpen(false) : openNow())} style={fieldBtn}>
        <span style={{ ...font, fontSize: 13.5, color: valueName ? V.ink : V.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {valueName || placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={V.faint} strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div style={pop}>
          <div style={searchRow}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={V.faint} strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a new name"
              style={{ flex: 1, border: 0, background: 'none', outline: 'none', ...font, fontSize: 14, color: V.ink }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {showCreate && (
              <button type="button" onClick={() => { onCreate!(q.trim()); setOpen(false); setQ(''); }} style={{ ...row, color: V.terra, fontWeight: 600 }}>
                Add “{q.trim()}”{createKind ? ` as a ${createKind}` : ''}
              </button>
            )}
            {filtered.map((i) => (
              <button type="button" key={i.id} onClick={() => { onSelect(i.id, i.name); setOpen(false); setQ(''); }} style={row}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                {i.tag && <span style={{ ...font, fontSize: 11, color: V.faint }}>{i.tag}</span>}
              </button>
            ))}
            {filtered.length === 0 && !showCreate && (
              <div style={{ ...font, fontSize: 13, color: V.faint, padding: '10px 12px' }}>No matches — keep typing to add a new name</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const fieldBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 8,
  border: `1px solid ${V.line}`, background: '#fff', cursor: 'pointer', textAlign: 'left',
};
const pop: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, background: '#fff',
  border: `1px solid ${V.line}`, borderRadius: 10, boxShadow: '0 12px 30px -12px rgba(27,23,19,.28)', padding: 6,
};
const searchRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, background: V.surface, borderRadius: 8, padding: '0 10px', height: 38, marginBottom: 4,
};
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 40, padding: '6px 10px', borderRadius: 8,
  border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: '#1B1713', fontFamily: 'inherit',
};
