// Canonical cause vocabulary — the UI-side mirror of the cause_taxonomy table (P1.1).
// This is the FIXED contract: users tune timing per cause (Follow-up Rules), they do NOT
// add causes. Keep these keys + order in lockstep with the 20260626000007 seed. Anywhere a
// human picks/labels a cause (the Issues table dropdown, the Follow-up Rules surface) reads
// from here so the words never drift from the taxonomy. Timing defaults live in the DB, not
// here — this file is only the key→label vocabulary.

export interface CauseDef {
  key: string
  label: string
  /** true = recorded, never chased (weather, auspicious) — null clock/cadence in the taxonomy. */
  notChasedByDefault?: boolean
  isOther?: boolean
}

export const CAUSES: CauseDef[] = [
  { key: 'material',   label: 'Material' },
  { key: 'labour',     label: 'Labour' },
  { key: 'rework',     label: 'Rework' },
  { key: 'design',     label: 'Design / Drawing' },
  { key: 'client',     label: 'Client decision' },
  { key: 'payment',    label: 'Payment' },
  { key: 'equipment',  label: 'Equipment' },
  { key: 'weather',    label: 'Weather', notChasedByDefault: true },
  { key: 'statutory',  label: 'Statutory / Approval' },
  { key: 'access',     label: 'Site access / Logistics' },
  { key: 'auspicious', label: 'Auspicious timing', notChasedByDefault: true },
  { key: 'other',      label: 'Other', isOther: true },
]

export const CAUSE_KEYS = CAUSES.map((c) => c.key)
const CAUSE_LABEL = new Map(CAUSES.map((c) => [c.key, c.label]))

/** Human label for a stored cause key; unknown/legacy keys fall back to the key itself. */
export function causeLabel(key: string | null | undefined): string {
  if (!key) return 'Other'
  return CAUSE_LABEL.get(key) ?? key
}
