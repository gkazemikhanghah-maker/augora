# 02 — Architecture

## 1. Monorepo layout

Augora is a TypeScript monorepo using **npm workspaces**.

```
augora/
├── package.json                # workspaces: packages/*, apps/*
├── packages/
│   ├── core/                   # pure domain logic, no I/O
│   │   ├── src/
│   │   │   ├── types.ts        # Market, Order, Position, etc.
│   │   │   ├── money.ts        # integer-cent helpers
│   │   │   ├── fees.ts         # fee model
│   │   │   ├── calc.ts         # single source of truth for price/fill math
│   │   │   ├── wengine.ts      # the universal w-vector spread engine
│   │   │   ├── ledger.ts       # double-entry ledger (FREE/LOCKED/ESCROW/...)
│   │   │   ├── matching.ts     # mint-on-cross CLOB + native write()
│   │   │   ├── settlement.ts   # atomic, idempotent resolution
│   │   │   └── index.ts        # public exports
│   │   └── test/
│   │       ├── invariants.test.ts
│   │       └── wengine.test.ts
│   └── server/                 # Fastify REST + WebSocket, port 4000
│       └── src/
│           ├── routes.ts       # all HTTP/WS endpoints
│           ├── store.ts        # node:sqlite persistence
│           ├── seed.ts         # demo markets (peace deal, nominee, ...)
│           ├── liveimport.ts   # Polymarket import + taxonomy suggestion
│           └── livedata.ts     # periodic price sync
└── apps/
    └── web/                    # Next.js 14.2.5 + Tailwind, port 3000
        ├── app/
        │   ├── layout.tsx      # shell + build-version badge
        │   ├── page.tsx        # markets list
        │   ├── market/page.tsx # market detail: Trade | Strategy | Strategies
        │   └── portfolio/page.tsx
        ├── components/         # builders, panels, charts (see doc 04)
        └── lib/api.ts          # typed client for the server
```

## 2. Stack

- **Language**: TypeScript throughout.
- **Core**: pure functions, no I/O — fully unit-testable.
- **Server**: Fastify (REST + WebSocket) on port **4000**.
- **Persistence**: `node:sqlite` (Node's built-in SQLite) — no native build
  tools, Windows-friendly.
- **Web**: Next.js **14.2.5** + Tailwind CSS on port **3000**.
- **Tests**: vitest in `packages/core`.

## 3. The six invariants (non-negotiable)

These are the financial laws of the system. Every feature is checked against
them; a violation is a bug by definition.

1. **YES + NO = \$1.** For any outcome, the YES and NO contract prices always sum
   to exactly one dollar (100 cents).
2. **Fully collateralized, no leverage.** Every position's worst-case loss is
   pre-funded at open. There is no borrowing and no liquidation.
3. **Conservation of money.** Across all accounts the total never changes except
   by explicit external deposit/withdrawal. The ledger sums to zero.
4. **No negative balances.** No account (user free balance, locked, escrow) can
   go below zero at any point.
5. **Atomic and idempotent settlement.** Resolving a market either completes fully
   or not at all, and resolving the same market twice has no additional effect.
6. **Integer cents.** All money is stored and computed as integer cents — never
   floating point — to avoid rounding drift.

## 4. The money core

### 4.1 Account types (double-entry ledger)

The ledger (`ledger.ts`) is double-entry; every posting moves value between named
accounts and the global sum stays zero (`assertConservation()`).

| Account | Key | Meaning |
|---------|-----|---------|
| **FREE** | `userId` | A user's spendable balance |
| **LOCKED** | `lockedId(userId)` | Collateral tied up by a resting limit order |
| **ESCROW** | `escrowId(marketId)` | Backs every minted YES+NO pair at \$1/pair |
| **PLATFORM** | platform | Collected fees |
| **EXTERNAL** | external | Source/sink for deposits (keeps the sum zero) |

### 4.2 Mint-on-cross CLOB

Matching (`matching.ts`) is a central limit order book that **mints contracts on
cross**. There is no pre-existing inventory of contracts; a YES and a NO are
created together only when a YES buyer and a NO buyer meet.

- When a YES bid and a NO bid cross (their prices sum to ≥ \$1), one contract
  **pair** is minted. The YES buyer funds their share and the NO buyer funds
  theirs; together exactly \$1 per pair flows **FREE → ESCROW**.
- Each side receives the corresponding contract (YES to one, NO to the other).
- Economic identity used throughout the engine: **selling YES ≡ buying NO**; debt
  is zero by construction because every minted pair is fully escrowed.

Who locks money, when:
- **Market buy** → FREE → ESCROW immediately (no resting, no LOCKED).
- **Resting limit order** → FREE → LOCKED until it fills or is cancelled.
- **Settlement** → ESCROW pays \$1 per contract to the winning side and drains to
  zero.

### 4.3 Native write (cash-secured short primitive)

In addition to mint-on-cross, the core has a **native write** primitive
(`write({userId, qty})` in `matching.ts`) representing a cash-secured short: the
writer posts the **full \$100 per contract** of collateral up front (stricter than
the net required to buy NO), receives the buyer's premium, and holds a NO position
tagged `written`.

Postings for a market write-YES of `qty` contracts that crosses resting YES bids:
- Writer funds full collateral: **writer FREE → ESCROW** of `100 * filled` cents.
- Buyer's locked premium is paid to the writer via `ledger.premiumPayout(buyer,
  writer, cents)`.
- Buyer receives a YES position; writer receives a NO position flagged
  `written: true` (shown as "SHORT YES" in the portfolio).
- At settlement the written NO settles like any NO holding.

`previewWrite(qty)` returns `{ allMarketFilled, totalCollateralCents = 100*qty,
totalFeeCents }`.

**Honest note:** in the current peer-to-peer engine, the economics of a native
write reduce to those of buying NO; the full-collateral "credit + collateral"
framing is partly presentational. A truly independent central-counterparty engine
that separates the short side is *not* built in v0. See 06_STATUS_GAPS_ROADMAP.md.

### 4.4 Settlement

`settlement.ts` resolves a market by paying \$1 per winning contract out of the
market's escrow and draining escrow to zero. It is:
- **Atomic** — completes fully or not at all.
- **Idempotent** — keyed so a repeated resolve does nothing further.
- **Conservation-preserving** — escrow drains exactly to the sum paid to winners.

The invariant test suite asserts conservation, escrow-drain-to-zero, and
no-negative-balance across mint, write and settle.

## 5. Pricing source of truth

`calc.ts` holds the single fill/preview math shared by the backend
`/strategy/preview` and the frontend Strategy Builder. **Any divergence between
frontend and backend calculation is a bug.** All YES-price derivation for group
members routes through one helper, `fairYesFromLive(lm, unknownDefault)`, with
`unknownDefault = 1` for group members so missing prices don't silently distort
group metrics.

## 6. Data flow at runtime

1. `seed.ts` populates demo markets on a fresh DB; `liveimport.ts` can import
   Polymarket markets and attach a taxonomy *suggestion* (unconfirmed).
2. The web app fetches markets/order books over REST and subscribes to price
   updates over WebSocket (live price flash on the market page).
3. A trade or strategy is **previewed** (depth-aware fill, collateral, P&L) then
   **executed** through the matching/write paths.
4. `ResolvePanel` drives the trade → settle → payout lifecycle for demos.
