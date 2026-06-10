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

describe("native write (cash-secured short) — invariants", () => {
  const M = "BTC-68K";
  it("writer funds FULL collateral, collects premium, holds a written short; conserves & escrow drains", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000); // buyer
    led.deposit("bob", 100_000);   // writer
    const eng = new MatchingEngine(binaryMarket(0), led);

    // alice rests a YES bid @60¢ ×100 (locks $60)
    eng.submit({ userId: "alice", side: "YES", type: "limit", priceCents: 60, qty: 100 });
    expect(led.account("alice").lockedCents).toBe(6_000);

    // bob WRITES YES ×100 (market): funds full $100/contract, collects 60¢ premium
    const res = eng.write({ userId: "bob", qty: 100 });
    expect(res.order.intent).toBe("write");
    expect(res.order.filledQty).toBe(100);

    // escrow fully funded (rule #2: 100¢/pair), and entirely by the writer
    expect(led.bal(escrowId(M))).toBe(10_000);
    // bob net = −$100 collateral + $60 premium = −$40 (same net as buy-NO @40¢)
    expect(led.account("bob").balanceCents).toBe(96_000);
    // alice's locked premium went to bob, not escrow
    expect(led.account("alice").lockedCents).toBe(0);
    expect(led.account("alice").balanceCents).toBe(94_000);

    // position is surfaced as a written short (held as NO)
    const bobPos = eng.allPositions().find((p) => p.userId === "bob")!;
    expect(bobPos.side).toBe("NO");
    expect(bobPos.written).toBe(true);
    led.assertConservation(); // rule #1/#3

    // settle YES: the YES buyer is paid from escrow; writer loses collateral
    const settle = new SettlementService();
    settle.settle(eng, led, "YES");
    expect(led.bal(escrowId(M))).toBe(0); // rule #4 — escrow drains
    expect(led.account("alice").balanceCents - 100_000).toBe(4_000);  // +$40
    expect(led.account("bob").balanceCents - 100_000).toBe(-4_000);   // −$40
    led.assertConservation();
  });

  it("writer keeps premium + collateral when the short wins (NO outcome)", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    led.deposit("bob", 100_000);
    const eng = new MatchingEngine(binaryMarket(0), led);
    eng.submit({ userId: "alice", side: "YES", type: "limit", priceCents: 60, qty: 100 });
    eng.write({ userId: "bob", qty: 100 });

    new SettlementService().settle(eng, led, "NO");
    expect(led.bal(escrowId(M))).toBe(0);
    expect(led.account("bob").balanceCents - 100_000).toBe(6_000);   // +$60 (premium + collateral back)
    expect(led.account("alice").balanceCents - 100_000).toBe(-6_000);
    led.assertConservation();
  });

  it("write NO (Short Put): writer holds a written YES short; conserves & settles", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000); // NO buyer
    led.deposit("bob", 100_000);   // writer of NO
    const eng = new MatchingEngine(binaryMarket(0), led);

    // alice rests a NO bid @35¢ ×100 (locks $35)
    eng.submit({ userId: "alice", side: "NO", type: "limit", priceCents: 35, qty: 100 });
    expect(led.account("alice").lockedCents).toBe(3_500);

    // bob WRITES NO ×100 (market): funds full $100/contract, collects 35¢ premium, holds YES(written)
    const res = eng.write({ userId: "bob", side: "NO", qty: 100 });
    expect(res.order.intent).toBe("write");
    expect(res.order.filledQty).toBe(100);
    expect(res.order.side).toBe("YES"); // writer holds the opposite (YES) as the short

    expect(led.bal(escrowId(M))).toBe(10_000);          // escrow fully funded
    expect(led.account("bob").balanceCents).toBe(93_500); // −$100 collateral + $35 premium
    expect(led.account("alice").lockedCents).toBe(0);
    expect(led.account("alice").balanceCents).toBe(96_500);

    const bobPos = eng.allPositions().find((p) => p.userId === "bob")!;
    expect(bobPos.side).toBe("YES");
    expect(bobPos.written).toBe(true);
    led.assertConservation();

    // settle NO: the NO buyer is paid from escrow; the short loses its collateral
    new SettlementService().settle(eng, led, "NO");
    expect(led.bal(escrowId(M))).toBe(0);
    expect(led.account("alice").balanceCents - 100_000).toBe(6_500);  // +$65
    expect(led.account("bob").balanceCents - 100_000).toBe(-6_500);   // −$65
    led.assertConservation();
  });

  it("FULL-COLLATERAL rule: a write needs the whole $100/contract upfront (stricter than buy-NO)", () => {
    const led = new Ledger();
    led.deposit("alice", 100_000);
    led.deposit("bob", 5_000); // $50 — enough for the $40 net of a buy-NO, NOT for $100 collateral
    const eng = new MatchingEngine(binaryMarket(0), led);
    eng.submit({ userId: "alice", side: "YES", type: "limit", priceCents: 60, qty: 100 });
    expect(() => eng.write({ userId: "bob", qty: 100 })).toThrow(); // blocked: full collateral unavailable
    led.assertConservation();
  });
});
