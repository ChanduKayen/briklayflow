// Zero-dependency test harness. The repo has no vitest/jest installed (build is `tsc -b &&
// vite build`), so the engine ships its own tiny runner: golden tests register via test()
// and are executed by run-tests.mjs, which transpiles this TS with esbuild (already a Vite
// dependency) and runs it under Node. Keeps the engine's "prove each module in isolation"
// discipline without dragging in a new devDependency the user must install.

type Fn = () => void | Promise<void>
interface Case { suite: string; name: string; fn: Fn }

const cases: Case[] = []
let currentSuite = '(root)'

export function suite(name: string, body: () => void): void {
  const prev = currentSuite
  currentSuite = name
  body()
  currentSuite = prev
}

export function test(name: string, fn: Fn): void {
  cases.push({ suite: currentSuite, name, fn })
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (!Object.is(actual, expected)) throw new Error(`expected ${fmt(expected)} but got ${fmt(actual)}`)
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`deep-equal failed\n   expected ${fmt(expected)}\n   got      ${fmt(actual)}`)
    },
    toBeTruthy() { if (!actual) throw new Error(`expected truthy but got ${fmt(actual)}`) },
    toBeFalsy() { if (actual) throw new Error(`expected falsy but got ${fmt(actual)}`) },
    toBeNull() { if (actual !== null) throw new Error(`expected null but got ${fmt(actual)}`) },
    toBeGreaterThan(n: number) {
      if (!((actual as unknown as number) > n)) throw new Error(`expected > ${n} but got ${fmt(actual)}`)
    },
    toContain(item: unknown) {
      const ok = Array.isArray(actual) ? actual.includes(item)
        : typeof actual === 'string' ? actual.includes(item as string) : false
      if (!ok) throw new Error(`expected ${fmt(actual)} to contain ${fmt(item)}`)
    },
    toHaveLength(n: number) {
      const len = (actual as unknown as { length: number })?.length
      if (len !== n) throw new Error(`expected length ${n} but got ${fmt(len)}`)
    },
    toThrow() { throw new Error('use expectThrows() for throwing assertions') },
  }
}

/** Assert that `fn` throws; optionally that the message includes `substr`. */
export function expectThrows(fn: () => unknown, substr?: string): void {
  let threw = false
  try { fn() } catch (e) {
    threw = true
    if (substr && !String((e as Error).message).includes(substr))
      throw new Error(`threw, but message ${fmt((e as Error).message)} did not include ${fmt(substr)}`, { cause: e })
  }
  if (!threw) throw new Error(`expected function to throw${substr ? ` (containing ${fmt(substr)})` : ''}`)
}

export async function runAll(): Promise<void> {
  let pass = 0, fail = 0
  let lastSuite = ''
  const failures: string[] = []
  for (const c of cases) {
    if (c.suite !== lastSuite) { console.log(`\n● ${c.suite}`); lastSuite = c.suite }
    try {
      await c.fn()
      pass++
      console.log(`  ✓ ${c.name}`)
    } catch (e) {
      fail++
      const msg = (e as Error).message ?? String(e)
      console.log(`  ✗ ${c.name}\n      ${msg.replace(/\n/g, '\n      ')}`)
      failures.push(`${c.suite} › ${c.name}: ${msg}`)
    }
  }
  console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed, ${cases.length} total`)
  if (fail > 0) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log('  - ' + f)
    process.exitCode = 1
  }
}
