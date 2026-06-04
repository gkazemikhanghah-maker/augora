"use client";
import { useMemo, useState } from "react";
import { wMetrics, type GroupLegCalc } from "@augora/core";
import { api, money, centsPrice, timeToExpiry, type MarketView, type GroupLeg } from "@/lib/api";

type Pick = "YES" | "NO" | null;

/** Strategy builder for a mutually-exclusive group (categorical / buckets).
 *  Each member can be a Buy-YES or Buy-NO leg; the basket executes atomically. */
export function GroupStrategyBuilder({
  group,
  title,
  onExecuted,
}: {
  group: MarketView[];
  title: string;
  onExecuted?: () => void;
}) {
  // stable display order: favorites first
  const members = useMemo(
    () => [...group].sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0)),
    [group],
  );
  const [legs, setLegs] = useState<Record<string, { pick: Pick; qty: number }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const label = (m: MarketView) => m.optionLabel ?? m.question;
  const yesPrice = (m: MarketView) => (m.priceCents ?? 50) / 100;
  const entryOf = (m: MarketView, pick: Pick) =>
    pick === "NO" ? 1 - yesPrice(m) : yesPrice(m);

  const set = (id: string, pick: Pick) =>
    setLegs((s) => {
      const cur = s[id];
      const next = cur?.pick === pick ? null : pick; // tap again to clear
      return { ...s, [id]: { pick: next, qty: cur?.qty ?? 100 } };
    });
  const setQty = (id: string, qty: number) =>
    setLegs((s) => ({ ...s, [id]: { pick: s[id]?.pick ?? null, qty: Math.max(0, qty) } }));

  // ---- spread presets: pre-fill legs as a starting point; user can tweak ----
  const isLadder = members[0]?.type === "ladder";
  const rungs = useMemo(
    () => [...group].filter((m) => m.orderValue != null).sort((a, b) => (a.orderValue ?? 0) - (b.orderValue ?? 0)),
    [group],
  );
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Basket: back the top 3 outcomes to win — wins $1 if any of them does.
  const applyBasket = () => {
    const top = [...group].sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0)).slice(0, 3);
    const next: Record<string, { pick: Pick; qty: number }> = {};
    top.forEach((m) => (next[m.id] = { pick: "YES", qty: 100 }));
    setLegs(next);
    setActivePreset("basket");
    setMsg(null);
  };
  // Window (ladder only): Yes on the later rung + No on the nearer rung — wins
  // only if the event lands in the gap between the two dates/levels.
  const applyWindow = () => {
    if (rungs.length < 2) return;
    const near = rungs[0]!;
    const far = rungs[1]!;
    setLegs({ [far.id]: { pick: "YES", qty: 100 }, [near.id]: { pick: "NO", qty: 100 } });
    setActivePreset("window");
    setMsg(null);
  };
  const clearLegs = () => { setLegs({}); setActivePreset(null); setMsg(null); };

  // build calc legs from active picks
  const calcLegs: GroupLegCalc[] = useMemo(
    () =>
      members
        .filter((m) => legs[m.id]?.pick && (legs[m.id]?.qty ?? 0) > 0)
        .map((m) => ({
          memberId: m.id,
          side: legs[m.id]!.pick as "YES" | "NO",
          dir: "long",
          qty: legs[m.id]!.qty,
          entry: entryOf(m, legs[m.id]!.pick),
        })),
    [members, legs],
  );

  // ---- risk via the universal w-engine (atoms = members; one resolves YES) ----
  const atomList = useMemo(() => members.map((m) => ({ id: m.id, price: yesPrice(m) })), [members]);
  const wVec = useMemo(() => {
    const w: Record<string, number> = {};
    for (const m of members) {
      const leg = legs[m.id];
      if (!leg?.pick || !(leg.qty > 0)) continue;
      if (leg.pick === "YES") w[m.id] = (w[m.id] ?? 0) + leg.qty;
      else for (const o of members) if (o.id !== m.id) w[o.id] = (w[o.id] ?? 0) + leg.qty; // Buy-NO ≡ +qty on every other atom
    }
    return w;
  }, [members, legs]);
  const wm = useMemo(() => wMetrics(wVec, atomList), [wVec, atomList]);
  const nLegs = calcLegs.length;
  // gross capital actually locked = sum of leg premiums (+ collateral once Write exists)
  const grossCapital = calcLegs.reduce((s, l) => s + l.qty * l.entry, 0) + wm.collateral;
  const scenarioById = new Map(wm.byAtom.map((b) => [b.id, b.pnl]));
  const payoff = { capital: grossCapital, maxP: wm.maxProfit, maxL: -wm.maxLoss, nLegs };

  const head = members[0];
  const typeLabel = head?.type === "ladder" ? "Ladder" : head?.type === "categorical" ? "Categorical" : "Grouped";
  const expiry = head ? timeToExpiry(head.secondsToExpiry) : "—";

  // payoff rows: every outcome you hold a leg on, plus one "any other" floor
  // (all leg-free outcomes share the same P&L, so we collapse them into one row).
  const leggedIds = new Set(calcLegs.map((l) => l.memberId));

  // orderable group → plot P&L on a real value axis (price / date) as a staircase
  const orderable = members.length >= 2 && members.every((m) => m.orderValue != null);
  const ladderPoints = orderable
    ? [...members]
        .sort((a, b) => (a.orderValue ?? 0) - (b.orderValue ?? 0))
        .map((m) => ({ label: m.orderLabel ?? label(m), pnl: scenarioById.get(m.id) ?? 0, lit: leggedIds.has(m.id) }))
    : [];

  const otherMember = members.find((m) => !leggedIds.has(m.id));
  const rows: { label: string; pnl: number; key: string }[] = [
    ...members
      .filter((m) => leggedIds.has(m.id))
      .map((m) => ({ label: label(m), pnl: scenarioById.get(m.id) ?? 0, key: m.id })),
    ...(otherMember ? [{ label: "Any other outcome", pnl: scenarioById.get(otherMember.id) ?? 0, key: "__other" }] : []),
  ];

  async function execute() {
    setBusy(true);
    setMsg(null);
    try {
      const apiLegs: GroupLeg[] = calcLegs.map((l) => ({
        marketId: l.memberId,
        side: l.side,
        type: "market",
        qty: l.qty,
      }));
      const { executed } = await api.executeStrategyGroup(apiLegs);
      const filled = executed.reduce((s, e) => s + e.trades.reduce((t, x) => t + x.qty, 0), 0);
      setMsg({ ok: true, text: `✓ ${executed.length} leg(s) across the group executed atomically · ${filled} contracts filled` });
      setLegs({});
      onExecuted?.();
    } catch (e) {
      setMsg({ ok: false, text: `✗ ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.15fr_0.85fr]">
      {/* LEFT: members as legs */}
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#eef3fb] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-[#3b6fb0]">
                {typeLabel}
              </span>
              {head?.source === "polymarket" && (
                <span className="rounded bg-[#f1efe8] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide text-muted">
                  Paper · Polymarket
                </span>
              )}
              <span className="font-mono text-[10.5px] text-muted">ends in {expiry}</span>
            </div>
            <div className="mt-1.5 text-[15px] font-bold leading-snug tracking-[-0.01em]">{title}</div>
            <div className="mt-1 text-[12px] leading-[1.55] text-muted">
              Exactly one of these {members.length} outcomes resolves <span className="font-semibold text-green">Yes</span> (pays
              $1); every other resolves <span className="font-semibold text-red">No</span> ($0). Buy{" "}
              <span className="font-semibold text-green">Yes</span> on an outcome to bet it happens, or{" "}
              <span className="font-semibold text-red">No</span> to bet against it. Combine several to build a spread that
              wins across a range. Every position is fully collateralized — your max loss is what you pay, never more.
            </div>
          </div>
        </div>

        {/* spread presets — a starting point you can then tweak below */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Presets</span>
          <button onClick={applyBasket}
            className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition ${activePreset === "basket" ? "border-ink bg-ink text-bg" : "border-line bg-white text-ink hover:border-ink"}`}>
            Basket · back top 3
          </button>
          {isLadder && rungs.length >= 2 && (
            <button onClick={applyWindow}
              className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition ${activePreset === "window" ? "border-ink bg-ink text-bg" : "border-line bg-white text-ink hover:border-ink"}`}>
              Window · between two dates
            </button>
          )}
          <button onClick={clearLegs}
            className="rounded-full border border-line bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted transition hover:border-ink hover:text-ink">
            Clear
          </button>
        </div>
        {activePreset && (
          <div className="mt-2 rounded-lg bg-[#f7f5ef] px-3 py-2 text-[11.5px] leading-[1.5] text-muted">
            {activePreset === "basket"
              ? "Backing the 3 most-likely outcomes. You win $1 if any one of them resolves Yes — cost is the sum of their Yes prices. Add or remove legs below."
              : "A window bet: Yes on the later date + No on the nearer one. It pays only if the event happens between the two dates. Tweak which rungs below."}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {members.map((m) => {
            const leg = legs[m.id];
            const active = leg?.pick != null;
            const cash = active ? -leg!.qty * entryOf(m, leg!.pick) : 0;
            return (
              <div key={m.id}
                className={`rounded-[12px] border bg-[#fffefb] px-[14px] py-[11px] transition ${
                  active ? "border-ink shadow-soft" : "border-line"
                }`}>
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{label(m)}</span>
                  <span className="font-mono text-[13px] font-semibold tabular-nums text-muted">
                    {m.priceCents ?? "—"}%
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => set(m.id, "YES")}
                      className={`rounded-lg border px-[12px] py-[6px] text-[12px] font-bold transition ${
                        leg?.pick === "YES" ? "border-green bg-green text-white" : "border-[#cfe6d6] bg-[#f0f6f1] text-green"
                      }`}>
                      Yes {centsPrice(yesPrice(m))}
                    </button>
                    <button onClick={() => set(m.id, "NO")}
                      className={`rounded-lg border px-[12px] py-[6px] text-[12px] font-bold transition ${
                        leg?.pick === "NO" ? "border-red bg-red text-white" : "border-[#eed6d0] bg-[#fbf0ee] text-red"
                      }`}>
                      No {centsPrice(1 - yesPrice(m))}
                    </button>
                  </div>
                </div>
                {active && (
                  <>
                    <div className="mt-[8px] text-[11px] leading-[1.45] text-muted">
                      {leg!.pick === "YES"
                        ? <>Buy Yes — you receive <span className="font-semibold">$1</span> per contract if <span className="font-medium text-ink">{label(m)}</span> wins, else $0.</>
                        : <>Buy No — you receive <span className="font-semibold">$1</span> per contract if <span className="font-medium text-ink">{label(m)}</span> does <span className="font-medium">not</span> win, else $0.</>}
                    </div>
                    <div className="mt-[8px] flex items-center justify-between border-t border-line pt-[9px]">
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">Contracts</span>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-[12px] font-semibold" style={{ color: "var(--red)" }}>
                          {money(cash)}
                        </span>
                        <input type="number" min={0} step={10} value={leg!.qty}
                          onChange={(ev) => setQty(m.id, Number(ev.target.value) || 0)}
                          className="w-[74px] rounded-lg border border-line bg-white px-2 py-[5px] text-right font-mono text-[14px] font-semibold" />
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: cost, payoff-by-outcome, execute */}
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Cost &amp; risk</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line bg-line">
          <Stat label="Net cost" value={money(wm.cost)} />
          <Stat label="Collateral" value={money(wm.collateral)} sm />
          <Stat label="Max profit" value={money(wm.maxProfit)} color="var(--green)" />
          <Stat label="Max loss" value={money(wm.maxLoss)} color="var(--red)" />
        </div>
        {nLegs > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-[10px] bg-[#f7f5ef] px-3 py-2 text-[11.5px]">
            <span className="text-muted">
              {wm.breakevenProb != null ? "Break-even probability" : "Relative position"}
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {wm.breakevenProb != null
                ? `${(wm.breakevenProb * 100).toFixed(1)}%`
                : `${nLegs} legs · ${money(payoff.capital)} locked`}
            </span>
          </div>
        )}
        {wm.breakevenProb != null && nLegs > 0 && (
          <div className="mt-1.5 px-1 text-[11px] leading-[1.5] text-muted">
            +EV only if the real chance of these outcomes exceeds{" "}
            <span className="font-semibold text-ink">{(wm.breakevenProb * 100).toFixed(1)}%</span>. Gross capital locked{" "}
            {money(payoff.capital)} — net risk {money(wm.maxLoss)}.
          </div>
        )}

        <div className="mb-2 mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          {orderable ? "P&L across the range" : "P&L by winning outcome"}
        </div>
        {payoff.nLegs === 0 ? (
          <div className="py-8 text-center text-[13px] text-muted">Pick at least one leg to see the payoff.</div>
        ) : orderable ? (
          <LadderPayoffChart points={ladderPoints} />
        ) : (
          <PayoffDiagram rows={rows} />
        )}

        <button onClick={execute} disabled={busy || payoff.nLegs === 0}
          className="mt-5 w-full rounded-xl bg-ink py-3 text-[14px] font-bold text-bg transition hover:opacity-90 disabled:opacity-40">
          {busy ? "Executing…" : `Execute ${payoff.nLegs} leg(s) atomically`}
        </button>
        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-[12.5px] ${
            msg.ok ? "border-[#cfe6d6] bg-[#f0f6f1] text-green" : "border-[#eed6d0] bg-[#fbf0ee] text-red"
          }`}>
            {msg.text}
          </div>
        )}
        <div className="mt-3 text-[11px] leading-[1.5] text-muted">
          All legs fill together or nothing commits. Prices shown are current mids; the exact fill is
          computed against live depth at execution.
        </div>
      </div>
    </div>
  );
}

function LadderPayoffChart({ points }: { points: { label: string; pnl: number; lit: boolean }[] }) {
  const W = 360;
  const H = 184;
  const padL = 6;
  const padR = 6;
  const padTop = 14;
  const padBottom = 30;
  const plotX = padL;
  const plotW = W - padL - padR;
  const plotTop = padTop;
  const plotBottom = H - padBottom;
  const plotH = plotBottom - plotTop;
  const span = Math.max(1, ...points.map((p) => Math.abs(p.pnl)));
  const yZero = plotTop + plotH / 2;
  const yOf = (pnl: number) => yZero - (pnl / span) * (plotH / 2);
  const n = points.length;
  const bw = plotW / n;
  const showEvery = n > 9 ? 2 : 1;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit and loss across the outcome range">
      {/* zero baseline */}
      <line x1={plotX} y1={yZero} x2={plotX + plotW} y2={yZero} stroke="var(--line)" strokeWidth={1} />
      {points.map((p, i) => {
        const x = plotX + i * bw;
        const win = p.pnl >= 0;
        const y = yOf(p.pnl);
        const top = Math.min(y, yZero);
        const h = Math.abs(y - yZero);
        const color = win ? "var(--green)" : "var(--red)";
        return (
          <g key={i}>
            <rect x={x + 1} y={top} width={Math.max(bw - 2, 1)} height={Math.max(h, 1)} rx={2}
              fill={color} opacity={p.lit ? 0.9 : 0.35} />
            {i % showEvery === 0 && (
              <text x={x + bw / 2} y={H - padBottom + 14} textAnchor="middle" fontSize={9.5}
                fill={p.lit ? "var(--ink)" : "#a8a294"} fontFamily="var(--font-mono)">
                {p.label.length > 8 ? p.label.slice(0, 8) : p.label}
              </text>
            )}
          </g>
        );
      })}
      {/* step outline */}
      <polyline
        points={points.map((p, i) => `${plotX + i * bw + bw / 2},${yOf(p.pnl)}`).join(" ")}
        fill="none" stroke="var(--ink)" strokeWidth={1.25} strokeLinejoin="round" opacity={0.55} />
      <text x={plotX + 2} y={plotTop + 4} fontSize={9} fill="#a8a294" fontFamily="var(--font-mono)">+ profit</text>
      <text x={plotX + 2} y={plotBottom - 1} fontSize={9} fill="#a8a294" fontFamily="var(--font-mono)">− loss</text>
    </svg>
  );
}

function PayoffDiagram({ rows }: { rows: { label: string; pnl: number; key: string }[] }) {
  const span = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  const rowH = 34;
  const padTop = 10;
  const padBottom = 22;
  const H = padTop + rows.length * rowH + padBottom;
  const W = 360;
  const labelW = 116; // left label column
  const valW = 64; // right value column
  const plotX = labelW;
  const plotW = W - labelW - valW;
  const zeroX = plotX + plotW / 2;
  const half = plotW / 2 - 4;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit and loss by winning outcome">
      {/* zero axis */}
      <line x1={zeroX} y1={padTop - 2} x2={zeroX} y2={H - padBottom + 2} stroke="var(--line)" strokeWidth={1} />
      <text x={zeroX} y={H - padBottom + 16} textAnchor="middle" fontSize={9} fill="#a8a294" fontFamily="var(--font-mono)">
        $0
      </text>
      {rows.map((r, i) => {
        const cy = padTop + i * rowH + rowH / 2;
        const win = r.pnl >= 0;
        const w = (Math.abs(r.pnl) / span) * half;
        const barX = win ? zeroX : zeroX - w;
        const color = win ? "var(--green)" : "var(--red)";
        const other = r.key === "__other";
        return (
          <g key={r.key}>
            <text x={0} y={cy} dominantBaseline="central" fontSize={11.5}
              fill={other ? "#a8a294" : "var(--muted)"} fontStyle={other ? "italic" : "normal"}>
              {r.label.length > 17 ? r.label.slice(0, 16) + "…" : r.label}
            </text>
            <rect x={zeroX - half} y={cy - 9} width={half * 2} height={18} rx={4} fill="#f4f3ee" opacity={0.6} />
            <rect x={barX} y={cy - 8} width={Math.max(w, 1)} height={16} rx={3} fill={color} opacity={0.9} />
            <text x={W} y={cy} textAnchor="end" dominantBaseline="central" fontSize={12.5}
              fontWeight={600} fill={color} fontFamily="var(--font-mono)">
              {money(r.pnl)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Stat({ label, value, color, sm }: { label: string; value: string; color?: string; sm?: boolean }) {
  return (
    <div className="bg-card px-[14px] py-[11px]">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mt-1 font-mono font-semibold ${sm ? "text-[14px]" : "text-[17px]"}`} style={{ color }}>
        {value}
      </div>
    </div>
  );
}
