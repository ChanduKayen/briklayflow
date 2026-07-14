// PLAN SETUP — THE RULES PICK, THE USER OVERRULES.
//
// Ported verbatim from the reference (plan-setup-v6.html): the same four groups, the same thresholds,
// the same precedence. It lives here rather than in the component because it is the only part of the
// setup screen that can be WRONG — a lift that never gets built because the rule missed it is a
// building with no lift — so it is pure, and it is tested.
//
// PRECEDENCE: a user's tick always wins. `userSet` holds only DIVERGENCES from what the rules chose;
// the moment a tick lands back on the rule's own answer the override is dropped, so changing the
// floor count picks the system up again instead of freezing the user's stale opinion in place.

export type Parking = 'none' | 'stilt' | 'cellar'

/** The four systems groups, in the order the popover shows them. Labels are the engine's labels. */
export const SYSTEMS: Record<string, string[]> = {
  Water: ['Overhead tank', 'Sump / UG tank', 'Borewell', 'STP'],
  Power: ['Transformer', 'DG / generator', 'Rooftop solar'],
  Access: ['Lift', 'Common staircase', 'Corridor finishes', 'Parking'],
  Site: ['Compound wall & gate', 'Landscaping', 'Fire fighting'],
}

export const ALL_SYSTEMS: string[] = Object.values(SYSTEMS).flat()

/** What a building of this shape gets, before anybody touches it. */
export function autoSet(floors: number, units: number, park: Parking): Set<string> {
  const total = floors * units
  const climb = floors + (park === 'stilt' ? 1 : 0)

  const a = new Set<string>(['Overhead tank', 'Sump / UG tank', 'Borewell', 'Compound wall & gate'])
  if (park !== 'none') a.add('Parking')
  if (floors >= 2) a.add('Common staircase')
  if (floors >= 2 && units >= 2) a.add('Corridor finishes')
  if (climb >= 4) a.add('Lift')
  if (floors >= 5 || total >= 8) { a.add('Fire fighting'); a.add('STP') }
  if (total > 4) a.add('Transformer')
  if (total > 8) a.add('DG / generator')
  return a
}

export type UserSet = Record<string, boolean>

/** Is this system on? The user's answer if they gave one, the rules' answer otherwise. */
export const isOn = (name: string, auto: Set<string>, user: UserSet): boolean =>
  name in user ? user[name] : auto.has(name)

/** Every system that is on, in the popover's order. */
export const chosen = (auto: Set<string>, user: UserSet): string[] =>
  ALL_SYSTEMS.filter((n) => isOn(n, auto, user))

/**
 * Toggling a system. If the new answer AGREES with the rules, the override is deleted rather than
 * stored — otherwise a user who ticks "Lift" on a 4-floor building (where the rule already wanted a
 * lift) would carry a frozen opinion into a 2-floor one.
 */
export function toggle(name: string, auto: Set<string>, user: UserSet): UserSet {
  const next = !isOn(name, auto, user)
  const out = { ...user }
  if (next === auto.has(name)) delete out[name]
  else out[name] = next
  return out
}

/** Why the rules chose what they chose — shown under the popover, so the picks are never a mystery. */
export function ruleHints(floors: number, units: number, park: Parking, user: UserSet): string[] {
  const a = autoSet(floors, units, park)
  const hints: string[] = []
  if (a.has('Lift') && !('Lift' in user)) hints.push(park === 'stilt' ? 'lift at 3 floors over stilt' : 'lift at 4 floors')
  if (a.has('Transformer') && !('Transformer' in user)) hints.push('transformer above 4 homes')
  if (a.has('DG / generator') && !('DG / generator' in user)) hints.push('DG above 8 homes')
  return hints
}
