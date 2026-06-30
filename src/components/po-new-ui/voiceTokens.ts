/**
 * Four-voice presentation tokens for the New PO redesign (ui/new-po-redesign).
 *
 * Implemented as a local constants object applied via inline styles — mirroring
 * NewPurchaseOrder_v3.jsx — rather than as Tailwind theme additions, to avoid
 * touching tailwind.config.js (brief §0.3 "do not modify config"). The Phase 1
 * §10 token mapping remains a *proposal*; nothing in the theme is edited.
 *
 *   USER    — the person's data (items, money, vendor, project). Darkest ink.
 *   SYSTEM  — narration (provenance, units, status, timestamps). Smaller, gray.
 *   ASK     — the system needs an answer. Amber, one question at a time.
 *   CONFIRM — something completed. Green, quiet (save ceremony is the exception).
 *
 * UI-only. Never read by any pipeline code path.
 */

export const V = {
  user:        '#1E1A15',
  userSoft:    '#3D3830',
  system:      '#6B6258',
  systemFaint: '#9A9186',
  ask:         '#8A5A0B',
  askDeep:     '#6B4407',
  askWash:     '#FBF3E0',
  askLine:     '#E5C98F',
  confirm:     '#2F5D34',
  confirmWash: '#E9F2E7',
  page:        '#FBFAF8',
  surface:     '#FFFFFF',
  field:       '#F4F2EE',
  // borders carry definition now (the old #E8E4DE was near-invisible); a real accent gives hierarchy.
  line:        '#DED7CB',
  lineStrong:  '#CFC6B6',
  accent:      '#C2592F',
  accentDeep:  '#A8451F',
  accentSoft:  '#FBECE3',
  accentLine:  '#EBC3AE',
} as const;

export const nums = { fontVariantNumeric: 'tabular-nums' } as const;
