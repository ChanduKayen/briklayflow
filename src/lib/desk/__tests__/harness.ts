// Zero-dependency test harness — the same shape as src/lib/siteOps/engine/__tests__/harness.ts
// and supabase/functions/whatsapp-webhook/__tests__/harness.ts. No framework in this repo, by design.

type Fn = () => void | Promise<void>
interface Case { name: string; fn: Fn; skip?: string }
interface Suite { name: string; cases: Case[] }

const suites: Suite[] = []
let current: Suite | null = null

export function suite(name: string, body: () => void): void {
  current = { name, cases: [] }
  suites.push(current)
  body()
  current = null
}

export function test(name: string, fn: Fn): void {
  if (!current) throw new Error('test() outside a suite()')
  current.cases.push({ name, fn })
}

test.skip = (name: string, reason: string): void => {
  if (!current) throw new Error('test.skip() outside a suite()')
  current.cases.push({ name, fn: () => {}, skip: reason })
}

// Sets and Maps stringify to "{}" — canonicalise them or every comparison passes vacuously.
// (This exact bug was found and fixed in the webhook harness on 2026-07-11.)
function norm(v: unknown): unknown {
  if (v instanceof Set) return { __set: [...v].map(norm).sort() }
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [k, norm(x)]).sort() }
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
  }
  return v
}

export function expect(actual: unknown) {
  return {
    toBe(want: unknown) {
      if (actual !== want) throw new Error(`expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
    },
    toEqual(want: unknown) {
      const a = JSON.stringify(norm(actual))
      const b = JSON.stringify(norm(want))
      if (a !== b) throw new Error(`expected ${b}, got ${a}`)
    },
    toContain(want: string) {
      if (typeof actual !== 'string' || !actual.includes(want)) {
        throw new Error(`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(want)}`)
      }
    },
    toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${JSON.stringify(actual)}`) },
    toBeFalsy() { if (actual) throw new Error(`expected falsy, got ${JSON.stringify(actual)}`) },
  }
}

export async function runAll(): Promise<void> {
  let pass = 0, fail = 0, skip = 0
  for (const s of suites) {
    console.log(`\n● ${s.name}`)
    for (const c of s.cases) {
      if (c.skip) { console.log(`  ○ ${c.name} — ${c.skip}`); skip++; continue }
      try { await c.fn(); console.log(`  ✓ ${c.name}`); pass++ }
      catch (e) { console.log(`  ✗ ${c.name}\n      ${(e as Error).message}`); fail++ }
    }
  }
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${pass} passed, ${fail} failed, ${skip} skipped, ${pass + fail + skip} total`)
  if (fail) process.exit(1)
}
