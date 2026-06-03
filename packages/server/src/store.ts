import {
  Ledger,
  MatchingEngine,
  SettlementService,
  type Market,
  type Position,
  type Side,
  type Trade,
} from "@augora/core";

/**
 * In-memory application state (spec: in-memory persistence for day one).
 * One global double-entry Ledger is the money authority; one MatchingEngine
 * per market; one SettlementService. No DB required to run.
 */

export const PLAYGROUND_START_CENTS = 1_000_000; // $10,000 virtual (spec §8.1)

export interface PricePoint {
  ts: number;
  midCents: number;
}

export class Store {
  readonly ledger = new Ledger();
  readonly settlement = new SettlementService();
  readonly markets = new Map<string, Market>();
  readonly engines = new Map<string, MatchingEngine>();
  readonly priceHistory = new Map<string, PricePoint[]>();
  private readonly knownUsers = new Set<string>();

  addMarket(market: Market): MatchingEngine {
    const engine = new MatchingEngine(market, this.ledger);
    this.markets.set(market.id, engine.market.id === market.id ? market : market);
    this.engines.set(market.id, engine);
    this.priceHistory.set(market.id, []);
    return engine;
  }

  engine(marketId: string): MatchingEngine {
    const e = this.engines.get(marketId);
    if (!e) throw new Error(`Unknown market ${marketId}`);
    return e;
  }

  /** Auto-provision a playground account with virtual funds on first touch. */
  ensureUser(userId: string): void {
    if (this.knownUsers.has(userId)) return;
    this.knownUsers.add(userId);
    this.ledger.deposit(userId, PLAYGROUND_START_CENTS);
  }

  recordPrice(marketId: string): void {
    const mid = this.engine(marketId).midCents();
    if (mid == null) return;
    const hist = this.priceHistory.get(marketId)!;
    hist.push({ ts: Date.now(), midCents: mid });
    if (hist.length > 500) hist.shift();
  }

  lastPriceCents(marketId: string): number | null {
    const eng = this.engine(marketId);
    const live = eng.midCents();
    if (live != null) return live;
    const hist = this.priceHistory.get(marketId);
    return hist && hist.length ? hist[hist.length - 1]!.midCents : null;
  }

  tradesForMarket(marketId: string, limit = 50): Trade[] {
    return this.engine(marketId).trades.slice(-limit).reverse();
  }

  /** Serialize the entire application state for persistence. */
  snapshot() {
    const engines: Record<string, ReturnType<MatchingEngine["snapshot"]>> = {};
    for (const [id, eng] of this.engines) engines[id] = eng.snapshot();
    return {
      ledger: this.ledger.snapshot(),
      settlement: this.settlement.snapshot(),
      markets: [...this.markets.values()],
      priceHistory: [...this.priceHistory] as [string, PricePoint[]][],
      engines,
      knownUsers: [...this.knownUsers],
    };
  }

  /** Rebuild the entire application state from a snapshot (startup path). */
  restore(s: ReturnType<Store["snapshot"]>): void {
    this.ledger.load(s.ledger);
    this.settlement.load(s.settlement);
    this.markets.clear();
    this.engines.clear();
    this.priceHistory.clear();
    this.knownUsers.clear();
    for (const m of s.markets) {
      const eng = new MatchingEngine(m, this.ledger);
      const snap = s.engines[m.id];
      if (snap) eng.load(snap);
      this.markets.set(m.id, m);
      this.engines.set(m.id, eng);
    }
    for (const [id, hist] of s.priceHistory) this.priceHistory.set(id, hist);
    for (const u of s.knownUsers) this.knownUsers.add(u);
  }

  /** Positions for a user enriched with mark-to-market, or realized result if the
   *  market is already settled (spec §8.1 portfolio). */
  positionsWithMtm(userId: string): Array<
    Position & {
      markCents: number | null;
      unrealizedPnlCents: number;
      settled: boolean;
      settledOutcome?: Side;
      won?: boolean;
      marketQuestion: string;
      source?: string;
    }
  > {
    const out: Array<
      Position & {
        markCents: number | null;
        unrealizedPnlCents: number;
        settled: boolean;
        settledOutcome?: Side;
        won?: boolean;
        marketQuestion: string;
        source?: string;
      }
    > = [];
    for (const [marketId, eng] of this.engines) {
      const settlement = this.settlement.get(marketId);
      const market = this.markets.get(marketId);
      const meta = { marketQuestion: market?.question ?? marketId, source: market?.source };
      const mid = this.lastPriceCents(marketId);
      for (const pos of eng.positionsForUser(userId)) {
        if (settlement) {
          const won = pos.side === settlement.outcome;
          const finalCents = won ? 100 : 0;
          const realized = Math.round(pos.qty * (finalCents - pos.avgPriceCents));
          out.push({ ...pos, ...meta, markCents: finalCents, unrealizedPnlCents: realized, settled: true, settledOutcome: settlement.outcome, won });
        } else {
          const markForSide = mid == null ? null : pos.side === "YES" ? mid : 100 - mid;
          const unreal = markForSide == null ? 0 : Math.round(pos.qty * (markForSide - pos.avgPriceCents));
          out.push({ ...pos, ...meta, markCents: markForSide, unrealizedPnlCents: unreal, settled: false });
        }
      }
    }
    return out;
  }
}
