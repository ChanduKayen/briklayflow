import { useState, useRef, useEffect, useCallback } from 'react';
import { GEN_HEADS, getCostCode } from '../lib/costCodes';

interface Props {
  value: string;                 // selected GEN code, e.g. "GEN-01"
  onChange: (code: string) => void;
  error?: boolean;
}

/**
 * A flat picker over the general-expense heads (GEN-xx). Mirrors CostCodePicker's
 * trigger/dropdown grammar but with no MAT/WRK tabs — general expenses are a single
 * short list, so a searchable flat list is enough.
 */
export function GenHeadPicker({ value, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60);
  }, [open]);

  const q = search.trim().toLowerCase();
  const items = q
    ? GEN_HEADS.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
    : GEN_HEADS;

  const handleSelect = useCallback((code: string) => {
    onChange(code);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const found = value ? getCostCode(value) : null;

  return (
    <div ref={containerRef} className="relative">
      {found ? (
        <div className="flex items-center gap-2">
          <div className={`flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border ${
            error ? 'border-error' : 'border-outline-variant/30'
          } bg-surface-container-lowest`}>
            <span className="font-data-mono text-[11px] text-primary/80 shrink-0">{found.item.code}</span>
            <span className="text-[12px] text-on-surface-variant/50 shrink-0">·</span>
            <span className="text-[13px] font-medium text-on-surface flex-1 leading-tight">{found.item.name}</span>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="p-1.5 rounded-lg hover:bg-surface-container transition-colors text-on-surface-variant/40 hover:text-on-surface-variant shrink-0">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
          <button type="button" onClick={() => setOpen(true)}
            className="px-3 py-2 rounded-lg border border-outline-variant/30 text-[11px] font-medium text-on-surface-variant/60 hover:border-primary/40 hover:text-primary transition-all shrink-0">
            Change
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left transition-all ${
            error
              ? 'border-error text-error bg-error/[0.04]'
              : 'border-outline-variant/30 text-on-surface-variant/50 hover:border-primary/40 hover:text-primary bg-white'
          }`}>
          <span className="material-symbols-outlined text-[16px] opacity-60">receipt_long</span>
          <span className="text-[13px] flex-1">Select expense head…</span>
          <span className="material-symbols-outlined text-[14px] opacity-40">expand_more</span>
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1.5 left-0 right-0 bg-white rounded-2xl border border-outline-variant/20 shadow-elevation-8 overflow-hidden flex flex-col"
          style={{ maxHeight: 340 }}>
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-outline-variant/[0.08]">
            <span className="material-symbols-outlined text-[15px] text-on-surface-variant/40 shrink-0">search</span>
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search expense heads…"
              className="flex-1 text-[13px] bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/35" />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-on-surface-variant/40">No matches found</div>
            ) : (
              items.map((item) => (
                <button key={item.code} type="button" onClick={() => handleSelect(item.code)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-container-low/60 transition-colors border-b border-outline-variant/[0.06] last:border-0 ${
                    item.code === value ? 'bg-primary/[0.06]' : ''
                  }`}>
                  <span className="font-data-mono text-[10.5px] text-primary/70 shrink-0 w-[52px]">{item.code}</span>
                  <span className={`flex-1 text-[12.5px] leading-snug ${item.code === value ? 'font-semibold text-on-surface' : 'text-on-surface-variant/80'}`}>{item.name}</span>
                  {item.code === value && (
                    <span className="material-symbols-outlined text-[14px] text-primary shrink-0">check</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
