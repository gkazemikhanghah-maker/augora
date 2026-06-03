import type { Cents } from "./types.js";

/**
 * Market-type constraints (PROJECT_SPEC §2.10). The engine MUST treat the
 * three types differently:
 *  - binary:      YES + NO = $1 (100¢).
 *  - categorical: Σ YES prices across mutually-exclusive options ≈ $1.
 *  - ladder:      NOT summed to 1; monotone non-decreasing across thresholds.
 */

export interface Check {
  ok: boolean;
  detail: string;
}

/** binary: yes + no must equal 100¢ (within tick tolerance). */
export function checkBinary(yesCents: Cents, noCents: Cents, tickCents = 1): Check {
  const sum = yesCents + noCents;
  const ok = Math.abs(sum - 100) <= tickCents;
  return { ok, detail: `YES(${yesCents}) + NO(${noCents}) = ${sum}¢ (target 100¢)` };
}

/** categorical: Σ of each option's YES price ≈ 100¢. */
export function checkCategorical(yesPricesCents: Cents[], tickCents = 1): Check {
  const sum = yesPricesCents.reduce((a, b) => a + b, 0);
  const ok = Math.abs(sum - 100) <= tickCents * Math.max(1, yesPricesCents.length);
  return { ok, detail: `Σ YES = ${sum}¢ across ${yesPricesCents.length} options (target ~100¢)` };
}

/**
 * ladder: prices ordered by ascending threshold must be monotone
 * NON-DECREASING (later/looser threshold ≥ earlier), and must NOT be forced
 * to sum to 1. Returns ok=false if any step decreases.
 */
export function checkLadder(yesPricesByThreshold: Cents[]): Check {
  for (let i = 1; i < yesPricesByThreshold.length; i++) {
    if (yesPricesByThreshold[i]! < yesPricesByThreshold[i - 1]!) {
      return {
        ok: false,
        detail: `monotonicity broken at step ${i}: ${yesPricesByThreshold[i - 1]} -> ${yesPricesByThreshold[i]}`,
      };
    }
  }
  return { ok: true, detail: `monotone non-decreasing across ${yesPricesByThreshold.length} thresholds` };
}
