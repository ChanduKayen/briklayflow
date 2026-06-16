/**
 * Navigation design tokens — the ONE source for the rail + context panel.
 *
 * N  — the warm-DARK "night binding" of the book: the always-present icon rail.
 * V  — the warm-LIGHT Briklay palette: the contextual secondary panel (shares
 *      lineage with the ledger / day-book tokens).
 * Widths + keyframes live here so the rail, the panel, and the App shell margin
 * all read from a single place (the reference's drift came from duplication).
 */
import type { CSSProperties } from 'react';

/** Warm-light palette — the contextual panel + light surfaces. */
export const V = {
  ink: '#1E1A15', inkSoft: '#3D3830', sys: '#6B6258', faint: '#9A9186',
  terra: '#BC4B27', terraDeep: '#8F3318', terraWash: '#FBEFE9',
  ask: '#8A5A0B', askWash: '#FBF3E0', askLine: '#E5C98F',
  sage: '#2F5D34', sageWash: '#E9F2E7',
  page: '#FBF9F6', surface: '#FFFFFF', field: '#F4F2EE', line: '#EAE6E0',
} as const;

/** Warm-dark palette — the rail (the night binding). */
export const N = {
  bg: 'linear-gradient(180deg, #383029 0%, #2F2820 100%)',
  text: '#F7F3EC',
  textSoft: 'rgba(247,243,236,0.66)',
  textFaint: 'rgba(247,243,236,0.40)',
  hover: 'rgba(247,243,236,0.055)',
  activeBg: 'rgba(247,243,236,0.08)',
  keyline: 'rgba(247,243,236,0.10)',
  terra: '#E07A4F',
  // a warm, recessed pocket for nested contexts (projects tray / in-project drawer)
  // — a touch warmer + deeper than the rail, with a faint top highlight for depth.
  recess: 'rgba(28,18,11,0.55)',
  recessLine: 'rgba(247,243,236,0.05)',
} as const;

/** WhatsApp brand green — channel signature only. */
export const WA = '#25D366';

export const font: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif" };
export const serif: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
export const nums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
export const terraGrad = 'linear-gradient(135deg, #C75530 0%, #A93E1F 100%)';

/** Rail widths. The collapsed spine is a permanent spacer in the App shell; the
 *  expanded width floats OVER content on hover. The panel sits beside the spine. */
export const RAIL_W = 56;     // collapsed icon spine
export const RAIL_OPEN = 220; // hovered / pinned
export const PANEL_W = 224;   // contextual secondary panel

/** Keyframes + scroll chrome for the rail and panel. Mounted once by the rail. */
export const NAV_ANIM = `
.nav-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.nav-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
@keyframes navPanelIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
.nav-panel-in { animation: navPanelIn .22s cubic-bezier(.32,.72,0,1) both; }
@keyframes navPop { 0% { opacity: 0; transform: translateY(4px) scale(.98); } 100% { opacity: 1; transform: none; } }
.nav-pop { animation: navPop .14s ease both; transform-origin: top; }
/* in-place sign-out: a calm spinner + an indeterminate progress sweep */
@keyframes navSpin { to { transform: rotate(360deg); } }
.nav-spin { animation: navSpin .8s linear infinite; }
@keyframes navIndet { 0% { left: -42%; } 100% { left: 100%; } }
.nav-indet { position: absolute; left: -42%; bottom: 0; height: 2px; width: 42%; border-radius: 2px; background: linear-gradient(90deg, transparent, #C75530, transparent); animation: navIndet 1.05s cubic-bezier(.4,0,.2,1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .nav-panel-in, .nav-pop { animation: none !important; }
  .nav-spin { animation-duration: 1.4s !important; }
  .nav-indet { animation: none !important; left: 0 !important; width: 100% !important; opacity: .5; }
}
`;
