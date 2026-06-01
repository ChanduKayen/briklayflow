import { useState } from 'react';

interface AttributeOption {
  value: string;
  hint?: string;
}

interface AttributePillSelectorProps {
  label:            string;
  description?:     string;
  coveragePercent?: number;
  options:          AttributeOption[];
  selected?:        string;
  onSelect:         (value: string) => void;
  onCustomValue:    (value: string) => void;
}

export function AttributePillSelector({
  label, description, coveragePercent, options, selected, onSelect, onCustomValue,
}: AttributePillSelectorProps) {
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [customVal, setCustomVal]           = useState('');

  return (
    <div className="flex flex-col gap-2 p-4 bg-surface-container-low rounded-lg border border-outline-variant/30 animate-peek-in">
      <div className="flex justify-between items-baseline">
        <div className="flex flex-col">
          <span className="font-semibold text-on-surface text-sm capitalize">{label}</span>
          {description && (
            <span className="text-xs text-on-surface-variant/50 italic">{description}</span>
          )}
        </div>
        {coveragePercent != null && (
          <span className="text-[10px] font-medium text-on-surface-variant/40 bg-surface-container/60 px-1.5 py-0.5 rounded">
            {coveragePercent}% of entries
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {options.map((opt) => {
          const isSelected = selected === opt.value && !showOtherInput;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setShowOtherInput(false); onSelect(opt.value); }}
              className={`min-h-[48px] px-4 py-2 rounded-lg border text-sm font-medium transition-all flex flex-col justify-center items-center gap-0.5 ${
                isSelected
                  ? 'bg-primary border-primary text-on-primary shadow-sm'
                  : 'bg-white border-outline-variant/30 text-on-surface-variant hover:border-primary/40 active:bg-surface-container'
              }`}
            >
              <span>{opt.value}</span>
              {opt.hint && (
                <span className={`text-[10px] ${isSelected ? 'text-on-primary/70' : 'text-on-surface-variant/40'}`}>
                  {opt.hint}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setShowOtherInput(true)}
          className={`min-h-[48px] px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
            showOtherInput
              ? 'bg-primary border-primary text-on-primary'
              : 'bg-white border-outline-variant/30 text-on-surface-variant hover:border-primary/40'
          }`}
        >
          Other
        </button>
      </div>

      {showOtherInput && (
        <div className="mt-2 animate-peek-in">
          <input
            type="text"
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value)}
            onBlur={() => { if (customVal.trim()) onCustomValue(customVal.trim()); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customVal.trim()) {
                e.preventDefault();
                onCustomValue(customVal.trim());
              }
            }}
            placeholder={`Enter custom ${label.toLowerCase()}…`}
            className="w-full min-h-[48px] px-3 border border-outline-variant/30 rounded-lg shadow-inner text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
