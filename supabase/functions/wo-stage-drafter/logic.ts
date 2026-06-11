// wo-stage-drafter — pure, deterministic stage-drafting logic.
//
// No imports → runs under Deno (the edge runtime) and is unit-testable in
// isolation (logic.test.ts). All server-side guarantees from the B4 ticket live
// here: weighted pcts normalise to EXACTLY 100, stage count is clamped to the
// value band, measured stages appear ONLY when the scope explicitly states
// qty + rate, never any due dates, and names are de-duplicated against the
// stages the user already has.

export type DraftMode = 'weighted' | 'measured';

export interface DraftStage {
  name: string;
  mode: DraftMode;
  weight_pct?: number;   // mode 'weighted'
  quantity?: number;     // mode 'measured'
  unit_type?: string;    // mode 'measured'
  rate?: number;         // mode 'measured'
}

export interface DraftInput {
  scope_text: string;
  trade: string | null;
  contract_value: number | null;
  existing_stage_names: string[];
}

// ── Banding: how many stages for a given contract value ───────────────────────
//   <₹50k → 1 · ₹50k–2L → 2–3 · ₹2L–10L → 3–5 · >₹10L → 5–7 · (null → 3–5)
export function bandRange(contractValue: number | null): { min: number; max: number } {
  if (contractValue == null || !(contractValue > 0)) return { min: 3, max: 5 };
  if (contractValue < 50_000)     return { min: 1, max: 1 };
  if (contractValue < 200_000)    return { min: 2, max: 3 };
  if (contractValue <= 1_000_000) return { min: 3, max: 5 };
  return { min: 5, max: 7 };
}

// ── Trade templates (data) — ordered weighted stages; weights are hints,
//    re-normalised after the band trims the list. ──────────────────────────────
export const TRADE_TEMPLATES: Record<string, { name: string; weight: number }[]> = {
  civil: [
    { name: 'Foundation & plinth', weight: 25 },
    { name: 'RCC superstructure', weight: 30 },
    { name: 'Brickwork & blockwork', weight: 15 },
    { name: 'Internal & external plastering', weight: 15 },
    { name: 'Finishing & handover', weight: 15 },
  ],
  electrical: [
    { name: 'Conduiting & back boxes', weight: 30 },
    { name: 'Wiring & cabling', weight: 35 },
    { name: 'Fixtures, switches & fittings', weight: 20 },
    { name: 'Testing & handover', weight: 15 },
  ],
  plumbing: [
    { name: 'Concealed rough-in lines', weight: 35 },
    { name: 'Fixtures & sanitaryware', weight: 35 },
    { name: 'Testing & commissioning', weight: 30 },
  ],
  painting: [
    { name: 'Surface prep & putty', weight: 30 },
    { name: 'Primer coat', weight: 20 },
    { name: 'Finish coats', weight: 40 },
    { name: 'Touch-up & handover', weight: 10 },
  ],
  generic: [
    { name: 'Mobilisation & site setup', weight: 15 },
    { name: 'Main execution', weight: 45 },
    { name: 'Secondary works', weight: 25 },
    { name: 'Finishing & handover', weight: 15 },
  ],
};

export function templateKeyForTrade(trade: string | null | undefined): keyof typeof TRADE_TEMPLATES {
  const t = (trade || '').toLowerCase();
  if (/electric|wiring|cable|conduit/.test(t)) return 'electrical';
  if (/plumb|sanitary|pipe|drain/.test(t))     return 'plumbing';
  if (/paint|putty|primer/.test(t))            return 'painting';
  if (/civil|mason|concrete|rcc|brick|block|plaster|found|structure/.test(t)) return 'civil';
  return 'generic';
}

// ── Normalise integer weights to sum EXACTLY 100 (largest-remainder method) ───
export function normalizeWeights(weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const base = Math.floor(100 / n);
    const out = weights.map(() => base);
    out[n - 1] += 100 - base * n;
    return out;
  }
  const raw = weights.map(w => (w / total) * 100);
  const floored = raw.map(r => Math.floor(r));
  let used = floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (used < 100) { floored[order[k % n].i] += 1; used++; k++; }
  return floored;
}

// ── Normalised name (trim / lowercase / collapse whitespace) for dedupe ───────
export function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

const UNIT_CANON: Record<string, string> = {
  sft: 'Sqft', sqft: 'Sqft', sqm: 'Sqm', sqyd: 'Sqyd',
  cum: 'Cum', cft: 'Cft', 'cu.yd': 'Cu.yd',
  rmt: 'Rmt', rft: 'Rft', nos: 'Nos', kg: 'Kg', mt: 'MT', quintal: 'Quintal',
};
const UNIT_ALT = Object.keys(UNIT_CANON).join('|');

function titleCase(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Extract explicitly-quantified measured stages: "<label> <qty> <unit> at <rate>"
//    e.g. "GF brickwork 1400 sft at 85". Returns [] when nothing is explicit. ──
export function extractMeasured(scopeText: string): DraftStage[] {
  if (!scopeText) return [];
  const re = new RegExp(
    `([A-Za-z][A-Za-z &/\\-]{1,60}?)\\s+([\\d,]+(?:\\.\\d+)?)\\s*(${UNIT_ALT})\\b\\s*(?:at|@|x|×|\\*)\\s*(?:₹|rs\\.?)?\\s*([\\d,]+(?:\\.\\d+)?)`,
    'gi',
  );
  const out: DraftStage[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(scopeText)) !== null) {
    const qty = parseFloat(m[2].replace(/,/g, ''));
    const rate = parseFloat(m[4].replace(/,/g, ''));
    if (!(qty > 0) || !(rate > 0)) continue;
    out.push({
      name: titleCase(m[1]),
      mode: 'measured',
      quantity: qty,
      unit_type: UNIT_CANON[m[3].toLowerCase()] ?? m[3],
      rate,
    });
  }
  return out;
}

function buildRationale(key: string, measured: number, weighted: number, band: { min: number; max: number }, contract: number | null): string {
  const parts: string[] = [];
  parts.push(`${key} template`);
  if (measured > 0) parts.push(`${measured} measured from scope`);
  if (weighted > 0) parts.push(`${weighted} weighted stage${weighted > 1 ? 's' : ''}`);
  parts.push(contract ? `band ${band.min}–${band.max} for ${contract}` : 'default band 3–5 (no contract value)');
  return parts.join(' · ');
}

// ── Assemble the draft ────────────────────────────────────────────────────────
export function draftStages(input: DraftInput): { stages: DraftStage[]; rationale: string } {
  const taken = new Set((input.existing_stage_names || []).map(normName));

  // 1) explicit measured items from the scope (deduped against existing)
  const measured = extractMeasured(input.scope_text || '').filter(s => {
    const k = normName(s.name);
    if (taken.has(k)) return false;
    taken.add(k);
    return true;
  });

  // 2) weighted template stages filling up to the band, deduped, re-normalised
  const band = bandRange(input.contract_value);
  const key = templateKeyForTrade(input.trade);
  const template = TRADE_TEMPLATES[key];

  const target = Math.max(band.min, Math.min(template.length + measured.length, band.max));
  const weightedSlots = Math.max(0, target - measured.length);
  const picked = template.filter(t => !taken.has(normName(t.name))).slice(0, weightedSlots);
  const weights = normalizeWeights(picked.map(p => p.weight));
  const weighted: DraftStage[] = picked.map((p, i) => ({ name: p.name, mode: 'weighted', weight_pct: weights[i] }));

  return {
    stages: [...measured, ...weighted],
    rationale: buildRationale(key, measured.length, weighted.length, band, input.contract_value),
  };
}
