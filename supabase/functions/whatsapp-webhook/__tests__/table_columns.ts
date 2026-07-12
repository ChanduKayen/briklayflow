// COLUMN PARSER — teaches the fake which COLUMNS each table actually has, parsed from the MIGRATION FILES
// themselves (never hand-copied), so a select() naming a column the database does not have goes RED in the
// offline gate instead of silently returning zero rows in prod.
//
// WHY THIS EXISTS (the live lesson, 2026-07-09): buildCandidateSet read `todos.title`; the column is
// `todos.text`. PostgREST rejected the select, the code discarded `error`, and to-dos read as "this org has
// none" — so every chased 📋 item was invisible to the resolver and five real site updates resolved to
// nothing. 300+ tests were green the whole time, because the fake ignored the select() column list and the
// fixtures seeded the BUG's shape (`title`). A fake that answers a question the database would refuse is not
// a test double, it is a second implementation with its own schema.
//
// This is the exact twin of check_constraints.ts — same doctrine (prod truth, not recorder truth), same
// parsed-not-copied discipline: a future migration that adds or drops a column teaches the fake automatically.
//
// Scope: CREATE TABLE column definitions, ALTER TABLE ADD/DROP/RENAME COLUMN. Enforcement applies ONLY to
// tables with a CREATE TABLE in the migrations — a table created elsewhere (or a view) yields an incomplete
// column set, and guessing there would manufacture false reds. Unknown table ⇒ no enforcement, never a throw.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import process from 'node:process'

/** table → the set of columns it has. Only tables with a parsed CREATE TABLE are present. */
export type TableColumns = Map<string, Set<string>>

function findMigrationsDir(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const cand = join(dir, 'supabase', 'migrations')
    if (existsSync(cand)) return cand
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // LOUD, never a silent empty map — an unenforced fake is the lie this module exists to end.
  throw new Error('table_columns: supabase/migrations not found walking up from cwd — run the gate from the repo root')
}

// CRLF-safe (see check_constraints.ts): `.` does not match `\r`, so an anchored `/--.*$/` never fires and
// commented-out rollback SQL would leak into the fold.
const stripLineComments = (sql: string) => sql.split('\n').map((l) => l.replace(/--.*/, '')).join('\n')

/** Balanced-paren scan for the body of `CREATE TABLE … ( … )` starting at `from`. */
function parenBodyAt(text: string, from: number): string | null {
  const open = text.indexOf('(', from)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i)
  }
  return null
}

/** Split on TOP-LEVEL commas only — `numeric(12,2)` and `CHECK (x IN ('a','b'))` must not split. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0, cur = '', quote = false
  for (const ch of body) {
    if (ch === "'") quote = !quote
    if (!quote) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

// Table-constraint clauses that are NOT column definitions.
const NOT_A_COLUMN = /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE|LIKE)\b/i

/** Column names from a CREATE TABLE body. */
function columnsFromCreateBody(body: string): string[] {
  const out: string[] = []
  for (const part of splitTopLevel(body)) {
    const p = part.trim()
    if (!p || NOT_A_COLUMN.test(p)) continue
    const m = p.match(/^"?([a-zA-Z_]\w*)"?/)
    if (m) out.push(m[1])
  }
  return out
}

/**
 * Parse every migration in filename (= apply) order and fold each table's columns to their final state.
 * `before` cuts the fold at a migration stamp (exclusive), so a test can pin the schema as it was — how we
 * prove a column bug was REAL (the pre-fix `todos.title` select must fail against the schema of its day).
 */
export function loadTableColumns(opts: { before?: string; dir?: string } = {}): TableColumns {
  const dir = opts.dir ?? findMigrationsDir()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !opts.before || f.slice(0, opts.before.length) < opts.before)

  const cols: TableColumns = new Map()

  for (const f of files) {
    const sql = stripLineComments(readFileSync(join(dir, f), 'utf8'))
    for (const stmt of sql.split(';')) {
      // CREATE TABLE — establishes the table (and only these tables are ever enforced).
      const create = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/i)
      if (create) {
        const body = parenBodyAt(stmt, create.index! + create[0].length)
        if (body) {
          const set = cols.get(create[1]) ?? new Set<string>()
          for (const c of columnsFromCreateBody(body)) set.add(c)
          cols.set(create[1], set)
        }
        continue
      }
      // ALTER TABLE — ADD / DROP / RENAME COLUMN. `ALTER TYPE … ADD VALUE` never reaches here.
      const alter = stmt.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/i)
      if (!alter) continue
      const set = cols.get(alter[1])
      if (!set) continue   // altering a table we never saw created — cannot know its full column set
      for (const m of stmt.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) set.add(m[1])
      for (const m of stmt.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) set.delete(m[1])
      for (const m of stmt.matchAll(/RENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) { set.delete(m[1]); set.add(m[2]) }
    }
  }
  return cols
}

/**
 * The columns a PostgREST `select(...)` argument names. Conservative by design — anything we cannot parse
 * with certainty is IGNORED rather than reported, because a false red is worse than a missed one here.
 *   • `*` / absent            → nothing to check
 *   • `alias:column`          → the real column is after the colon
 *   • `column::text`          → cast stripped
 *   • `relation(a,b)` / `!inner` → embedded resource, skipped entirely (it is a join, not a column)
 */
export function selectedColumns(selectArg: string | undefined): string[] {
  if (!selectArg) return []
  const out: string[] = []
  for (const raw of splitTopLevel(selectArg)) {
    let p = raw.trim()
    if (!p || p === '*') continue
    if (p.includes('(') || p.includes('!')) continue      // embedded resource / join hint
    if (p.includes(':')) p = p.slice(p.indexOf(':') + 1)  // alias:column
    p = p.split('::')[0].trim().replace(/^"|"$/g, '')     // strip cast + quotes
    if (p && p !== '*' && /^[a-zA-Z_]\w*$/.test(p)) out.push(p)
  }
  return out
}

/**
 * Columns named by the select that the table does NOT have. Empty for an unknown/unenforced table.
 * A non-empty result is exactly what PostgREST answers with 42703 (undefined_column).
 */
export function unknownColumns(cols: TableColumns, table: string, selectArg: string | undefined): string[] {
  const set = cols.get(table)
  if (!set) return []   // table not created in migrations (view / external) → no enforcement
  return selectedColumns(selectArg).filter((c) => !set.has(c))
}
