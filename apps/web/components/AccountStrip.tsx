"use client";
import { useCallback, useEffect, useState } from "react";
import { api, moneyC } from "@/lib/api";

/** Always-visible account summary in the header: cash, blocked collateral,
 *  current position value, and equity (with open P&L). Polls so it stays live. */
export function AccountStrip() {
  const [d, setD] = useState<{ cash: number; blocked: number; posValue: number; equity: number; pnl: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, ps] = await Promise.all([api.balance(), api.positions()]);
      const open = ps.filter((p) => !p.settled);
      const cost = open.reduce((s, p) => s + p.qty * p.avgPriceCents, 0);          // collateral tied up (cost basis, in escrow)
      const posValue = open.reduce((s, p) => s + (p.markCents != null ? p.qty * p.markCents : 0), 0);
      setD({
        cash: b.balanceCents,
        blocked: b.lockedCents + cost,                       // resting-order locks + position collateral
        posValue,
        equity: b.balanceCents + b.lockedCents + posValue,
        pnl: ps.reduce((s, p) => s + p.unrealizedPnlCents, 0),
      });
    } catch {
      /* leave last good value */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [load]);

  if (!d) return null;
  return (
    <div className="hidden items-center gap-3 md:flex">
      <Stat label="Cash" value={moneyC(d.cash)} />
      <span className="h-6 w-px bg-line" />
      <Stat label="Blocked" value={moneyC(d.blocked)} />
      <span className="h-6 w-px bg-line" />
      <Stat label="In positions" value={moneyC(d.posValue)} />
      <span className="h-6 w-px bg-line" />
      <Stat label="Equity" value={moneyC(d.equity)} pnl={d.pnl} />
    </div>
  );
}

function Stat({ label, value, pnl }: { label: string; value: string; pnl?: number }) {
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[13px] font-semibold tabular-nums">
        {value}
        {pnl != null && (
          <span className="ml-1 text-[10px] font-medium" style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
            {moneyC(pnl)}
          </span>
        )}
      </div>
    </div>
  );
}
