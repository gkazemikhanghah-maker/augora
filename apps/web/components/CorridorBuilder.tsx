"use client";
import { useMemo, useState } from "react";
import {
  wMetrics, buildCorridor, scaleW, deriveCumulativeAtoms, corridorLegsCumulative, type Rung,
} from "@augora/core";
import { api, money, timeToExpiry, type MarketView, type GroupLeg } from "@/lib/api";

const QTY = 100; // one $100 block per contract-unit, matching the rest of the app

/** Corridor builder for a CUMULATIVE threshold ladder (peace-deal style).
 *  Members are nested thresholds ("by 2026" ⊆ "by 2027"); the real MECE atoms
 *  are the WINDOWS between them. The user picks a window range; we map it to the
 *  executable Buy-YES(wider)+Buy-NO(narrower) legs and price it on the windows. */
export function CorridorBuilder({
  group, title, onExecuted,
}: {
  group: MarketView[];
  title: string;
  onExecuted?: () => void;
}) {
  const rungsAsc = useMemo(
    () => [...group].sort((a, b) => (a.orderValue ?? 0) - (b.orderValue ?? 0)),
    [group],
  );
  const rungs: Rung[] = useMemo(
    () => rungsAsc.map((m) => ({ id: m.id, label: m.orderLabel ?? m.optionLabel ?? m.question, cumPrice: (m.priceCents ?? 50) / 100 })),
    [rungsAsc],
  );
  const atoms = useMemo(() => deriveCumulativeAtoms(rungs), [rungs]);
  const n = atoms.length;

  const [from, setFrom] = useState(Math.min(1, n - 1));
  const [to, setTo] = useState(Math.min(1, n - 1));
  const lo = Math.min(from, to), hi = Math.max(from, to);

  const w = useMemo(() => scaleW(buildCorridor(atoms, lo, hi), QTY), [atoms, lo, hi]);
  const wm = useMemo(() => wMetrics(w, atoms), [w, atoms]);
  const legs = useMemo(() => corridorLegsCumulative(rungs, lo, hi), [rungs, lo, hi]);

  const priceOf = (id: string, side: "YES" | "NO") => {
    const m = group.find((x) => x.id === id);
    const y = (m?.priceCents ?? 50) / 100;
    return side === "YES" ? y : 1 - y;
  };
  const labelOf = (id: string) => rungs.find((r) => r.id === id)?.label ?? id;
  const gross = legs.reduce((s, l) => s + QTY * priceOf(l.memberId, l.side), 0);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const expiry = group[0] ? timeToExpiry(group[0].secondsToExpiry) : "—";
  const maxBar = Math.max(1, ...wm.byAtom.map((b) => Math.abs(b.pnl)));

  async function execute() {
    if (legs.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const apiLegs: GroupLeg[] = legs.map((l) => ({ marketId: l.memberId, side: l.side, type: "market", qty: QTY }));
      const { executed } = await api.executeStrategyGroup(apiLegs);
      const filled = executed.reduce((s, e) => s + e.trades.reduce((t, x) => t + x.qty, 0), 0);
      setMsg({ ok: true, text: `✓ Corridor executed atomically · ${filled} contracts filled` });
      onExecuted?.();
    } catch (e) {
      setMsg({ ok: false, text: `✗ ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.15fr_0.85fr]">
      {/* LEFT: range picker */}
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#eef3fb] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-[#3b6fb0]">
            Cumulative ladder
          </span>
          <span className="font-mono text-[10.5px] text-muted">ends in {expiry}</span>
        </div>
        <div className="mt-1.5 text-[15px] font-bold leading-snug tracking-[-0.01em]">{title}</div>
        <div className="mt-1 text-[12px] leading-[1.55] text-muted">
          These are nested deadlines, so the real outcomes are the <span className="font-semibold text-ink">windows</span> between
          them. Pick a window range — we build it from a Buy-<span className="font-semibold text-green">Yes</span> on the wider
          deadline plus a Buy-<span className="font-semibold text-red">No</span> on the narrower one, and lock only your net risk.
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">From window</span>
            <select value={from} onChange={(e) => setFrom(+e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
              {atoms.map((a, i) => <option key={a.id} value={i}>{a.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">To window</span>
            <select value={to} onChange={(e) => setTo(+e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
              {atoms.map((a, i) => <option key={a.id} value={i}>{a.label}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-[12px] border border-line bg-[#fffefb] px-[14px] py-[12px]">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Executable legs</div>
          {legs.length === 0 ? (
            <div className="mt-1.5 text-[12.5px] text-muted">Whole-market range — no legs needed (you already hold the field).</div>
          ) : (
            <div className="mt-1.5 flex flex-col gap-1 font-mono text-[12.5px]">
              {legs.map((l) => (
                <div key={l.memberId + l.side} className="flex items-center justify-between">
                  <span>
                    Buy-<span className={l.side === "YES" ? "font-semibold text-green" : "font-semibold text-red"}>{l.side}</span>{" "}
                    <span className="text-ink">{labelOf(l.memberId)}</span>
                  </span>
                  <span className="text-muted">{Math.round(priceOf(l.memberId, l.side) * 100)}¢</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={execute} disabled={busy || legs.length === 0}
          className="mt-4 w-full rounded-xl bg-ink py-3 text-[13.5px] font-semibold text-bg transition disabled:opacity-40">
          {busy ? "Executing…" : `Execute corridor (${legs.length} leg${legs.length === 1 ? "" : "s"})`}
        </button>
        {msg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${msg.ok ? "bg-[#eef7ee] text-green" : "bg-[#fbeeee] text-red"}`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* RIGHT: net metrics + P&L by window */}
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Cost &amp; risk</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line bg-line">
          <Stat label="Net cost" value={money(wm.cost)} />
          <Stat label="Gross locked" value={money(gross)} sm />
          <Stat label="Max profit" value={money(wm.maxProfit)} color="var(--green)" />
          <Stat label="Max loss" value={money(wm.maxLoss)} color="var(--red)" />
        </div>
        <div className="mt-2 flex items-center justify-between rounded-[10px] bg-[#f7f5ef] px-3 py-2 text-[11.5px]">
          <span className="text-muted">Break-even probability</span>
          <span className="font-mono font-semibold tabular-nums">
            {wm.breakevenProb != null ? `${(wm.breakevenProb * 100).toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="mt-1.5 px-1 text-[11px] leading-[1.5] text-muted">
          +EV only if the real chance of landing in this range exceeds{" "}
          <span className="font-semibold text-ink">{wm.breakevenProb != null ? (wm.breakevenProb * 100).toFixed(1) : "—"}%</span>.
          You put up {money(gross)} gross but at least {money(QTY - wm.maxLoss)} comes back, so net risk is {money(wm.maxLoss)}.
        </div>

        <div className="mb-2 mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">P&amp;L by window</div>
        <div className="flex flex-col gap-1.5">
          {wm.byAtom.map((b) => {
            const atom = atoms.find((a) => a.id === b.id)!;
            const lit = atom.index! >= lo && atom.index! <= hi;
            const wbar = (Math.abs(b.pnl) / maxBar) * 50;
            return (
              <div key={b.id} className="flex items-center gap-2">
                <div className={`w-[120px] truncate text-[11.5px] ${lit ? "font-semibold text-ink" : "text-muted"}`}>{atom.label}</div>
                <div className="relative h-[16px] flex-1 rounded bg-[#f0eee8]">
                  <div className="absolute bottom-0 top-0 left-1/2 w-px bg-line" />
                  <div className="absolute bottom-[2px] top-[2px] rounded-[3px]"
                    style={b.pnl >= 0
                      ? { left: "50%", width: `${wbar}%`, background: "var(--green)" }
                      : { right: "50%", width: `${wbar}%`, background: "var(--red)" }} />
                </div>
                <div className="w-[52px] text-right font-mono text-[11.5px] tabular-nums"
                  style={{ color: b.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                  {b.pnl >= 0 ? "+" : ""}{money(b.pnl)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, sm }: { label: string; value: string; color?: string; sm?: boolean }) {
  return (
    <div className="bg-card px-[14px] py-[11px]">
      <div className="font-mono text-[9.5px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${sm ? "text-[15px]" : "text-[18px]"}`} style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
