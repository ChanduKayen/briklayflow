/**
 * Safe money arithmetic for Briklay.
 * All public functions round to 2 decimal places (paise precision).
 * Use these for every calculation on amounts — never raw JS operators.
 */

export function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function add(a: number, b: number): number {
  return round(a + b);
}

export function subtract(a: number, b: number): number {
  return round(a - b);
}

export function multiply(a: number, b: number): number {
  return round(a * b);
}

export function sum(amounts: number[]): number {
  return amounts.reduce((acc, n) => round(acc + n), 0);
}

/** Apply a percentage: applyPercent(10000, 18) → 1800.00 */
export function applyPercent(amount: number, percent: number): number {
  return round((amount * percent) / 100);
}

/** Format for display only — never use the result in arithmetic */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Parse a user-typed string into a rounded number; returns 0 for invalid input */
export function parseAmount(input: string | number): number {
  if (typeof input === 'number') return round(input);
  const cleaned = input.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : round(parsed);
}
