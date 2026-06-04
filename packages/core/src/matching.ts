import type { Cents, Market, Order, OrderType, Position, Side, Trade } from "./types.js";
import { feeCents } from "./fees.js";
import { Ledger } from "./ledger.js";

/**
 * Fully-collateralized binary CLOB with price-time priority (spec §2.3, §2.5, §7).
 *
 * There are only two real assets: YES and NO. We keep two resting bid books:
 *   - bidsYES: users wanting to BUY YES   (price = max ¢ they pay for YES)
 *   - bidsNO:  users wanting to BUY NO    (price = max ¢ they pay for NO)
 *
 * A YES bid at L crosses the best NO bid at noPrice when L + noPrice ≥ 100¢.
 * On a cross we MINT a pair: exactly 100¢ enters escrow (taker pays 100−noPrice
 * for YES, maker pays noPrice for NO). No leverage, no naked positions, bad
 * debt = 0 by construction. A "sell YES" is simply a "buy NO" — same book.
 */

interface RestingOrder {
  order: Order;
  remaining: number;
  /** monotonic sequence for time priority */
  seq: number;
}

export interface BookLevel {
  priceCents: Cents;
  qty: number;
}

export interface OrderBookSnapshot {
  /** YES bids (buy YES) and YES asks (= NO bids mapped to 100−price). */
  yesBids: BookLevel[];
  yesAsks: BookLevel[];
}

export interface FillPlan {
  fills: { priceCents: Cents; qty: number }[];
  filledQty: number;
  avgPriceCents: number; // for preview
  feeCents: Cents;
  restingQty: number;
}

export interface LegInput {
  side: Side;
  type: OrderType;
  priceCents?: Cents;
  qty: number;
}

export interface LegPlan extends FillPlan {
  side: Side;
  type: OrderType;
  collateralCents: Cents;
}

export interface MultiLegPreview {
  plans: LegPlan[];
  /** every MARKET leg fully filled (atomic all-or-nothing precondition) */
  allMarketFilled: boolean;
  totalCollateralCents: Cents;
  totalFeeCents: Cents;
}

export class MatchingEngine {
  private bidsYES: RestingOrder[] = [];
  private bidsNO: RestingOrder[] = [];
  private positions = new Map<string, Position>();
  readonly trades: Trade[] = [];
  private clock = 0;
  private orderSeq = 0;
  private tradeSeq = 0;
  /** total YES/NO pairs minted (= escrow/100); used to assert settlement. */
  mintedPairs = 0;

  constructor(
    readonly market: Market,
    private ledger: Ledger,
  ) {}

  private now(): number {
    return ++this.clock;
  }

  private posKey(userId: string, side: Side): string {
    return `${this.market.id}:${userId}:${side}`;
  }

  private addToPosition(userId: string, side: Side, qty: number, priceCents: Cents): void {
    const key = this.posKey(userId, side);
    const cur = this.positions.get(key);
    if (!cur) {
      this.positions.set(key, {
        marketId: this.market.id,
        userId,
        side,
        qty,
        avgPriceCents: priceCents,
        realizedPnlCents: 0,
      });
    } else {
      const totalQty = cur.qty + qty;
      cur.avgPriceCents = Math.round((cur.qty * cur.avgPriceCents + qty * priceCents) / totalQty);
      cur.qty = totalQty;
    }
  }

  /** Side opposite to the incoming order. */
  private restingBookFor(side: Side): RestingOrder[] {
    // an incoming YES order matches resting NO bids, and vice versa
    return side === "YES" ? this.bidsNO : this.bidsYES;
  }

  private ownBookFor(side: Side): RestingOrder[] {
    return side === "YES" ? this.bidsYES : this.bidsNO;
  }

  /** Sort resting book: best (highest) price first, then earliest seq. */
  private sortBook(book: RestingOrder[]): void {
    book.sort((a, b) => b.order.priceCents - a.order.priceCents || a.seq - b.seq);
  }

  /**
   * Submit an order. Market orders fill against the book and cancel any
   * remainder; limit orders rest the remainder (collateral locked at limit).
   */
  submit(input: { userId: string; side: Side; type: OrderType; priceCents?: Cents; qty: number }): {
    order: Order;
    trades: Trade[];
  } {
    if (this.market.status !== "open") throw new Error("Market not open");
    const limit = input.type === "market" ? 99 : input.priceCents!;
    if (input.type === "limit" && (limit < 1 || limit > 99)) throw new Error("price out of [1,99]");
    if (!Number.isInteger(input.qty) || input.qty <= 0) throw new Error("qty must be positive integer");

    const order: Order = {
      id: `O${++this.orderSeq}`,
      marketId: this.market.id,
      userId: input.userId,
      side: input.side,
      type: input.type,
      priceCents: limit,
      qty: input.qty,
      filledQty: 0,
      status: "open",
      ts: this.now(),
    };

    const newTrades: Trade[] = [];
    const opp = this.restingBookFor(input.side);
    this.sortBook(opp);

    let remaining = input.qty;
    while (remaining > 0 && opp.length > 0) {
      const maker = opp[0]!;
      const makerPrice = maker.order.priceCents; // price of the OPPOSITE asset
      // cross if limit(YES/own) + makerPrice >= 100
      if (limit + makerPrice < 100) break;

      const takerPrice = 100 - makerPrice; // taker pays this for its own side
      const take = Math.min(remaining, maker.remaining);

      // mint pair: 100¢ * take into escrow (taker from balance, maker from locked)
      this.ledger.balanceToEscrow(input.userId, this.market.id, takerPrice * take, order.id);
      this.ledger.lockedToEscrow(maker.order.userId, this.market.id, makerPrice * take, maker.order.id);
      this.mintedPairs += take;

      // symmetric fees from each party's free balance
      const tFee = feeCents(take, takerPrice / 100, this.market.feeMult);
      const mFee = feeCents(take, makerPrice / 100, this.market.feeMult);
      this.ledger.chargeFee(input.userId, tFee, order.id);
      this.ledger.chargeFee(maker.order.userId, mFee, maker.order.id);

      // positions
      this.addToPosition(input.userId, input.side, take, takerPrice);
      const makerSide: Side = input.side === "YES" ? "NO" : "YES";
      this.addToPosition(maker.order.userId, makerSide, take, makerPrice);

      // trade record (normalize to YES price)
      const yesPriceCents = input.side === "YES" ? takerPrice : makerPrice;
      const trade: Trade = {
        id: `T${++this.tradeSeq}`,
        marketId: this.market.id,
        makerOrderId: maker.order.id,
        takerOrderId: order.id,
        yesPriceCents,
        qty: take,
        ts: this.now(),
      };
      this.trades.push(trade);
      newTrades.push(trade);

      // update books / fills
      remaining -= take;
      order.filledQty += take;
      maker.remaining -= take;
      maker.order.filledQty += take;
      if (maker.remaining === 0) {
        maker.order.status = "filled";
        opp.shift();
      }
    }

    if (remaining > 0 && input.type === "limit") {
      // rest remainder: lock collateral at the limit price
      this.ledger.lock(input.userId, limit * remaining, order.id);
      this.ownBookFor(input.side).push({ order, remaining, seq: order.ts });
      this.sortBook(this.ownBookFor(input.side));
      order.status = "open";
    } else {
      order.status = order.filledQty > 0 ? (remaining === 0 ? "filled" : "filled") : "cancelled";
    }

    return { order, trades: newTrades };
  }

  private addWrittenPosition(userId: string, qty: number, priceCents: Cents): void {
    this.addToPosition(userId, "NO", qty, priceCents); // short YES ≡ holding NO for settlement
    const cur = this.positions.get(this.posKey(userId, "NO"));
    if (cur) cur.written = true;
  }

  /**
   * Native WRITE of YES (a cash-secured short), market order. The writer funds
   * the FULL $1 collateral per contract into escrow and collects the resting
   * buyer's premium directly — versus a buy-NO, where the buyer's premium funds
   * escrow. Net balances/positions/escrow are identical (no-arbitrage), but the
   * writer's cash flow is "receive premium + block collateral" and the position
   * is surfaced as a written short. Invariants are preserved: every posting nets
   * to zero, escrow holds exactly 100¢/pair, and settlement drains it.
   */
  write(input: { userId: string; qty: number }): { order: Order; trades: Trade[] } {
    if (this.market.status !== "open") throw new Error("Market not open");
    if (!Number.isInteger(input.qty) || input.qty <= 0) throw new Error("qty must be positive integer");

    const order: Order = {
      id: `O${++this.orderSeq}`,
      marketId: this.market.id,
      userId: input.userId,
      side: "NO", // writer ends up holding NO (short YES)
      type: "market",
      priceCents: 99,
      qty: input.qty,
      filledQty: 0,
      status: "open",
      ts: this.now(),
      intent: "write",
    };

    const newTrades: Trade[] = [];
    const book = this.bidsYES; // resting YES buyers we provide YES to
    this.sortBook(book);

    let remaining = input.qty;
    while (remaining > 0 && book.length > 0) {
      const maker = book[0]!;
      const makerPrice = maker.order.priceCents; // YES premium the buyer bid
      const noPrice = 100 - makerPrice; // writer's effective cost basis
      const take = Math.min(remaining, maker.remaining);

      // native-write funding: writer posts FULL collateral, buyer's premium → writer
      this.ledger.balanceToEscrow(input.userId, this.market.id, 100 * take, order.id);
      this.ledger.premiumPayout(maker.order.userId, input.userId, makerPrice * take, order.id);
      this.mintedPairs += take;

      // symmetric fees (same basis as submit)
      this.ledger.chargeFee(input.userId, feeCents(take, noPrice / 100, this.market.feeMult), order.id);
      this.ledger.chargeFee(maker.order.userId, feeCents(take, makerPrice / 100, this.market.feeMult), maker.order.id);

      // positions: buyer long YES, writer short YES (held as written NO)
      this.addToPosition(maker.order.userId, "YES", take, makerPrice);
      this.addWrittenPosition(input.userId, take, noPrice);

      const trade: Trade = {
        id: `T${++this.tradeSeq}`,
        marketId: this.market.id,
        makerOrderId: maker.order.id,
        takerOrderId: order.id,
        yesPriceCents: makerPrice,
        qty: take,
        ts: this.now(),
      };
      this.trades.push(trade);
      newTrades.push(trade);

      remaining -= take;
      order.filledQty += take;
      maker.remaining -= take;
      maker.order.filledQty += take;
      if (maker.remaining === 0) {
        maker.order.status = "filled";
        book.shift();
      }
    }

    order.status = order.filledQty > 0 ? "filled" : "cancelled"; // market: no resting remainder
    return { order, trades: newTrades };
  }

  cancel(orderId: string): boolean {
    for (const book of [this.bidsYES, this.bidsNO]) {
      const i = book.findIndex((r) => r.order.id === orderId);
      if (i >= 0) {
        const r = book[i]!;
        // refund locked collateral for the unfilled remainder
        this.ledger.unlock(r.order.userId, r.order.priceCents * r.remaining, orderId);
        r.order.status = "cancelled";
        book.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Cancel all resting orders for a user (refunding locked collateral). Used to
   *  re-quote a market-maker around a new price without touching positions. */
  cancelUserOrders(userId: string): number {
    let n = 0;
    for (const book of [this.bidsYES, this.bidsNO]) {
      for (let i = book.length - 1; i >= 0; i--) {
        const r = book[i]!;
        if (r.order.userId === userId) {
          this.ledger.unlock(r.order.userId, r.order.priceCents * r.remaining, r.order.id);
          r.order.status = "cancelled";
          book.splice(i, 1);
          n++;
        }
      }
    }
    return n;
  }

  private reducePosition(key: string, qty: number, addRealizedCents: Cents): void {
    const p = this.positions.get(key);
    if (!p) return;
    p.qty -= qty;
    p.realizedPnlCents += addRealizedCents;
    if (p.qty <= 0) this.positions.delete(key);
  }

  /**
   * Net a user's offsetting YES+NO holdings into cash — the inverse of mint.
   * Collapses min(yesQty, noQty) pairs, returning 100¢ each from escrow. This is
   * how a "sell/close" frees collateral: YES+NO together are worth exactly $1.
   */
  private mergeUser(userId: string): number {
    const yKey = this.posKey(userId, "YES");
    const nKey = this.posKey(userId, "NO");
    const y = this.positions.get(yKey);
    const n = this.positions.get(nKey);
    if (!y || !n) return 0;
    const pairs = Math.min(y.qty, n.qty);
    if (pairs <= 0) return 0;
    // realized PnL per pair = 100¢ returned − combined cost basis (yAvg + nAvg)
    const realized = pairs * (100 - (y.avgPriceCents + n.avgPriceCents));
    this.ledger.payout(userId, this.market.id, pairs * 100, `merge:${userId}`);
    this.mintedPairs -= pairs;
    this.reducePosition(yKey, pairs, realized);
    this.reducePosition(nKey, pairs, 0);
    return pairs;
  }

  /**
   * Sell/close `qty` of `side`. Mechanically: buy the opposite side, then merge.
   * - Portion within current holdings ⇒ closes the position, frees collateral.
   * - Any excess ⇒ opens a short (you hold the opposite side; premium in,
   *   collateral blocked) — exactly like writing an option.
   * A limit sell at P for YES means buying NO at ≤ 100−P.
   */
  sell(input: { userId: string; side: Side; type: OrderType; priceCents?: Cents; qty: number }): {
    order: Order;
    trades: Trade[];
    mergedPairs: number;
  } {
    const opp: Side = input.side === "YES" ? "NO" : "YES";
    const oppPrice = input.priceCents != null ? 100 - input.priceCents : undefined;
    const res = this.submit({ userId: input.userId, side: opp, type: input.type, priceCents: oppPrice, qty: input.qty });
    const mergedPairs = this.mergeUser(input.userId);
    return { ...res, mergedPairs };
  }

  /** Quantity a user currently holds on a side (for sell/close UI). */
  heldQty(userId: string, side: Side): number {
    return this.positions.get(this.posKey(userId, side))?.qty ?? 0;
  }

  /** Preview a marketable order against the current book (no state change). */
  previewFill(side: Side, qty: number, limitCents = 99): FillPlan {
    const opp = [...this.restingBookFor(side)].sort(
      (a, b) => b.order.priceCents - a.order.priceCents || a.seq - b.seq,
    );
    const fills: { priceCents: Cents; qty: number }[] = [];
    let remaining = qty;
    let cost = 0;
    let fee = 0;
    for (const maker of opp) {
      if (remaining <= 0) break;
      const makerPrice = maker.order.priceCents;
      if (limitCents + makerPrice < 100) break;
      const takerPrice = 100 - makerPrice;
      const take = Math.min(remaining, maker.remaining);
      fills.push({ priceCents: takerPrice, qty: take });
      cost += takerPrice * take;
      fee += feeCents(take, takerPrice / 100, this.market.feeMult);
      remaining -= take;
    }
    const filledQty = qty - remaining;
    return {
      fills,
      filledQty,
      avgPriceCents: filledQty > 0 ? cost / filledQty : 0,
      feeCents: fee,
      restingQty: remaining,
    };
  }

  /**
   * Preview a whole multi-leg strategy against the current book WITHOUT mutating
   * state, consuming a private copy of the books sequentially so that same-side
   * legs see depth already taken by earlier legs. Used for atomic execution:
   * the route commits only if every market leg is fully fillable.
   */
  previewMultiLeg(legs: LegInput[]): MultiLegPreview {
    const copy = (book: RestingOrder[]) =>
      book.map((r) => ({ price: r.order.priceCents, remaining: r.remaining, seq: r.seq }));
    const books = { YES: copy(this.bidsYES), NO: copy(this.bidsNO) };

    const plans: LegPlan[] = [];
    let totalCollateral = 0;
    let totalFee = 0;
    let allMarketFilled = true;

    for (const leg of legs) {
      const limit = leg.type === "market" ? 99 : leg.priceCents ?? 99;
      const opp = (leg.side === "YES" ? books.NO : books.YES).sort(
        (a, b) => b.price - a.price || a.seq - b.seq,
      );
      const fills: { priceCents: Cents; qty: number }[] = [];
      let remaining = leg.qty;
      let cost = 0;
      let fee = 0;
      for (const maker of opp) {
        if (remaining <= 0) break;
        if (limit + maker.price < 100) break;
        const takerPrice = 100 - maker.price;
        const take = Math.min(remaining, maker.remaining);
        if (take <= 0) continue;
        fills.push({ priceCents: takerPrice, qty: take });
        cost += takerPrice * take;
        fee += feeCents(take, takerPrice / 100, this.market.feeMult);
        maker.remaining -= take;
        remaining -= take;
      }
      const filledQty = leg.qty - remaining;
      const restingQty = remaining;
      const restLock = leg.type === "limit" ? limit * restingQty : 0;
      const collateralCents = cost + restLock;
      if (leg.type === "market" && restingQty > 0) allMarketFilled = false;
      totalCollateral += collateralCents;
      totalFee += fee;
      plans.push({
        side: leg.side,
        type: leg.type,
        fills,
        filledQty,
        avgPriceCents: filledQty > 0 ? cost / filledQty : 0,
        feeCents: fee,
        restingQty,
        collateralCents,
      });
    }
    return { plans, allMarketFilled, totalCollateralCents: totalCollateral, totalFeeCents: totalFee };
  }

  orderbook(depth = 10): OrderBookSnapshot {
    const agg = (book: RestingOrder[], map: (p: Cents) => Cents): BookLevel[] => {
      const m = new Map<Cents, number>();
      for (const r of book) {
        const p = map(r.order.priceCents);
        m.set(p, (m.get(p) ?? 0) + r.remaining);
      }
      return [...m.entries()]
        .map(([priceCents, qty]) => ({ priceCents, qty }))
        .sort((a, b) => b.priceCents - a.priceCents)
        .slice(0, depth);
    };
    return {
      yesBids: agg(this.bidsYES, (p) => p), // YES bids as-is
      yesAsks: agg(this.bidsNO, (p) => 100 - p), // NO bids mapped to YES ask price
    };
  }

  /** mid price in cents from best YES bid/ask, or null if one side empty. */
  midCents(): number | null {
    const ob = this.orderbook(1);
    const bestBid = ob.yesBids[0]?.priceCents;
    const bestAsk = ob.yesAsks[0]?.priceCents;
    if (bestBid == null || bestAsk == null) return null;
    return (bestBid + bestAsk) / 2;
  }

  allPositions(): Position[] {
    return [...this.positions.values()];
  }

  positionsForUser(userId: string): Position[] {
    return [...this.positions.values()].filter((p) => p.userId === userId);
  }

  /** Serialize full engine state for persistence. */
  snapshot() {
    return {
      bidsYES: this.bidsYES,
      bidsNO: this.bidsNO,
      positions: [...this.positions] as [string, Position][],
      trades: this.trades,
      mintedPairs: this.mintedPairs,
      clock: this.clock,
      orderSeq: this.orderSeq,
      tradeSeq: this.tradeSeq,
    };
  }

  /** Restore engine state from a snapshot (replaces current state). */
  load(s: ReturnType<MatchingEngine["snapshot"]>): void {
    this.bidsYES = s.bidsYES;
    this.bidsNO = s.bidsNO;
    this.positions = new Map(s.positions);
    this.trades.length = 0;
    this.trades.push(...s.trades);
    this.mintedPairs = s.mintedPairs;
    this.clock = s.clock;
    this.orderSeq = s.orderSeq;
    this.tradeSeq = s.tradeSeq;
  }
}
