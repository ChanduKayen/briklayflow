/**
 * Day Book design tokens — the ONE source for the module (brief: do not copy
 * these per file; the reference's chapter-chip drift came from duplication).
 *
 * V  — warm Briklay palette (shared lineage with the ledger tokens)
 * N  — night / binding tokens for the dark invitation banner
 * T  — fluid clamp type scale (all type goes through T, never fixed px)
 * WA — WhatsApp brand green, used ONLY as the channel signature
 */
import type { CSSProperties } from 'react';

export const V = {
  ink: '#1E1A15', inkSoft: '#3D3830', sys: '#6B6258', faint: '#9A9186',
  terra: '#BC4B27', terraDeep: '#8F3318', terraWash: '#FBEFE9',
  ask: '#8A5A0B', askWash: '#FBF3E0', askLine: '#E5C98F',
  sage: '#2F5D34', sageWash: '#E9F2E7',
  page: '#FBF9F6', surface: '#FFFFFF', field: '#F4F2EE', line: '#EAE6E0',
} as const;

export const N = {
  bg: 'linear-gradient(150deg, #2B251E 0%, #211B15 100%)',
  text: '#F6F1EA',
  textSoft: 'rgba(246,241,234,0.74)',
  textFaint: 'rgba(246,241,234,0.46)',
  keyline: 'rgba(246,241,234,0.16)',
  field: 'rgba(246,241,234,0.07)',
  terra: '#D96A43',
} as const;

/** WhatsApp brand green — channel signature only, never a status colour. */
export const WA = '#25D366';

export const font: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif" };
export const serif: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
export const nums: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
export const terraGrad = 'linear-gradient(135deg, #C75530 0%, #A93E1F 100%)';

/**
 * THE DAY BOOK'S THREE VOICES.
 *
 * A day book is a DOCUMENT — a bound ledger somebody signs off, page by page — and the redesign is
 * built on that idea rather than on "a feed of notifications". Three typefaces carry it, and each one
 * is doing a job that the other two cannot:
 *
 *   display  Playfair Display — the amount, and the date a day begins. The figure IS the fact; it is
 *            the thing the eye lands on and the thing the whole card exists to state. (Already loaded
 *            for the New Transaction ledger; the same voice, deliberately.)
 *   mono     DM Mono — the docket furniture: the voucher number, the timestamp, the running total. A
 *            ledger's small print has always been monospaced, and it is what makes the card read as a
 *            record rather than a message.
 *   telugu   Noto Sans Telugu — the supervisor's OWN WORDS, quoted verbatim and set in italic. This is
 *            the one line on the card nobody at head office wrote, and it must not fall back to
 *            whatever the operating system happens to have lying around.
 *
 * The PALETTE stays Briklay's (V above). The reference's cream/terracotta/sage sit within a hair of
 * these already, and a second palette living inside one module is how an app starts to look like two.
 */
export const display: CSSProperties = { fontFamily: "'Playfair Display', Georgia, serif" };
export const mono: CSSProperties = { fontFamily: "'DM Mono', ui-monospace, 'SF Mono', monospace" };
export const telugu: CSSProperties = { fontFamily: "'Noto Sans Telugu', 'DM Sans', sans-serif" };

/** Fluid type — scales with viewport, never fixed px. */
export const T: Record<'h1' | 'body' | 'sm' | 'xs' | 'amt', CSSProperties> = {
  h1:   { fontSize: 'clamp(1.6rem, 1.1rem + 2.2vw, 2.1rem)' },
  body: { fontSize: 'clamp(0.84rem, 0.78rem + 0.4vw, 0.95rem)' },
  sm:   { fontSize: 'clamp(0.8rem, 0.74rem + 0.3vw, 0.9rem)' },
  xs:   { fontSize: 'clamp(0.72rem, 0.68rem + 0.2vw, 0.8rem)' },
  amt:  { fontSize: 'clamp(1rem, 0.85rem + 0.7vw, 1.2rem)' },
};
