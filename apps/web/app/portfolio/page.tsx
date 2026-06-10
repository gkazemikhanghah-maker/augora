"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, moneyC, centsPrice, type MtmPosition } from "@/lib/api";

export default function PortfolioPage() {
  const [balance, setBalance] = useState<{ balanceCents: number; lockedCents: number } | null>(null);
  const [positions, setPositions] = useState<MtmPosition[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    return Promise.all([api.balance(), api.positions()])
      .then(([b, p]) => { setBalance(b); setPositions(p); })
      .catch((e) => setErr((e as Error).message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (err)
    return <Note>Can’t reach the API ({err}). Is the backend running on port 4000?</Note>;
  if (!balance || !positions) return <Note>Loading…</Note>;

  const totalUnreal = positions.reduce((s, p) => s + p.unrealizedPnlCents, 0);
  // equity = cash + collateral + marked value of still-open positions
  const openValue = positions.reduce(
    (s, p) => s + (!p.settled && p.markCents != null ? p.qty * p.markCents : 0),
    0,
  );
  const equity = balance.balanceCents + balance.lockedCents + openValue;

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
          <div className="grid grid-cols-[1.5fr_0.6fr_0.5fr_0.6fr_0.6fr_0.8fr_0.7fr] gap-2 border-b border-line px-5 py-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">
            <span>Market</span><span>Side</span><span>Qty</span><span>Avg</span><span>Mark</span><span className="text-right">P&L</span><span className="text-right">Action</span>
          </div>
          {positions.map((p, i) => (
            <PositionRow key={`${p.marketId}:${p.side}:${p.written ? "w" : "l"}:${i}`} p={p} onClosed={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function PositionRow({ p, onClosed }: { p: MtmPosition; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(p.qty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setQty(p.qty); }, [p.qty]);

  const canClose = !p.settled && p.qty > 0;
  const closeQty = Math.min(Math.max(0, qty), p.qty);
  // proportional, sign-correct estimate from the server-computed unrealized P&L
  const estPnl = p.qty > 0 ? Math.round((p.unrealizedPnlCents * closeQty) / p.qty) : 0;
  const sideLabel = p.written ? `SHORT ${p.side === "NO" ? "YES" : "NO"}` : p.side;

  async function close() {
    if (closeQty <= 0) return;
    setBusy(true); setMsg(null);
    try {
      // close = sell your side (engine buys the opposite and merges)
      await api.placeOrder({ market_id: p.marketId, side: p.side, type: "market", qty: closeQty, action: "sell" });
      setMsg({ ok: true, text: `Closed ${closeQty} ${sideLabel}` });
      setOpen(false);
      onClosed();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="border-b border-line last:border-0">
      <div className="grid grid-cols-[1.5fr_0.6fr_0.5fr_0.6fr_0.6fr_0.8fr_0.7fr] items-center gap-2 px-5 py-[14px] font-mono text-[12.5px]">
        <Link href={`/market?id=${p.marketId}`} className="flex items-center gap-2 truncate text-ink hover:underline">
          <span className="truncate">{p.marketQuestion}</span>
          {p.source === "polymarket" && (
            <span className="shrink-0 rounded bg-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue">Paper</span>
          )}
          {p.settled && (
            <span className="shrink-0 rounded px-[5px] py-[1px] text-[9px] uppercase" style={{ background: p.won ? "var(--green-soft)" : "var(--red-soft)", color: p.won ? "var(--green)" : "var(--red)" }}>
              {p.won ? "won" : "lost"}
            </span>
          )}
        </Link>
        {p.written ? (
          <span className="text-[11px]" style={{ color: "var(--red)" }} title="Written short: premium collected, $1/contract collateral blocked">{sideLabel}</span>
        ) : (
          <span style={{ color: p.side === "YES" ? "var(--green)" : "var(--red)" }}>{p.side}</span>
        )}
        <span>{p.qty}</span>
        <span>{centsPrice(p.avgPriceCents / 100)}</span>
        <span>{p.markCents == null ? "—" : centsPrice(p.markCents / 100)}</span>
        <span className="text-right font-semibold" style={{ color: p.unrealizedPnlCents >= 0 ? "var(--green)" : "var(--red)" }}>
          {moneyC(p.unrealizedPnlCents)}
        </span>
        <span className="text-right">
          {canClose ? (
            <button onClick={() => setOpen((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] font-semibold text-ink transition hover:border-line-strong hover:bg-[#fffefb]">
              {open ? "Cancel" : "Close"}
            </button>
          ) : (
            <span className="text-[10px] text-muted">{p.settled ? "settled" : "—"}</span>
          )}
        </span>
      </div>

      {open && canClose && (
        <div className="border-t border-line bg-[#fafaf7] px-5 py-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Contracts to close</div>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={p.qty} value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(p.qty, Number(e.target.value) || 0)))}
                  className="w-24 rounded-lg border border-line px-3 py-2 text-right font-mono text-[16px] font-bold outline-none" />
                <div className="flex gap-1">
                  {[25, 50, 100].map((pct) => (
                    <button key={pct} onClick={() => setQty(Math.max(1, Math.floor((p.qty * pct) / 100)))}
                      className="rounded-md border border-line px-2 py-1 text-[10.5px] font-medium text-muted hover:border-line-strong hover:text-ink">{pct}%</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="font-mono text-[12px]">
              <div className="mb-1 text-[9.5px] uppercase tracking-[0.12em] text-muted">Est. realized P&L</div>
              <div className="text-[16px] font-bold" style={{ color: estPnl >= 0 ? "var(--green)" : "var(--red)" }}>{moneyC(estPnl)}</div>
            </div>
            <button onClick={close} disabled={busy || closeQty <= 0}
              className="ml-auto rounded-lg bg-ink px-5 py-2.5 text-[13px] font-bold text-white transition hover:brightness-95 disabled:opacity-50">
              {busy ? "Closing…" : `Close ${closeQty} ${sideLabel}`}
            </button>
          </div>
          <p className="mt-2 text-[10.5px] text-muted">
            Closes at market ({p.written ? "buys back the short" : "sells into the book"}); estimate uses the current mark and fills at the best available price.
          </p>
          {msg && <div className="mt-2 text-[11px] font-medium" style={{ color: msg.ok ? "var(--green)" : "var(--red)" }}>{msg.ok ? "✓ " : "✗ "}{msg.text}</div>}
        </div>
      )}
      {!open && msg && <div className="px-5 pb-2 text-[11px] font-medium" style={{ color: msg.ok ? "var(--green)" : "var(--red)" }}>{msg.ok ? "✓ " : "✗ "}{msg.text}</div>}
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
