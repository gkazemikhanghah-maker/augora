# 04 — Data Model & API

## 1. Core types (`packages/core/src/types.ts`)

Money is **always integer cents**. The shapes below describe intent; field names
match the source.

### Market
- `id: string`
- `title: string`, `category: string`
- `groupId?: string` — members of a multi-outcome event share a group id
- `orderLabel?: string` — short axis label for a member (e.g. "end of 2026")
- pricing fields: current YES price in cents, order book / depth, price history
- **Taxonomy (all optional, non-breaking):**
  - `orderingType?: "NOMINAL" | "ORDINAL" | "INTERVAL"`
  - `representation?: "ATOMIC" | "CUMULATIVE"`
  - `axisDirection?: "INCREASING" | "DECREASING"`
  - `orderValue?: number` — position on the axis
  - `taxonomyConfirmed?: boolean` — gates the cumulative corridor builder
- `sourceId?: string` — Polymarket identifier for idempotent re-import
- `resolved?` / resolution fields

### Order
- `id`, `userId`, `marketId`
- `side: "YES" | "NO"`
- `type: "market" | "limit"`
- `intent?: "buy" | "write"` — `write` triggers the native cash-secured short path
- `price?` (cents, for limit), `qty`
- status / fill fields

### Position
- `id`, `userId`, `marketId`
- `side: "YES" | "NO"`
- `qty`
- `written?: boolean` — true for the NO side created by a native write; rendered
  as "SHORT YES" in the portfolio

### Ledger entry
- account key, delta (cents), reason; the ledger enforces `Σ = 0`.

## 2. Persistence (`packages/server/src/store.ts`)

- `node:sqlite` (built-in). Tables for markets, orders, positions, ledger.
- **Seed only runs on a fresh DB.** SQLite persists between runs, so whenever
  `seed.ts` changes you must delete the `.db` files to re-seed (see
  05_BUILD_RUN_DEPLOY.md). This caused "I don't see the new feature" confusion
  twice — it is a workflow gotcha, not a bug.

## 3. REST + WebSocket API (`packages/server/src/routes.ts`)

Base URL: `http://localhost:4000`. Representative endpoints (names match source):

### Markets
- `GET /markets` — list all markets (with taxonomy fields, sparkline data).
- `GET /markets/:id` — single market detail + order book + history.
- `GET /markets/group/:groupId` — members of a multi-outcome group.
- `POST /markets/group/:groupId/taxonomy` — set `orderingType` /
  `representation` / `axisDirection` and `taxonomyConfirmed = true` on **all**
  members. This is the human-confirm step.

### Trading
- `POST /orders` — place an order. Accepts `action: "buy" | "write"` (and
  side/type/price/qty). `write` routes to the native cash-secured short.
- `POST /strategy/preview` — depth-aware preview of a single-market structured
  position (shares `calc.ts` with the frontend).
- `POST /strategy/execute-group` — execute a multi-leg group strategy. Legs carry
  `intent: "buy" | "write"`; `write` legs are previewed at full collateral and
  executed via the engine's `write`. **Sequential, not yet rollback-atomic.**
- Resolution endpoint(s) for the trade → settle → payout lifecycle used by
  `ResolvePanel`.

### Live data
- WebSocket channel for price updates (drives the live flash on the market page).
- `liveimport.ts` exposes Polymarket import; `livedata.ts` periodically syncs
  prices (≈30s) and fetches real price history via Polymarket's CLOB
  `prices-history` endpoint using each member's `yesTokenId`, with a graceful
  fallback to a flat seed at import price (honest baseline over synthetic noise).

## 4. Web client (`apps/web/lib/api.ts`)

A typed wrapper around the endpoints above, including:
- `markets()`, `market(id)`, group fetchers
- `confirmTaxonomy(...)`
- `executeStrategyGroup(...)` with `GroupLeg.intent`
- order placement, preview

## 5. UI components (`apps/web/components/`)

| Component | Role |
|-----------|------|
| `QuickTrade` | Market/limit single orders with depth-aware fill preview |
| `StrategyBuilder` | Single-outcome PRO structured builder |
| `GroupStrategyBuilder` | Basket / per-member group builder ("back top 3" preset) |
| `CorridorBuilder` | Cumulative corridor; Back (debit) / Fade (credit) toggle; window pickers |
| `LongShortBuilder` | Relative long/short on a categorical (`w={long:+1,short:−1}`) |
| `TaxonomyConfirm` | Banner: Cumulative ladder / Distinct buckets / Unordered → confirm |
| `ResolvePanel` | Drives trade → settle → payout |
| `OutcomeLadder` / `OutcomeRows` | Multi-outcome navigation |
| `PriceChart` / `GroupPriceChart` | Area chart with grid/axes/crosshair |

### Market page tabs (`apps/web/app/market/page.tsx`)
- **Trade** — `QuickTrade`.
- **Strategy** — single-outcome `StrategyBuilder`, scoped to the opened outcome.
- **Strategies** — group tools. Logic:
  - if multi-member with a non-`NOMINAL` ordering and not yet confirmed →
    `TaxonomyConfirm` banner (gates the corridor),
  - else if `representation === "CUMULATIVE"` and confirmed → `CorridorBuilder`,
  - else → inline toggle `[Basket | Relative]` → `GroupStrategyBuilder` /
    `LongShortBuilder`.

### Portfolio (`apps/web/app/portfolio/page.tsx`)
- Written positions render as **"SHORT YES"** (red).
- Equity includes **open-position mark value** (not just free balance) — this was
  a fixed bug.
