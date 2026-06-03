import type { Account, Cents, LedgerEntry } from "./types.js";
import { assertCents } from "./money.js";

/**
 * Double-entry ledger, the single money authority (invariants #1, #3, #4, #6).
 *
 * Every account is a string id holding integer Cents:
 *   - "<userId>"          user free balance
 *   - "LOCKED:<userId>"   user collateral reserved for resting orders
 *   - "PLATFORM"          fee revenue
 *   - "ESCROW:<marketId>" collateral backing minted YES+NO pairs
 *   - "EXTERNAL"          source of deposits (goes negative by design)
 *
 * Because every posting nets to zero, the sum of ALL balances is always 0.
 * Conservation of user+platform PnL therefore reduces to: escrow drains to 0
 * at settlement and no money is created among tracked accounts.
 */

export const PLATFORM = "PLATFORM";
export const EXTERNAL = "EXTERNAL";
export const lockedId = (userId: string) => `LOCKED:${userId}`;
export const escrowId = (marketId: string) => `ESCROW:${marketId}`;

interface Posting {
  accountId: string;
  deltaCents: Cents;
  reason: string;
  refId?: string;
}

export class Ledger {
  private balances = new Map<string, Cents>();
  readonly entries: LedgerEntry[] = [];
  private seq = 0;

  bal(accountId: string): Cents {
    return this.balances.get(accountId) ?? 0;
  }

  /** Atomic balanced posting. Throws on imbalance, non-integer, or guard breach. */
  private post(postings: Posting[], guardNonNegative: string[] = []): void {
    let sum = 0;
    for (const p of postings) {
      assertCents(p.deltaCents, `posting ${p.reason}`);
      sum += p.deltaCents;
    }
    if (sum !== 0) throw new Error(`Unbalanced ledger posting (sum=${sum})`);

    // apply
    const ts = Date.now();
    for (const p of postings) {
      const next = this.bal(p.accountId) + p.deltaCents;
      this.balances.set(p.accountId, next);
      this.entries.push({
        id: `L${++this.seq}`,
        accountId: p.accountId,
        deltaCents: p.deltaCents,
        reason: p.reason,
        refId: p.refId,
        ts,
      });
    }
    // guard: invariant #4 — no negative balance on protected accounts
    for (const id of guardNonNegative) {
      if (this.bal(id) < 0) {
        throw new Error(`Negative balance forbidden on ${id} (${this.bal(id)})`);
      }
    }
  }

  deposit(userId: string, cents: Cents): void {
    this.post([
      { accountId: EXTERNAL, deltaCents: -cents, reason: "deposit", refId: userId },
      { accountId: userId, deltaCents: +cents, reason: "deposit", refId: userId },
    ]);
  }

  /** Reserve free balance as collateral for a resting order. */
  lock(userId: string, cents: Cents, refId?: string): void {
    this.post(
      [
        { accountId: userId, deltaCents: -cents, reason: "lock", refId },
        { accountId: lockedId(userId), deltaCents: +cents, reason: "lock", refId },
      ],
      [userId],
    );
  }

  unlock(userId: string, cents: Cents, refId?: string): void {
    this.post(
      [
        { accountId: lockedId(userId), deltaCents: -cents, reason: "unlock", refId },
        { accountId: userId, deltaCents: +cents, reason: "unlock", refId },
      ],
      [lockedId(userId)],
    );
  }

  /** Maker pays from already-locked collateral into market escrow. */
  lockedToEscrow(userId: string, marketId: string, cents: Cents, refId?: string): void {
    this.post(
      [
        { accountId: lockedId(userId), deltaCents: -cents, reason: "mint-from-locked", refId },
        { accountId: escrowId(marketId), deltaCents: +cents, reason: "mint-to-escrow", refId },
      ],
      [lockedId(userId)],
    );
  }

  /** Taker pays from free balance into market escrow. */
  balanceToEscrow(userId: string, marketId: string, cents: Cents, refId?: string): void {
    this.post(
      [
        { accountId: userId, deltaCents: -cents, reason: "mint-from-balance", refId },
        { accountId: escrowId(marketId), deltaCents: +cents, reason: "mint-to-escrow", refId },
      ],
      [userId],
    );
  }

  chargeFee(userId: string, cents: Cents, refId?: string): void {
    if (cents === 0) return;
    this.post(
      [
        { accountId: userId, deltaCents: -cents, reason: "fee", refId },
        { accountId: PLATFORM, deltaCents: +cents, reason: "fee", refId },
      ],
      [userId],
    );
  }

  /** Settlement payout from escrow to a winning user. */
  payout(userId: string, marketId: string, cents: Cents, refId?: string): void {
    if (cents === 0) return;
    this.post(
      [
        { accountId: escrowId(marketId), deltaCents: -cents, reason: "payout", refId },
        { accountId: userId, deltaCents: +cents, reason: "payout", refId },
      ],
      [escrowId(marketId)],
    );
  }

  account(userId: string): Account {
    return {
      userId,
      balanceCents: this.bal(userId),
      lockedCents: this.bal(lockedId(userId)),
    };
  }

  totalDepositedCents(): Cents {
    return -this.bal(EXTERNAL);
  }

  /** Invariant #1: every posting balanced ⇒ sum of all accounts is 0. */
  assertConservation(): void {
    let sum = 0;
    for (const v of this.balances.values()) sum += v;
    if (sum !== 0) throw new Error(`Conservation broken: Σ all accounts = ${sum} (expected 0)`);
  }

  /** Serialize full state for persistence. */
  snapshot(): { balances: [string, Cents][]; entries: LedgerEntry[]; seq: number } {
    return { balances: [...this.balances], entries: this.entries, seq: this.seq };
  }

  /** Restore state from a snapshot (replaces current state). */
  load(s: { balances: [string, Cents][]; entries: LedgerEntry[]; seq: number }): void {
    this.balances = new Map(s.balances);
    this.entries.length = 0;
    this.entries.push(...s.entries);
    this.seq = s.seq;
  }
}
