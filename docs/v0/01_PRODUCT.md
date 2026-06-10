# 01 — Product

## 1. The problem

Prediction markets (Kalshi, Polymarket) let people bet on the probability of an
event. But they sell almost exclusively **single binary bets**: buy YES or buy
NO on one outcome. Options markets, by contrast, let traders express far richer
views — "I think it lands *between* X and Y", "I want to be *short* this region
and collect premium", "I'm long A *relative to* B" — through spreads and
combinations.

Prediction markets left that expressiveness on the table. The usual way to get
it elsewhere (real options, perpetual futures) drags in **leverage** and
therefore **liquidation risk**: positions can be force-closed and losses can
exceed deposits.

## 2. The thesis

> **Augora gives options-like expressiveness on prediction markets, with full
> collateralization and no liquidation.**

The key realization is that a binary outcome contract pays either \$0 or \$1.
Its payoff is **bounded**. Because the worst case is bounded and known in
advance, every position can be **fully pre-funded (collateralized) at the moment
it is opened**. Nothing can ever be liquidated, because there is never an
uncovered loss. The \$0–\$1 bound is not a limitation to be escaped — **it is
the very thing that makes no-leverage, no-liquidation possible.** It is the
feature.

On that safe base, Augora composes structured positions (corridors, credit
spreads, relative bets) that *feel* like options strategies but inherit the
bounded, fully-collateralized safety of their binary legs.

## 3. Mental models

### 3.1 MECE atoms

Every market decomposes into a set of **atoms**: mutually exclusive, collectively
exhaustive outcomes. Exactly one atom resolves true (pays \$1); the rest pay \$0.
- A single yes/no market has two atoms (YES, NO) — or is modeled as one atom
  whose complement is "not it".
- A categorical market (e.g. "who wins the nomination": A/B/C/D) has one atom per
  candidate, plus optionally an "Other" atom so the set is exhaustive.
- A laddered/threshold market (e.g. "peace deal by Q3 2026 / by end 2026 / by end
  2027") is **derived** into MECE *window* atoms (see §3.3).

### 3.2 The payoff vector `w`

Any position whatsoever is a vector `w` assigning a payoff coefficient to each
atom. If atom *a* resolves true, the position pays `w[a]`.

- Single YES bet on atom A: `w = {A: +1}`.
- Basket (back A, B, C; win \$1 if any resolves): `w = {A:1, B:1, C:1}`.
- Corridor / window (win \$1 only if the outcome lands in a contiguous band of
  atoms): `w = 1` on the band, `0` elsewhere.
- Credit spread / "fade the range" (collect premium, lose only if it lands in the
  band): `w = -1` on the band region (capped by an offsetting long leg).
- Relative long/short (long A, short B): `w = {A:+1, B:-1}`.

**One vector, one engine.** Pricing, max-profit, max-loss, collateral and
breakeven are all computed from `w` and the atom prices by a single function. The
different "strategy types" the user sees are just different `w` over the same
atoms — there is no separate code path per strategy. This is the central design
idea of the whole system.

### 3.3 Cumulative ladders vs atomic buckets

Some categorical markets are **atomic** (the listed outcomes are themselves MECE:
"0–1 goals", "2–3 goals", "4+ goals"). Others are **cumulative/threshold** ladders
where each rung is "≥ this point" and rungs are *nested*, not exclusive ("by Q3",
"by end of year", "by next year" — the second contains the first).

For a cumulative ladder with N rungs, Augora derives **N+1 MECE window atoms** by
differencing consecutive cumulative prices. This lets a corridor be expressed as
adjacent windows and executed with real threshold legs. Whether a market is
atomic or cumulative is captured by its **taxonomy** (see 03_SPREAD_ENGINE.md),
which is auto-suggested on import and confirmed by a human before advanced tools
unlock.

### 3.4 Bounded payoff = full collateralization

Because each atom pays at most \$1, the maximum payout of any `w` is bounded by
`max(w)` and the maximum loss by `-min(w)`. Both are finite and known up front,
so the platform can require the full worst-case collateral at open. No margin, no
mark-to-market, no liquidation engine. This is the safety invariant that defines
the product.

## 4. Differentiation vs Kalshi & Polymarket

**What Augora has that they do not:** one-click structured positions — corridors
(back a range), credit spreads (fade a range, collect premium, capped loss), and
relative long/short — built and priced as a single action. Neither Kalshi nor
Polymarket sells this; a trader there would have to leg into it manually, if at
all.

**What they have that Augora does not:** real liquidity, real money, automated
real-world resolution, regulatory standing (Kalshi is CFTC-regulated), mobile
apps, large market catalogs, mature order types and APIs, and scale. Augora is a
demo on top of others' data.

The honest summary: **Augora's differentiator (structured expressiveness without
leverage) is real and built; everything else that makes a real exchange is not.**

## 5. The bounded vs unbounded discussion (important design boundary)

A recurring question: *could Augora let you short an unbounded index so a position
behaves like a stock?* The honest answer, which defines a hard product boundary:

- You **can** get stock-*like* directional exposure while keeping full
  collateralization, by synthesizing a near-linear payoff from a **ladder of fine
  bounded digitals** (many adjacent threshold contracts). Loss stays capped at the
  premium paid; no liquidation. This keeps the thesis intact. *(Path A — preferred.)*
- You **cannot** have *true* unbounded P&L (a naked short on an unbounded
  underlying) while remaining fully collateralized. Bounded collateral cannot
  cover unbounded loss — this is a mathematical fact, not an implementation gap.
- To get true unbounded shorts you must **abandon full collateralization** and
  adopt **margin + mark-to-market + liquidation + funding**. At that point Augora
  is no longer a prediction market; it is a perps/futures venue. The constraints
  don't disappear — they transform into the harder ones (unbounded loss, margin
  calls, liquidation) that the thesis was built to avoid. *(Path B.)*
- A middle option is a **synthetically capped index** (bound the underlying with a
  ceiling), which stays collateralizable and tradable as a near-continuous ladder.

This is a **product-identity decision**, not a mechanism tweak. v0 deliberately
stays on Path A: fully-collateralized, no liquidation.

## 6. Who it's for / positioning

A trader who wants to express nuanced, structured views on real-world events —
ranges, premium collection, relative bets — without the leverage and liquidation
risk of options or perps, in a venue where the worst case is always pre-funded
and visible before they click.
