import { useState } from 'react';
import type { PillData } from '../lib/buildPillsFromResolution';
import { humanLabel } from '../lib/buildPillsFromResolution';

export interface InlineAttributePillsProps {
  pills:                 PillData[];
  onSelectOption:        (attribute: string, value: string) => void;
  onCustomValue:         (attribute: string, value: string) => void;
  onConfirmSuggestion?:  (attribute: string, value: string) => void;
  // Editable-pill state owned by the parent so it survives re-renders.
  editingPill?:          string | null;
  onPillTap?:            (attribute: string) => void;
  familyName?:           string;
  familySize?:           number;
  isOrphan?:             boolean;
}

export function InlineAttributePills({
  pills, onSelectOption, onCustomValue, onConfirmSuggestion,
  editingPill, onPillTap,
  familyName, familySize, isOrphan,
}: InlineAttributePillsProps) {
  const firstConflict     = pills.find(p => p.state === 'conflict') || null;
  const firstMissingIndex = pills.findIndex(p => p.state === 'missing');
  const firstMissing      = firstMissingIndex >= 0 ? pills[firstMissingIndex] : null;
  const editingPillData   = editingPill ? pills.find(p => p.attribute === editingPill) : null;
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal,  setCustomVal]  = useState('');

  const focusedAttr = editingPill ?? firstConflict?.attribute ?? firstMissing?.attribute ?? '';

  return (
    <div className="mt-2">
      {familyName && familySize && familySize > 1 && (
        <p className="text-[11px] text-on-surface-variant/30 mb-2">
          {familySize} {familyName.toLowerCase()} items in catalog
        </p>
      )}
      {isOrphan && (
        <p className="text-[11px] text-on-surface-variant/30 mb-2">
          New item — web suggests these specs
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 mb-2">
        {pills.map(pill => {
          const isSuggested  = pill.state === 'suggested';
          const isConflict   = pill.state === 'conflict';
          const isSatisfied  = pill.state === 'satisfied';
          const isMissing    = pill.state === 'missing';
          const isCommon     = pill.state === 'common';
          const isEditable   = isSatisfied && pill.editable && pill.attribute !== 'sub_category';
          const isEditing    = editingPill === pill.attribute;

          const onClick = () => {
            if (isSuggested && pill.value && onConfirmSuggestion) {
              onConfirmSuggestion(pill.attribute, pill.value);
            } else if (isEditable && onPillTap) {
              onPillTap(pill.attribute);
            }
          };

          let className = 'inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-medium transition-all duration-200';
          if (isConflict) {
            className += ' bg-red-50 text-red-700 border border-red-200';
          } else if (isSatisfied) {
            className += isEditable
              ? (isEditing
                  ? ' bg-primary/10 text-primary ring-1 ring-primary/20 cursor-pointer'
                  : ' bg-on-surface/8 text-on-surface hover:bg-on-surface/12 cursor-pointer')
              : ' bg-on-surface/8 text-on-surface';
          } else if (isMissing) {
            className += ' bg-amber-50 text-amber-700 border border-amber-200 ring-1 ring-amber-100';
          } else if (isSuggested) {
            className += ' bg-white text-on-surface-variant border border-dashed border-primary/40 cursor-pointer hover:border-primary/70 hover:text-primary';
          } else if (isCommon) {
            className += ' bg-surface-container/50 text-on-surface-variant/35';
          }

          const title = isConflict
            ? `You typed ${pill.value} — catalog has ${pill.conflictWith}`
            : isSuggested
              ? `Tap to confirm ${pill.value}`
              : isEditable
                ? `${pill.label}: ${pill.value} — tap to change`
                : (pill.value ?? `${pill.label} not yet specified`);

          return (
            <span
              key={`${pill.attribute}-${pill.value ?? '?'}`}
              role={(isSuggested || isEditable) ? 'button' : undefined}
              onClick={(isSuggested || isEditable) ? onClick : undefined}
              className={className}
              title={title}
            >
              {isMissing && (
                <span className="material-symbols-outlined text-[12px] mr-1">help</span>
              )}
              {isConflict && pill.conflictWith ? (
                <span className="inline-flex items-center gap-1">
                  <span>{pill.value}</span>
                  <span className="text-red-300 text-[10px]">≠</span>
                  <span className="text-red-400">{pill.conflictWith}</span>
                </span>
              ) : (
                pill.value || `${pill.label}?`
              )}
              {isSuggested && (
                <span className="material-symbols-outlined text-[12px] ml-1 text-primary/60">check</span>
              )}
              {isEditable && !isEditing && (
                <span className="material-symbols-outlined text-[10px] ml-0.5 opacity-30">edit</span>
              )}
            </span>
          );
        })}
      </div>

      {/* Conflict resolution — two explicit choices: keep existing vs add as new */}
      {firstConflict && firstConflict.conflictWith && (
        <div
          key={`conflict-${focusedAttr}`}
          className="animate-in fade-in slide-in-from-bottom-1 duration-200 mt-1 mb-2"
        >
          <p className="text-[11px] text-red-600/70 mb-1.5">
            You typed <span className="font-semibold">{firstConflict.value}</span> —
            catalog has <span className="font-semibold">{firstConflict.conflictWith}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSelectOption(firstConflict.attribute, firstConflict.conflictWith!)}
              className="flex-1 px-3 py-2 rounded-lg border border-outline-variant/20 text-[12px] font-medium
                text-on-surface-variant bg-white hover:border-primary/30 active:scale-[0.97] transition-all min-h-[44px]"
            >
              <span className="block text-[13px]">{firstConflict.conflictWith}</span>
              <span className="block text-[10px] text-on-surface-variant/40 mt-0.5">use existing</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectOption(firstConflict.attribute, firstConflict.value!)}
              className="flex-1 px-3 py-2 rounded-lg border border-primary/20 text-[12px] font-medium
                text-primary bg-primary/5 hover:bg-primary/10 active:scale-[0.97] transition-all min-h-[44px]"
            >
              <span className="block text-[13px]">{firstConflict.value}</span>
              <span className="block text-[10px] text-primary/50 mt-0.5">add as new</span>
            </button>
          </div>
        </div>
      )}

      {/* Editable satisfied pill — inline options for re-selection */}
      {!firstConflict && editingPillData && editingPillData.options && editingPillData.options.length > 0 && (
        <div key={`edit-${focusedAttr}`} className="animate-in fade-in slide-in-from-bottom-1 duration-150 mb-2">
          <div className="flex flex-wrap gap-1.5">
            {editingPillData.options.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => onSelectOption(editingPillData.attribute, opt)}
                className={`px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all min-h-[36px] ${
                  opt === editingPillData.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/20 text-on-surface-variant bg-white hover:border-primary/30'
                }`}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setCustomOpen(true); setCustomVal(''); }}
              className="px-3 py-1.5 rounded-lg border border-dashed border-outline-variant/15 text-[12px]
                text-on-surface-variant/40 hover:border-primary/20 transition-all min-h-[36px]"
            >
              Other
            </button>
          </div>
          {customOpen && (
            <input
              type="text"
              value={customVal}
              autoFocus
              onChange={e => setCustomVal(e.target.value)}
              onBlur={() => {
                const v = customVal.trim();
                setCustomOpen(false);
                if (v) onCustomValue(editingPillData.attribute, v);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = customVal.trim();
                  setCustomOpen(false);
                  if (v) onCustomValue(editingPillData.attribute, v);
                } else if (e.key === 'Escape') {
                  setCustomOpen(false);
                }
              }}
              placeholder={`Enter ${humanLabel(editingPillData.attribute).toLowerCase()}…`}
              className="mt-2 w-full min-h-[36px] px-3 border border-outline-variant/30 rounded-lg
                shadow-inner text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          )}
        </div>
      )}

      {/* Options for the first missing pill (progressive disclosure). Skipped
          while a conflict is active or a satisfied pill is being edited. */}
      {!firstConflict && !editingPillData && firstMissing && firstMissing.options && firstMissing.options.length > 0 && (
        <div key={focusedAttr} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
          <div className="flex flex-wrap gap-1.5">
            {firstMissing.options.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => onSelectOption(firstMissing.attribute, opt)}
                className="px-3 py-1.5 rounded-lg border border-outline-variant/20 text-[12px] font-medium
                  text-on-surface-variant bg-white hover:border-primary/30 hover:text-primary
                  active:scale-[0.97] transition-all min-h-[36px]"
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setCustomOpen(true); setCustomVal(''); }}
              className="px-3 py-1.5 rounded-lg border border-dashed border-outline-variant/15 text-[12px]
                text-on-surface-variant/40 hover:border-primary/20 hover:text-on-surface-variant
                transition-all min-h-[36px]"
            >
              Other
            </button>
          </div>

          {customOpen && (
            <input
              type="text"
              value={customVal}
              autoFocus
              onChange={e => setCustomVal(e.target.value)}
              onBlur={() => {
                const v = customVal.trim();
                setCustomOpen(false);
                if (v) onCustomValue(firstMissing.attribute, v);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = customVal.trim();
                  setCustomOpen(false);
                  if (v) onCustomValue(firstMissing.attribute, v);
                } else if (e.key === 'Escape') {
                  setCustomOpen(false);
                }
              }}
              placeholder={`Enter ${humanLabel(firstMissing.attribute).toLowerCase()}…`}
              className="mt-2 w-full min-h-[36px] px-3 border border-outline-variant/30 rounded-lg
                shadow-inner text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          )}
        </div>
      )}
    </div>
  );
}

export interface CardCheckmarkProps {
  isReady:     boolean;
  isAvailable: boolean;
  onCommit:    () => void;
}

export function CardCheckmark({ isReady, isAvailable, onCommit }: CardCheckmarkProps) {
  if (!isAvailable) return null;
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onCommit(); }}
      className={`flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 ${
        isReady
          ? 'bg-primary text-on-primary shadow-sm hover:shadow-md active:scale-[0.92]'
          : 'bg-surface-container text-on-surface-variant/30 hover:bg-surface-container-high active:scale-[0.95]'
      }`}
      title={isReady ? 'Link this item' : 'Link as-is (some details missing)'}
    >
      <span
        className="material-symbols-outlined text-[18px]"
        style={{ fontVariationSettings: isReady ? "'FILL' 1" : "'FILL' 0" }}
      >
        check
      </span>
    </button>
  );
}
