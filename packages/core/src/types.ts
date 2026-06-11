/**
 * Domain types for Augora — aligned with PROJECT_SPEC.md §5.
 *
 * MONEY RULE (invariant #6): all *executed* money is integer Cents.
 * `Cents` is a plain number that MUST always hold an integer. Use the
 * helpers in money.ts to convert; never store floats in the ledger.
 */

export type Cents = number; // integer cents, e.g. 12100 === $121.00

export type Side = "YES" | "NO";

export type MarketType = "binary" | "categorical" | "ladder";

export type MarketStatus = "open" | "closed" | "settled";

export interface Market {
  id: string;
  question: string;
  type: MarketType;
  /** For categorical/ladder grouping; binary markets have groupId === id. */
  groupId: string;
  asset?: string;
  strike?: number;
  expiryTs: number;
  status: MarketStatus;
  feeMult: number; // 0 = none, 0.07 = standard
  tickSize: number; // in cents, e.g. 1
  createdTs: number;
  /** Provenance for paper markets imported from an external venue (optional). */
  source?: "polymarket";
  sourceId?: string;
  sourceSlug?: string;
  /** Human title shared by every member of a categorical/ladder group (optional;
   *  the UI prefers this over a hard-coded map or the first member's question). */
  groupTitle?: string;
  /** Short label for this member within its group, e.g. "Candidate A" or
   *  "by end of 2026". When set, the UI uses it instead of parsing `question`. */
  optionLabel?: string;
  /** Display category/section (optional; imported live markets set this). */
  category?: string;
  /** Numeric coordinate for ordered/ranged groups (price buckets, by-date
   *  thresholds), extracted from the option label at import time. Enables the
   *  value-axis payoff chart and range spreads. */
  orderValue?: number;
  orderKind?: "number" | "date";
  orderLabel?: string;
  /** Spread-engine taxonomy (addendum v1.1). `orderingType` says whether a
   *  corridor is even meaningful; `representation` says how it's built (atoms
   *  vs cumulative thresholds); `axisDirection` disambiguates "wider" for
   *  cumulative markets. Set once at import (heuristic + human confirm) and then
   *  stored — never re-guessed at runtime. Absent ⇒ structured products off. */
  orderingType?: "NOMINAL" | "ORDINAL" | "INTERVAL";
  representation?: "ATOMIC" | "CUMULATIVE";
  axisDirection?: "INCREASING" | "DECREASING";
  /** Human-confirmed the taxonomy above (safety gate for corridor products). */
  taxonomyConfirmed?: boolean;
  /** Why the taxonomy was auto-suggested (debug / "why" panel). Set at import,
   *  informational only — the human confirm above is what actually gates products. */
  taxonomyReason?: string;
  taxonomyConfidence?: "LOW" | "MEDIUM" | "HIGH";
  taxonomySignals?: { label: string; detail: string; toward: "CUMULATIVE" | "ATOMIC" | "NEUTRAL" }[];
}

export type OrderType = "limit" | "market";
export type OrderStatus = "open" | "filled" | "cancelled";

export interface Order {
  id: string;
  marketId: string;
  userId: string;
  side: Side; // the asset the order wants to BUY (YES or NO)
  type: OrderType;
  priceCents: Cents; // limit price for the chosen side, [1..99]
  qty: number; // integer contracts
  filledQty: number;
  status: OrderStatus;
  ts: number;
  /** "write" = a native short: writer funds full $1 collateral and collects the
   *  premium from the buyer (a cash-secured written option). Absent ⇒ a buy. */
  intent?: "buy" | "write";
}

export interface Trade {
  id: string;
  marketId: string;
  makerOrderId: string;
  takerOrderId: string;
  /** price paid for YES side of the minted pair, in cents */
  yesPriceCents: Cents;
  qty: number;
  ts: number;
}

export interface Position {
  marketId: string;
  userId: string;
  side: Side;
  qty: number;
  avgPriceCents: Cents; // volume-weighted avg entry, in cents
  realizedPnlCents: Cents;
  /** True when this NO holding was opened by writing YES (a short). Economically
   *  identical to a bought NO here, but surfaced for credit-spread display. */
  written?: boolean;
}

export interface Account {
  userId: string;
  balanceCents: Cents; // free, spendable
  lockedCents: Cents; // reserved as collateral for resting orders
}

export interface LedgerEntry {
  id: string;
  accountId: string; // userId | "PLATFORM" | "ESCROW:<marketId>" | "EXTERNAL"
  deltaCents: Cents;
  reason: string;
  refId?: string;
  ts: number;
}

export interface Settlement {
  marketId: string;
  outcome: Side;
  resolvedPrice?: number;
  twapWindow?: number;
  oracleSource?: string;
  ts: number;
}

/* ---- Strategy Builder (ported from PayoffBuilder.html) ---- */

export type LegKey = "BUY" | "WRITE" | "BUYA" | "WRITEA";

export interface LegState {
  on: boolean;
  qty: number;
}

export interface StrategyState {
  /** YES mid price as a probability in (0,1), e.g. 0.605 */
  mid: number;
  /** spread in price units (dollars), e.g. 0 or 0.02 */
  spread: number;
  /** user belief P(YES) in (0,1) */
  belief: number;
  /** fee multiplier: 0 none, 0.07 Kalshi, 0.10 high */
  feeMult: number;
  legs: Record<LegKey, LegState>;
}

/** Result of the single calc() — all amounts in DOLLARS (preview units). */
export interface CalcResult {
  netPrem: number;
  collat: number;
  fees: number;
  P0: number; // P&L if NO wins (YES prob = 0)
  P1: number; // P&L if YES wins (YES prob = 1)
  maxP: number;
  maxL: number;
  be: number | null; // breakeven YES-probability in [0,1]
  capital: number; // cash-accounting capital == -maxL
  ev: number;
  nLegs: number;
}
