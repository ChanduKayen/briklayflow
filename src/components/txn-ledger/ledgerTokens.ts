/**
 * Transactions-ledger design tokens (verbatim from
 * docs/reference/BriklayTransactionsPage.jsx). The warm Briklay palette; DM Sans
 * for machine-set entries, Georgia for written totals, tabular nums for money.
 */
import type { CSSProperties } from 'react';

export const V = {
  ink: '#1E1A15', inkSoft: '#3D3830', sys: '#6B6258', faint: '#9A9186',
  terra: '#BC4B27', terraDeep: '#8F3318', terraWash: '#FBEFE9',
  ask: '#8A5A0B', askWash: '#FBF3E0', askLine: '#E5C98F',
  sage: '#2F5D34', sageWash: '#E9F2E7',
  page: '#FBF9F6', surface: '#FFFFFF', field: '#F4F2EE', line: '#EAE6E0',
} as const;

export const font: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif" };
export const serif: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
export const nums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
export const terraGrad = 'linear-gradient(135deg, #C75530 0%, #A93E1F 100%)';
