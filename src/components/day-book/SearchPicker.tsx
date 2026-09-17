/**
 * SearchPicker — a type-to-search "pick or add a name" field, the same interaction as the payee picker on
 * the transaction cards (search box + filtered list + an "Add “X”" create row).
 *
 * The dropdown floats as a FIXED, viewport-anchored popover (like CardSplitPanel's picker): at least
 * 240px wide, clamped inside the screen, and flipped above the field when there's no room below. That's
 * why it never bleeds off a half-width field in the bill card's two-column vendor/site row.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { V, font } from './tokens';

export interface PickerItem { id: string; name: string; tag?: string }

type Anchor = { left: number; width: number; top?: number; bottom?: number; maxH: number };

export function SearchPicker({
  items, valueName, placeholder, initialQuery, onSelect, onCreate, createKind, onOpenChange,
}: {
  items: PickerItem[];
  valueName: string | null;            // the current selection's display name (null → nothing picked)
  placeholder: string;
  initialQuery?: string | null;        // pre-seed the search (e.g. the name the AI read) so a match surfaces at once
  onSelect: (id: string, name: string) => void;
  onCreate?: (name: string) => void;   // omit to disable "add new"
  createKind?: string;                 // e.g. "vendor" → the create row reads "Add “X” as a vendor"
  onOpenChange?: (open: boolean) => void;  // lets the host lift its own stacking context while the list is open
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v); };
  const [q, setQ] = useState('');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Anchor the fixed popover to the field, clamped inside the viewport; flip up when the bottom is tight.
  const position = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, 240), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const below = vh - r.bottom - 8, above = r.top - 8;
    const flipUp = below < 220 && above > below;
    setAnchor(flipUp
      ? { left, width, bottom: vh - r.top + 4, maxH: Math.max(150, Math.min(300, above)) }
      : { left, width, top: r.bottom + 4, maxH: Math.max(150, Math.min(300, below)) });
  };

  useLayoutEffect(() => { if (open) position(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => position();
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); document.removeEventListener('mousedown', onDown); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div ref={ref} style={{ position: 'relative', marginTop: 4, minWidth: 0 }}>
      <button ref={btnRef} type="button" onClick={() => (open ? setOpen(false) : openNow())} style={fieldBtn}>
        <span style={{ ...font, flex: 1, minWidth: 0, fontSize: 13.5, color: valueName ? V.ink : V.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {valueName || placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={V.faint} strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && anchor && (
        <div style={{
          position: 'fixed', left: anchor.left, width: anchor.width,
          ...(anchor.top != null ? { top: anchor.top } : { bottom: anchor.bottom }),
          zIndex: 9999, maxHeight: anchor.maxH, display: 'flex', flexDirection: 'column',
          background: '#fff', border: `1px solid ${V.line}`, borderRadius: 12,
          boxShadow: '0 16px 36px -12px rgba(27,23,19,.32)', padding: 6, overflow: 'hidden',
        }}>
          <div style={searchRow}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={V.faint} strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or type a new name"
              style={{ flex: 1, minWidth: 0, border: 0, background: 'none', outline: 'none', ...font, fontSize: 14, color: V.ink }} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {showCreate && (
              <button type="button" onClick={() => { onCreate!(q.trim()); setOpen(false); setQ(''); }} style={{ ...row, color: V.terra, fontWeight: 600 }}>
                Add “{q.trim()}”{createKind ? ` as a ${createKind}` : ''}
              </button>
            )}
            {filtered.map((i) => (
              <button type="button" key={i.id} onClick={() => { onSelect(i.id, i.name); setOpen(false); setQ(''); }} style={row}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.name}</span>
                {i.tag && <span style={{ ...font, fontSize: 11, color: V.faint, flexShrink: 0 }}>{i.tag}</span>}
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
const searchRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, background: V.surface, borderRadius: 8, padding: '0 10px', height: 38, marginBottom: 4, flexShrink: 0,
};
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 40, padding: '6px 10px', borderRadius: 8,
  border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14, color: '#1B1713', fontFamily: 'inherit',
};
