import { describe, it, expect } from "vitest";
import {
  wMetrics, buildSingle, buildBasket, buildCorridor, buildThreshold, buildLongShort,
  addW, scaleW, deriveCumulativeAtoms, corridorLegsCumulative, suggestTaxonomy, type Atom,
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

  it("long-short via Buy-YES(A)+Buy-NO(C) is identical in P&L to the spec short w=[+1,0,−1]", () => {
    const cat: Atom[] = [
      { id: "A", price: 0.4 },
      { id: "B", price: 0.35 },
      { id: "C", price: 0.25 },
    ];
    // Augora replication: Buy-YES(A) adds +1 to A; Buy-NO(C) adds +1 to every atom ≠ C
    const rep: Record<string, number> = { A: 1 };
    for (const a of cat) if (a.id !== "C") rep[a.id] = (rep[a.id] ?? 0) + 1;
    const mr = wMetrics(rep, cat);
    const ml = wMetrics(buildLongShort("A", "C"), cat);
    for (const a of cat) {
      const r = mr.byAtom.find((x) => x.id === a.id)!.pnl;
      const l = ml.byAtom.find((x) => x.id === a.id)!.pnl;
      expect(r).toBeCloseTo(l, 6); // same payoff in every outcome
    }
    expect(mr.maxLoss).toBeCloseTo(ml.maxLoss, 6);
    expect(mr.maxProfit).toBeCloseTo(ml.maxProfit, 6);
  });

  it("empty corridor throws", () => {
    expect(() => buildCorridor(atoms, 2, 1)).toThrow();
  });
});

describe("cumulative ladder → window atoms + corridor legs (peace-deal model)", () => {
  const rungs = [
    { id: "T1", label: "by Q3 2026", cumPrice: 0.18 },
    { id: "T2", label: "by end 2026", cumPrice: 0.31 },
    { id: "T3", label: "by end 2027", cumPrice: 0.52 },
  ];

  it("derives 4 MECE window atoms whose prices sum to 1", () => {
    const atoms = deriveCumulativeAtoms(rungs);
    expect(atoms.map((a) => a.id)).toEqual(["win_0", "win_1", "win_2", "win_3"]);
    expect(atoms.map((a) => +a.price.toFixed(2))).toEqual([0.18, 0.13, 0.21, 0.48]);
    expect(atoms.reduce((s, a) => s + a.price, 0)).toBeCloseTo(1);
  });

  it("single-window corridor [1,1] = Q4 2026: net cost 13%, legs YES(T2)+NO(T1)", () => {
    const atoms = deriveCumulativeAtoms(rungs);
    const w = buildCorridor(atoms, 1, 1);
    const m = wMetrics(w, atoms);
    expect(m.cost).toBeCloseTo(0.13);
    expect(m.maxLoss).toBeCloseTo(0.13);
    expect(m.breakevenProb).toBeCloseTo(0.13);
    expect(corridorLegsCumulative(rungs, 1, 1)).toEqual([
      { memberId: "T2", side: "YES", intent: "buy" },
      { memberId: "T1", side: "NO", intent: "buy" },
    ]);
  });

  it("corridor from the start [0,1] needs only a YES leg; to the end [2,3] only a NO leg", () => {
    expect(corridorLegsCumulative(rungs, 0, 1)).toEqual([{ memberId: "T2", side: "YES", intent: "buy" }]);
    expect(corridorLegsCumulative(rungs, 2, 3)).toEqual([{ memberId: "T2", side: "NO", intent: "buy" }]);
  });

  it("FADE a window (credit / short call spread): Write-YES(far) + Buy-YES(near), and w is negative", () => {
    // fade window [1,1] = collect the window's probability as a credit, lose only if it lands there
    const atoms = deriveCumulativeAtoms(rungs);
    const short = scaleW(buildCorridor(atoms, 1, 1), -1);
    const m = wMetrics(short, atoms);
    expect(m.cost).toBeCloseTo(-0.13); // credit of 13%
    expect(m.collateral).toBe(1); // a written short blocks full collateral
    expect(m.maxProfit).toBeCloseTo(0.13); // keep the credit if outside
    expect(m.maxLoss).toBeCloseTo(0.87); // lose 1 − credit if inside
    expect(corridorLegsCumulative(rungs, 1, 1, "fade")).toEqual([
      { memberId: "T2", side: "YES", intent: "write" },
      { memberId: "T1", side: "YES", intent: "buy" },
    ]);
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

describe("taxonomy auto-detection (suggestTaxonomy)", () => {
  it("peace-deal thresholds → CUMULATIVE / INCREASING (even though prices sum ≈ 1)", () => {
    const s = suggestTaxonomy([
      { label: "Iran–US peace deal by end of Q3 2026?", priceCents: 18, orderValue: 1 },
      { label: "Iran–US peace deal by end of 2026?", priceCents: 31, orderValue: 2 },
      { label: "Iran–US peace deal by end of 2027?", priceCents: 52, orderValue: 3 },
    ]);
    expect(s.orderingType).toBe("INTERVAL");
    expect(s.representation).toBe("CUMULATIVE");
    expect(s.axisDirection).toBe("INCREASING");
  });

  it("descending threshold (≥ points) → CUMULATIVE / DECREASING", () => {
    const s = suggestTaxonomy([
      { label: "Over 1M", priceCents: 80, orderValue: 1 },
      { label: "Over 2M", priceCents: 50, orderValue: 2 },
      { label: "Over 3M", priceCents: 20, orderValue: 3 },
    ]);
    expect(s.representation).toBe("CUMULATIVE");
    expect(s.axisDirection).toBe("DECREASING");
  });

  it("numeric buckets → ATOMIC", () => {
    const s = suggestTaxonomy([
      { label: "0–1 goals", priceCents: 30, orderValue: 0 },
      { label: "2–3 goals", priceCents: 45, orderValue: 2 },
      { label: "4+ goals", priceCents: 25, orderValue: 4 },
    ]);
    expect(s.orderingType).toBe("INTERVAL");
    expect(s.representation).toBe("ATOMIC");
  });

  it("unordered outcomes → NOMINAL (no corridor)", () => {
    const s = suggestTaxonomy([
      { label: "Candidate A", priceCents: 38 },
      { label: "Candidate B", priceCents: 31 },
      { label: "Candidate C", priceCents: 19 },
    ]);
    expect(s.orderingType).toBe("NOMINAL");
    expect(s.representation).toBeUndefined();
  });
});
