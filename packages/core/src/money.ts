import type { Cents } from "./types.js";

/** Convert a dollar float to integer cents (rounded to nearest cent). */
export function dollarsToCents(d: number): Cents {
  return Math.round(d * 100);
}

export function centsToDollars(c: Cents): number {
  return c / 100;
}

/** Throws if a value is not a safe integer — guards invariant #6. */
export function assertCents(c: number, ctx = "value"): asserts c is Cents {
  if (!Number.isInteger(c)) {
    throw new Error(`Money must be integer cents (${ctx} = ${c})`);
  }
}

/**
 * Format integer cents like PayoffBuilder's money(): uses the U+2212 minus
 * sign and two decimals. e.g. -12100 -> "−$121.00".
 */
export function formatMoney(c: Cents): string {
  const sign = c < 0 ? "\u2212$" : "$";
  return sign + (Math.abs(c) / 100).toFixed(2);
}

/** Format a probability (0..1) as a cents-price string, e.g. 0.605 -> "60.5¢". */
export function formatCentsPrice(p: number): string {
  return (p * 100).toFixed(1) + "\u00A2";
}
