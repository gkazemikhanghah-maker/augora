import { describe, it, expect } from "vitest";
import {
  Ledger,
  MatchingEngine,
  SettlementService,
  escrowId,
  PLATFORM,
  type Market,
} from "../src/index.js";

function binaryMarket(feeMult = 0): Market {
  return {
    id: "BTC-68K",
    question: "BTC ≥ $68,000 at expiry?",
    type: "binary",
    groupId: "BTC-68K",
    asset: "BTC",
    strike: 68000,
    expiryTs: Date.now() + 86_400_000,
    status: "open",
    feeMult,
    tickSize: 1,
    createdTs: Date.now(),
  };
}

describe("system invariants (spec §3) — end-to-end", () => {
  it("fully-collateralized mint: 100¢ enters escrow per pair, no negative balances", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000); // $1000
    led.deposit("bob", 100_000);
    const eng = new MatchingEngine(binaryMarket(0), led);

    // bob rests a NO bid at 40¢ for 100 contracts (locks $40)
    eng.submit({ userId: "bob", side: "NO", type: "limit", priceCents: 40, qty: 100 });
    expect(led.account("bob").lockedCents).toBe(4_000);

    // alice market-buys 100 YES -> crosses bob, mints 100 pairs
    eng.submit({ userId: "alice", side: "YES", type: "market", qty: 100 });

    expect(eng.mintedPairs).toBe(100);
    expect(led.bal(escrowId("BTC-68K"))).toBe(10_000); // 100 pairs × 100¢ (rule #2/#4)
    expect(led.account("alice").balanceCents).toBe(94_000); // paid 60¢×100
    expect(led.account("bob").balanceCents).toBe(96_000); // 40¢×100 moved from locked
    expect(led.account("bob").lockedCents).toBe(0);
    led.assertConservation(); // rule #1
  });

  it("conservation: Σ user PnL + platform = 0 after settlement, escrow drains to 0", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    led.deposit("bob", 100_000);
    const eng = new MatchingEngine(binaryMarket(0), led);
    const settle = new SettlementService();

    eng.submit({ userId: "bob", side: "NO", type: "limit", priceCents: 40, qty: 100 });
    eng.submit({ userId: "alice", side: "YES", type: "market", qty: 100 });

    settle.settle(eng, led, "YES"); // YES wins -> alice paid out

    expect(led.bal(escrowId("BTC-68K"))).toBe(0); // rule #4 escrow empty
    const alicePnl = led.account("alice").balanceCents - 100_000;
    const bobPnl = led.account("bob").balanceCents - 100_000;
    expect(alicePnl).toBe(4_000); // +$40
    expect(bobPnl).toBe(-4_000); // -$40
    expect(alicePnl + bobPnl + led.bal(PLATFORM)).toBe(0); // rule #3
    led.assertConservation();
  });

  it("conservation holds WITH fees (fees flow user -> platform)", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    led.deposit("bob", 100_000);
    const eng = new MatchingEngine(binaryMarket(0.07), led);
    const settle = new SettlementService();

    eng.submit({ userId: "bob", side: "NO", type: "limit", priceCents: 50, qty: 100 });
    eng.submit({ userId: "alice", side: "YES", type: "market", qty: 100 });

    expect(led.bal(PLATFORM)).toBeGreaterThan(0); // platform earned fees
    settle.settle(eng, led, "NO"); // bob wins

    expect(led.bal(escrowId("BTC-68K"))).toBe(0);
    const alicePnl = led.account("alice").balanceCents - 100_000;
    const bobPnl = led.account("bob").balanceCents - 100_000;
    expect(alicePnl + bobPnl + led.bal(PLATFORM)).toBe(0); // rule #3 still holds
    led.assertConservation();
  });

  it("no negative balance: order beyond funds is rejected (rule #4)", () => {
    const led = new Ledger();
    led.deposit("carol", 1_000); // only $10
    led.deposit("dave", 100_000);
    const eng = new MatchingEngine(binaryMarket(0), led);

    eng.submit({ userId: "dave", side: "NO", type: "limit", priceCents: 40, qty: 100 });
    // carol tries to buy 100 YES @60¢ = $60 with only $10 -> must throw
    expect(() =>
      eng.submit({ userId: "carol", side: "YES", type: "market", qty: 100 }),
    ).toThrow();
  });

  it("settlement is idempotent (rule #5): second call is a no-op", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    led.deposit("bob", 100_000);
    const eng = new MatchingEngine(binaryMarket(0), led);
    const settle = new SettlementService();

    eng.submit({ userId: "bob", side: "NO", type: "limit", priceCents: 40, qty: 100 });
    eng.submit({ userId: "alice", side: "YES", type: "market", qty: 100 });

    const first = settle.settle(eng, led, "YES");
    const aliceAfterFirst = led.account("alice").balanceCents;
    const second = settle.settle(eng, led, "YES");

    expect(second).toEqual(first);
    expect(led.account("alice").balanceCents).toBe(aliceAfterFirst); // not paid twice
    expect(led.bal(escrowId("BTC-68K"))).toBe(0);
    led.assertConservation();
  });

  it("integer-cent guard rejects fractional money (rule #6)", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    expect(() => led.chargeFee("alice", 12.5 as unknown as number)).toThrow();
  });

  it("cancel refunds locked collateral", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    const eng = new MatchingEngine(binaryMarket(0), led);
    const { order } = eng.submit({ userId: "alice", side: "YES", type: "limit", priceCents: 55, qty: 100 });
    expect(led.account("alice").lockedCents).toBe(5_500);
    expect(eng.cancel(order.id)).toBe(true);
    expect(led.account("alice").lockedCents).toBe(0);
    expect(led.account("alice").balanceCents).toBe(100_000);
  });
});
