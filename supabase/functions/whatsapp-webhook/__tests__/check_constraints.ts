// CHECK-CONSTRAINT PARSER — teaches the fake the database's enum CHECKs from the MIGRATION FILES
// themselves, never hand-copied (ruling, Phase 0 go-order step 2: hand-copied constraints drift, and that
// drift produced both landmines — siteops_unplaced.reason and followup_events.type='bare_ack'). Because the
// constraints are parsed, a future migration that widens or adds an enum CHECK teaches the fake
// automatically; a code path that writes a value no migration admits goes RED in the offline gate instead
// of silently dropping in prod behind a best-effort catch.
//
// Scope: enum-style CHECKs only — `col IN ('a','b',…)` and `col IS NULL OR col IN (…)` — the exact class
// both landmines belonged to. Structural CHECKs (arithmetic, multi-column, subqueries) are ignored.
// Postgres semantics respected: a CHECK on a NULL value is UNKNOWN, and only FALSE rejects — so NULL/absent
// columns always pass; only a present, off-enum string violates.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import process from 'node:process'

export interface EnumCheck { name: string; column: string; values: Set<string> }
/** table → (constraint name → enum check). Keyed by CONSTRAINT NAME so a later migration's
 *  `DROP CONSTRAINT IF EXISTS x` + re-ADD replaces the earlier definition, exactly as in postgres. */
export type TableChecks = Map<string, Map<string, EnumCheck>>

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
  throw new Error('check_constraints: supabase/migrations not found walking up from cwd — run the gate from the repo root')
}

const stripLineComments = (sql: string) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

/** Balanced-paren scan for the expression inside `CHECK ( … )` starting at checkIdx. */
function checkExprAt(text: string, checkIdx: number): { expr: string; end: number } | null {
  const open = text.indexOf('(', checkIdx)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return { expr: text.slice(open + 1, i), end: i }
  }
  return null
}

/** `col IN ('a','b')` or `col IS NULL OR col IN ('a','b')` → { column, values }; anything else null. */
function parseEnumExpr(expr: string): { column: string; values: string[] } | null {
  const m = expr.match(/^\s*"?(\w+)"?\s+(?:IS\s+NULL\s+OR\s+"?\1"?\s+)?IN\s*\(([\s\S]*)\)\s*$/i)
  if (!m) return null
  if (/\(|\bSELECT\b/i.test(m[2])) return null   // subquery / nested expression — not an enum list
  const values = [...m[2].matchAll(/'([^']*)'/g)].map((v) => v[1])
  return values.length ? { column: m[1], values } : null
}

/**
 * Parse every migration in filename (= apply) order and fold the enum CHECKs into their final state.
 * `before` cuts the fold at a migration stamp (exclusive) — how a test pins the PRE-fix constraint to
 * prove a landmine was real (e.g. before:'20260704000000' must reject 'bare_ack', as prod did).
 */
export function loadEnumChecks(opts: { before?: string; dir?: string } = {}): TableChecks {
  const dir = opts.dir ?? findMigrationsDir()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !opts.before || f.slice(0, opts.before.length) < opts.before)
  const checks: TableChecks = new Map()
  const forTable = (t: string) => {
    let m = checks.get(t)
    if (!m) { m = new Map(); checks.set(t, m) }
    return m
  }

  for (const f of files) {
    const sql = stripLineComments(readFileSync(join(dir, f), 'utf8'))
    for (const stmt of sql.split(';')) {
      const create = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/i)
      const alter = stmt.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?(\w+)"?/i)
      const table = create?.[1] ?? alter?.[1]
      if (!table) continue   // CREATE POLICY / functions / indexes — their CHECKs are not table constraints
      if (alter) {
        for (const d of stmt.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) forTable(table).delete(d[1])
      }
      let idx = 0
      for (;;) {
        const rel = stmt.slice(idx).search(/\bCHECK\s*\(/i)
        if (rel < 0) break
        const abs = idx + rel
        const found = checkExprAt(stmt, abs)
        if (!found) break
        const parsed = parseEnumExpr(found.expr)
        if (parsed) {
          // explicit `CONSTRAINT name CHECK` immediately before, else postgres's auto-name convention
          const named = stmt.slice(Math.max(0, abs - 100), abs).match(/CONSTRAINT\s+"?(\w+)"?\s*$/i)
          const name = named?.[1] ?? `${table}_${parsed.column}_check`
          forTable(table).set(name, { name, column: parsed.column, values: new Set(parsed.values) })
        }
        idx = found.end + 1
      }
    }
  }
  return checks
}

/** First enum CHECK the row violates, or null. NULL/absent columns pass (postgres: UNKNOWN ≠ FALSE). */
export function checkViolation(checks: TableChecks, table: string, row: Record<string, unknown>): EnumCheck | null {
  const t = checks.get(table)
  if (!t) return null
  for (const c of t.values()) {
    const v = row[c.column]
    if (typeof v === 'string' && !c.values.has(v)) return c
  }
  return null
}
