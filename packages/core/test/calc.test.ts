import { describe, it, expect } from "vitest";
import {
  calc,
  referenceState,
  binaryScenarios,
  entryPrice,
  LEGDEF,
  checkBinary,
  checkCategorical,
  checkLadder,
  feeCents,
  type StrategyState,
} from "../src/index.js";

const D = (x: number) => Math.round(x * 100) / 100; // round to cent for comparisons

describe("calc — single source of truth (ported from PayoffBuilder.html)", () => {
  it("YES price + NO price = $1 (rule #1)", () => {
    const st: StrategyState = { ...referenceState(), mid: 0.6, spread: 0 };
    const buy = LEGDEF.find((d) => d.k === "BUY")!;
    const buyA = LEGDEF.find((d) => d.k === "BUYA")!;
    const yes = entryPrice(buy, st); // YES ask
    const no = entryPrice(buyA, st); // NO ask
    expect(D(yes + no)).toBe(1);
    expect(checkBinary(Math.round(yes * 100), Math.round(no * 100)).ok).toBe(true);
  });

  it("reference combo: Buy 100 YES @60.5¢ + Write Against 100 NO @39.5¢", () => {
    const c = calc(referenceState());
    expect(D(c.netPrem)).toBe(-21.0); // net premium
    expect(D(c.collat)).toBe(100.0); // collateral locked
    expect(D(c.capital)).toBe(121.0); // net capital
    expect(D(c.maxL)).toBe(-121.0); // max loss
    expect(D(c.maxP)).toBe(79.0); // max profit
    expect(c.be).not.toBeNull();
    expect(D(c.be! * 100)).toBe(60.5); // breakeven 60.5%
  });

  it("scenarios: exactly two rows for binary, correct values & sign (spec §8.1)", () => {
    const c = calc(referenceState());
    const rows = binaryScenarios(c);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.outcome).toBe("YES");
    expect(D(rows[0]!.pnl)).toBe(79.0);
    expect(rows[1]!.outcome).toBe("NO");
    expect(D(rows[1]!.pnl)).toBe(-121.0);
    // sign rule: Buy YES + Write NO ⇒ YES positive, NO negative
    expect(c.P1).toBeGreaterThan(0);
    expect(c.P0).toBeLessThan(0);
  });

  it("single-source consistency: capital === -maxLoss", () => {
    const c = calc(referenceState());
    expect(Math.abs(c.capital - -c.maxL)).toBeLessThan(0.01);
  });

  it("EV uses belief and the same P0/P1 (no separate calc)", () => {
    const c = calc(referenceState()); // belief 0.66
    expect(D(c.ev)).toBe(D(0.66 * 79 + 0.34 * -121));
  });

  it("fee is symmetric and max near P=0.5 (rule #6 fee model)", () => {
    expect(feeCents(100, 0.5, 0.07)).toBe(feeCents(100, 0.5, 0.07));
    expect(feeCents(100, 0.6, 0.07)).toBe(feeCents(100, 0.4, 0.07)); // symmetry
    expect(feeCents(100, 0.5, 0.07)).toBeGreaterThan(feeCents(100, 0.1, 0.07));
    expect(feeCents(100, 0.5, 0)).toBe(0);
  });
});

describe("market-type constraints (spec §2.10)", () => {
  it("categorical YES prices sum to ~100¢", () => {
    expect(checkCategorical([45, 30, 25]).ok).toBe(true);
    expect(checkCategorical([60, 60]).ok).toBe(false);
  });

  it("ladder is monotone non-decreasing and NOT summed to 1", () => {
    expect(checkLadder([20, 35, 35, 70]).ok).toBe(true); // valid
    expect(checkLadder([40, 30]).ok).toBe(false); // decreasing -> invalid
    // ladder prices may sum well above 100 — that's allowed
    expect(checkLadder([50, 70, 90]).ok).toBe(true);
  });
});
