/**
 * The trade a new worker is created as.
 *
 * A party minted from the muster used to be written with no trade at all, and a party with no trade
 * has no rate: the crew came out as a gang of two helpers with no tradesman in it, and the week
 * priced a mason as a labourer. So the trade is asked first, and only then is anybody created.
 *
 * The list is THE list — src/lib/trades.ts, the same grouped one the Parties drawer offers when a
 * party is created anywhere else in the app, ending in "Other (specify)". It is a dropdown, not a
 * typed field, so the same mason is called the same thing everywhere and the aliases below can price
 * him: resolveTrade() maps a party trade ("Tile Fitter", "Shuttering Carpenter") onto the rate card's
 * own ("Tiler", "Carpenter").
 */
import { WORKER_TRADE_GROUPS, OTHER_TRADE } from '../../lib/trades';

export { WORKER_TRADE_GROUPS, OTHER_TRADE };

/**
 * The party list and the rate card speak different dialects: a party is a "Tile Fitter", the card
 * prices a "Tiler". This maps one onto the other, and it is the ONLY copy — it used to sit, verbatim,
 * in both attendance components, and the card lookup did not consult it at all, so a tiler was priced
 * at the ₹700 fallback instead of his own ₹950.
 *
 * A role that is not a trade — a helper, a supervisor, a guard — maps to nothing: it has no skilled
 * rate, and the muster prices it from the unskilled side of the card instead.
 */
const TRADE_ALIASES: Record<string, string> = {
  'painting worker': 'Painter', 'polish worker': 'Painter', 'wood polish worker': 'Painter', 'painter': 'Painter',
  'tile fitter': 'Tiler', 'marble fixer': 'Tiler', 'granite fixer': 'Tiler', 'tiler': 'Tiler',
  'shuttering carpenter': 'Carpenter', 'carpenter': 'Carpenter', 'modular kitchen installer': 'Carpenter', 'wardrobe installer': 'Carpenter',
  'bar bender / reinforcement': 'Bar bender', 'bar bender': 'Bar bender',
  'mason': 'Mason', 'stone mason': 'Mason', 'concrete worker': 'Mason',
  'electrician': 'Electrician', 'plumber': 'Plumber',
};
const NOT_A_TRADE = /helper|unskilled|labour|labor|supervisor|guard|housekeep|cleaner|driver|operator|material handler|security/;

/** The card's name for what this party does, or null when what they do is not a trade. */
export function cardTradeOf(category: string | null | undefined): string | null {
  const c = (category || '').trim(); if (!c) return null;
  const lc = c.toLowerCase();
  if (NOT_A_TRADE.test(lc)) return null;
  return TRADE_ALIASES[lc] || c;
}

/** The question, asked in the same words on a phone and at a desk. */
export const TRADE_ASK = {
  title: (name: string) => `What does ${name} do?`,
  sub: 'Their trade sets what a day of their work is worth.',
  placeholder: 'Select trade…',
  otherPlaceholder: 'Type the trade…',
  go: (name: string, trade: string) => `Add ${name} as ${trade}`,
  waiting: 'Pick what they do',
} as const;

/** What the card will pay for the trade just picked — shown so the site sees it before it commits.
 *  `known` is whether the card actually carries that trade: a rate it fell back to is not a rate the
 *  office set, and saying so is the difference between a quote and a guess. */
export function rateNote(trade: string, resolved: string | null, rate: number, known: boolean): string {
  if (!trade) return '';
  if (!(rate > 0)) return 'no rate on your card yet — set one under Rate card';
  const inr = '₹' + Math.round(rate).toLocaleString('en-IN');
  if (!known) return `${inr}/day · not on your rate card yet`;
  return resolved && resolved !== trade ? `${inr}/day · priced as ${resolved}` : `${inr}/day from your rate card`;
}

/** The dropdown's markup, built once so both surfaces offer the same options in the same order. */
export function tradeOptionsHTML(selected: string, esc: (s: string) => string): string {
  return `<option value="">${TRADE_ASK.placeholder}</option>` + WORKER_TRADE_GROUPS.map((g) =>
    `<optgroup label="${esc(g.group)}">${g.trades.map((t) =>
      `<option value="${esc(t)}"${t === selected ? ' selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('');
}
