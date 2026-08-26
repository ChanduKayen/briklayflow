// Transactions importer — infer a new party's type + trade from the notes across its rows, so the
// create-new form arrives pre-filled. The LLM (sku-matcher `classifyStakeholderTrade`) only PROPOSES;
// this module owns the two pure, testable halves around it:
//   • what to ASK   — the new (unmatched) names + their gathered notes + the trades.ts vocabulary
//   • how to TRUST  — snap the model's answer back onto the real vocabulary, so a hallucinated or
//     off-list trade can NEVER reach the form. (Same lesson as the "Dr Shyam's" fabrication floor:
//     the model proposes, code disposes.)

import { ALL_WORKER_TRADES, ALL_VENDOR_TRADES, OTHER_TRADE } from './trades';
import { scorePayeeName } from './payeeSearch';
import type { NameGroup } from './importResolve';

export type StakeholderType = 'Worker' | 'Vendor' | 'Client';

export interface TradeVocab { Worker: string[]; Vendor: string[]; Client: string[] }

// The vocabulary sent to the model and used to snap its answer. Worker/Vendor come straight from
// trades.ts (the create-stakeholder dropdown's list); Client is a minimal set — a client's real
// `category` is free-text and clients are the rare income case in a v1 expenses import.
export const TRADE_VOCAB: TradeVocab = {
  Worker: ALL_WORKER_TRADES,
  Vendor: ALL_VENDOR_TRADES,
  Client: ['Villa buyer', 'Flat buyer', 'Contract work', OTHER_TRADE],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const SNAP_FLOOR = 0.6;   // below this, we don't claim a trade — fall back to "Other (specify)"

export interface ClassifyParty { name: string; notes: string[] }

/**
 * The parties worth classifying: the NEW names (band 'open' — no existing match), each with its
 * gathered notes. Matched/confirm names either already carry a type+trade or will be resolved to an
 * existing party by hand, so we don't spend a classification on them.
 */
export function partiesToClassify(groups: NameGroup[]): ClassifyParty[] {
  return groups
    .filter((g) => g.match.band === 'open')
    .map((g) => ({ name: g.src, notes: g.notes.slice(0, 15) }));
}

/**
 * Force one raw model answer onto the real taxonomy. The trade decides the type when it is a known
 * trade (a "Mason" is a Worker even if the model said Vendor); otherwise the type is taken from the
 * model (default Vendor) and the trade is snapped to the nearest in that type's list, or
 * "Other (specify)" when nothing is close. The result is ALWAYS a valid (type, trade) from trades.ts.
 */
export function snapClassification(
  raw: { type?: string | null; trade?: string | null },
  vocab: TradeVocab = TRADE_VOCAB,
): { type: StakeholderType; trade: string } {
  const rawTrade = (raw.trade ?? '').trim();

  // 1. Exact (case-insensitive) trade anywhere → the trade is the strong signal; it fixes the type.
  for (const t of ['Worker', 'Vendor', 'Client'] as StakeholderType[]) {
    const hit = vocab[t].find((x) => x.toLowerCase() === rawTrade.toLowerCase());
    if (hit) return { type: t, trade: hit };
  }

  // 2. Type from the model, default Vendor (the commonest party on an expenses import).
  const rt = (raw.type ?? '').trim().toLowerCase();
  const type: StakeholderType = rt === 'worker' ? 'Worker' : rt === 'client' ? 'Client' : 'Vendor';

  // 3. Snap the trade within that type's list; nothing close → Other (specify).
  if (rawTrade) {
    const best = vocab[type]
      .map((x) => ({ x, s: scorePayeeName(rawTrade.toLowerCase(), x) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= SNAP_FLOOR) return { type, trade: best.x };
  }
  return { type, trade: OTHER_TRADE };
}

/**
 * Fold the model's results into a lookup keyed by normalized name (matching NameGroup keys), each
 * snapped to the real vocabulary. Unnamed/garbage entries are dropped. The UI reads this to pre-fill
 * each new party's type + trade dropdowns.
 */
export function classificationsByName(
  results: { name?: string; type?: string | null; trade?: string | null }[],
  vocab: TradeVocab = TRADE_VOCAB,
): Record<string, { type: StakeholderType; trade: string }> {
  const out: Record<string, { type: StakeholderType; trade: string }> = {};
  for (const r of results) {
    if (!r || !r.name || !r.name.trim()) continue;
    out[norm(r.name)] = snapClassification(r, vocab);
  }
  return out;
}
