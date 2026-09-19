/**
 * The trades a new worker can be.
 *
 * A party created from the muster used to be minted the moment the name was typed, with no trade on
 * it at all — and a party with no trade has no rate, so the sheet then offered helpers where a mason
 * should have been, and the weekly muster priced him at nothing. So the name is not enough: the trade
 * is asked first, from the org's OWN rate card, and only then is the party created carrying it.
 *
 * The card is the list. Whatever the office put on it — the seven it starts with, or a welder added
 * later — is what the site is offered, at the rate the card actually pays. Below the trades sit the
 * two roles that are not trades: a helper, and a supervisor. And because a site will always meet a
 * trade nobody has written down yet, a typed one is accepted and carried on the party as given.
 */
import type { RateCard } from '../../lib/attendanceApi';
import { HELPER_M, HELPER_F } from './musterRows';

export interface TradeChoice {
  label: string;
  /** What the card pays for a day of it, or null when the card is silent. */
  rate: number | null;
}

export interface TradeChoices {
  /** The skilled trades on the org's card, alphabetical. */
  trades: TradeChoice[];
  /** What is not a trade: the helpers, and a supervisor. */
  roles: TradeChoice[];
}

export function tradeChoices(card: RateCard | null | undefined): TradeChoices {
  const trades = Object.entries(card?.trades ?? {})
    .map(([label, t]) => ({ label, rate: t.skilled }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const roles: TradeChoice[] = [
    { label: HELPER_M, rate: card?.unskilled.hm ?? null },
    { label: HELPER_F, rate: card?.unskilled.hf ?? null },
    { label: 'Supervisor', rate: card?.supervisor ?? null },
  ];
  return { trades, roles };
}

/** The question the picker asks, in both places, so it reads the same on a phone and a desk. */
export const TRADE_ASK = {
  title: (name: string) => `What does ${name} do?`,
  sub: 'From your rate card — it sets what a day of their work is worth.',
  otherLabel: 'Another trade',
  otherPlaceholder: 'Welder, fabricator, glazier…',
  none: 'Your rate card is empty. Type what they do.',
} as const;
