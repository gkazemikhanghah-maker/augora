# Augora — MVP

Fully-collateralized binary prediction market (Polymarket/Kalshi style).
**Single source of truth:** the calc logic from `PayoffBuilder.html` is ported
once to `packages/core` and consumed by both backend and (later) frontend, so
cost breakdown, scenarios, and the payoff curve can never disagree.

## Monorepo

```
packages/
  core/              # shared TypeScript logic — the single source of truth
    src/
      types.ts         # data model (spec §5) — money is integer Cents
      money.ts         # integer-cent helpers (invariant #6)
      fees.ts          # Kalshi fee model (§2.6), round-up cents
      calc.ts          # SINGLE SOURCE OF TRUTH — ported from PayoffBuilder.html
      marketTypes.ts   # binary / categorical / ladder constraints (§2.10)
      ledger.ts        # double-entry ledger, conservation + no-negative guards
      matching.ts      # CLOB price-time, mint-on-cross, fully collateralized
      settlement.ts    # atomic, idempotent settlement (escrow -> 0)
    test/
      calc.test.ts        # reference numbers, scenario count, P&L signs, market types
      invariants.test.ts  # the six invariants, end-to-end
  server/            # Fastify REST + WebSocket API, in-memory state, seed
    src/
      store.ts         # in-memory app state: ledger, engines, MTM, price history
      seed.ts          # sample markets of all 3 types + market-maker liquidity
      hub.ts           # WS per-market pub/sub
      routes.ts        # REST + WS endpoints (spec §6) + strategy preview + risk
      index.ts         # Fastify bootstrap
    test/
      server.test.ts   # seed integrity + trade -> settle conservation
# apps/web — Next.js + Tailwind dashboard, wired to this API
  web/
    app/
      page.tsx                # Markets list
       market/page.tsx          # Market detail: live book/depth/history + Strategy Builder
      portfolio/page.tsx      # Portfolio + MTM
      layout.tsx, globals.css # shared theme (Fraunces + IBM Plex, paper background)
    components/
      StrategyBuilder.tsx     # reads the SHARED calc() from @augora/core
      PayoffChart.tsx         # payoff curve, ported from PayoffBuilder.html
      MarketCharts.tsx        # order book, depth chart, price history (SVG)
    lib/api.ts                # API client + formatting helpers
```

## Run

Two terminals — backend on `:4000`, frontend on `:3000`.

```bash
npm install        # once, from the repo root

# terminal 1 — API (in-memory; no Postgres/Redis needed)
npm run dev        # http://localhost:4000  (8 markets seeded)

# terminal 2 — web app
npm run dev:web    # http://localhost:3000  (open this in your browser)
```

Other commands:

```bash
npm test           # all acceptance tests (17)
npm run typecheck  # strict TypeScript check (core + server)
npm run build:web  # production build of the Next.js app
```

The backend keeps state in memory — **no database on day one**. Every request
without an `x-user-id` header acts as the `playground` account, auto-funded with
**$10,000** virtual (paper trading). The frontend talks to the API at
`http://localhost:4000` (override with `NEXT_PUBLIC_API_BASE`).

## Frontend (apps/web — Next.js + Tailwind)

Light theme matching `PayoffBuilder.html` (Fraunces + IBM Plex). Three pages:

- **`/` Markets** — binary / categorical / ladder grouped, live YES price, time to expiry.
- **`/market?id=…`** — live order book + depth chart + price history (over WebSocket),
  fair value, time to expiry, and the **Strategy Builder**: four legs
  (Buy / Write / Buy Against / Write Against), payoff chart, Max profit / Max loss /
  Breakeven / EV, and exactly two outcome scenarios — all from the **shared `calc()`**
  in `@augora/core` (same numbers as the backend `/strategy/preview`). Execute places
  real market orders against the running API.
- **`/portfolio`** — free balance, locked collateral, equity, and open positions with
  mark-to-market unrealized P&L.

## API (spec §6)

```
GET    /markets                       list + live price + seconds to expiry
GET    /markets/:id                   market detail
GET    /markets/:id/orderbook         { yesBids, yesAsks } depth
GET    /markets/:id/trades            recent tape
GET    /markets/:id/history           synthetic price history (for the chart)
WS     /markets/:id/stream            push: snapshot { orderbook, price, trades }

POST   /orders        { market_id, side, type, price?, qty }   place (limit|market)
DELETE /orders/:id?market_id=...      cancel (refunds locked collateral)

GET    /me/balance                    { balanceCents, lockedCents }   (x-user-id header)
GET    /me/positions                  open positions + mark-to-market
GET    /me/history                    this user's ledger entries

POST   /strategy/preview  { state }   runs the SHARED calc() — same numbers as the UI

# dev / admin
POST   /admin/markets/:id/settle      { outcome } or { observedPrice } (stub oracle)
GET    /admin/markets/:id/risk        OI, escrow match, imbalance, concentration, type check
```

### Quick smoke test

```bash
npm run dev      # in one terminal
# in another:
curl localhost:4000/markets
curl -H 'x-user-id: playground' -X POST localhost:4000/orders \
  -H content-type:application/json \
  -d '{"market_id":"BTC-68K","side":"YES","type":"market","qty":100}'
curl -H 'x-user-id: playground' localhost:4000/me/positions
```

## Seeded markets (all three types — spec §2.10)

- **binary** — `BTC-68K` "آیا BTC ≥ $68,000؟" (Kalshi fee on).
- **ladder (dated)** — `IRAN-US-PEACE`: three "تا تاریخِ X" thresholds, prices
  monotone non-decreasing, **not** summed to 1.
- **categorical** — `NOMINEE-2028`: four mutually-exclusive options whose YES
  prices sum to ~100¢.

## The six invariants (enforced + tested)

1. Conservation: Σ user PnL + platform = 0.
2. Fully collateralized, no leverage; max loss = premium paid; bad debt = 0.
3. No negative balance.
4. Escrow backs each YES+NO pair at $1 and drains to 0 at settlement.
5. Settlement is atomic and idempotent.
6. Money is integer cents (never float) in the ledger.

Reference combo (`calc`): Buy 100 YES @60.5¢ + Write Against 100 NO @39.5¢ ⇒
net premium −$21, collateral $100, capital/max-loss $121, YES +$79, NO −$121,
breakeven 60.5%. The frontend Strategy Builder and the backend `/strategy/preview`
both call this one function, so they can never disagree.
