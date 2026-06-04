import type { Market, Order, Position, Side, Trade, LegInput, MultiLegPreview } from "@augora/core";

export type OrderType = "limit" | "market";
export interface GroupLeg {
  marketId: string;
  side: Side;
  type: OrderType;
  priceCents?: number;
  qty: number;
  intent?: "buy" | "write";
}
export interface GroupPreview {
  perMarket: Record<string, MultiLegPreview>;
  allMarketFilled: boolean;
  totalCollateralCents: number;
  totalFeeCents: number;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

/** The playground identity; sent on every request so /me/* resolves. */
export const USER_ID = "playground";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-id": USER_ID,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type MarketView = Market & {
  priceCents: number | null;
  secondsToExpiry: number;
  category: string;
  spark: number[];
  resolution: { outcome: Side; resolvedPrice?: number } | null;
};
export interface BookLevel {
  priceCents: number;
  qty: number;
}
export interface OrderBook {
  yesBids: BookLevel[];
  yesAsks: BookLevel[];
}
export interface PricePoint {
  ts: number;
  midCents: number;
}
export type MtmPosition = Position & {
  markCents: number | null;
  unrealizedPnlCents: number;
  settled: boolean;
  settledOutcome?: Side;
  won?: boolean;
  marketQuestion: string;
  source?: string;
};

export interface LiveOutcome {
  label: string;
  priceCents: number | null;
}
export interface LiveMarket {
  id: string;
  slug: string;
  question: string;
  category: string;
  outcomes: LiveOutcome[];
  volume: number | null;
  volume24hr: number | null;
  liquidity: number | null;
  endDate: string | null;
  closed: boolean;
  resolvedOutcome: "YES" | "NO" | null;
  oneDayChange: number | null;
  bestBidCents: number | null;
  bestAskCents: number | null;
  image: string | null;
  source: "polymarket";
}

export interface LiveEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  negRisk: boolean | null;
  volume: number | null;
  liquidity: number | null;
  endDate: string | null;
  closed: boolean;
  image: string | null;
  markets: LiveMarket[];
}

export const api = {
  markets: () => req<{ markets: MarketView[] }>("/markets").then((r) => r.markets),
  market: (id: string) => req<MarketView>(`/markets/${id}`),
  orderbook: (id: string) => req<OrderBook>(`/markets/${id}/orderbook`),
  trades: (id: string) => req<{ trades: Trade[] }>(`/markets/${id}/trades`).then((r) => r.trades),
  history: (id: string) =>
    req<{ history: PricePoint[] }>(`/markets/${id}/history`).then((r) => r.history),
  balance: () => req<{ balanceCents: number; lockedCents: number }>("/me/balance"),
  positions: () => req<{ positions: MtmPosition[] }>("/me/positions").then((r) => r.positions),
  placeOrder: (body: { market_id: string; side: Side; type: "limit" | "market"; price?: number; qty: number; action?: "buy" | "sell" }) =>
    req<{ order: Order; trades: Trade[]; mergedPairs?: number }>("/orders", { method: "POST", body: JSON.stringify(body) }),
  fillPreview: (market_id: string, legs: LegInput[]) =>
    req<MultiLegPreview>("/strategy/fill-preview", { method: "POST", body: JSON.stringify({ market_id, legs }) }),
  executeStrategy: (market_id: string, legs: LegInput[]) =>
    req<{ executed: { order: Order; trades: Trade[] }[]; preview: MultiLegPreview }>("/strategy/execute", {
      method: "POST",
      body: JSON.stringify({ market_id, legs }),
    }),
  fillPreviewGroup: (legs: GroupLeg[]) =>
    req<GroupPreview>("/strategy/fill-preview-group", { method: "POST", body: JSON.stringify({ legs }) }),
  executeStrategyGroup: (legs: GroupLeg[]) =>
    req<{ executed: { marketId: string; order: Order; trades: Trade[] }[]; preview: GroupPreview }>(
      "/strategy/execute-group",
      { method: "POST", body: JSON.stringify({ legs }) },
    ),
  settle: (market_id: string, body: { outcome?: Side; observedPrice?: number }) =>
    req<{ settlement: { outcome: Side }; escrowCents: number }>(`/admin/markets/${market_id}/settle`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  settleGroup: (groupId: string, body: { winnerId?: string; firstSatisfiedId?: string; none?: boolean }) =>
    req<{ settled: { id: string; outcome: Side }[] }>(`/admin/groups/${encodeURIComponent(groupId)}/settle`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  liveMarkets: () => req<{ markets: LiveMarket[] }>("/live/markets").then((r) => r.markets),
  liveMarket: (id: string) => req<LiveMarket>(`/live/markets/${encodeURIComponent(id)}`),
  liveEvents: () => req<{ events: LiveEvent[] }>("/live/events").then((r) => r.events),
  importLiveEvent: (id: string, event?: LiveEvent) =>
    req<{ groupId: string; type: Market["type"]; marketIds: string[]; primaryId?: string }>(
      `/live/events/${encodeURIComponent(id)}/import`,
      { method: "POST", body: JSON.stringify({ event }) },
    ),
  importLive: (id: string, market?: LiveMarket) =>
    req<{ marketId: string; live: LiveMarket }>(`/live/markets/${encodeURIComponent(id)}/import`, {
      method: "POST",
      body: JSON.stringify({ market }),
    }),
  streamUrl: (id: string) => `${API_BASE.replace("http", "ws")}/markets/${id}/stream`,
};

/* ---- formatting (mirrors PayoffBuilder money()/cents()) ---- */
export const money = (dollars: number) =>
  (dollars < 0 ? "\u2212$" : "$") + Math.abs(dollars).toFixed(2);
export const moneyC = (cents: number) => money(cents / 100);
export const centsPrice = (p: number) => (p * 100).toFixed(1) + "\u00A2";

export function timeToExpiry(seconds: number): string {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export const MARKET_TYPE_LABEL: Record<Market["type"], string> = {
  binary: "Binary",
  categorical: "Categorical",
  ladder: "Ladder",
};
