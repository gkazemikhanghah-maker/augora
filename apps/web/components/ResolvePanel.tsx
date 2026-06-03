"use client";
import { useState } from "react";
import { api, centsPrice, type MarketView } from "@/lib/api";
import { outcomeLabel } from "@/components/OutcomeLadder";
import type { Side } from "@augora/core";

/** Demo settlement control. Single binary markets settle YES/NO. Grouped markets
 *  settle atomically: categorical = one winner (rest NO); ladder = first satisfied
 *  threshold + all looser ones win (cumulative, like an option chain). */
export function ResolvePanel({
  market,
  siblings = [],
  onSettled,
}: {
  market: MarketView;
  siblings?: MarketView[];
  onSettled?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [price, setPrice] = useState<number>(market.strike ?? 0);

  const group = siblings.filter((m) => m.groupId === market.groupId);
  const isGroup = group.length > 1;
  const type = market.type;

  if (market.resolution) {
    const won = market.resolution.outcome;
    return (
      <div className="rounded-xl border border-line bg-card p-4 shadow-soft">
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Resolved</div>
        <span className="rounded-md px-2 py-1 text-[12px] font-bold"
          style={{ background: won === "YES" ? "var(--green-soft)" : "var(--red-soft)", color: won === "YES" ? "var(--green)" : "var(--red)" }}>
          {won} won
        </span>
        <p className="mt-3 text-[10.5px] leading-snug text-muted">
          Escrow drained to $0. Winners were paid $1.00 per contract — see Portfolio for your realized result.
        </p>
      </div>
    );
  }

  async function settleBinary(outcome?: Side, observedPrice?: number) {
    run(() => api.settle(market.id, observedPrice != null ? { observedPrice } : { outcome }).then((r) => `Resolved ${r.settlement.outcome}`));
  }
  async function settleGroup(body: { winnerId?: string; firstSatisfiedId?: string; none?: boolean }) {
    run(() => api.settleGroup(market.groupId, body).then((r) => `Settled ${r.settled.length} options`));
  }
  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg(null);
    try { setMsg(`✓ ${await fn()}`); onSettled?.(); }
    catch (e) { setMsg(`✗ ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const ladderSorted = [...group].sort((a, b) => a.expiryTs - b.expiryTs);

  return (
    <div className="rounded-xl border border-dashed border-line bg-card p-4 shadow-soft">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-amber">Resolve (demo)</div>
      <p className="mb-3 text-[10.5px] leading-snug text-muted">
        Dev tool — in production an oracle does this. Trigger it to see the full trade → settle → payout cycle.
      </p>

      {/* GROUPED: categorical = pick winner; ladder = pick first satisfied threshold */}
      {isGroup && type === "categorical" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-medium text-muted">Which option won?</span>
          {group.map((m) => (
            <button key={m.id} onClick={() => settleGroup({ winnerId: m.id })} disabled={busy}
              className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-[12px] hover:border-green hover:bg-green-soft disabled:opacity-50">
              <span className="truncate">{outcomeLabel(m)}</span>
              <span className="font-mono text-muted">{m.priceCents ?? "—"}%</span>
            </button>
          ))}
        </div>
      )}

      {isGroup && type === "ladder" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-medium text-muted">When did it first happen? (that threshold + all later ones win)</span>
          {ladderSorted.map((m) => (
            <button key={m.id} onClick={() => settleGroup({ firstSatisfiedId: m.id })} disabled={busy}
              className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-[12px] hover:border-green hover:bg-green-soft disabled:opacity-50">
              <span className="truncate">{outcomeLabel(m)}</span>
              <span className="font-mono text-muted">{m.priceCents ?? "—"}%</span>
            </button>
          ))}
          <button onClick={() => settleGroup({ none: true })} disabled={busy}
            className="rounded-lg border border-line px-3 py-2 text-left text-[12px] text-muted hover:border-red hover:bg-red-soft disabled:opacity-50">
            Didn’t happen (all No)
          </button>
        </div>
      )}

      {/* SINGLE binary market */}
      {!isGroup && (
        <>
          {market.strike != null && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10.5px] uppercase tracking-wide text-muted">Observed</span>
              <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)}
                className="w-24 rounded-lg border border-line bg-card px-2 py-1 text-right font-mono text-[13px]" />
              <button onClick={() => settleBinary(undefined, price)} disabled={busy}
                className="rounded-lg bg-ink px-3 py-1 text-[11px] text-white disabled:opacity-50">By oracle</button>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => settleBinary("YES")} disabled={busy}
              className="flex-1 rounded-lg bg-green-soft py-2 text-[12px] font-semibold text-green disabled:opacity-50">YES wins</button>
            <button onClick={() => settleBinary("NO")} disabled={busy}
              className="flex-1 rounded-lg bg-red-soft py-2 text-[12px] font-semibold text-red disabled:opacity-50">NO wins</button>
          </div>
        </>
      )}

      {msg && <div className="mt-2 text-center text-[11px] font-medium" style={{ color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
    </div>
  );
}
