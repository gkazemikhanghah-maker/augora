"use client";
import { useMemo, useState } from "react";
import { wMetrics, scaleW, type Atom } from "@augora/core";
import { api, money, timeToExpiry, type MarketView, type GroupLeg } from "@/lib/api";

const QTY = 100;

const short = (m: MarketView) => (m.optionLabel ?? m.question).replace(/\?$/, "").replace(/^.*?:\s*/, "");

/** Relative-value bet on a NOMINAL market: back one outcome, fade another.
 *  Augora has no naked short ("sell YES" == "buy NO"), so the spec's long-short
 *  w=[+1,0,−1] is built — identically in P&L — as Buy-YES(long) + Buy-NO(against),
 *  both fully-collateralized longs. Executes through the existing group endpoint. */
export function LongShortBuilder({
  group, title, onExecuted,
}: {
  group: MarketView[];
  title: string;
  onExecuted?: () => void;
}) {
  const members = useMemo(
    () => [...group].sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0)),
    [group],
  );
  const [longId, setLongId] = useState(members[0]?.id ?? "");
  const [againstId, setAgainstId] = useState(members[1]?.id ?? members[0]?.id ?? "");
  const same = longId === againstId;

  const atoms: Atom[] = useMemo(() => members.map((m) => ({ id: m.id, price: (m.priceCents ?? 50) / 100 })), [members]);
  // TRUE long-short per spec: w[long]=+1, w[short]=−1 (a real Write leg). The
  // w-engine prices this natively — net cost can be a credit, collateral = $100.
  const w = useMemo(() => {
    if (same) return {} as Record<string, number>;
    return { [longId]: QTY, [againstId]: -QTY };
  }, [longId, againstId, same]);
  const wm = useMemo(() => wMetrics(w, atoms), [w, atoms]);

  const priceOf = (id: string) => (group.find((x) => x.id === id)?.priceCents ?? 50) / 100;
  const longLbl = short(members.find((m) => m.id === longId) ?? members[0]!);
  const againstLbl = short(members.find((m) => m.id === againstId) ?? members[0]!);
  const cost = wm.cost; // = QTY·(p_long + 1 − p_against) on a clean partition
  const maxBar = Math.max(1, ...wm.byAtom.map((b) => Math.abs(b.pnl)));
  const expiry = group[0] ? timeToExpiry(group[0].secondsToExpiry) : "—";

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function execute() {
    if (same) return;
    setBusy(true); setMsg(null);
    try {
      const legs: GroupLeg[] = [
        { marketId: longId, side: "YES", type: "market", qty: QTY },
        { marketId: againstId, side: "YES", type: "market", qty: QTY, intent: "write" }, // native cash-secured short
      ];
      const { executed } = await api.executeStrategyGroup(legs);
      const filled = executed.reduce((s, e) => s + e.trades.reduce((t, x) => t + x.qty, 0), 0);
      setMsg({ ok: true, text: `✓ Relative bet executed atomically · ${filled} contracts · short leg written` });
      onExecuted?.();
    } catch (e) {
      setMsg({ ok: false, text: `✗ ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#f3eefb] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-[#7d5bbe]">
            Relative · long / short
          </span>
          <span className="font-mono text-[10.5px] text-muted">ends in {expiry}</span>
        </div>
        <div className="mt-1.5 text-[15px] font-bold leading-snug tracking-[-0.01em]">{title}</div>
        <div className="mt-1 text-[12px] leading-[1.55] text-muted">
          Bet that one outcome beats another. We back one with a Buy-<span className="font-semibold text-green">Yes</span> and
          fade the other with a native cash-secured <span className="font-semibold text-red">Write</span> — you collect that
          premium and block $1/contract of collateral. Fully collateralized: your loss is capped, never a margin call.
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wide text-green">Back (long)</span>
            <select value={longId} onChange={(e) => setLongId(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
              {members.map((m) => <option key={m.id} value={m.id}>{short(m)} · {m.priceCents}¢</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-wide text-red">Fade (short)</span>
            <select value={againstId} onChange={(e) => setAgainstId(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
              {members.map((m) => <option key={m.id} value={m.id}>{short(m)} · {m.priceCents}¢</option>)}
            </select>
          </label>
        </div>

        {same ? (
          <div className="mt-4 rounded-[12px] border border-line bg-[#fbf6ee] px-[14px] py-[12px] text-[12.5px] text-muted">
            Pick two different outcomes — one to back and one to fade.
          </div>
        ) : (
          <div className="mt-4 rounded-[12px] border border-line bg-[#fffefb] px-[14px] py-[12px]">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Executable legs</div>
            <div className="mt-1.5 flex flex-col gap-1 font-mono text-[12.5px]">
              <div className="flex items-center justify-between">
                <span>Buy-<span className="font-semibold text-green">YES</span> <span className="text-ink">{longLbl}</span></span>
                <span className="text-muted">pay {Math.round(priceOf(longId) * 100)}¢</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Write-<span className="font-semibold text-red">YES</span> <span className="text-ink">{againstLbl}</span></span>
                <span className="text-muted">get {Math.round(priceOf(againstId) * 100)}¢ · block $1</span>
              </div>
            </div>
          </div>
        )}

        <button onClick={execute} disabled={busy || same}
          className="mt-4 w-full rounded-xl bg-ink py-3 text-[13.5px] font-semibold text-bg transition disabled:opacity-40">
          {busy ? "Executing…" : "Execute relative bet (2 legs)"}
        </button>
        <div className="mt-2 px-1 text-[10.5px] leading-[1.5] text-muted">
          The short leg executes as a native cash-secured Write: you collect the premium and block $1/contract of collateral
          (settled from your collateral if it wins). It shows up as a written short in your Portfolio.
        </div>
        {msg && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${msg.ok ? "bg-[#eef7ee] text-green" : "bg-[#fbeeee] text-red"}`}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Cost &amp; risk</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line bg-line">
          <Stat label={cost < 0 ? "Credit received" : "Net debit"} value={money(Math.abs(cost))} color={cost < 0 ? "var(--green)" : undefined} />
          <Stat label="Collateral blocked" value={money(wm.collateral)} sm />
          <Stat label="Max profit" value={money(wm.maxProfit)} color="var(--green)" />
          <Stat label="Max loss" value={money(wm.maxLoss)} color="var(--red)" />
        </div>
        <div className="mt-2 rounded-[10px] bg-[#f7f5ef] px-3 py-2 text-[11.5px] leading-[1.5] text-muted">
          A relative position — best if <span className="font-semibold text-green">{longLbl}</span> wins, worst if{" "}
          <span className="font-semibold text-red">{againstLbl}</span> wins. The short leg is a Write: you{" "}
          {cost < 0 ? "collect a net credit" : "pay a small net debit"} and block {money(wm.collateral)} collateral, so total at
          risk is {money(wm.maxLoss)} — never more.
        </div>

        <div className="mb-2 mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">P&amp;L by winning outcome</div>
        <div className="flex flex-col gap-1.5">
          {wm.byAtom.map((b) => {
            const m = members.find((x) => x.id === b.id)!;
            const lit = b.id === longId || b.id === againstId;
            const wbar = (Math.abs(b.pnl) / maxBar) * 50;
            return (
              <div key={b.id} className="flex items-center gap-2">
                <div className={`w-[110px] truncate text-[11.5px] ${lit ? "font-semibold text-ink" : "text-muted"}`}>{short(m)}</div>
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
