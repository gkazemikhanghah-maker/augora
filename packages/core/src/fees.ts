import type { Cents } from "./types.js";

/**
 * Kalshi fee model (PROJECT_SPEC §2.6):
 *   fee = round_up(0.07 × C × P × (1−P))   [in dollars]
 * Implemented in integer cents with round-up (ceil), per order.
 *
 * - Symmetric: feeCents(q, p) === feeCents(q, 1-p).
 * - Max near P=0.5 (~1.75¢/contract before rounding), ~0 near 0/1.
 *
 * @param qty   number of contracts (integer)
 * @param p     execution price as a probability in [0,1]
 * @param mult  fee multiplier (0 none, 0.07 Kalshi, 0.10 high)
 */
export function feeCents(qty: number, p: number, mult: number): Cents {
  if (mult <= 0 || qty <= 0) return 0;
  const dollars = mult * qty * p * (1 - p);
  return Math.ceil(dollars * 100);
}

/**
 * Continuous (un-rounded) fee in DOLLARS, used by the strategy-builder
 * preview calc() to stay faithful to PayoffBuilder.html. Execution uses
 * feeCents() above for the ledger.
 */
export function feeDollarsPreview(qty: number, p: number, mult: number): number {
  return mult * p * (1 - p) * qty;
}
