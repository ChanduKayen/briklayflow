// Zero-dependency test harness (same pattern as the siteOps engine / auth harnesses). The repo
// has no vitest/jest; run-tests.mjs transpiles these TS tests with esbuild and runs them under
// Node with a tiny Deno shim. Keeps the payment characterization gate provable in isolation.

type Fn = () => void | Promise<void>;
interface Case { suite: string; name: string; fn: Fn | null; skip?: boolean; reason?: string }

const cases: Case[] = [];
let currentSuite = '(root)';

export function suite(name: string, body: () => void): void {
  const prev = currentSuite;
  currentSuite = name;
  body();
  currentSuite = prev;
}

interface TestFn {
  (name: string, fn: Fn): void;
  // A test that is deliberately NOT run — a standing spec for a fix that hasn't landed. It reports as
  // "○ skipped" and never fails the gate, so a known-red spec (e.g. Defect B's cross-script match) can
  // live in the suite as executable documentation without turning the gate's signal red. `reason` is
  // printed so the skip is loud, not silent. Un-skip (test.skip → test) when the fix lands.
  skip: (name: string, reason: string, fn?: Fn) => void;
}

export const test = ((name: string, fn: Fn): void => {
  cases.push({ suite: currentSuite, name, fn });
}) as TestFn;

test.skip = (name: string, reason: string, _fn?: Fn): void => {
  cases.push({ suite: currentSuite, name, fn: null, skip: true, reason });
};

// A Set and a Map both JSON.stringify to "{}" — so `expect(new Set(['a'])).toEqual(new Set(['b']))` used to
// compare "{}" with "{}" and PASS. Every Set assertion in the suite was vacuous (found 2026-07-11 while the
// type-tie shortlist was red: an assertion that cannot fail is not a test). Normalize collections into a
// stable, comparable shape BEFORE stringifying — a Set is order-insensitive (sorted), a Map is by key.
function norm(v: unknown): unknown {
  if (v instanceof Set) return { __set: [...v].map(norm).map((x) => JSON.stringify(x)).sort() };
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [k, norm(x)] as const).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = norm((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  try { return JSON.stringify(norm(v)); } catch { return String(v); }
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (!Object.is(actual, expected)) throw new Error(`expected ${fmt(expected)} but got ${fmt(actual)}`);
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(norm(actual)) !== JSON.stringify(norm(expected)))
        throw new Error(`deep-equal failed\n   expected ${fmt(expected)}\n   got      ${fmt(actual)}`);
    },
    toBeNull() { if (actual !== null) throw new Error(`expected null but got ${fmt(actual)}`); },
  };
}

export async function runAll(): Promise<void> {
  let pass = 0, fail = 0, skip = 0;
  let lastSuite = '';
  const failures: string[] = [];
  for (const c of cases) {
    if (c.suite !== lastSuite) { console.log(`\n● ${c.suite}`); lastSuite = c.suite; }
    if (c.skip || !c.fn) {
      skip++;
      console.log(`  ○ ${c.name} (skipped — ${c.reason ?? 'no reason given'})`);
      continue;
    }
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
  const skipNote = skip ? `, ${skip} skipped` : '';
  console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed${skipNote}, ${cases.length} total`);
  if (fail > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  - ' + f);
    process.exitCode = 1;
  }
}
