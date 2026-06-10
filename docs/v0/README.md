# Augora — Version 0 Documentation

> This is the **v0 documentation set**: a complete, honest description of what
> Augora is, why it exists, how it is built, and how to rebuild and extend it
> from scratch. If you read every document here you should be able to (a)
> understand the product and its thesis, (b) recreate the codebase, and (c)
> continue development from where v0 left off.

Augora is a **fully-collateralized binary prediction-market paper-trading
platform** that gives traders **options-like expressiveness** (spreads,
corridors, credit spreads, relative long/short) **without leverage and without
liquidation**. It is currently a *hypothesis-test demo*, not a finished
commercial exchange — this distinction is stated honestly throughout.

## What this is and is not

- **It is**: a working TypeScript monorepo that prices, matches, executes and
  settles binary outcome contracts, plus a one-click engine for multi-leg
  structured positions (the genuine differentiator).
- **It is not**: a real money venue, a regulated exchange, or an independent
  liquidity source. It paper-trades on top of seeded markets and imported
  Polymarket data.

## Document map

| Doc | Contents |
|-----|----------|
| [01_PRODUCT.md](./01_PRODUCT.md) | Vision, thesis, mental models, differentiation vs Kalshi/Polymarket, the bounded-payoff insight, the unbounded-index discussion |
| [02_ARCHITECTURE.md](./02_ARCHITECTURE.md) | Monorepo layout, stack, the money core (ledger, matching, settlement), the six invariants, account flows |
| [03_SPREAD_ENGINE.md](./03_SPREAD_ENGINE.md) | The universal w-vector engine, payoff math, taxonomy detection, corridor/credit/relative/basket, leg-mapping tables, native write |
| [04_DATA_MODEL_AND_API.md](./04_DATA_MODEL_AND_API.md) | Core types, persistence, REST + WebSocket endpoints |
| [05_BUILD_RUN_DEPLOY.md](./05_BUILD_RUN_DEPLOY.md) | Install, run, test, the deploy flow, build badge, DB re-seed |
| [06_STATUS_GAPS_ROADMAP.md](./06_STATUS_GAPS_ROADMAP.md) | Honest gap audit, deferred items, vs Kalshi/Polymarket, build history |

## The one-paragraph summary

Every Augora market is a set of mutually-exclusive, collectively-exhaustive
(MECE) outcomes. Each outcome has a YES and a NO contract that together always
cost \$1, so a position is always fully collateralized and can never be
liquidated — the worst case is pre-funded at creation. On top of this base,
Augora maps **any** structured position (single bet, basket, corridor/window,
credit spread, relative long/short) to a single **payoff vector `w`** over the
market's atoms, and a single engine prices and executes all of them. That
"one-click structured exposure without leverage" is the product.
