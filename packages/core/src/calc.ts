import type { CalcResult, LegKey, StrategyState } from "./types.js";
import { feeDollarsPreview } from "./fees.js";

/**
 * SINGLE SOURCE OF TRUTH — ported verbatim from PayoffBuilder.html.
 * Frontend panels AND backend previews must read from THIS function only,
 * so cost breakdown, scenarios, and the payoff curve can never disagree.
 *
 * All amounts here are in DOLLARS (preview units). Execution rounds to
 * integer cents in the ledger/matching layer.
 */

export interface LegDef {
  k: LegKey;
  name: string;
  side: "YES" | "NO";
  dir: "long" | "short";
  tag: "pay" | "rec";
  sub: string;
  fa: string;
}

export const LEGDEF: readonly LegDef[] = [
  { k: "BUY", name: "Buy", side: "YES", dir: "long", tag: "pay", sub: "Pay premium now · win $1 if YES", fa: "شرط روی بله" },
  { k: "WRITE", name: "Write", side: "YES", dir: "short", tag: "rec", sub: "Receive premium · owe $1 if YES", fa: "فروشِ بله" },
  { k: "BUYA", name: "Buy Against", side: "NO", dir: "long", tag: "pay", sub: "Pay premium now · win $1 if NO", fa: "شرط روی خیر" },
  { k: "WRITEA", name: "Write Against", side: "NO", dir: "short", tag: "rec", sub: "Receive premium · owe $1 if NO", fa: "فروشِ خیر" },
];

/** YES ask/bid from mid+spread; NO prices derived as 1 - (yes). */
export function entryPrice(def: LegDef, state: StrategyState): number {
  const a = state.mid + state.spread / 2; // YES ask
  const b = state.mid - state.spread / 2; // YES bid
  if (def.side === "YES") return def.dir === "long" ? a : b;
  return def.dir === "long" ? 1 - b : 1 - a; // NO ask / NO bid
}

/** The ONE function everything reads from. */
export function calc(state: StrategyState): CalcResult {
  let netPrem = 0,
    collat = 0,
    fees = 0,
    P0 = 0,
    P1 = 0,
    nLegs = 0;

  for (const def of LEGDEF) {
    const L = state.legs[def.k];
    if (!L.on || L.qty <= 0) continue;
    nLegs++;
    const e = entryPrice(def, state);
    const q = L.qty;
    fees += feeDollarsPreview(q, e, state.feeMult);
    netPrem += def.dir === "long" ? -q * e : +q * e;
    if (def.dir === "short") collat += q * 1;
    // contract value at YES-prob p: YES -> p, NO -> (1-p)
    const v0 = def.side === "YES" ? 0 : 1; // p = 0
    const v1 = def.side === "YES" ? 1 : 0; // p = 1
    const s = def.dir === "long" ? 1 : -1;
    P0 += s * q * (v0 - e);
    P1 += s * q * (v1 - e);
  }

  P0 -= fees;
  P1 -= fees;

  const maxP = Math.max(P0, P1);
  const maxL = Math.min(P0, P1);
  const slope = P1 - P0;
  let be: number | null = null;
  if (Math.abs(slope) > 1e-9) {
    const p = -P0 / slope;
    if (p >= 0 && p <= 1) be = p;
  }

  const capital =
    LEGDEF.reduce((acc, def) => {
      const L = state.legs[def.k];
      if (!L.on || L.qty <= 0) return acc;
      const e = entryPrice(def, state);
      const q = L.qty;
      return acc + (def.dir === "long" ? q * e : q * (1 - e));
    }, 0) + fees;

  const ev = state.belief * P1 + (1 - state.belief) * P0;

  return { netPrem, collat, fees, P0, P1, maxP, maxL, be, capital, ev, nLegs };
}

/**
 * Outcome scenarios for a BINARY market — exactly TWO rows (spec §8.1 / §2.11).
 * P1 = YES wins, P0 = NO wins. Never more, never duplicated.
 */
export function binaryScenarios(c: CalcResult): { outcome: "YES" | "NO"; pnl: number }[] {
  return [
    { outcome: "YES", pnl: c.P1 },
    { outcome: "NO", pnl: c.P0 },
  ];
}

/** Payoff curve endpoints for the chart: linear from (p=0, P0) to (p=1, P1). */
export function payoffPoints(c: CalcResult): { p: number; pnl: number }[] {
  return [
    { p: 0, pnl: c.P0 },
    { p: 1, pnl: c.P1 },
  ];
}

/**
 * GROUP payoff — for a basket of legs spanning MULTIPLE member markets of one
 * mutually-exclusive group (categorical / ladder buckets). Exactly one member
 * resolves YES; every other resolves NO. This is the N-outcome generalization of
 * binaryScenarios + calc(), and the single source of truth the group strategy
 * UI reads from (so cost, scenarios, and the payoff shape can never disagree).
 *
 * All amounts in DOLLARS (preview units). `entry` is the YES/NO price paid per
 * contract in dollars (0..1).
 */
export interface GroupLegCalc {
  memberId: string;
  side: "YES" | "NO";
  dir: "long" | "short";
  qty: number;
  entry: number;
}

export interface GroupPayoff {
  /** PnL if `winnerId` is the member that resolves YES (all others NO). */
  scenarios: { winnerId: string; pnl: number }[];
  capital: number; // upfront cost: long premium + short collateral + fees
  maxP: number;
  maxL: number;
  fees: number;
  nLegs: number;
}

export function groupPayoff(legs: GroupLegCalc[], memberIds: string[], feeMult: number): GroupPayoff {
  const active = legs.filter((l) => l.qty > 0);
  let fees = 0;
  let capital = 0;
  for (const l of active) {
    fees += feeDollarsPreview(l.qty, l.entry, feeMult);
    capital += l.dir === "long" ? l.qty * l.entry : l.qty * (1 - l.entry);
  }
  capital += fees;

  const scenarios = memberIds.map((winnerId) => {
    let pnl = 0;
    for (const l of active) {
      const memberYes = l.memberId === winnerId;
      // contract pays $1 when its side matches the resolution
      const cv = l.side === "YES" ? (memberYes ? 1 : 0) : memberYes ? 0 : 1;
      pnl += l.dir === "long" ? l.qty * (cv - l.entry) : l.qty * (l.entry - cv);
    }
    return { winnerId, pnl: pnl - fees };
  });

  const pnls = scenarios.map((s) => s.pnl);
  return {
    scenarios,
    capital,
    maxP: pnls.length ? Math.max(...pnls) : 0,
    maxL: pnls.length ? Math.min(...pnls) : 0,
    fees,
    nLegs: active.length,
  };
}

/** Default strategy state = the spec reference example. */
export function referenceState(): StrategyState {
  return {
    mid: 0.605,
    spread: 0,
    belief: 0.66,
    feeMult: 0,
    legs: {
      BUY: { on: true, qty: 100 },
      WRITE: { on: false, qty: 100 },
      BUYA: { on: false, qty: 100 },
      WRITEA: { on: true, qty: 100 },
    },
  };
}
