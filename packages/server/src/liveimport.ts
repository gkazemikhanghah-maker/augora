import type { Market, MarketType } from "@augora/core";
import { Store } from "./store.js";
import { getLiveMarket, getLiveEvent, liveGroupLabel, parseOrderKey, type LiveMarket, type LiveEvent } from "./livedata.js";

const MM = "mm-bot";
const DAY = 86_400_000;

/** Stable internal id for an imported live market. */
export function liveMarketId(liveId: string): string {
  return `LIVE-${liveId}`;
}

/**
 * Derive a sane fair YES price (cents, 1..99) from a live market. Prefer the
 * traded YES price; if missing, use the bid/ask midpoint; never fall back to a
 * lone bestAsk (a wide illiquid book has ask≈98 which would wrongly read as 98%).
 */
function fairYesFromLive(lm: LiveMarket, unknownDefault = 50): number {
  let c = lm.outcomes[0]?.priceCents ?? null;
  if (c == null) {
    const bid = lm.bestBidCents;
    const ask = lm.bestAskCents;
    if (bid != null && ask != null) c = Math.round((bid + ask) / 2);
    else if (bid != null) c = bid;
    // an ask with no bid is a wide, illiquid book — a longshot, not a coin flip
    // and definitely not the ask price (which is ~98); treat it as a few cents.
    else if (ask != null) c = Math.min(ask, 4);
    else c = unknownDefault; // no signal at all
  }
  return Math.max(1, Math.min(99, c));
}

/** Two-sided MM quote around a fair YES price (cents). */
function quote(store: Store, marketId: string, fairYes: number, spreadC: number, qty: number): void {
  const eng = store.engine(marketId);
  const yesBid = Math.max(1, Math.min(98, Math.round(fairYes - spreadC / 2)));
  const noBid = Math.max(1, Math.min(98, Math.round(100 - fairYes - spreadC / 2)));
  eng.submit({ userId: MM, side: "YES", type: "limit", priceCents: yesBid, qty });
  eng.submit({ userId: MM, side: "NO", type: "limit", priceCents: noBid, qty });
}

function seedFlatHistory(store: Store, marketId: string, priceC: number, n = 24): void {
  const hist = store.priceHistory.get(marketId);
  if (!hist || hist.length) return;
  // honest flat lead-in at the imported price; real movement is appended live as
  // the 30s sync tracks the source. (No synthetic wiggle — that read as noise.)
  const t0 = Date.now() - n * 3_600_000;
  const p = Math.round(Math.min(99, Math.max(1, priceC)));
  for (let i = 0; i <= n; i++) hist.push({ ts: t0 + i * 3_600_000, midCents: p });
}

/**
 * Import a Polymarket market into our engine so users can paper-trade it with
 * our own ledger/positions/settlement. Idempotent: returns the existing one if
 * already imported. We only handle the YES/NO (binary) outcome here — the first
 * two outcomes — which covers most Polymarket markets.
 */
export async function importLiveMarket(
  store: Store,
  liveId: string,
  provided?: LiveMarket,
): Promise<{ market: Market; live: LiveMarket } | null> {
  const id = liveMarketId(liveId);
  // prefer the snapshot the client already had; only fetch if not provided
  const live = provided ?? (await getLiveMarket(liveId));
  if (!live) return null;

  // already imported → just refresh the live snapshot reference
  if (store.markets.has(id)) {
    return { market: store.markets.get(id)!, live };
  }

  // derive a fair YES price from the live outcomes (robust against null prices)
  const fairYes = fairYesFromLive(live);

  const endTs = live.endDate ? new Date(live.endDate).getTime() : Date.now() + 30 * DAY;
  const market: Market = {
    id,
    question: live.question,
    type: "binary",
    groupId: id,
    asset: undefined,
    strike: undefined,
    expiryTs: Number.isFinite(endTs) ? endTs : Date.now() + 30 * DAY,
    status: "open",
    feeMult: 0,
    tickSize: 1,
    createdTs: Date.now(),
    // tag so the UI/portfolio can show this is a paper market mirroring a real one
    source: "polymarket",
    sourceId: liveId,
    sourceSlug: live.slug,
  };

  store.ensureUser(MM);
  store.addMarket(market);
  // deep, tight book so paper trades fill cleanly at ~the live price
  quote(store, id, fairYes, 2, 2000);
  seedFlatHistory(store, id, fairYes);
  store.recordPrice(id);
  return { market, live };
}

/** Stable internal group id for an imported live event. */
export function liveEventGroupId(eventId: string): string {
  return `LIVE-EVT-${eventId}`;
}

/** Decide which of our market types an event maps to. */
function inferEventType(ev: LiveEvent, override?: MarketType): MarketType {
  if (override) return override;
  // mutually-exclusive (one winner) → categorical. This is the common case
  // (elections, tournaments, "who will win X").
  if (ev.negRisk === true) return "categorical";
  // heuristic ladder: every option label reads like a cumulative threshold and
  // we have a sensible ascending order by expiry. Conservative: require >=3 and
  // a date/threshold-ish keyword in most labels, else fall back to categorical.
  const labels = ev.markets.map((m) => liveGroupLabel(m).toLowerCase());
  const thresholdish = labels.filter((l) => /(by |before |or more|or fewer|\+|over |under |at least|less than)/.test(l)).length;
  if (ev.markets.length >= 3 && thresholdish >= Math.ceil(ev.markets.length * 0.6)) return "ladder";
  // default for a multi-market event: treat as categorical (soft Σ≈100 via MM).
  return "categorical";
}

type KeyedMember = { lm: LiveMarket; parsed: ReturnType<typeof parseOrderKey>; value: number | undefined };

/** Extract numeric order keys and return members in display order (ascending by
 *  value for orderable/ladder groups, else input order). Shared by create + refresh. */
function orderMembers(ev: LiveEvent, type: MarketType): KeyedMember[] {
  const keyed: KeyedMember[] = ev.markets.map((lm) => {
    const yearHint = lm.endDate ? new Date(lm.endDate).getUTCFullYear() : undefined;
    const parsed = parseOrderKey(liveGroupLabel(lm), yearHint);
    const value = parsed?.kind === "date" ? endTs(lm) : parsed?.value;
    return { lm, parsed, value };
  });
  const orderable = keyed.every((k) => k.value != null);
  return orderable || type === "ladder"
    ? [...keyed].sort((a, b) => (a.value ?? endTs(a.lm)) - (b.value ?? endTs(b.lm)))
    : keyed;
}

/**
 * with our existing categorical/ladder group machinery. Idempotent.
 *
 * Each member keeps its OWN sourceId (its Polymarket market id), so the periodic
 * price/settlement sync in liveimport already tracks every member individually.
 */
export async function importLiveEvent(
  store: Store,
  eventId: string,
  opts?: { event?: LiveEvent; type?: MarketType },
): Promise<{ groupId: string; type: MarketType; markets: Market[]; event: LiveEvent } | null> {
  const ev = opts?.event ?? (await getLiveEvent(eventId));
  if (!ev || ev.markets.length === 0) return null;

  const groupId = liveEventGroupId(ev.id);
  const type = inferEventType(ev, opts?.type);

  // already imported → REFRESH each member's price from the fresh event data
  // (re-importing is the user's "update" gesture; a stale 50%/old snapshot in the
  // db should not be sticky). Members map to the same sorted order by index.
  const existing = [...store.markets.values()]
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (existing.length) {
    // map each existing member to its fresh data by sourceId (robust to ordering
    // and to the list endpoint returning a different subset). Members with no
    // fresh price drop to a low longshot instead of clinging to a stale value.
    const bySource = new Map(ev.markets.map((lm) => [lm.id, lm]));
    for (const m of existing) {
      if (store.settlement.isSettled(m.id)) continue;
      const lm = m.sourceId ? bySource.get(m.sourceId) : undefined;
      requote(store, m.id, lm ? fairYesFromLive(lm, 1) : 1);
    }
    return { groupId, type, markets: existing, event: ev };
  }

  // a single-market event is just a binary import; reuse that path
  if (ev.markets.length === 1) {
    const only = ev.markets[0]!;
    const res = await importLiveMarket(store, only.id, only);
    return res ? { groupId: res.market.groupId, type: "binary", markets: [res.market], event: ev } : null;
  }

  store.ensureUser(MM);
  const created: Market[] = [];

  const seq = orderMembers(ev, type);
  const orderable = seq.every((k) => k.value != null);

  // big events (60–128 options) need the MM funded enough to back every quote,
  // else a mid-loop quote hits the negative-balance guard and aborts the import.
  const qty = seq.length > 40 ? 400 : seq.length > 12 ? 800 : 2000;
  const need = seq.length * qty * 100 + 2_000_000; // worst-case lock + buffer
  const have = store.ledger.bal(MM);
  if (have < need) store.ledger.deposit(MM, need - have);

  seq.forEach(({ lm, parsed, value }, i) => {
    const id = `${groupId}-${i}`;
    const fairYes = fairYesFromLive(lm, 1);
    const label = liveGroupLabel(lm);
    const market: Market = {
      id,
      question: `${ev.title}: ${label}?`,
      type,
      groupId,
      expiryTs: endTs(lm),
      status: "open",
      feeMult: 0,
      tickSize: 1,
      createdTs: Date.now(),
      source: "polymarket",
      sourceId: lm.id, // per-member real id → individual price/settlement sync
      sourceSlug: lm.slug,
      groupTitle: ev.title,
      optionLabel: label,
      category: ev.category,
      ...(orderable && value != null
        ? { orderValue: value, orderKind: parsed!.kind, orderLabel: parsed!.axisLabel }
        : {}),
    };
    store.addMarket(market);
    // one bad option must not abort the whole group import
    try {
      quote(store, id, fairYes, 2, qty);
    } catch {
      /* leave this option with a thin/empty book; market still exists */
    }
    seedFlatHistory(store, id, fairYes);
    store.recordPrice(id);
    created.push(market);
  });

  return { groupId, type, markets: created, event: ev };
}

function endTs(lm: LiveMarket): number {
  const t = lm.endDate ? new Date(lm.endDate).getTime() : NaN;
  return Number.isFinite(t) ? t : Date.now() + 30 * DAY;
}

/**
 * Re-quote the MM around a new fair YES price: cancel its old orders and place
 * fresh two-sided liquidity. Leaves all user positions untouched.
 */
export function requote(store: Store, marketId: string, fairYesC: number, spreadC = 2, qty = 800): void {
  const eng = store.engine(marketId);
  eng.cancelUserOrders(MM);
  store.ensureUser(MM);
  // defensive top-up: never let a periodic re-quote hit the negative-balance guard
  if (store.ledger.bal(MM) < qty * 100 * 4) store.ledger.deposit(MM, qty * 100 * 8);
  quote(store, marketId, fairYesC, spreadC, qty);
  store.recordPrice(marketId);
}

/**
 * Refresh prices of imported (paper) live markets from Polymarket so the paper
 * market tracks the real one. Re-quotes the MM around the new price and records
 * a fresh history point. Skips settled markets. Returns ids that moved.
 */
export async function syncLivePrices(store: Store): Promise<string[]> {
  const moved: string[] = [];
  for (const [id, market] of store.markets) {
    if (market.source !== "polymarket" || !market.sourceId) continue;
    if (store.settlement.isSettled(id)) continue;
    let live;
    try {
      live = await getLiveMarket(market.sourceId);
    } catch {
      continue;
    }
    if (!live) continue;
    // same robust derivation as import: never snap a null price to bestAsk (~98).
    // group members default low (longshot), binaries stay neutral.
    if (live.outcomes[0]?.priceCents == null && live.bestBidCents == null && live.bestAskCents == null) continue;
    const fair = fairYesFromLive(live, market.type === "binary" ? 50 : 1);
    const cur = store.lastPriceCents(id);
    if (cur != null && Math.abs(cur - fair) < 1) continue; // no meaningful change
    requote(store, id, fair);
    moved.push(id);
  }
  return moved;
}

/**
 * Check every imported (paper) live market that isn't settled yet; if Polymarket
 * has resolved it, settle our paper market with the same outcome. Returns the
 * ids we just settled. Safe to call on a timer — settlement is idempotent.
 */
export async function syncLiveSettlements(store: Store): Promise<string[]> {
  const settled: string[] = [];
  for (const [id, market] of store.markets) {
    if (market.source !== "polymarket" || !market.sourceId) continue;
    if (store.settlement.isSettled(id)) continue;
    let live;
    try {
      live = await getLiveMarket(market.sourceId);
    } catch {
      continue; // network hiccup — try again next tick
    }
    if (live?.resolvedOutcome) {
      store.settlement.settle(store.engine(id), store.ledger, live.resolvedOutcome, { oracleSource: "polymarket" });
      market.status = "settled";
      settled.push(id);
    }
  }
  return settled;
}
