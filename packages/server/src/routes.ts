import type { FastifyInstance } from "fastify";
import {
  calc,
  binaryScenarios,
  checkBinary,
  checkCategorical,
  checkLadder,
  escrowId,
  PLATFORM,
  stubOracle,
  type LegInput,
  type Market,
  type MatchingEngine,
  type OrderType,
  type Side,
  type StrategyState,
} from "@augora/core";
import { Store } from "./store.js";
import { Hub } from "./hub.js";
import { listLiveMarkets, getLiveMarket, listLiveEvents, getLiveEvent, type LiveEvent } from "./livedata.js";
import { importLiveMarket, importLiveEvent } from "./liveimport.js";
import type { MarketType } from "@augora/core";

/** Resolve the acting user from a header; default to the playground account. */
function userOf(req: { headers: Record<string, unknown> }): string {
  const h = req.headers["x-user-id"];
  return (typeof h === "string" && h.trim()) || "playground";
}

const CATEGORY: Record<string, string> = {
  "BTC-68K": "Crypto",
  "IRAN-US-PEACE": "Geopolitics",
  "NOMINEE-2028": "Politics",
};

function marketView(store: Store, m: Market) {
  const hist = store.priceHistory.get(m.id) ?? [];
  const settlement = store.settlement.get(m.id);
  return {
    ...m,
    priceCents: store.lastPriceCents(m.id),
    secondsToExpiry: Math.max(0, Math.round((m.expiryTs - Date.now()) / 1000)),
    category: m.category ?? CATEGORY[m.groupId] ?? (m.source === "polymarket" ? "Live" : "Other"),
    spark: hist.slice(-24).map((p) => p.midCents),
    resolution: settlement ? { outcome: settlement.outcome, resolvedPrice: settlement.resolvedPrice } : null,
  };
}

export function registerRoutes(app: FastifyInstance, store: Store, hub: Hub, save: () => void = () => {}): void {
  // ---- markets ----
  app.get("/markets", async () => {
    const list = [...store.markets.values()].map((m) => marketView(store, m));
    // group categorical/ladder so the frontend can render them together
    return { markets: list };
  });

  app.get<{ Params: { id: string } }>("/markets/:id", async (req, reply) => {
    const m = store.markets.get(req.params.id);
    if (!m) return reply.code(404).send({ error: "market not found" });
    return marketView(store, m);
  });

  app.get<{ Params: { id: string } }>("/markets/:id/orderbook", async (req, reply) => {
    if (!store.markets.has(req.params.id)) return reply.code(404).send({ error: "not found" });
    return store.engine(req.params.id).orderbook();
  });

  app.get<{ Params: { id: string } }>("/markets/:id/trades", async (req, reply) => {
    if (!store.markets.has(req.params.id)) return reply.code(404).send({ error: "not found" });
    return { trades: store.tradesForMarket(req.params.id) };
  });

  app.get<{ Params: { id: string } }>("/markets/:id/history", async (req, reply) => {
    if (!store.markets.has(req.params.id)) return reply.code(404).send({ error: "not found" });
    return { history: store.priceHistory.get(req.params.id) ?? [] };
  });

  // ---- orders (buy = open/add, sell = close/short via buy-opposite + merge) ----
  app.post<{
    Body: { market_id: string; side: Side; type: "limit" | "market"; price?: number; qty: number; action?: "buy" | "sell" | "write" };
  }>("/orders", async (req, reply) => {
    const userId = userOf(req);
    store.ensureUser(userId);
    const { market_id, side, type, price, qty, action = "buy" } = req.body as typeof req.body & { action?: "buy" | "sell" | "write" };
    if (!store.markets.has(market_id)) return reply.code(404).send({ error: "market not found" });
    try {
      const eng = store.engine(market_id);
      const result =
        action === "write"
          ? eng.write({ userId, qty })
          : action === "sell"
          ? eng.sell({ userId, side, type, priceCents: price, qty })
          : eng.submit({ userId, side, type, priceCents: price, qty });
      if (result.trades.length) store.recordPrice(market_id);
      hub.broadcast(market_id);
      save();
      return result;
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { market_id: string } }>(
    "/orders/:id",
    async (req, reply) => {
      const marketId = req.query.market_id;
      if (!marketId || !store.markets.has(marketId))
        return reply.code(400).send({ error: "market_id query param required" });
      const ok = store.engine(marketId).cancel(req.params.id);
      if (ok) { hub.broadcast(marketId); save(); }
      return { cancelled: ok };
    },
  );

  // ---- me ----
  app.get("/me/balance", async (req) => {
    const userId = userOf(req);
    store.ensureUser(userId);
    const acct = store.ledger.account(userId);
    return { userId, balanceCents: acct.balanceCents, lockedCents: acct.lockedCents };
  });

  app.get("/me/positions", async (req) => {
    const userId = userOf(req);
    store.ensureUser(userId);
    return { positions: store.positionsWithMtm(userId) };
  });

  app.get("/me/history", async (req) => {
    const userId = userOf(req);
    store.ensureUser(userId);
    const entries = store.ledger.entries.filter((e) => e.accountId === userId);
    return { entries };
  });

  // ---- strategy preview: SAME calc() the frontend uses (single source of truth) ----
  app.post<{ Body: { state: StrategyState } }>("/strategy/preview", async (req, reply) => {
    try {
      const c = calc(req.body.state);
      return { calc: c, scenarios: binaryScenarios(c) };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- fill preview: real depth-aware fill/slippage for one or more legs ----
  app.post<{ Body: { market_id: string; legs: LegInput[] } }>("/strategy/fill-preview", async (req, reply) => {
    const { market_id, legs } = req.body;
    if (!store.markets.has(market_id)) return reply.code(404).send({ error: "market not found" });
    try {
      return store.engine(market_id).previewMultiLeg(legs);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- atomic multi-leg execution: all market legs fill or nothing commits ----
  app.post<{ Body: { market_id: string; legs: LegInput[] } }>("/strategy/execute", async (req, reply) => {
    const { market_id, legs } = req.body;
    if (!store.markets.has(market_id)) return reply.code(404).send({ error: "market not found" });
    if (!Array.isArray(legs) || legs.length === 0) return reply.code(400).send({ error: "no legs" });
    const userId = userOf(req);
    store.ensureUser(userId);
    const eng = store.engine(market_id);
    try {
      // 1) preview the whole basket without mutating state
      const preview = eng.previewMultiLeg(legs);
      // 2) atomic precondition: every market leg fully fillable
      if (!preview.allMarketFilled)
        return reply.code(409).send({ error: "Not enough liquidity to fill all market legs", preview });
      // 3) collateral precondition: enough free balance for cost + fees + resting locks
      const bal = store.ledger.account(userId).balanceCents;
      if (preview.totalCollateralCents + preview.totalFeeCents > bal)
        return reply.code(402).send({ error: "Insufficient balance", preview });
      // 4) commit — single-threaded, so what preview validated is what executes
      const executed = legs.map((leg) =>
        eng.submit({ userId, side: leg.side, type: leg.type, priceCents: leg.priceCents, qty: leg.qty }),
      );
      store.recordPrice(market_id);
      hub.broadcast(market_id);
      save();
      return { executed: executed.map((r) => ({ order: r.order, trades: r.trades })), preview };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- GROUP strategy: legs spanning MULTIPLE members of one group ----
  // Atomic across markets: every market leg must fill and total cost must fit,
  // else nothing commits. This is what lets users build real cross-strike spreads.
  type GroupLeg = { marketId: string; side: Side; type: OrderType; priceCents?: number; qty: number };

  const previewGroup = (legs: GroupLeg[]) => {
    const byMarket = new Map<string, LegInput[]>();
    for (const l of legs) {
      if (!byMarket.has(l.marketId)) byMarket.set(l.marketId, []);
      byMarket.get(l.marketId)!.push({ side: l.side, type: l.type, priceCents: l.priceCents, qty: l.qty });
    }
    let allMarketFilled = true;
    let totalCollateralCents = 0;
    let totalFeeCents = 0;
    const perMarket: Record<string, ReturnType<MatchingEngine["previewMultiLeg"]>> = {};
    for (const [mid, ls] of byMarket) {
      const p = store.engine(mid).previewMultiLeg(ls);
      perMarket[mid] = p;
      allMarketFilled &&= p.allMarketFilled;
      totalCollateralCents += p.totalCollateralCents;
      totalFeeCents += p.totalFeeCents;
    }
    return { perMarket, allMarketFilled, totalCollateralCents, totalFeeCents };
  };

  // validate every leg targets a real market in the SAME group
  const validateGroup = (legs: GroupLeg[]): string | null => {
    if (!Array.isArray(legs) || legs.length === 0) return "no legs";
    let groupId: string | null = null;
    for (const l of legs) {
      const m = store.markets.get(l.marketId);
      if (!m) return `market not found: ${l.marketId}`;
      if (m.status !== "open") return `market not open: ${l.marketId}`;
      if (groupId === null) groupId = m.groupId;
      else if (m.groupId !== groupId) return "all legs must belong to the same group";
    }
    return null;
  };

  app.post<{ Body: { legs: GroupLeg[] } }>("/strategy/fill-preview-group", async (req, reply) => {
    const err = validateGroup(req.body?.legs);
    if (err) return reply.code(400).send({ error: err });
    try {
      return previewGroup(req.body.legs);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body: { legs: GroupLeg[] } }>("/strategy/execute-group", async (req, reply) => {
    const legs = req.body?.legs;
    const err = validateGroup(legs);
    if (err) return reply.code(400).send({ error: err });
    const userId = userOf(req);
    store.ensureUser(userId);
    try {
      // 1) preview the whole cross-market basket without mutating state
      const preview = previewGroup(legs);
      // 2) every market leg must fully fill
      if (!preview.allMarketFilled)
        return reply.code(409).send({ error: "Not enough liquidity to fill all market legs", preview });
      // 3) enough free balance for the whole basket (cost + fees + resting locks)
      const bal = store.ledger.account(userId).balanceCents;
      if (preview.totalCollateralCents + preview.totalFeeCents > bal)
        return reply.code(402).send({ error: "Insufficient balance", preview });
      // 4) commit — single-threaded, so what preview validated is what executes
      const executed = legs.map((leg) => ({
        marketId: leg.marketId,
        ...store.engine(leg.marketId).submit({
          userId,
          side: leg.side,
          type: leg.type,
          priceCents: leg.priceCents,
          qty: leg.qty,
        }),
      }));
      const touched = [...new Set(legs.map((l) => l.marketId))];
      for (const mid of touched) {
        store.recordPrice(mid);
        hub.broadcast(mid);
      }
      save();
      return {
        executed: executed.map((r) => ({ marketId: r.marketId, order: r.order, trades: r.trades })),
        preview,
      };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- WS stream ----
  app.get<{ Params: { id: string } }>("/markets/:id/stream", { websocket: true }, (socket, req) => {
    const marketId = req.params.id;
    if (!store.markets.has(marketId)) {
      socket.close();
      return;
    }
    hub.subscribe(marketId, socket);
    socket.send(JSON.stringify(hub.snapshot(marketId)));
    socket.on("close", () => hub.unsubscribe(marketId, socket));
  });

  // ---- dev/admin: GROUP settle (categorical = winner-take-all, ladder = cumulative) ----
  app.post<{
    Params: { groupId: string };
    Body: { winnerId?: string; firstSatisfiedId?: string; none?: boolean };
  }>("/admin/groups/:groupId/settle", async (req, reply) => {
    const members = [...store.markets.values()].filter((m) => m.groupId === req.params.groupId);
    if (members.length === 0) return reply.code(404).send({ error: "group not found" });
    const type = members[0]!.type;
    try {
      const results: { id: string; outcome: Side }[] = [];

      if (type === "categorical") {
        const { winnerId } = req.body;
        if (!winnerId) return reply.code(400).send({ error: "winnerId required for categorical" });
        for (const m of members) {
          const outcome: Side = m.id === winnerId ? "YES" : "NO";
          store.settlement.settle(store.engine(m.id), store.ledger, outcome, { oracleSource: "group" });
          m.status = "settled";
          results.push({ id: m.id, outcome });
        }
      } else if (type === "ladder") {
        // ascending by threshold date; the first satisfied threshold + all looser ones win
        const sorted = [...members].sort((a, b) => a.expiryTs - b.expiryTs);
        const idx = req.body.none ? sorted.length : sorted.findIndex((m) => m.id === req.body.firstSatisfiedId);
        if (!req.body.none && idx < 0) return reply.code(400).send({ error: "firstSatisfiedId required for ladder" });
        sorted.forEach((m, i) => {
          const outcome: Side = i >= idx ? "YES" : "NO";
          store.settlement.settle(store.engine(m.id), store.ledger, outcome, { oracleSource: "group" });
          m.status = "settled";
          results.push({ id: m.id, outcome });
        });
      } else {
        return reply.code(400).send({ error: "group settle only applies to categorical/ladder" });
      }

      for (const r of results) hub.broadcast(r.id);
      save();
      return { settled: results };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- dev/admin: stub oracle settle ----
  app.post<{ Params: { id: string }; Body: { outcome?: Side; observedPrice?: number } }>(
    "/admin/markets/:id/settle",
    async (req, reply) => {
      const m = store.markets.get(req.params.id);
      if (!m) return reply.code(404).send({ error: "not found" });
      let outcome = req.body.outcome;
      if (!outcome && req.body.observedPrice != null) outcome = stubOracle(m, req.body.observedPrice);
      if (!outcome) return reply.code(400).send({ error: "outcome or observedPrice required" });
      try {
        const rec = store.settlement.settle(store.engine(m.id), store.ledger, outcome, {
          resolvedPrice: req.body.observedPrice,
          oracleSource: "stub",
        });
        hub.broadcast(m.id);
        save();
        return { settlement: rec, escrowCents: store.ledger.bal(escrowId(m.id)) };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );

  // ---- admin/risk snapshot (spec §6, §8.2) ----
  app.get<{ Params: { id: string } }>("/admin/markets/:id/risk", async (req, reply) => {
    const m = store.markets.get(req.params.id);
    if (!m) return reply.code(404).send({ error: "not found" });
    const eng = store.engine(req.params.id);
    const escrow = store.ledger.bal(escrowId(m.id));
    let yesQty = 0,
      noQty = 0;
    const byUser = new Map<string, number>();
    for (const p of eng.allPositions()) {
      if (p.side === "YES") yesQty += p.qty;
      else noQty += p.qty;
      byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + p.qty);
    }
    const oi = eng.mintedPairs; // open interest in pairs
    const topConcentration = [...byUser.values()].sort((a, b) => b - a)[0] ?? 0;
    // type-specific constraint check
    let typeCheck;
    if (m.type === "binary") {
      const mid = store.lastPriceCents(m.id);
      typeCheck = mid == null ? { ok: true, detail: "no book" } : checkBinary(mid, 100 - mid);
    } else if (m.type === "categorical") {
      const group = [...store.markets.values()].filter((x) => x.groupId === m.groupId);
      const prices = group.map((g) => store.lastPriceCents(g.id) ?? 0);
      typeCheck = checkCategorical(prices);
    } else {
      const group = [...store.markets.values()]
        .filter((x) => x.groupId === m.groupId)
        .sort((a, b) => a.expiryTs - b.expiryTs);
      const prices = group.map((g) => store.lastPriceCents(g.id) ?? 0);
      typeCheck = checkLadder(prices);
    }
    return {
      marketId: m.id,
      type: m.type,
      openInterestPairs: oi,
      escrowCents: escrow,
      escrowMatchesOi: escrow === oi * 100, // invariant #2/#4
      imbalanceQty: yesQty - noQty,
      platformInventoryCents: store.ledger.bal(PLATFORM),
      topUserConcentrationQty: topConcentration,
      typeConstraint: typeCheck,
    };
  });

  // ---- health ----
  // ---- LIVE data proxy (Polymarket) — read-only, cached ----
  app.get("/live/markets", async (_req, reply) => {
    try {
      return { markets: await listLiveMarkets(24) };
    } catch (e) {
      return reply.code(502).send({ error: `live data unavailable: ${(e as Error).message}` });
    }
  });

  app.get<{ Params: { id: string } }>("/live/markets/:id", async (req, reply) => {
    try {
      const m = await getLiveMarket(req.params.id);
      if (!m) return reply.code(404).send({ error: "live market not found" });
      return m;
    } catch (e) {
      return reply.code(502).send({ error: `live data unavailable: ${(e as Error).message}` });
    }
  });

  // import a live market into our engine so it can be paper-traded
  app.post<{ Params: { id: string }; Body: { market?: import("./livedata.js").LiveMarket } }>(
    "/live/markets/:id/import",
    async (req, reply) => {
      try {
        const res = await importLiveMarket(store, req.params.id, req.body?.market);
        if (!res) return reply.code(404).send({ error: "live market not found" });
        hub.broadcast(res.market.id);
        save();
        return { marketId: res.market.id, live: res.live };
      } catch (e) {
        return reply.code(502).send({ error: `import failed: ${(e as Error).message}` });
      }
    },
  );

  // ---- LIVE events (multi-outcome) → import as a categorical/ladder group ----
  app.get("/live/events", async (_req, reply) => {
    try {
      // only multi-market events are interesting here; singles show under /live/markets
      const events = (await listLiveEvents(20)).filter((e) => e.markets.length >= 2);
      return { events };
    } catch (e) {
      return reply.code(502).send({ error: `live data unavailable: ${(e as Error).message}` });
    }
  });

  app.get<{ Params: { id: string } }>("/live/events/:id", async (req, reply) => {
    try {
      const ev = await getLiveEvent(req.params.id);
      if (!ev) return reply.code(404).send({ error: "live event not found" });
      return ev;
    } catch (e) {
      return reply.code(502).send({ error: `live data unavailable: ${(e as Error).message}` });
    }
  });

  app.post<{ Params: { id: string }; Body: { event?: LiveEvent; type?: MarketType } }>(
    "/live/events/:id/import",
    async (req, reply) => {
      try {
        const res = await importLiveEvent(store, req.params.id, {
          event: req.body?.event,
          type: req.body?.type,
        });
        if (!res) return reply.code(404).send({ error: "live event not found" });
        for (const m of res.markets) hub.broadcast(m.id);
        save();
        return {
          groupId: res.groupId,
          type: res.type,
          marketIds: res.markets.map((m) => m.id),
          // the market to land on: highest-priced YES option
          primaryId: [...res.markets].sort(
            (a, b) => (store.lastPriceCents(b.id) ?? 0) - (store.lastPriceCents(a.id) ?? 0),
          )[0]?.id,
        };
      } catch (e) {
        return reply.code(502).send({ error: `import failed: ${(e as Error).message}` });
      }
    },
  );

  app.get("/health", async () => ({ ok: true, markets: store.markets.size }));
}
