# 06 — Status, Gaps & Roadmap

This document is deliberately **honest**. Augora v0 is a working
hypothesis-test demo with a genuinely novel core, sitting a long way from a real
exchange. Both halves of that sentence matter.

## 1. What is solid

- The **six invariants** hold and are tested (conservation, no-negative,
  escrow-drain-to-zero across mint / write / settle).
- The **universal w-vector engine** is complete, pure, and unit-tested: pricing,
  builders, bucket↔threshold duality, cumulative-atom derivation, corridor legs,
  fade/credit legs, taxonomy suggestion.
- **Structured positions work end to end**: debit corridor (back a window), credit
  spread (fade a window = short call/put spread), relative long/short, basket —
  all from one engine, verified by screenshots against hand-computed numbers.
- **Native write** primitive exists in the money core with full-collateral
  semantics and correct settlement.
- Real Polymarket price history is wired with a graceful flat fallback.
- Taxonomy auto-detect + human-confirm gating is in place.

## 2. Logical / correctness gaps (present today)

1. **Group execution is not truly atomic.** `execute-group` checks balance then
   runs legs sequentially with no rollback. Safe in the synchronous demo, fragile
   otherwise; it contradicts the "all-or-nothing" promise shown in the UI. **Needs
   a real transaction/rollback.**
2. **"Other" synthetic row is not auto-settled.** For large categoricals, if a
   top-5 member wins, "Other" should resolve NO automatically but is manual — a
   settlement hole.
3. **Group prices may not sum to \$1** for imported categoricals without a
   synthetic "Other", making basket/relative metrics approximate and potentially
   arbitrageable.
4. **Native write economically reduces to buy-NO** in the current peer-to-peer
   engine; the credit/collateral framing is partly presentational. A true
   central-counterparty short engine is not built.
5. **Taxonomy detection is unvalidated on real data** — unit-tested on synthetic
   cases only; will misclassify some real Polymarket markets (human-confirm
   mitigates).

## 3. Missing trading features (vs Kalshi / Polymarket)

- **No position-close from the UI** before settlement (the engine can
  sell/merge, but there's no exit flow in the portfolio). This is the most
  glaring everyday-trading gap.
- **No limit orders in the strategy/group builders** (all market orders).
- **Thin order management** (viewing/cancelling resting orders).
- **No consistent fee model** across the group path (single orders have fees; the
  group path does not).
- **No real liquidity / slippage realism** — a single static market-maker bot
  provides depth; no real two-sided flow.

## 4. The big architecture gap

Augora is **paper-trading on top of others' market data**. Becoming an
*independent exchange* would require: a real central-counterparty or AMM, real
collateral custody, a genuine native-short engine, user-created markets,
**oracle-based real-world resolution**, KYC/compliance, money rails, and — hardest
of all — **liquidity bootstrapping** (how to get two-sided liquidity without real
users; today it's a static bot). None of this exists in v0, and none of it should
for a hypothesis test — but it is the gap between "demo" and "product."

## 5. Product boundary already decided

Per 01_PRODUCT.md §5: v0 stays **fully-collateralized, no liquidation** (Path A).
Stock-like exposure is achievable via fine bounded-digital ladders; true unbounded
shorting would mean abandoning the thesis for a margin/liquidation (perps) model.
This is a conscious identity choice, not an unbuilt feature.

## 6. Deferred items (the "later" list)

- Position-close from the UI.
- True atomic / rollback-safe group execution.
- "Other" row auto-settle.
- Group pricing normalized to sum \$1.
- **ATOMIC** bucket corridor (type C) and **ORDINAL** (type E) — only CUMULATIVE
  corridors are built; atomic/ordinal are routed to basket for now.
- Native **write as a resting/limit** order (currently market-only).
- Consistent fee model across all paths.
- Real candlestick chart library + "live feel" polish (charts are basic area
  charts; UI still reads somewhat AI-generated — layout/hierarchy first, then
  live feel, then a real chart library).
- Automated resolution mirroring real Polymarket outcomes.
- Portfolio-level aggregate risk view.
- Liquidity bootstrapping strategy (open strategic question).

## 7. Recommended priority order

If the goal is to **prove the thesis**:
1. Position-close from the UI.
2. True atomic / rollback group execution.
3. "Other" auto-settle.
4. Normalize group pricing to sum \$1.
5. Validate taxonomy detection on several real markets.

If the goal is to **move toward a real product**: the architecture gap (§4) —
independent CCP engine + oracle resolution + liquidity — dominates, but it is a
large rewrite, not polish.

## 8. Build history (this development arc)

Earlier builds (7→15) established the core invariant suite, the markets list, the
market detail page (sticky buy-box, quick trade, live price flash, area chart),
the outcome ladder, atomic multi-leg execution, the resolve panel, real Polymarket
price history, and large-categorical handling (top-5 + "Other").

Builds 16→28 (this arc):

| Build | Change |
|------:|--------|
| 16 | Spread presets on the spread tab |
| 17 | Universal w-engine core |
| 18 | Spread-engine cutover (structures route through the w-engine) |
| 19 | Cumulative corridor builder |
| 20 | Corridor labels |
| 21 | Relative tab |
| 22 | True-write framing |
| 23 | Native write primitive in the money core |
| 24 | Native write wired into server/UI |
| 25 | Write polish; portfolio equity fixed to include open-position mark value |
| 26 | Credit (short call/put) spreads — Fade direction on the corridor |
| 27 | Unified tabs into "Strategies" (absorbed the old Relative tab) |
| 28 | Taxonomy auto-detect on import + human-confirm gating |

**v0 documentation** (this `docs/v0/` set) is a docs-only addition on top of build
28 and does not bump the build badge.

## 9. How to continue from here

1. Read 01→05 in order; they are sufficient to rebuild the system.
2. Pick from §7 by goal (thesis vs product).
3. Keep the **six invariants** as the acceptance test for every change — a feature
   that breaks one is wrong by definition.
4. Keep `calc.ts` / the w-engine as the **single source of truth**; any
   frontend/backend pricing divergence is a bug.
5. Prefer **honest baselines over synthetic polish** (e.g. flat price history over
   fake noise) — a guiding principle of the project.
