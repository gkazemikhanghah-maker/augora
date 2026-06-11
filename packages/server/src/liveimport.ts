import type { Market, MarketType, Side } from "@augora/core";
import { suggestTaxonomy } from "@augora/core";
import { Store } from "./store.js";
import { getLiveMarket, getLiveEvent, liveGroupLabel, parseOrderKey, fetchLiveHistory, type LiveMarket, type LiveEvent } from "./livedata.js";

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
  store.ensureUser(MM);
  // a 5-level ladder ties up more collateral than a single quote; keep the MM funded
  if (store.ledger.bal(MM) < qty * 100 * 12) store.ledger.deposit(MM, qty * 100 * 30);
  const LEVELS = 5;
  const yesBid0 = Math.max(1, Math.min(98, Math.round(fairYes - spreadC / 2)));
  const noBid0 = Math.max(1, Math.min(98, Math.round(100 - fairYes - spreadC / 2)));
  for (let k = 0; k < LEVELS; k++) {
    const lvlQty = Math.round(qty * (1 + 0.5 * k));
    const yb = yesBid0 - k;
    const nb = noBid0 - k;
    if (yb >= 1) eng.submit({ userId: MM, side: "YES", type: "limit", priceCents: yb, qty: lvlQty });
    if (nb >= 1) eng.submit({ userId: MM, side: "NO", type: "limit", priceCents: nb, qty: lvlQty });
  }
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

/** Seed (or refresh) a market's chart with REAL Polymarket history when we can
 *  fetch it, otherwise a flat line. Replaces existing flat seed on re-import.
 *  Returns true if real history was applied. Never throws. */
async function seedHistory(
  store: Store,
  marketId: string,
  yesTokenId: string | null | undefined,
  sourceId: string | null | undefined,
  fair: number,
): Promise<boolean> {
  const hist = store.priceHistory.get(marketId);
  if (!hist) return false;
  // the event-list payload often omits clobTokenIds; fall back to the per-market
  // endpoint to obtain the YES token, then fetch its price history.
  let token = yesTokenId ?? null;
  if (!token && sourceId) {
    const lm = await getLiveMarket(sourceId).catch(() => null);
    token = lm?.yesTokenId ?? null;
  }
  const real = await fetchLiveHistory(token);
  if (real.length >= 2) {
    hist.length = 0;
    hist.push(...real);
    return true;
  }
  if (!hist.length) seedFlatHistory(store, marketId, fair);
  return false;
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
  await seedHistory(store, id, live.yesTokenId, liveId, fairYes);
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

type MemberSpec = {
  sourceId: string | null; // null = synthetic "Other" row (no Polymarket id)
  slug?: string;
  yesTokenId?: string | null;
  label: string;
  fair: number;
  expiryTs: number;
  orderValue?: number;
  orderKind?: "number" | "date";
  orderLabel?: string;
};

const TOP_N = 5;

/** Decide which members of an event to actually import. For a big categorical
 *  event (e.g. a 128-candidate nominee race) most options are placeholder/no-
 *  liquidity markets sitting at Polymarket's default 50¢ — pure noise. We keep
 *  only the TOP_N options with real trade volume and fold everything else into a
 *  single "Other" row, the way Polymarket itself collapses the long tail. Ladder
 *  and small groups are kept in full. */
/** Categorical outcomes are MECE → their YES fairs must sum to $1 (100¢). Adjust a
 *  set of integer-cent fairs to sum to exactly 100. If an "Other" residual slot exists
 *  (otherIdx), it absorbs the residual; otherwise every member is scaled proportionally.
 *  Ladders are cumulative and must NOT be passed here. */
export function normalizeToHundred(fairs: number[], otherIdx: number | null): number[] {
  const out = fairs.slice();
  if (out.length === 0) return out;
  if (otherIdx != null && otherIdx >= 0) {
    let rest = out.reduce((s, v, i) => (i === otherIdx ? s : s + v), 0);
    if (rest >= 99) {
      // over-round book: scale the non-Other members down to leave Other = 1
      const scale = 99 / rest;
      let acc = 0;
      for (let i = 0; i < out.length; i++) {
        if (i === otherIdx) continue;
        const v = Math.max(1, Math.round((out[i] ?? 0) * scale));
        out[i] = v;
        acc += v;
      }
      out[otherIdx] = Math.max(1, 100 - acc);
    } else {
      out[otherIdx] = Math.max(1, 100 - rest);
    }
    return out;
  }
  // no residual slot: scale all members proportionally, then fix rounding drift
  const sum = out.reduce((s, v) => s + v, 0) || 1;
  let acc = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.max(1, Math.round(((out[i] ?? 0) * 100) / sum));
    out[i] = v;
    acc += v;
  }
  const drift = 100 - acc;
  if (drift !== 0) {
    let maxI = 0;
    for (let i = 1; i < out.length; i++) if ((out[i] ?? 0) > (out[maxI] ?? 0)) maxI = i;
    out[maxI] = Math.max(1, (out[maxI] ?? 0) + drift);
  }
  return out;
}

function buildMemberSpecs(ev: LiveEvent, type: MarketType): MemberSpec[] {
  const collapse = type === "categorical" && ev.markets.length > TOP_N + 1;
  let specs: MemberSpec[];
  if (!collapse) {
    specs = orderMembers(ev, type).map(({ lm, parsed, value }) => ({
      sourceId: lm.id,
      slug: lm.slug,
      yesTokenId: lm.yesTokenId,
      label: liveGroupLabel(lm),
      fair: fairYesFromLive(lm, 1),
      expiryTs: endTs(lm),
      ...(value != null && parsed ? { orderValue: value, orderKind: parsed.kind, orderLabel: parsed.axisLabel } : {}),
    }));
  } else {
    // "meaningful" = has real trade volume; placeholders trade ~0 and sit at 50¢.
    const hasVol = ev.markets.some((m) => (m.volume ?? 0) > 0);
    const real = hasVol
      ? ev.markets.filter((m) => (m.volume ?? 0) > 0)
      : ev.markets.filter((m) => { const p = m.outcomes[0]?.priceCents; return p != null && p !== 50; });
    const pool = real.length ? real : ev.markets;
    const top = [...pool].sort((a, b) => (b.outcomes[0]?.priceCents ?? 0) - (a.outcomes[0]?.priceCents ?? 0)).slice(0, TOP_N);

    specs = top.map((lm) => ({
      sourceId: lm.id,
      slug: lm.slug,
      yesTokenId: lm.yesTokenId,
      label: liveGroupLabel(lm),
      fair: fairYesFromLive(lm, 1),
      expiryTs: endTs(lm),
    }));
    const sum = specs.reduce((s, m) => s + m.fair, 0);
    specs.push({
      sourceId: null,
      label: "Other",
      fair: Math.max(1, Math.min(99, 100 - sum)),
      expiryTs: Math.max(...ev.markets.map(endTs)),
    });
  }

  // categorical members are mutually exclusive → normalize YES fairs to sum 100¢.
  // (Ladders are cumulative and are intentionally left untouched.)
  if (type === "categorical") {
    const otherIdx = specs.findIndex((s) => s.sourceId == null);
    const norm = normalizeToHundred(specs.map((s) => s.fair), otherIdx);
    specs.forEach((s, i) => { s.fair = norm[i]!; });
  }
  return specs;
}

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
    // and to the list endpoint returning a different subset). The synthetic
    // "Other" row (no sourceId) absorbs the residual. For categorical groups the
    // whole set is normalized to sum 100¢ BEFORE requoting (members are MECE);
    // ladders are cumulative and refreshed independently.
    const bySource = new Map(ev.markets.map((lm) => [lm.id, lm]));
    const active = existing.filter((m) => !store.settlement.isSettled(m.id));
    // raw target fair per active member (Other → placeholder, replaced by normalize)
    const targets = active.map((m) => {
      if (!m.sourceId) return 1;
      const lm = bySource.get(m.sourceId);
      return lm ? fairYesFromLive(lm, 1) : 1;
    });
    const fairs =
      type === "categorical"
        ? normalizeToHundred(targets, active.findIndex((m) => !m.sourceId))
        : targets;
    let refreshedHist = 0;
    for (let i = 0; i < active.length; i++) {
      const m = active[i]!;
      const fair = fairs[i]!;
      requote(store, m.id, fair);
      if (m.sourceId) {
        const lm = bySource.get(m.sourceId);
        // also pull real price history so the chart isn't stuck on the old flat seed
        if (await seedHistory(store, m.id, lm?.yesTokenId, m.sourceId, fair)) refreshedHist++;
      }
    }
    console.log(`[augora] re-import ${groupId}: refreshed ${active.length} members, ${refreshedHist} got real history`);
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

  const specs = buildMemberSpecs(ev, type);

  // auto-detect spread taxonomy (suggestion only — a human confirms before any
  // corridor product turns on). Binary markets need none.
  const suggestion =
    type === "binary"
      ? null
      : suggestTaxonomy(specs.map((s) => ({ label: s.label, priceCents: s.fair, orderValue: s.orderValue })));

  // fund the MM enough to back every quote, else a mid-loop quote hits the
  // negative-balance guard and aborts the import.
  const qty = specs.length > 40 ? 400 : specs.length > 12 ? 800 : 2000;
  const need = specs.length * qty * 100 + 2_000_000;
  const have = store.ledger.bal(MM);
  if (have < need) store.ledger.deposit(MM, need - have);

  let i = 0;
  let realCount = 0;
  for (const sp of specs) {
    const id = `${groupId}-${i++}`;
    const market: Market = {
      id,
      question: `${ev.title}: ${sp.label}?`,
      type,
      groupId,
      expiryTs: sp.expiryTs,
      status: "open",
      feeMult: 0,
      tickSize: 1,
      createdTs: Date.now(),
      source: "polymarket",
      groupTitle: ev.title,
      optionLabel: sp.label,
      category: ev.category,
      ...(sp.sourceId ? { sourceId: sp.sourceId, sourceSlug: sp.slug } : {}),
      ...(sp.orderValue != null ? { orderValue: sp.orderValue, orderKind: sp.orderKind, orderLabel: sp.orderLabel } : {}),
      ...(suggestion
        ? {
            orderingType: suggestion.orderingType,
            ...(suggestion.representation ? { representation: suggestion.representation } : {}),
            ...(suggestion.axisDirection ? { axisDirection: suggestion.axisDirection } : {}),
            taxonomyConfirmed: false, // human must confirm before corridor/credit products
            taxonomyReason: suggestion.reason,
            taxonomyConfidence: suggestion.confidence,
            taxonomySignals: suggestion.signals,
          }
        : {}),
    };
    store.addMarket(market);
    try {
      quote(store, id, sp.fair, 2, qty);
    } catch {
      /* leave this option with a thin/empty book; market still exists */
    }
    if (await seedHistory(store, id, sp.yesTokenId, sp.sourceId, sp.fair)) realCount++;
    store.recordPrice(id);
    created.push(market);
  }

  console.log(`[augora] import ${groupId}: ${realCount}/${created.length} members got real Polymarket history`);
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
  // (the 5-level ladder ties up more collateral than a single quote did)
  if (store.ledger.bal(MM) < qty * 100 * 15) store.ledger.deposit(MM, qty * 100 * 40);
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
  // the synthetic "Other" rows have no Polymarket id, so the loop above skips
  // them — derive their outcome from the now-resolved real members instead.
  settled.push(...settleOtherRows(store));
  return settled;
}

/**
 * Auto-settle the synthetic "Other" row of each categorical group once ALL of its
 * real (sourced) members have resolved. Categorical outcomes are mutually exclusive,
 * so "Other" (none of the listed options) wins YES iff no listed option won, and
 * loses NO if exactly one listed option won. Idempotent + safe to call on a timer.
 */
export function settleOtherRows(store: Store): string[] {
  const settled: string[] = [];
  const groups = new Map<string, Market[]>();
  for (const m of store.markets.values()) {
    if (m.type !== "categorical" || !m.groupId) continue;
    const arr = groups.get(m.groupId);
    if (arr) arr.push(m);
    else groups.set(m.groupId, [m]);
  }
  for (const members of groups.values()) {
    const other = members.find((m) => !m.sourceId);
    if (!other || store.settlement.isSettled(other.id)) continue;
    const sourced = members.filter((m) => m.sourceId);
    if (sourced.length === 0 || !sourced.every((m) => store.settlement.isSettled(m.id))) continue; // wait for all
    const anyYes = sourced.some((m) => store.settlement.get(m.id)?.outcome === "YES");
    const outcome: Side = anyYes ? "NO" : "YES";
    store.settlement.settle(store.engine(other.id), store.ledger, outcome, { oracleSource: "derived-other" });
    other.status = "settled";
    settled.push(other.id);
  }
  return settled;
}
