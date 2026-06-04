"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, moneyC, centsPrice, type MtmPosition } from "@/lib/api";

export default function PortfolioPage() {
  const [balance, setBalance] = useState<{ balanceCents: number; lockedCents: number } | null>(null);
  const [positions, setPositions] = useState<MtmPosition[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.balance(), api.positions()])
      .then(([b, p]) => {
        setBalance(b);
        setPositions(p);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err)
    return <Note>Can’t reach the API ({err}). Is the backend running on port 4000?</Note>;
  if (!balance || !positions) return <Note>Loading…</Note>;

  const totalUnreal = positions.reduce((s, p) => s + p.unrealizedPnlCents, 0);
  const equity = balance.balanceCents + balance.lockedCents;

  return (
    <div className="pt-4">
      <h1 className="font-disp text-[30px] font-semibold tracking-[-0.5px]">Portfolio</h1>
      <p className="mt-2 text-[13px] text-muted">Playground mode with virtual balance — for paper trading.</p>

      {/* summary */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-soft sm:grid-cols-4">
        <Cell label="Free balance" value={moneyC(balance.balanceCents)} />
        <Cell label="Locked (collateral)" value={moneyC(balance.lockedCents)} />
        <Cell label="Equity" value={moneyC(equity)} />
        <Cell label="P&L (open + settled)" value={moneyC(totalUnreal)} color={totalUnreal >= 0 ? "var(--green)" : "var(--red)"} />
      </div>

      {/* positions */}
      <div className="mt-6 mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Open positions</div>
      {positions.length === 0 ? (
        <Note>
          No positions yet. Head to <Link href="/" className="text-blue underline">Markets</Link> and place a trade.
        </Note>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
          <div className="grid grid-cols-[1.5fr_0.6fr_0.6fr_0.7fr_0.7fr_0.8fr] gap-2 border-b border-line px-5 py-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">
            <span>Market</span><span>Side</span><span>Qty</span><span>Avg</span><span>Mark</span><span className="text-right">P&L</span>
          </div>
          {positions.map((p, i) => (
            <Link key={i} href={`/market?id=${p.marketId}`}
              className="grid grid-cols-[1.5fr_0.6fr_0.6fr_0.7fr_0.7fr_0.8fr] items-center gap-2 border-b border-line px-5 py-[14px] font-mono text-[12.5px] transition last:border-0 hover:bg-[#fffefb]">
              <span className="flex items-center gap-2 truncate text-ink">
                <span className="truncate">{p.marketQuestion}</span>
                {p.source === "polymarket" && (
                  <span className="shrink-0 rounded bg-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue">Paper</span>
                )}
                {p.settled && (
                  <span className="shrink-0 rounded px-[5px] py-[1px] text-[9px] uppercase" style={{ background: p.won ? "var(--green-soft)" : "var(--red-soft)", color: p.won ? "var(--green)" : "var(--red)" }}>
                    {p.won ? "won" : "lost"}
                  </span>
                )}
              </span>
              {p.written ? (
                <span className="text-[11px]" style={{ color: "var(--red)" }} title="Written short: premium collected, $1/contract collateral blocked">
                  SHORT YES
                </span>
              ) : (
                <span style={{ color: p.side === "YES" ? "var(--green)" : "var(--red)" }}>{p.side}</span>
              )}
              <span>{p.qty}</span>
              <span>{centsPrice(p.avgPriceCents / 100)}</span>
              <span>{p.markCents == null ? "—" : centsPrice(p.markCents / 100)}</span>
              <span className="text-right font-semibold" style={{ color: p.unrealizedPnlCents >= 0 ? "var(--green)" : "var(--red)" }}>
                {moneyC(p.unrealizedPnlCents)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="font-mono text-[18px] font-semibold tracking-[-0.3px]" style={{ color }}>{value}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-2xl border border-line bg-card p-6 text-center text-[13px] leading-[1.8] text-muted">
      {children}
    </div>
  );
}
