import { describe, it, expect } from "vitest";
import {
  wMetrics, buildSingle, buildBasket, buildCorridor, buildThreshold, buildLongShort,
  addW, scaleW, type Atom,
} from "../src/wengine.js";
import { groupPayoff } from "../src/calc.js";

// peace-deal-style CUMULATIVE market reduced to MECE atoms (the windows):
//   atom0 = "by 2026", atom1 = "2027 window", atom2 = "2028 window", atom3 = "never"
// atom prices are the *bucket* probabilities (threshold differences).
const atoms: Atom[] = [
  { id: "a0", price: 0.18, index: 0 },
  { id: "a1", price: 0.13, index: 1 }, // 0.31 − 0.18
  { id: "a2", price: 0.21, index: 2 }, // 0.52 − 0.31
  { id: "a3", price: 0.48, index: 3 }, // 1 − 0.52
];

describe("w-engine universal metrics", () => {
  it("single atom: cost = its price, maxLoss = cost, maxProfit = 1 − cost", () => {
    const m = wMetrics(buildSingle("a1"), atoms);
    expect(m.cost).toBeCloseTo(0.13);
    expect(m.maxLoss).toBeCloseTo(0.13);
    expect(m.maxProfit).toBeCloseTo(0.87);
    expect(m.collateral).toBe(0);
    expect(m.breakevenProb).toBeCloseTo(0.13);
  });

  it("corridor is self-collateralizing: maxLoss == cost (acceptance criterion)", () => {
    // corridor over atoms [1,2] = "happens in 2027 or 2028"
    const w = buildCorridor(atoms, 1, 2);
    const m = wMetrics(w, atoms);
    expect(m.cost).toBeCloseTo(0.13 + 0.21); // 0.34
    expect(m.maxLoss).toBeCloseTo(m.cost); // {0,1} ⇒ min w = 0 ⇒ no extra collateral
    expect(m.collateral).toBe(0);
    expect(m.breakevenProb).toBeCloseTo(0.34);
  });

  it("breakeven probability equals cost for digital {0,1} structures", () => {
    const m = wMetrics(buildBasket(["a0", "a3"]), atoms);
    expect(m.breakevenProb).toBeCloseTo(0.18 + 0.48);
  });

  it("long-short needs collateral = 1 and maxLoss = 1 + cost", () => {
    const w = buildLongShort("a0", "a2"); // long a0, short a2
    const m = wMetrics(w, atoms);
    expect(m.cost).toBeCloseTo(0.18 - 0.21); // −0.03 credit
    expect(m.collateral).toBe(1);
    expect(m.maxLoss).toBeCloseTo(1 + m.cost); // 0.97
    expect(m.breakevenProb).toBeNull(); // not a {0,1} structure
  });

  it("buying the whole partition surfaces an arbitrage when prices sum < 1", () => {
    const cheap: Atom[] = atoms.map((a) => ({ ...a, price: a.price * 0.9 }));
    const w = buildBasket(cheap.map((a) => a.id)); // +1 on every atom
    const m = wMetrics(w, cheap);
    // guaranteed $1 back, cost < 1 ⇒ negative maxLoss (locked-in profit)
    expect(m.maxLoss).toBeLessThan(0);
  });

  it("duality: bucket = Threshold(≥K1) − Threshold(≥K2)", () => {
    // atom a1 (index 1) == Threshold(≥1) − Threshold(≥2)
    const diff = addW(buildThreshold(atoms, 1), scaleW(buildThreshold(atoms, 2), -1));
    const single = buildSingle("a1");
    // both vectors must price and risk identically
    const md = wMetrics(diff, atoms);
    const ms = wMetrics(single, atoms);
    expect(md.cost).toBeCloseTo(ms.cost);
    expect(md.maxLoss).toBeCloseTo(ms.maxLoss);
    expect(md.maxProfit).toBeCloseTo(ms.maxProfit);
  });

  it("net collateral, not per-leg: Write A + Buy B over {A,B,C}", () => {
    const nom: Atom[] = [
      { id: "A", price: 0.5 },
      { id: "B", price: 0.3 },
      { id: "C", price: 0.2 },
    ];
    const w = addW({ A: -1 }, { B: 1 }); // Write A + Buy B = [-1,+1,0]
    const m = wMetrics(w, nom);
    expect(m.cost).toBeCloseTo(-0.5 + 0.3); // −0.2
    // net maxLoss = 1 − p_A + p_B = 1 − 0.5 + 0.3 = 0.8, NOT 1 + p_B (per-leg)
    expect(m.maxLoss).toBeCloseTo(0.8);
    expect(m.collateral).toBe(1);
  });

  it("empty corridor throws", () => {
    expect(() => buildCorridor(atoms, 2, 1)).toThrow();
  });
});

describe("w-engine ⟷ groupPayoff parity (shadow-mode, MECE atoms)", () => {
  // categorical {A,B,C} with prices summing to 1 (a proper MECE partition)
  const cat: Atom[] = [
    { id: "A", price: 0.5 },
    { id: "B", price: 0.3 },
    { id: "C", price: 0.2 },
  ];
  // legs → w: Buy-YES(i) adds qty to atom i; Buy-NO(i) adds qty to every other atom
  function legsToW(legs: { id: string; pick: "YES" | "NO"; qty: number }[]): Record<string, number> {
    const w: Record<string, number> = {};
    for (const l of legs)
      if (l.pick === "YES") w[l.id] = (w[l.id] ?? 0) + l.qty;
      else for (const a of cat) if (a.id !== l.id) w[a.id] = (w[a.id] ?? 0) + l.qty;
    return w;
  }
  const price = (id: string) => cat.find((a) => a.id === id)!.price;

  for (const legs of [
    [{ id: "A", pick: "YES" as const, qty: 100 }],
    [{ id: "B", pick: "NO" as const, qty: 100 }],
    [{ id: "A", pick: "YES" as const, qty: 100 }, { id: "B", pick: "YES" as const, qty: 100 }],
    [{ id: "A", pick: "YES" as const, qty: 100 }, { id: "C", pick: "NO" as const, qty: 50 }],
  ]) {
    it(`matches for ${JSON.stringify(legs)}`, () => {
      const wm = wMetrics(legsToW(legs), cat);
      const gp = groupPayoff(
        legs.map((l) => ({ memberId: l.id, side: l.pick, dir: "long" as const, qty: l.qty, entry: l.pick === "YES" ? price(l.id) : 1 - price(l.id) })),
        cat.map((a) => a.id),
        0,
      );
      // per-outcome P&L must agree atom-by-atom
      for (const a of cat) {
        const wmPnl = wm.byAtom.find((x) => x.id === a.id)!.pnl;
        const gpPnl = gp.scenarios.find((s) => s.winnerId === a.id)!.pnl;
        expect(wmPnl).toBeCloseTo(gpPnl, 6);
      }
      expect(wm.maxLoss).toBeCloseTo(-gp.maxL, 6); // gp.maxL is signed (min pnl)
      expect(wm.maxProfit).toBeCloseTo(gp.maxP, 6);
    });
  }
});
