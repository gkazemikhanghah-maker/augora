import { describe, it, expect } from "vitest";
import { groupPayoff, type GroupLegCalc } from "../src/calc.js";

describe("groupPayoff — categorical / bucket spreads", () => {
  const members = ["A", "B", "C"];

  it("single Buy YES on A: wins (1-e) if A, loses e otherwise", () => {
    const legs: GroupLegCalc[] = [{ memberId: "A", side: "YES", dir: "long", qty: 100, entry: 0.4 }];
    const r = groupPayoff(legs, members, 0);
    expect(r.scenarios.find((s) => s.winnerId === "A")!.pnl).toBeCloseTo(60);
    expect(r.scenarios.find((s) => s.winnerId === "B")!.pnl).toBeCloseTo(-40);
    expect(r.maxP).toBeCloseTo(60);
    expect(r.maxL).toBeCloseTo(-40);
    expect(r.capital).toBeCloseTo(40);
  });

  it("buy two adjacent buckets = box: profits only inside the band", () => {
    // bet price lands in A or B (the 'range'), each bought at 0.3
    const legs: GroupLegCalc[] = [
      { memberId: "A", side: "YES", dir: "long", qty: 100, entry: 0.3 },
      { memberId: "B", side: "YES", dir: "long", qty: 100, entry: 0.3 },
    ];
    const r = groupPayoff(legs, members, 0);
    // if A wins: +0.7*100 on A, -0.3*100 on B = 40; same if B wins; if C wins: -0.3*100*2 = -60
    expect(r.scenarios.find((s) => s.winnerId === "A")!.pnl).toBeCloseTo(40);
    expect(r.scenarios.find((s) => s.winnerId === "B")!.pnl).toBeCloseTo(40);
    expect(r.scenarios.find((s) => s.winnerId === "C")!.pnl).toBeCloseTo(-60);
  });

  it("Buy A + Write B (vertical spread): bounded both sides", () => {
    const legs: GroupLegCalc[] = [
      { memberId: "A", side: "YES", dir: "long", qty: 100, entry: 0.45 },
      { memberId: "B", side: "YES", dir: "short", qty: 100, entry: 0.35 },
    ];
    const r = groupPayoff(legs, members, 0);
    // A wins: long pays +0.55*100=55, short B not triggered keep premium +0.35*100=35 -> 90
    expect(r.scenarios.find((s) => s.winnerId === "A")!.pnl).toBeCloseTo(90);
    // B wins: long A loses -45, short B owes (0.35-1)*100=-65 -> -110
    expect(r.scenarios.find((s) => s.winnerId === "B")!.pnl).toBeCloseTo(-110);
    // C wins: long A -45, short B keep +35 -> -10
    expect(r.scenarios.find((s) => s.winnerId === "C")!.pnl).toBeCloseTo(-10);
  });
});
