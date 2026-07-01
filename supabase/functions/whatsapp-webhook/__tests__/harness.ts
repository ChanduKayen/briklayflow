// Zero-dependency test harness (same pattern as the siteOps engine / auth harnesses). The repo
// has no vitest/jest; run-tests.mjs transpiles these TS tests with esbuild and runs them under
// Node with a tiny Deno shim. Keeps the payment characterization gate provable in isolation.

type Fn = () => void | Promise<void>;
interface Case { suite: string; name: string; fn: Fn }

const cases: Case[] = [];
let currentSuite = '(root)';

export function suite(name: string, body: () => void): void {
  const prev = currentSuite;
  currentSuite = name;
  body();
  currentSuite = prev;
}

export function test(name: string, fn: Fn): void {
  cases.push({ suite: currentSuite, name, fn });
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (!Object.is(actual, expected)) throw new Error(`expected ${fmt(expected)} but got ${fmt(actual)}`);
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(`deep-equal failed\n   expected ${fmt(expected)}\n   got      ${fmt(actual)}`);
    },
    toBeNull() { if (actual !== null) throw new Error(`expected null but got ${fmt(actual)}`); },
  };
}

export async function runAll(): Promise<void> {
  let pass = 0, fail = 0;
  let lastSuite = '';
  const failures: string[] = [];
  for (const c of cases) {
    if (c.suite !== lastSuite) { console.log(`\n● ${c.suite}`); lastSuite = c.suite; }
    try {
      await c.fn();
      pass++;
      console.log(`  ✓ ${c.name}`);
    } catch (e) {
      fail++;
      const msg = (e as Error).message ?? String(e);
      console.log(`  ✗ ${c.name}\n      ${msg.replace(/\n/g, '\n      ')}`);
      failures.push(`${c.suite} › ${c.name}: ${msg}`);
    }
  }
  console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed, ${cases.length} total`);
  if (fail > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  - ' + f);
    process.exitCode = 1;
  }
}
