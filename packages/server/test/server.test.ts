import { describe, it, expect } from "vitest";
import { escrowId, PLATFORM, checkCategorical, checkLadder } from "@augora/core";
import { Store, PLAYGROUND_START_CENTS } from "../src/store.js";
import { seed } from "../src/seed.js";
import { normalizeToHundred } from "../src/liveimport.js";

describe("server seed + wiring (in-memory Store)", () => {
  it("seeds all three market types with valid type constraints", () => {
    const store = new Store();
    seed(store);
    const types = new Set([...store.markets.values()].map((m) => m.type));
    expect(types).toEqual(new Set(["binary", "categorical", "ladder"]));

    // categorical group sums to ~100¢
    const cat = [...store.markets.values()].filter((m) => m.groupId === "NOMINEE-2028");
    expect(checkCategorical(cat.map((m) => store.lastPriceCents(m.id) ?? 0)).ok).toBe(true);

    // ladder group is monotone non-decreasing by expiry
    const lad = [...store.markets.values()]
      .filter((m) => m.groupId === "IRAN-US-PEACE")
      .sort((a, b) => a.expiryTs - b.expiryTs);
    expect(checkLadder(lad.map((m) => store.lastPriceCents(m.id) ?? 0)).ok).toBe(true);
  });

  it("playground user trades and conservation holds through settlement", () => {
    const store = new Store();
    seed(store);
    store.ensureUser("playground");
    expect(store.ledger.account("playground").balanceCents).toBe(PLAYGROUND_START_CENTS);

    const eng = store.engine("BTC-68K");
    eng.submit({ userId: "playground", side: "YES", type: "market", qty: 100 });
    store.recordPrice("BTC-68K");

    // before settle: escrow backs every minted pair fully (invariant #2/#4)
    expect(store.ledger.bal(escrowId("BTC-68K"))).toBe(eng.mintedPairs * 100);

    store.settlement.settle(eng, store.ledger, "YES");
    expect(store.ledger.bal(escrowId("BTC-68K"))).toBe(0);

    // conservation across every tracked account (invariant #1/#3)
    store.ledger.assertConservation();
  });
});

describe("normalizeToHundred — categorical group prices sum to 100¢", () => {
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

  it("with Other slot: residual absorbs to reach exactly 100 (under-round)", () => {
    const out = normalizeToHundred([45, 30, 12, 1 /*Other*/], 3);
    expect(sum(out)).toBe(100);
    expect(out[3]).toBe(13); // 100 - (45+30+12)
    expect(out.slice(0, 3)).toEqual([45, 30, 12]); // sourced members untouched
  });

  it("with Other slot: over-round book scales members down, Other stays >=1", () => {
    const out = normalizeToHundred([60, 50, 30, 1 /*Other*/], 3);
    expect(sum(out)).toBe(100);
    expect(out[3]).toBeGreaterThanOrEqual(1);
    out.forEach((v) => expect(v).toBeGreaterThanOrEqual(1));
  });

  it("no Other slot: proportional rescale to 100 (under-round)", () => {
    const out = normalizeToHundred([30, 20, 40], null); // sum 90
    expect(sum(out)).toBe(100);
    out.forEach((v) => expect(v).toBeGreaterThanOrEqual(1));
  });

  it("no Other slot: proportional rescale to 100 (over-round)", () => {
    const out = normalizeToHundred([60, 50, 30], null); // sum 140
    expect(sum(out)).toBe(100);
    out.forEach((v) => expect(v).toBeGreaterThanOrEqual(1));
  });

  it("every member keeps a tradeable price >=1 even from tiny inputs", () => {
    const out = normalizeToHundred([1, 1, 1, 1, 1], null);
    expect(sum(out)).toBe(100);
    out.forEach((v) => expect(v).toBeGreaterThanOrEqual(1));
  });
});
