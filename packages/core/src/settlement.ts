import type { Market, Settlement, Side } from "./types.js";
import { Ledger, escrowId } from "./ledger.js";
import type { MatchingEngine } from "./matching.js";

/**
 * Atomic, idempotent settlement (invariants #2, #4, #5).
 * Winning side gets $1 (100¢) per contract from escrow; escrow drains to 0
 * exactly because minted YES qty == NO qty == pairs == escrow/100.
 */
export class SettlementService {
  private settled = new Map<string, Settlement>();

  settle(
    engine: MatchingEngine,
    ledger: Ledger,
    outcome: Side,
    meta: { resolvedPrice?: number; twapWindow?: number; oracleSource?: string } = {},
  ): Settlement {
    const market: Market = engine.market;

    // idempotent: second call is a no-op returning the prior result (#5)
    const prior = this.settled.get(market.id);
    if (prior) return prior;

    for (const pos of engine.allPositions()) {
      const payout = pos.side === outcome ? pos.qty * 100 : 0;
      if (payout > 0) ledger.payout(pos.userId, market.id, payout, "settle");
    }

    const escrowLeft = ledger.bal(escrowId(market.id));
    if (escrowLeft !== 0) {
      throw new Error(`Settlement left escrow=${escrowLeft} (expected 0) on ${market.id}`);
    }

    market.status = "settled";
    const record: Settlement = {
      marketId: market.id,
      outcome,
      resolvedPrice: meta.resolvedPrice,
      twapWindow: meta.twapWindow,
      oracleSource: meta.oracleSource,
      ts: Date.now(),
    };
    this.settled.set(market.id, record);
    return record;
  }

  isSettled(marketId: string): boolean {
    return this.settled.has(marketId);
  }

  get(marketId: string): Settlement | undefined {
    return this.settled.get(marketId);
  }

  snapshot(): [string, Settlement][] {
    return [...this.settled];
  }

  load(arr: [string, Settlement][]): void {
    this.settled = new Map(arr);
  }
}

/** Stub oracle: resolves BTC ≥ strike markets, etc. Replace with a real feed. */
export function stubOracle(market: Market, observedPrice: number): Side {
  if (market.strike == null) throw new Error("market has no strike for stub oracle");
  return observedPrice >= market.strike ? "YES" : "NO";
}
