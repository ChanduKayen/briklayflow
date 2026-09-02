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

/** Warm-dark palette — the rail (the night binding). "Bitter chocolate" ground. */
export const N = {
  bg: 'linear-gradient(180deg, #191009 0%, #140D07 100%)',
  text: '#F5F0E7',
  textSoft: 'rgba(245,240,231,0.80)',
  textFaint: 'rgba(245,240,231,0.52)',
  hover: 'rgba(245,240,231,0.07)',
  activeBg: 'rgba(245,240,231,0.13)',
  keyline: 'rgba(245,240,231,0.10)',
  terra: '#B4532F',
  // the rail's right edge — a fine warm keyline, applied as an inset shadow (no layout width).
  edge: '#302014',
  // light-glass fill for monograms / the org plaque.
  well: 'rgba(245,240,231,0.09)',
  // a warm, recessed pocket for nested contexts (projects tray / in-project drawer)
  // — a touch warmer + deeper than the rail, with a faint top highlight for depth.
  recess: 'rgba(20,13,7,0.55)',
  recessLine: 'rgba(245,240,231,0.05)',
  // the secondary navbar surface — SAME bitter-chocolate family as the rail, only a HAIR
  // warmer/lighter so it reads as a quiet step beside the spine. A whisper of terra glow at its head.
  panel: 'linear-gradient(180deg, #221812 0%, #1B120B 100%)',
  panelGlow: 'radial-gradient(ellipse 85% 38% at 50% 0%, rgba(180,83,47,0.06) 0%, transparent 70%)',
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

/** Routes that show a secondary navbar (the second column): the Site Management hub AND any
 *  in-project page. On these the rail collapses to its spine and the App shell reserves
 *  RAIL_W + PANEL_W. Kept here so the rail's collapse and the content margin read from ONE place. */
/** The ONE secondary-nav context left: inside a project. (Site Management is deleted — the desk owns
 *  its own full width and needs no second column.) */
export function isSecondaryNavRoute(pathname: string): boolean {
  // in a specific project (/projects/:id/…) — but not the list (/projects) or the wizard (/projects/new)
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return !!(m && m[1] !== 'new');
}

/** Keyframes + scroll chrome for the rail and panel. Mounted once by the rail. */
export const NAV_ANIM = `
.nav-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.nav-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
/* ── the cursor-following "lamp": a warm glow + a latent drafting sheet, visible only under the
   pointer. Two absolute fx layers behind the rail content; the JS eases --mx/--my to the cursor. ── */
.briklay-rail { --mx: 50%; --my: 30%; }
.briklay-rail > *:not(.rail-fx) { position: relative; z-index: 1; }
.rail-fx { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: 0; transition: opacity .45s ease; }
.briklay-rail.lit .rail-fx { opacity: 1; }
.rail-glow {
  background:
    radial-gradient(115px circle at var(--mx) var(--my), rgba(180,83,47,.13), rgba(180,83,47,.05) 55%, transparent 75%),
    radial-gradient(215px circle at var(--mx) var(--my), rgba(245,240,231,.04), transparent 74%);
}
.rail-draft {
  background:
    repeating-linear-gradient(0deg, rgba(245,240,231,.055) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(90deg, rgba(245,240,231,.055) 0 1px, transparent 1px 26px);
  -webkit-mask-image: radial-gradient(115px circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 55%, transparent 82%);
          mask-image: radial-gradient(115px circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 55%, transparent 82%);
}
@media (prefers-reduced-motion: reduce) { .rail-fx { transition: none; } }
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
