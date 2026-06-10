# 03 — The Spread Engine

This is the heart of Augora's differentiation. The engine lives in
`packages/core/src/wengine.ts` and is **pure and representation-agnostic**: it
knows nothing about HTTP, the DB, or the UI. Every structured position is a
payoff vector `w` over a market's atoms, and one set of functions prices and
builds all of them.

## 1. Atoms and the payoff vector

- **Atom**: a MECE outcome with a price `p` in cents (probability × 100). Exactly
  one atom resolves true.
- **`w`**: a map from atom id → payoff coefficient. If atom *a* resolves true, the
  position pays `w[a]` dollars per contract.

## 2. `wMetrics(w, atoms)` — the universal pricer

Given a payoff vector `w` and the atoms with prices `p`, it returns:

| Field | Formula | Meaning |
|-------|---------|---------|
| `cost` | `Σ w[a] · p[a]` | Net price to enter (debit if > 0, credit if < 0) |
| `maxProfit` | `max(w) − cost` | Best-case profit |
| `maxLoss` | `cost − min(w)` | Worst-case loss |
| `collateral` | `max(0, −min(w))` | Worst-case cash to post up front |
| `breakevenProb` | `cost / Q` if all non-zero coefficients are equal and positive, else `null` | Implied breakeven probability |
| `byAtom[a]` | `w[a] − cost` | Per-atom P&L |

`Q` is the common positive coefficient when the structure is a uniform multiple
of an indicator (e.g. a plain corridor where every in-band atom has `w = 1`).
When coefficients are mixed (e.g. long/short), `breakevenProb` is `null` because a
single breakeven probability is not well-defined.

Because the bound is built in (`min(w)`/`max(w)` are finite), `collateral` is
always finite and known — the full-collateralization invariant falls straight out
of this function.

## 3. Builders

All builders return a `w` (and helpers compose them):

- `buildSingle(atomId)` → `{atomId: +1}`.
- `buildBasket(atomIds[])` → `+1` on each listed atom (win \$1 if any resolves).
- `buildCorridor(atoms, aIdx, bIdx)` → `+1` on atoms `aIdx..bIdx`, else `0`
  (win \$1 only if the outcome lands in the contiguous band).
- `buildThreshold(...)` → cumulative "≥ point" indicator.
- `buildLongShort(longId, shortId)` → `{long:+1, short:-1}`.
- `addW(w1, w2)` and `scaleW(w, k)` → compose/scale vectors.

Duality used in tests: a bucket indicator and the difference of two thresholds
describe the same `w` (bucket ↔ threshold duality), which is asserted to hold.

## 4. Cumulative ladders

Threshold ladders are nested (not MECE). To make them composable:

- `deriveCumulativeAtoms(rungs)` — takes N nested cumulative rungs (ascending) and
  derives **N+1 MECE window atoms**, each priced as the difference of consecutive
  cumulative prices. (Example: peace-deal cumulative prices 18 / 31 / 52 → window
  atoms priced 18, 13, 21, 48.)
- `corridorLegsCumulative(rungsAsc, fromAtom, toAtom, direction)` — turns a chosen
  window `[fromAtom, toAtom]` into **executable threshold legs** on the real rungs:

| Direction | Leg when `j < N` (upper edge) | Leg when `i > 0` (lower edge) | Meaning |
|-----------|-------------------------------|-------------------------------|---------|
| `"back"` (debit) | Buy-YES at rung `j` | Buy-NO at rung `i−1` | Pay premium; win \$1 if outcome lands in the window |
| `"fade"` (credit) | Write-YES at rung `j` | Buy-YES at rung `i−1` | Collect premium; lose only if outcome lands in the window (short call/put spread) |

Here `i = fromAtom`, `j = toAtom`, `N` = number of rungs. The lower/upper edge legs
are omitted at the boundaries (`i = 0` or `j = N`), which is why a window from the
very start collapses to a single threshold leg.

## 5. The structures the user sees (all are `w`)

- **Single** — one outcome, `w = +1` on its atom.
- **Basket** — back several outcomes, `+1` on each; win \$1 if any resolves.
  (UI preset: "back top 3".)
- **Corridor / Window (debit)** — `back` a contiguous band; pay premium, capped
  loss = premium, win \$1 if it lands in the band.
- **Credit spread / "fade the range"** — `fade` a band; `w = -1` on the band,
  offset by a long leg so loss is capped. Collect premium up front, \$100
  collateral blocked, max profit = credit, max loss capped by the long leg. This
  is a short call/put vertical spread.
- **Relative long/short** — long one categorical member, short another:
  `w = {long:+QTY, short:−QTY}`. Legs: Buy-YES(long) + Write-YES(short, intent
  `write`). Shows credit received / net debit and \$100 collateral blocked.

Every one of these is the *same* `wMetrics` call on a different `w`. There is no
per-strategy pricing code.

## 6. Taxonomy detection

To know whether a categorical market is atomic or a cumulative ladder (and which
direction it runs), the engine suggests a taxonomy and a human confirms it before
the corridor tools unlock.

`suggestTaxonomy(members[{label, priceCents, orderValue?}])` returns:

```
{
  orderingType: "NOMINAL" | "ORDINAL" | "INTERVAL",
  representation?: "ATOMIC" | "CUMULATIVE",
  axisDirection?: "INCREASING" | "DECREASING",
  reason: string
}
```

Heuristic, in priority order:
1. **Label regex** dominates. Threshold words ("by", "over", "≥", "before") →
   `CUMULATIVE`. Bucket phrasings ("2–3", "between") → `ATOMIC`.
2. **Price monotonicity** along `orderValue` is weighted *above* the naive
   sum-test. (A naive "do YES prices sum to ~1?" test misclassifies cumulative
   ladders — e.g. the peace deal sums to ≈1.01 and would look atomic. Weighting
   labels and monotonicity higher fixes this.)
3. **No `orderValue`** → `NOMINAL` (unordered, e.g. candidate names).

The suggestion is stored with `taxonomyConfirmed: false` on import; the UI shows a
confirmation banner and only unlocks the cumulative corridor builder once a human
confirms via `POST /markets/group/:groupId/taxonomy`.

**Honest note:** the heuristic is unit-tested on synthetic cases only; it has not
been validated against the full breadth of real Polymarket markets and will
misclassify some. The human-confirm step is the safety net.

## 7. `buildMemberSpecs` (large categoricals)

For categorical events with many members, `buildMemberSpecs` surfaces only the
**top 5 members by real trade volume** plus a synthetic **"Other"** row carrying
the residual probability, so the UI isn't flooded and the atom set stays
exhaustive (sums toward \$1). *Caveat:* the "Other" row is **not auto-settled** in
v0 — see the roadmap.

## 8. How a structured order executes end to end

1. UI builder constructs `w` and calls `wMetrics` for the live preview (cost,
   max profit/loss, collateral, breakeven).
2. For executable legs, the cumulative helpers emit threshold legs with an
   `intent` of `"buy"` or `"write"`.
3. The client calls the group execute endpoint; the server previews each leg
   (full collateral for `write` legs) and then runs the matching/`write` paths.
4. Positions appear in the portfolio (written legs as "SHORT YES"); the
   `ResolvePanel` can then settle the market.

> Atomicity caveat: group execution runs legs **sequentially without rollback**.
> In the current synchronous demo nothing changes between preview and execute, so
> it is effectively safe, but it is **not** transactionally atomic and should be
> made so before any concurrent/real use. See 06_STATUS_GAPS_ROADMAP.md.
