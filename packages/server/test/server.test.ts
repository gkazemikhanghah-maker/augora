import { describe, it, expect } from "vitest";
import { escrowId, PLATFORM, checkCategorical, checkLadder } from "@augora/core";
import { Store, PLAYGROUND_START_CENTS } from "../src/store.js";
import { seed } from "../src/seed.js";

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
