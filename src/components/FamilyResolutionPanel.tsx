import { useState } from 'react';
import { AttributePillSelector } from './AttributePillSelector';
import type {
  AliasFamilyMatch, FamilyProfile, FamilyMember, TreeLevel, TreeResolution,
} from '../lib/skuTreeResolver';
import { normalizeAttrValue, isPlaceholder } from '../lib/skuTreeResolver';

interface FamilyResolutionPanelProps {
  originalInput: string;
  familyMatch:   AliasFamilyMatch;
  familyProfile: FamilyProfile;
  resolution:    TreeResolution;
  members:       FamilyMember[];
  onResolve:     (resolvedAttrs: Record<string, string>) => void;
  onSkip:        () => void;
}

export function FamilyResolutionPanel({
  originalInput, familyProfile, resolution, members, onResolve, onSkip,
}: FamilyResolutionPanelProps) {
  const [localResolved, setLocalResolved] = useState<Record<string, string>>({});
  const [revealedCount, setRevealedCount] = useState(Math.min(1, resolution.missing.length));

  const allMissing    = resolution.missing;
  const alreadyResolved = resolution.resolved;

  // Dynamically narrow options for a given missing level based on what's been selected so far
  function getOptionsForLevel(level: TreeLevel): string[] {
    const attrKey = level.attribute as keyof FamilyMember;
    const combined = { ...alreadyResolved, ...localResolved };

    // Filter members by everything already resolved
    const filtered = members.filter(m =>
      Object.entries(combined).every(([attr, val]) => {
        const mv = m[attr as keyof FamilyMember] as string | null;
        return mv ? normalizeAttrValue(mv) === normalizeAttrValue(val) : false;
      })
    );

    if (filtered.length > 0) {
      const vals = [...new Set(
        filtered
          .map(m => m[attrKey] as string | null)
          .filter((v): v is string => !!v && !isPlaceholder(v))
      )];
      if (vals.length > 0) return vals;
    }
    // Fall back to full profile values (handles novel-value candidate exhaustion)
    return level.values;
  }

  function handlePillSelect(attrName: string, value: string) {
    const newLocal   = { ...localResolved, [attrName]: value };
    setLocalResolved(newLocal);

    const combined   = { ...alreadyResolved, ...newLocal };
    const stillMissing = allMissing.filter(m => !combined[m.attribute]);

    if (stillMissing.length === 0) {
      onResolve(combined);
    } else {
      setRevealedCount(c => Math.min(c + 1, allMissing.length));
    }
  }

  function handleSave() {
    const combined = { ...alreadyResolved, ...localResolved };
    const allFilled = allMissing.every(m => combined[m.attribute]);
    if (allFilled) onResolve(combined);
  }

  const combined     = { ...alreadyResolved, ...localResolved };
  const allFilled    = allMissing.every(m => combined[m.attribute]);

  // Explanation text: range from dimension values
  const dimValues     = familyProfile.fields?.dimension?.common_values || [];
  const rangeText     = dimValues.length >= 2
    ? `, from ${dimValues[0]} to ${dimValues[dimValues.length - 1]}`
    : '';
  const firstMissing  = allMissing[0]?.attribute || 'specification';
  const question      = allMissing.length === 1
    ? `which ${firstMissing} is this?`
    : 'could you clarify?';

  // Siblings display
  const siblings          = (familyProfile.siblings || []).filter(Boolean);
  const siblingsToShow    = siblings.slice(0, 4);
  const siblingsRemainder = siblings.length - siblingsToShow.length;

  return (
    <div className="border-t border-amber-100 bg-amber-50/10 p-4">
      <div className="border-l-4 border-amber-400 pl-4 space-y-3">

        {/* Header */}
        <div>
          <p className="text-[12px] font-bold text-amber-900">
            {familyProfile.sub_category}
            <span className="font-normal text-amber-700/70 ml-1">
              · matched via "{originalInput}"
            </span>
          </p>

          {/* Explanation */}
          <p className="text-[11px] text-amber-800/80 mt-0.5">
            We have{' '}
            <span className="font-semibold">{familyProfile.family_size}</span>{' '}
            {familyProfile.sub_category} items in your catalog{rangeText}.
            To keep records clean and avoid duplicates, {question}
          </p>

          {/* Siblings */}
          {siblingsToShow.length > 0 && (
            <p className="text-[10px] text-amber-700/60 mt-1">
              <span className="font-semibold">Similar items: </span>
              {siblingsToShow.join(' · ')}
              {siblingsRemainder > 0 && (
                <span className="text-amber-600/60"> · +{siblingsRemainder} more</span>
              )}
            </p>
          )}
        </div>

        {/* Already resolved from regex */}
        {Object.keys(alreadyResolved).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(alreadyResolved).map(([attr, val]) => (
              <span
                key={attr}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 bg-green-100 text-green-800 border border-green-200 rounded-full"
              >
                <span className="text-green-600">✓</span>
                <span className="capitalize">{attr}:</span>
                <span className="font-bold">{val}</span>
                <span className="text-green-600/60 font-normal italic">(from your input)</span>
              </span>
            ))}
          </div>
        )}

        {/* Progressive pickers for missing levels */}
        <div className="space-y-3">
          {allMissing.slice(0, revealedCount).map((level) => (
            <AttributePillSelector
              key={level.attribute}
              label={level.attribute}
              coveragePercent={Number(level.coverage)}
              options={getOptionsForLevel(level).map(v => ({ value: v }))}
              selected={localResolved[level.attribute]}
              onSelect={(val) => handlePillSelect(level.attribute, val)}
              onCustomValue={(val) => handlePillSelect(level.attribute, val)}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!allFilled}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">link</span>
            Save &amp; Link
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-[11px] text-amber-700/70 hover:text-amber-900 hover:underline transition-colors"
          >
            Skip — add as generic {familyProfile.sub_category}
          </button>
        </div>
      </div>
    </div>
  );
}
