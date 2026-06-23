/**
 * UiContractorCombobox — "Who's doing the work?" search combobox (brief §4 / B3).
 *
 * Reads the page's EXISTING ['workers'] list (passed in). Selection writes
 * through the page's existing setter (onSelect). "Add as new" does NOT insert
 * here — it calls onAddNew(typedName), which the page wires to its EXISTING
 * inline add-worker form + createWorker mutation (pre-filled with the typed
 * name). Normalized dedupe (trim/lowercase/collapse-whitespace, ruling 5): when
 * a near-identical name already exists it is surfaced as the top result and the
 * "add as new" row is suppressed.
 *
 * Local open/query state is cosmetic combobox UI — it does not duplicate any
 * pipeline state (the selected worker id lives in the page).
 */
import { useState } from 'react';
import { Search, Check, UserPlus, ArrowRight } from 'lucide-react';
import { V } from '../po-new-ui/voiceTokens';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface UiContractorComboboxProps {
  workers: { stakeholder_id: string; name: string }[];
  selectedId: string;
  selectedName: string;
  onSelect: (id: string) => void;
  onClear: () => void;
  onAddNew: (typedName: string) => void;
}

export default function UiContractorCombobox({
  workers, selectedId, selectedName, onSelect, onClear, onAddNew,
}: UiContractorComboboxProps) {
  const [uiOpen, setUiOpen] = useState(false);
  const [uiQuery, setUiQuery] = useState('');

  const q = uiQuery.trim();
  const nq = norm(uiQuery);
  const filtered = q === ''
    ? workers.slice(0, 6)
    : workers.filter((w) => norm(w.name).includes(nq));
  const exactExists = workers.some((w) => norm(w.name) === nq);

  const pick = (id: string) => { onSelect(id); setUiQuery(''); setUiOpen(false); };

  return (
    <div className="relative" style={{ maxWidth: 420 }}>
      <div
        className="flex items-center gap-2.5 px-3.5 rounded-xl"
        style={{ background: V.surface, border: `1px solid ${uiOpen ? V.userSoft : V.line}`, height: 46 }}
      >
        {selectedId && !uiOpen ? (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center font-medium shrink-0"
            style={{ background: V.user, color: '#fff', fontSize: 10 }}
            aria-hidden="true"
          >
            {selectedName.slice(0, 2).toUpperCase()}
          </span>
        ) : (
          <Search size={15} style={{ color: V.systemFaint }} />
        )}
        <input
          value={uiOpen ? uiQuery : (selectedName || '')}
          onChange={(e) => { setUiQuery(e.target.value); setUiOpen(true); }}
          onFocus={() => { setUiQuery(''); setUiOpen(true); }}
          onBlur={() => setTimeout(() => setUiOpen(false), 120)}
          placeholder="Search contractor…"
          aria-label="Search or add contractor"
          aria-expanded={uiOpen}
          role="combobox"
          className="flex-1 bg-transparent text-sm font-medium outline-none"
          style={{ color: V.user }}
        />
        {selectedId && !uiOpen && (
          <button
            type="button"
            onClick={() => { onClear(); setUiQuery(''); setUiOpen(true); }}
            aria-label="Change contractor"
            className="text-xs"
            style={{ color: V.systemFaint }}
          >
            change
          </button>
        )}
      </div>

      {uiOpen && (
        <div
          className="absolute left-0 right-0 mt-1.5 rounded-xl overflow-hidden z-30 max-h-72 overflow-y-auto"
          style={{ background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 8px 24px rgba(30,26,21,0.08)' }}
          role="listbox"
        >
          {q === '' && filtered.length > 0 && (
            <p className="text-xs px-3.5 pt-2.5 pb-1" style={{ color: V.systemFaint }}>recent</p>
          )}
          {filtered.map((w) => (
            <button
              key={w.stakeholder_id}
              type="button"
              onMouseDown={() => pick(w.stakeholder_id)}
              role="option"
              aria-selected={w.stakeholder_id === selectedId}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
              style={{ background: w.stakeholder_id === selectedId ? V.field : 'transparent' }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center font-medium shrink-0"
                style={{ background: V.field, color: V.system, fontSize: 10, border: `1px solid ${V.line}` }}
              >
                {w.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-sm flex-1" style={{ color: V.user }}>{w.name}</span>
              {w.stakeholder_id === selectedId && <Check size={14} style={{ color: V.confirm }} />}
            </button>
          ))}

          {/* Add-as-new — suppressed when a normalized match already exists (ruling 5).
              Zero matches → promoted to a hero row (one tap to add a brand-new contractor);
              with matches present it stays a quiet footer under the list. */}
          {q !== '' && !exactExists && filtered.length === 0 && (
            <button
              type="button"
              onMouseDown={() => { onAddNew(q); setUiQuery(''); setUiOpen(false); }}
              role="option"
              className="group w-full flex items-center gap-3 px-3.5 py-3 text-left"
              style={{ background: V.askWash }}
            >
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold"
                style={{ background: V.user, color: '#fff', fontSize: 14 }}
              >
                {q[0].toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate" style={{ color: V.user }}>Add &ldquo;{q}&rdquo;</span>
                <span className="block text-xs" style={{ color: V.system }}>New contractor · add trade &amp; phone</span>
              </span>
              <ArrowRight size={16} style={{ color: V.askDeep }} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
          {q !== '' && !exactExists && filtered.length > 0 && (
            <button
              type="button"
              onMouseDown={() => { onAddNew(q); setUiQuery(''); setUiOpen(false); }}
              role="option"
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
              style={{ borderTop: `1px solid ${V.line}` }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ border: `1px dashed ${V.askLine}`, color: V.askDeep }}
              >
                <UserPlus size={13} />
              </span>
              <span className="text-sm" style={{ color: V.user }}>
                Not here? <span className="font-medium">{q}</span>
                <span style={{ color: V.askDeep }}> — add as new contractor</span>
              </span>
            </button>
          )}

          {q !== '' && filtered.length === 0 && exactExists && (
            <p className="text-xs px-3.5 py-2.5" style={{ color: V.systemFaint }}>Already in your list above.</p>
          )}
        </div>
      )}
    </div>
  );
}
