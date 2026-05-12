import { useState, useRef, useEffect, useCallback } from 'react';
import {
  COST_DIVISIONS,
  MAT_DIVISIONS,
  WRK_DIVISIONS,
  getCostCode,
  type CostCodeDivision,
} from '../lib/costCodes';

interface Props {
  value: string;                        // selected code, e.g. "MAT-09-04"
  onChange: (code: string) => void;
  defaultType?: 'MAT' | 'WRK';         // which tab opens by default
  defaultDivision?: string;             // e.g. "WRK-22" — pre-scroll to division
  error?: boolean;
}

export function CostCodePicker({ value, onChange, defaultType = 'MAT', defaultDivision, error }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'MAT' | 'WRK'>(defaultType);
  const [activeDivCode, setActiveDivCode] = useState<string>(
    defaultDivision ?? (defaultType === 'MAT' ? 'MAT-01' : 'WRK-01')
  );
  const [search, setSearch] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef    = useRef<HTMLInputElement>(null);
  const divListRef   = useRef<HTMLDivElement>(null);

  // Sync tab + division when parent changes defaultType (e.g. txnType switch)
  useEffect(() => {
    setTab(defaultType);
    setActiveDivCode(defaultDivision ?? (defaultType === 'MAT' ? 'MAT-01' : 'WRK-01'));
  }, [defaultType, defaultDivision]);

  // Close on outside click
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

  // Focus search when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60);
  }, [open]);

  const divisions: CostCodeDivision[] = tab === 'MAT' ? MAT_DIVISIONS : WRK_DIVISIONS;

  // When searching, flatten across all divisions of current tab
  const searchQuery = search.trim().toLowerCase();
  const isSearching = searchQuery.length > 0;

  const filteredItems = isSearching
    ? COST_DIVISIONS
        .filter((d) => d.type === tab)
        .flatMap((d) =>
          d.items
            .filter(
              (i) =>
                i.name.toLowerCase().includes(searchQuery) ||
                i.code.toLowerCase().includes(searchQuery) ||
                d.name.toLowerCase().includes(searchQuery)
            )
            .map((i) => ({ ...i, divisionName: d.name, divisionCode: d.code }))
        )
    : divisions
        .find((d) => d.code === activeDivCode)
        ?.items.map((i) => ({
          ...i,
          divisionName: divisions.find((d) => d.code === activeDivCode)?.name ?? '',
          divisionCode: activeDivCode,
        })) ?? [];

  const handleSelect = useCallback((code: string) => {
    onChange(code);
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  }, [onChange]);

  const found = value ? getCostCode(value) : null;

  return (
    <div ref={containerRef} className="relative">

      {/* ── Trigger / Selected chip ─────────────────────────────────────── */}
      {found ? (
        <div className="flex items-center gap-2">
          <div className={`flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border ${
            error ? 'border-error' : 'border-outline-variant/30'
          } bg-surface-container-lowest`}>
            <span className="font-data-mono text-[11px] text-primary/80 shrink-0">{found.item.code}</span>
            <span className="text-[12px] text-on-surface-variant/50 shrink-0">·</span>
            <span className="text-[13px] font-medium text-on-surface flex-1 leading-tight">{found.item.name}</span>
            <span className="text-[10px] text-on-surface-variant/40 shrink-0 hidden sm:block">{found.division.name}</span>
          </div>
          <button type="button" onClick={handleClear}
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
          <span className="material-symbols-outlined text-[16px] opacity-60">category</span>
          <span className="text-[13px] flex-1">Select cost code…</span>
          <span className="material-symbols-outlined text-[14px] opacity-40">expand_more</span>
        </button>
      )}

      {/* ── Dropdown panel ──────────────────────────────────────────────── */}
      {open && (
        <div className="absolute z-50 mt-1.5 left-0 right-0 bg-white rounded-2xl border border-outline-variant/20
          shadow-elevation-8 overflow-hidden flex flex-col"
          style={{ maxHeight: 360 }}>

          {/* Search + Tabs row */}
          <div className="flex items-center gap-0 border-b border-outline-variant/[0.08]">
            {/* Search */}
            <div className="flex items-center gap-2 flex-1 px-3.5 py-2.5">
              <span className="material-symbols-outlined text-[15px] text-on-surface-variant/40 shrink-0">search</span>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search codes or descriptions…"
                className="flex-1 text-[13px] bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/35"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')}
                  className="text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>

            {/* MAT / WRK tabs */}
            <div className="flex items-center pr-2 gap-1 shrink-0">
              {(['MAT', 'WRK'] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => {
                    setTab(t);
                    setActiveDivCode(t === 'MAT' ? 'MAT-01' : 'WRK-01');
                    setSearch('');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide transition-all ${
                    tab === t
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant/50 hover:bg-surface-container'
                  }`}>
                  {t === 'MAT' ? 'MATERIALS' : 'WORKS'}
                </button>
              ))}
            </div>
          </div>

          {/* Body: divisions + items */}
          {isSearching ? (
            /* Search results — flat list */
            <div className="overflow-y-auto flex-1">
              {filteredItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-on-surface-variant/40">No matches found</div>
              ) : (
                filteredItems.map((item) => (
                  <button key={item.code} type="button"
                    onClick={() => handleSelect(item.code)}
                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-container-low/60 transition-colors border-b border-outline-variant/[0.06] last:border-0 ${
                      item.code === value ? 'bg-primary/[0.06]' : ''
                    }`}>
                    <span className="font-data-mono text-[10.5px] text-primary/70 shrink-0 pt-0.5 w-[76px]">{item.code}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium text-on-surface leading-snug">{item.name}</p>
                      <p className="text-[10.5px] text-on-surface-variant/45 mt-0.5">{item.divisionCode} · {item.divisionName}</p>
                    </div>
                    {item.code === value && (
                      <span className="material-symbols-outlined text-[14px] text-primary shrink-0 mt-0.5">check</span>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            /* Two-panel: division list | items */
            <div className="flex flex-1 min-h-0" style={{ maxHeight: 280 }}>
              {/* Division list */}
              <div ref={divListRef} className="w-[168px] shrink-0 overflow-y-auto border-r border-outline-variant/[0.08] bg-surface-container-lowest/40">
                {divisions.map((div) => (
                  <button key={div.code} type="button"
                    onClick={() => setActiveDivCode(div.code)}
                    className={`w-full text-left px-3 py-2 transition-colors border-b border-outline-variant/[0.06] last:border-0 ${
                      div.code === activeDivCode
                        ? 'bg-primary/[0.08] border-l-2 border-l-primary'
                        : 'hover:bg-surface-container-low/60'
                    }`}>
                    <p className={`font-data-mono text-[9.5px] mb-0.5 ${div.code === activeDivCode ? 'text-primary' : 'text-on-surface-variant/45'}`}>
                      {div.code}
                    </p>
                    <p className={`text-[11px] leading-tight ${div.code === activeDivCode ? 'font-semibold text-on-surface' : 'text-on-surface-variant/70'}`}>
                      {div.name}
                    </p>
                  </button>
                ))}
              </div>

              {/* Items list */}
              <div className="flex-1 overflow-y-auto">
                {filteredItems.map((item) => (
                  <button key={item.code} type="button"
                    onClick={() => handleSelect(item.code)}
                    className={`w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-surface-container-low/60 transition-colors border-b border-outline-variant/[0.06] last:border-0 ${
                      item.code === value ? 'bg-primary/[0.06]' : ''
                    }`}>
                    <span className="font-data-mono text-[9.5px] text-primary/60 shrink-0 pt-0.5 w-[58px]">
                      {item.code.split('-').pop()?.padStart(2, '0') && item.code}
                    </span>
                    <p className={`flex-1 text-[12px] leading-snug ${item.code === value ? 'font-semibold text-on-surface' : 'text-on-surface-variant/80'}`}>
                      {item.name}
                    </p>
                    {item.code === value && (
                      <span className="material-symbols-outlined text-[14px] text-primary shrink-0 mt-0.5">check</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
