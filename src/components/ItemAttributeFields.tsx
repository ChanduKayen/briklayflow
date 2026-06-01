import { useState, useRef, useEffect } from 'react';
import type { PillData } from '../lib/buildPillsFromResolution';

interface ItemAttributeFieldsProps {
  pills:                PillData[];
  onSelectOption:       (attribute: string, value: string) => void;
  onCustomValue:        (attribute: string, value: string) => void;
  onConfirmSuggestion?: (attribute: string, value: string) => void;
  familyName?:          string;
  familySize?:          number;
  isOrphan?:            boolean;
  disabled?:            boolean;
  // Brand — ORDER-ONLY 4th field. Rendered as a sibling grid column; it is NEVER part of
  // `pills`, never a PillData, and never touches SKU resolution. Shown only when
  // onBrandChange is provided. Stays editable even when the line is linked (disabled is
  // for SKU fields; brand is order metadata).
  brandValue?:          string;
  brandOptions?:        string[];
  brandListId?:         string;
  onBrandChange?:       (value: string) => void;
  onBrandAdd?:          (value: string) => void;
}

// Brand intentionally excluded — pills system has no `brand` attribute today.
// Adding it requires a po_line_items.brand column + buildPills support first.
const FIELD_ORDER = ['dimension', 'variant', 'grade'] as const;

const FIELD_CONFIG: Record<string, { label: string; placeholder: string }> = {
  dimension: { label: 'Size / Dimension', placeholder: 'e.g. 12mm, 1 inch' },
  variant:   { label: 'Variant / Type',   placeholder: 'e.g. Elbow, Bend' },
  grade:     { label: 'Grade',            placeholder: 'e.g. Fe500, OPC 53' },
  material:  { label: 'Material',         placeholder: 'e.g. Brass, GI' },
  angle:     { label: 'Angle',            placeholder: 'e.g. 45°, 90°' },
  thread:    { label: 'Thread',           placeholder: 'e.g. Male, Female' },
  finish:    { label: 'Finish',           placeholder: 'e.g. Chrome, Matt' },
  thickness: { label: 'Thickness',        placeholder: 'e.g. 0.5mm, 18 gauge' },
  weight:    { label: 'Weight',           placeholder: 'e.g. 100gsm' },
};

const SKIP_ATTRS = new Set(['sub_category', 'family', 'info']);

export function ItemAttributeFields({
  pills, onSelectOption, onCustomValue, onConfirmSuggestion,
  familyName, familySize, isOrphan, disabled,
  brandValue, brandOptions, brandListId, onBrandChange, onBrandAdd,
}: ItemAttributeFieldsProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const pillMap = new Map<string, PillData>();
  for (const pill of pills) {
    if (SKIP_ATTRS.has(pill.attribute) || pill.attribute.startsWith('info_')) continue;
    pillMap.set(pill.attribute, pill);
  }

  const extraAttrs = pills
    .filter(p =>
      !SKIP_ATTRS.has(p.attribute)
      && !p.attribute.startsWith('info_')
      && !(FIELD_ORDER as readonly string[]).includes(p.attribute),
    )
    .map(p => p.attribute);
  const fieldsToShow: string[] = [...FIELD_ORDER, ...extraAttrs];

  const contextLine = familyName && familySize && familySize > 1
    ? `${familySize} ${familyName.toLowerCase()} variants in catalog`
    : isOrphan
      ? 'New item — web suggests these specs'
      : null;

  return (
    <div className="mt-2.5" ref={containerRef}>
      {contextLine && (
        <p className="text-[10px] text-on-surface-variant/40 mb-2 tracking-wide uppercase">
          {contextLine}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
        {fieldsToShow.map(attr => {
          const pill = pillMap.get(attr);
          const config = FIELD_CONFIG[attr] || {
            label: attr.charAt(0).toUpperCase() + attr.slice(1),
            placeholder: '',
          };
          const hasDropdown = !!(pill?.options && pill.options.length > 0);
          const isRequired  = pill?.state === 'missing';
          const isConflict  = pill?.state === 'conflict';
          const isSuggested = pill?.state === 'suggested';
          const isSatisfied = pill?.state === 'satisfied';

          return (
            <div key={attr} className="relative">
              <label className={`block text-[10px] font-medium mb-0.5 tracking-wide
                ${isRequired ? 'text-amber-600'
                  : isConflict ? 'text-red-600'
                  : 'text-on-surface-variant/55'
                }`}
              >
                {config.label}
                {isRequired && <span className="ml-1 text-amber-400 text-[8px]">●</span>}
              </label>

              <div className="relative">
                {hasDropdown && !isSatisfied ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpenDropdown(openDropdown === attr ? null : attr)}
                    className={`w-full text-left px-2.5 py-2 pr-7 rounded-lg text-[13px] transition-all min-h-[40px]
                      ${isRequired
                        ? 'bg-amber-50/50 border border-amber-200/60 text-on-surface hover:border-amber-300'
                        : isConflict
                          ? 'bg-red-50/50 border border-red-200/60 text-red-700'
                          : 'bg-surface-container-low border border-outline-variant/15 text-on-surface-variant hover:border-outline-variant/30'
                      }
                      ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                  >
                    <span className={pill?.value ? 'text-on-surface' : 'text-on-surface-variant/40 text-[12px]'}>
                      {pill?.value || config.placeholder}
                    </span>
                    <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant/35">
                      expand_more
                    </span>
                  </button>
                ) : (
                  <div className="relative group/field">
                    <input
                      type="text"
                      disabled={disabled}
                      readOnly={isSatisfied}
                      value={
                        isSatisfied
                          ? (pill?.value || '')
                          : (customInputs[attr] ?? pill?.value ?? '')
                      }
                      placeholder={disabled ? '—' : config.placeholder}
                      onChange={(e) => {
                        if (!isSatisfied) {
                          setCustomInputs(prev => ({ ...prev, [attr]: e.target.value }));
                        }
                      }}
                      onBlur={() => {
                        const val = customInputs[attr]?.trim();
                        if (val && val !== pill?.value) {
                          onCustomValue(attr, val);
                          setCustomInputs(prev => ({ ...prev, [attr]: '' }));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = customInputs[attr]?.trim();
                          if (val && val !== pill?.value) {
                            onCustomValue(attr, val);
                            setCustomInputs(prev => ({ ...prev, [attr]: '' }));
                          }
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className={`w-full px-2.5 py-2 rounded-lg text-[13px] outline-none transition-all min-h-[40px]
                        ${isSatisfied
                          ? `bg-on-surface/[0.03] border border-transparent text-on-surface cursor-default ${disabled ? 'opacity-70' : ''}`
                          : isConflict
                            ? 'bg-red-50/50 border border-red-200/60 text-red-700'
                          : isSuggested
                            ? 'bg-white border border-dashed border-primary/30 text-on-surface'
                          : disabled
                            ? 'bg-surface-container-low/50 border border-outline-variant/10 text-on-surface-variant/30 cursor-not-allowed'
                            : 'bg-surface-container-low border border-outline-variant/15 text-on-surface-variant focus:border-primary/40 focus:ring-1 focus:ring-primary/15'
                        }`}
                    />

                    {isSatisfied && pill?.value && hasDropdown && !disabled && (
                      <button
                        type="button"
                        onClick={() => setOpenDropdown(attr)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/field:opacity-100 text-on-surface-variant/35 hover:text-on-surface-variant transition-opacity"
                        title="Change"
                      >
                        <span className="material-symbols-outlined text-[13px]">edit</span>
                      </button>
                    )}

                    {isSuggested && pill?.value && onConfirmSuggestion && !disabled && (
                      <button
                        type="button"
                        onClick={() => onConfirmSuggestion(attr, pill.value!)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors"
                        title="Confirm"
                      >
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      </button>
                    )}
                  </div>
                )}

                {openDropdown === attr && hasDropdown && (
                  <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-outline-variant/20 py-1 max-h-[220px] overflow-y-auto">
                    {(pill?.options || []).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          onSelectOption(attr, opt);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 py-2.5 text-[13px] transition-colors min-h-[44px]
                          ${opt === pill?.value
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-on-surface hover:bg-surface-container-low'
                          }`}
                      >
                        {opt}
                      </button>
                    ))}
                    <div className="border-t border-outline-variant/15 mt-1 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenDropdown(null);
                          const val = prompt(`Enter ${config.label}:`);
                          if (val?.trim()) onCustomValue(attr, val.trim());
                        }}
                        className="w-full text-left px-3 py-2.5 text-[13px] text-on-surface-variant/60 hover:bg-surface-container-low min-h-[44px]"
                      >
                        Other…
                      </button>
                    </div>
                  </div>
                )}

                {isConflict && pill?.conflictWith && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-red-500/80">
                      Catalog has {pill.conflictWith}
                    </span>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => onSelectOption(attr, pill.conflictWith!)}
                        className="text-[10px] text-red-600 font-medium underline underline-offset-2 hover:text-red-700"
                      >
                        Use {pill.conflictWith}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Brand — order-only 4th column. Native datalist (suggestions + free text) plus a
            "+" button that persists a typed brand to the list. NOT a pill; never enters
            resolution. Editable regardless of link state (no `disabled` gate). */}
        {onBrandChange && (() => {
          const cur    = (brandValue || '').trim();
          const canAdd = !!cur && !(brandOptions || []).some(b => b.toLowerCase() === cur.toLowerCase());
          return (
            <div key="brand" className="relative">
              <label className="block text-[10px] font-medium mb-0.5 tracking-wide text-on-surface-variant/55">
                Brand <span className="text-on-surface-variant/30">(order)</span>
              </label>
              <div className="flex items-center gap-1">
                <input
                  list={brandListId}
                  value={brandValue || ''}
                  onChange={(e) => onBrandChange(e.target.value)}
                  placeholder="e.g. Finolex"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full px-2.5 py-2 rounded-lg text-[13px] outline-none transition-all min-h-[40px]
                             bg-surface-container-low border border-outline-variant/15 text-on-surface
                             focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
                />
                {brandListId && (
                  <datalist id={brandListId}>
                    {(brandOptions || []).map(b => <option key={b} value={b} />)}
                  </datalist>
                )}
                {onBrandAdd && (
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => canAdd && onBrandAdd(cur)}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-outline-variant/15
                               text-primary/80 hover:bg-primary/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title={canAdd ? `Add "${cur}" to the brand list` : 'Type a new brand to add it to the list'}
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
