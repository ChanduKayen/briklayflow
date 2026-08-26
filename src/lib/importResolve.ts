// Transactions importer — the resolve layer. Pure decisions between parse (importParse.ts) and
// commit: collapse the sheet's rows to unique NAMES and SITES, band each against the org's
// stakeholders/projects, flag rows that cannot be filed, and detect ones already in the books.
// No I/O — the LLM category classify and the bulk write are separate, later phases.

import type { TxnMode } from './importParse';
import { matchPayee } from './payeeSearch';
import { matchProject } from './projectSearch';
import type { BandedMatch } from './matchBand';

/** One normalized sheet row (post importParse). `amount` is signed — a negative is an income signal,
 *  read by detectDirection at commit time (direction needs the resolved party type, so it is NOT
 *  decided here). */
export interface ParsedRow {
  rowNo: number;              // 1-based source row — display + idempotency key
  date: string | null;       // yyyy-mm-dd
  dateAmbiguous?: boolean;
  name: string | null;
  amount: number | null;     // signed
  site: string | null;
  mode: TxnMode | null;
  note: string | null;
  directionCell?: string | null;
}

const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// ── Grouping ─────────────────────────────────────────────────────────────────────────────────────
export interface NameGroup {
  key: string;          // normalized name (the dedupe key)
  src: string;          // first-seen raw spelling, for display
  rowNos: number[];     // every row that used this name
  notes: string[];      // all notes across those rows — the LLM classify reads these
  match: BandedMatch;   // banded against the org's stakeholders
}

/**
 * Collapse rows to unique names (resolve each ONCE, not per row) and band each against the roster.
 * Sorted most-used first, exactly as the prototype lists them. Rows with no name are ignored here —
 * a missing name is a validation issue (validateRow), not a name to resolve.
 */
export function groupNames(
  rows: ParsedRow[],
  stakeholders: { stakeholder_id: string; name: string; type?: string | null; category?: string | null }[],
): NameGroup[] {
  const by = new Map<string, NameGroup>();
  for (const r of rows) {
    if (!r.name || !r.name.trim()) continue;
    const key = normKey(r.name);
    let g = by.get(key);
    if (!g) {
      g = { key, src: r.name.trim(), rowNos: [], notes: [], match: matchPayee(r.name, stakeholders) };
      by.set(key, g);
    }
    g.rowNos.push(r.rowNo);
    if (r.note && r.note.trim()) g.notes.push(r.note.trim());
  }
  return [...by.values()].sort((a, b) => b.rowNos.length - a.rowNos.length);
}

export interface SiteGroup {
  key: string;
  src: string;
  rowNos: number[];
  match: BandedMatch;   // banded against the org's projects
}

/** Collapse rows to unique sites and band each against the projects. Rows with no site are handled
 *  in the Check step (a no-site expense), not here. */
export function groupSites(
  rows: ParsedRow[],
  projects: { id: string; name: string }[],
): SiteGroup[] {
  const by = new Map<string, SiteGroup>();
  for (const r of rows) {
    if (!r.site || !r.site.trim()) continue;
    const key = normKey(r.site);
    let g = by.get(key);
    if (!g) { g = { key, src: r.site.trim(), rowNos: [], match: matchProject(r.site, projects) }; by.set(key, g); }
    g.rowNos.push(r.rowNo);
  }
  return [...by.values()].sort((a, b) => b.rowNos.length - a.rowNos.length);
}

// ── Validation ─────────────────────────────────────────────────────────────────────────────────────
export type IssueField = 'amount' | 'date' | 'name';
export interface RowIssue { field: IssueField; why: string }

/**
 * The single most-blocking reason a row can't be filed as-is, or null when it's clean. One issue per
 * row (the prototype's single highlighted cell); checked amount → date → name so the commonest gap
 * (a missing/zero amount) surfaces first.
 */
export function validateRow(r: ParsedRow): RowIssue | null {
  if (r.amount == null) return { field: 'amount', why: 'blank' };
  if (r.amount === 0) return { field: 'amount', why: 'zero' };
  if (!r.date) return { field: 'date', why: 'unreadable' };
  if (r.dateAmbiguous) return { field: 'date', why: 'ambiguous' };
  if (!r.name || !r.name.trim()) return { field: 'name', why: 'blank' };
  return null;
}

// ── Duplicate detection ──────────────────────────────────────────────────────────────────────────
export interface ExistingTxn {
  txn_id: string;
  stakeholder_id: string | null;
  date: string;              // yyyy-mm-dd
  amount: number;
  mode: TxnMode | null;
}

/** A sheet row after the user has resolved its party (the id is known, so a dup can be judged). */
export interface ResolvedRow {
  rowNo: number;
  stakeholderId: string | null;
  date: string | null;
  amount: number | null;     // signed; compared on magnitude
  mode: TxnMode | null;
}

export interface DupHit { rowNo: number; existing: ExistingTxn }

/**
 * Flag rows that are already in the books. Scoped to the SHEET'S OWN DATE SPAN (min…max of the
 * rows' dates) — a re-typed August sheet is checked against August, not all of history. Match key:
 * same resolved party + date + amount magnitude, with mode as a tiebreaker only when BOTH sides have
 * one. One-to-one: N identical sheet rows don't all collapse onto a single existing txn (only the
 * first is a dup; the rest are genuinely new same-day payments).
 */
export function findDuplicates(rows: ResolvedRow[], existing: ExistingTxn[]): DupHit[] {
  const dates = rows.map((r) => r.date).filter((d): d is string => !!d);
  if (!dates.length) return [];
  const min = dates.reduce((m, d) => (d < m ? d : m), dates[0]);
  const max = dates.reduce((m, d) => (d > m ? d : m), dates[0]);
  const inSpan = existing.filter((e) => e.date >= min && e.date <= max);

  const used = new Set<string>();
  const hits: DupHit[] = [];
  for (const r of rows) {
    if (!r.stakeholderId || r.amount == null || !r.date) continue;
    const amt = Math.abs(r.amount);
    const e = inSpan.find((x) =>
      !used.has(x.txn_id) &&
      x.stakeholder_id === r.stakeholderId &&
      x.date === r.date &&
      Math.abs(x.amount) === amt &&
      (r.mode == null || x.mode == null || x.mode === r.mode));
    if (e) { used.add(e.txn_id); hits.push({ rowNo: r.rowNo, existing: e }); }
  }
  return hits;
}
