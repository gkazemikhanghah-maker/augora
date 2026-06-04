/**
 * Universal spread/corridor engine — the single risk core for every structure.
 *
 * Per the design spec (v1.0 §3,§7 and addendum v1.1): a market is reduced to a
 * set of MECE *atoms* (exactly one resolves YES, paying $1), and any tradeable
 * structure is a *payoff vector* `w` over those atoms — w[a] = dollars received
 * per contract if atom `a` realizes. Single / corridor / threshold / basket /
 * long-short are then just different `w` vectors fed to ONE metrics function.
 *
 * This module is intentionally pure and unit-normalized (one contract pays $1).
 * Callers scale by quantity and notional ($100 block) and map the vector to the
 * executable binary legs (representation ATOMIC vs CUMULATIVE) — that mapping is
 * an execution concern, NOT part of the risk math: at the atom level a corridor
 * is always "+1 on the atoms inside the range" regardless of representation.
 */

/** A MECE atom: an outcome that pays $1 if it resolves, with its YES price. */
export interface Atom {
  id: string;
  /** Implied YES probability / price in [0,1]. */
  price: number;
  /** Canonical order index (for ORDINAL/INTERVAL markets). */
  index?: number;
}

/** Payoff vector: atomId -> coefficient (dollars per contract if that atom hits). */
export type WVector = Record<string, number>;

export interface WMetrics {
  /** Net premium paid per contract (Σ w·p). Negative = a credit received. */
  cost: number;
  /** Best-case P&L per contract. */
  maxProfit: number;
  /** Worst-case loss per contract (always ≥ 0 for a real position, or negative
   *  when the structure is a guaranteed arbitrage profit). */
  maxLoss: number;
  /** Collateral required beyond premium, per contract: max(0, −min_a w[a]). */
  collateral: number;
  /** For a digital {0,1} structure this is the break-even *probability*
   *  (= cost). Undefined when w has coefficients outside {0,1}. */
  breakevenProb: number | null;
  /** P&L per contract if a given atom realizes (w[a] − cost). */
  byAtom: { id: string; pnl: number }[];
}

/** Coefficients across ALL atoms (absent atoms count as 0). */
function coeffsOf(w: WVector, atoms: Atom[]): number[] {
  return atoms.map((a) => w[a.id] ?? 0);
}

/** The universal risk function — every structure's metrics come from here. */
export function wMetrics(w: WVector, atoms: Atom[]): WMetrics {
  if (atoms.length === 0) {
    return { cost: 0, maxProfit: 0, maxLoss: 0, collateral: 0, breakevenProb: null, byAtom: [] };
  }
  const coeffs = coeffsOf(w, atoms);
  const cost = atoms.reduce((s, a) => s + (w[a.id] ?? 0) * a.price, 0);
  const minW = Math.min(...coeffs);
  const maxW = Math.max(...coeffs);

  const byAtom = atoms.map((a) => ({ id: a.id, pnl: (w[a.id] ?? 0) - cost }));
  // digital ⇔ every leg pays the same nonzero amount (e.g. {0, Q}); then the
  // break-even is a *probability* = cost / Q. Mixed-sign (long-short) ⇒ none.
  const nonzero = coeffs.filter((c) => c !== 0);
  const uniformPos = nonzero.length > 0 && nonzero.every((c) => c === nonzero[0]) && nonzero[0]! > 0;

  return {
    cost,
    maxProfit: maxW - cost,
    maxLoss: cost - minW,
    collateral: Math.max(0, -minW),
    breakevenProb: uniformPos ? cost / nonzero[0]! : null,
    byAtom,
  };
}

/* ----------------------------- structure builders ------------------------- *
 * Each returns a `w` vector. They are representation-agnostic; the execution
 * layer decides how to realize the vector as binary legs.                     */

export function buildSingle(atomId: string): WVector {
  return { [atomId]: 1 };
}

/** Back a subset (basket) — wins $1 if any atom in the subset resolves. */
export function buildBasket(atomIds: string[]): WVector {
  const w: WVector = {};
  for (const id of atomIds) w[id] = 1;
  return w;
}

/** Corridor over the inclusive index range [aIdx, bIdx]. Requires ordered atoms. */
export function buildCorridor(atoms: Atom[], aIdx: number, bIdx: number): WVector {
  if (aIdx > bIdx) throw new Error("empty corridor: aIdx > bIdx");
  const w: WVector = {};
  for (const a of atoms) {
    const i = a.index ?? atoms.indexOf(a);
    if (i >= aIdx && i <= bIdx) w[a.id] = 1;
  }
  return w;
}

/** Threshold ≥ k (upper tail) over ordered atoms. */
export function buildThreshold(atoms: Atom[], k: number): WVector {
  const w: WVector = {};
  for (const a of atoms) {
    const i = a.index ?? atoms.indexOf(a);
    if (i >= k) w[a.id] = 1;
  }
  return w;
}

/** Relative bet: long one atom, short another (needs a Write leg to execute). */
export function buildLongShort(longId: string, shortId: string): WVector {
  return { [longId]: 1, [shortId]: -1 };
}

/* ------------------------------- duality ---------------------------------- *
 * bucket[K1,K2) = Threshold(≥K1) − Threshold(≥K2)
 * Threshold(≥K) = Σ bucket[i] for buckets with index ≥ K                      */

/** Add two w-vectors (used to verify duality / compose structures). */
export function addW(a: WVector, b: WVector): WVector {
  const out: WVector = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] ?? 0) + b[k]!;
  for (const k of Object.keys(out)) if (out[k] === 0) delete out[k];
  return out;
}

export function scaleW(a: WVector, s: number): WVector {
  const out: WVector = {};
  for (const k of Object.keys(a)) out[k] = a[k]! * s;
  return out;
}
