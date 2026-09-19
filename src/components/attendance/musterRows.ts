/**
 * What a muster always offers.
 *
 * A mason does not turn up alone. He turns up with a helper, often two, and the man marking the
 * register is standing in the doorway counting heads — not editing an engagement. So the sheet that
 * records a day always shows the same three lines:
 *
 *     the trade itself · Helper · male · Helper · female
 *
 * A line the crew already carries is the crew's own, with its days and its rate. A line it does not
 * carry yet is OFFERED at the rate card's rate and costs nothing until somebody marks it — the first
 * tap creates it. Anything else the crew carries (a supervisor, a second trade) keeps its place after
 * the three, because it was put there on purpose.
 *
 * Both surfaces read this, so the phone and the desktop offer the same lines in the same order.
 */

export const HELPER_M = 'Helper · male';
export const HELPER_F = 'Helper · female';

/** Names are typed by people: "Helper - male", "helper male" and "Helper · male" are one thing. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const K_HM = key(HELPER_M), K_HF = key(HELPER_F);

export const isHelper = (label: string) => { const k = key(label); return k === K_HM || k === K_HF; };
/** A supervisor is not a trade and never stands in for one. */
export const isSupervisor = (label: string) => key(label) === 'supervisor';

/** The trade a crew's muster leads with: what it was engaged as, else the first line that is a trade. */
export function skilledOf(trade: string | null | undefined, existing: readonly string[]): string | null {
  const t = (trade || '').trim();
  if (t && !isHelper(t) && !isSupervisor(t)) return t;
  return existing.find((l) => !isHelper(l) && !isSupervisor(l)) ?? null;
}

export interface MusterLine<T> {
  label: string;
  rate: number;
  /** The crew's own line, or null when this one is only being offered. */
  own: T | null;
}

/**
 * The lines a muster shows, in the order it shows them. `existing` keeps its own order among the
 * extras; the three standard lines always come first, whether or not the crew carries them yet.
 */
export function musterLines<T>(
  trade: string | null | undefined,
  existing: readonly { label: string; row: T }[],
  rateFor: (label: string) => number,
): MusterLine<T>[] {
  const own = (label: string) => existing.find((e) => key(e.label) === key(label)) ?? null;
  const skilled = skilledOf(trade, existing.map((e) => e.label));
  const heads = [skilled, HELPER_M, HELPER_F].filter((x): x is string => !!x);
  const lines: MusterLine<T>[] = heads.map((label) => {
    const e = own(label);
    // An existing line keeps the label and the rate the crew actually carries.
    return e ? { label: e.label, rate: rateFor(e.label), own: e.row } : { label, rate: rateFor(label), own: null };
  });
  const taken = new Set(heads.map(key));
  existing.forEach((e) => { if (!taken.has(key(e.label))) lines.push({ label: e.label, rate: rateFor(e.label), own: e.row }); });
  return lines;
}
