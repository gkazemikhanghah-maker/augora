"use client";
import { useMemo, useState } from "react";
import {
  calc,
  entryPrice,
  binaryScenarios,
  LEGDEF,
  type LegKey,
  type Side,
  type StrategyState,
} from "@augora/core";
import { api, money, centsPrice, type MarketView } from "@/lib/api";
import { PayoffChart } from "./PayoffChart";

/** UI->backend asset mapping (spec §2.3): Buy & Write-Against own YES; Write &
 *  Buy-Against own NO. */
const LEG_SIDE: Record<LegKey, Side> = { BUY: "YES", WRITEA: "YES", WRITE: "NO", BUYA: "NO" };

const FEES: Array<[number, string]> = [
  [0, "None"],
  [0.07, "Standard"],
  [0.1, "High"],
];

export function StrategyBuilder({ market, onExecuted }: { market: MarketView; onExecuted?: () => void }) {
  const initialMid = market.priceCents != null ? market.priceCents / 100 : 0.5;
  const [state, setState] = useState<StrategyState>({
    mid: initialMid,
    spread: 0,
    belief: Math.min(0.99, Math.max(0.01, initialMid)),
    feeMult: market.feeMult || 0,
    legs: {
      BUY: { on: true, qty: 100 },
      WRITE: { on: false, qty: 100 },
      BUYA: { on: false, qty: 100 },
      WRITEA: { on: false, qty: 100 },
    },
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const c = useMemo(() => calc(state), [state]);
  const scenarios = binaryScenarios(c);
  const consistent = Math.abs(c.capital - -c.maxL) < 0.01;

  const toggle = (k: LegKey) =>
    setState((s) => ({ ...s, legs: { ...s.legs, [k]: { ...s.legs[k], on: !s.legs[k].on } } }));
  const setQty = (k: LegKey, qty: number) =>
    setState((s) => ({ ...s, legs: { ...s.legs, [k]: { ...s.legs[k], qty: Math.max(0, qty) } } }));

  async function execute() {
    setBusy(true);
    setMsg(null);
    try {
      const legs = LEGDEF.filter((d) => state.legs[d.k].on && state.legs[d.k].qty > 0).map((d) => ({
        side: LEG_SIDE[d.k],
        type: "market" as const,
        qty: state.legs[d.k].qty,
      }));
      const { executed } = await api.executeStrategy(market.id, legs);
      const filled = executed.reduce((s, r) => s + r.trades.reduce((t, x) => t + x.qty, 0), 0);
      setMsg(`✓ ${legs.length} leg(s) executed atomically · ${filled} contracts filled`);
      onExecuted?.();
    } catch (e) {
      // backend returns a clear reason when the basket can't fill atomically
      setMsg(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.15fr_0.85fr]">
      {/* LEFT: market controls + legs + payoff */}
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        {/* context */}
        <div className="mb-5 border-b border-line pb-4">
          <div className="text-[15px] font-bold leading-snug tracking-[-0.01em]">{market.question}</div>
          <div className="mt-1 text-[12px] leading-[1.55] text-muted">
            Binary market — it resolves <span className="font-semibold text-green">Yes</span> ($1) or{" "}
            <span className="font-semibold text-red">No</span> ($0). Buy or write the Yes and No sides below to shape your
            payoff; combine legs for spreads. Every position is fully collateralized, so your max loss is the capital you
            put up — never more.
          </div>
        </div>
        {/* market controls */}
        <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
          <Slider label="YES price" value={state.mid} min={0.02} max={0.98} step={0.005}
            display={centsPrice(state.mid)} onChange={(v) => setState((s) => ({ ...s, mid: v }))} />
          <Slider label="Spread" value={state.spread} min={0} max={0.08} step={0.005}
            display={(state.spread * 100).toFixed(1) + "¢"} onChange={(v) => setState((s) => ({ ...s, spread: v }))} />
          <Slider label="Your belief P(YES)" value={state.belief} min={0.01} max={0.99} step={0.01}
            display={(state.belief * 100).toFixed(0) + "%"} onChange={(v) => setState((s) => ({ ...s, belief: v }))} />
          <div className="flex flex-col gap-[7px]">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Fee</span>
            <div className="flex gap-1">
              {FEES.map(([v, lab]) => (
                <button key={lab} onClick={() => setState((s) => ({ ...s, feeMult: v }))}
                  className={`rounded-md border px-[11px] py-[7px] font-mono text-[11px] font-semibold transition ${
                    state.feeMult === v ? "border-ink bg-ink text-bg" : "border-line bg-white text-muted"
                  }`}>
                  {lab}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* legs */}
        <div className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Legs</div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LEGDEF.map((def) => {
            const L = state.legs[def.k];
            const e = entryPrice(def, state);
            const cash = L.on ? (def.dir === "long" ? -L.qty * e : +L.qty * e) : 0;
            return (
              <div key={def.k} onClick={() => toggle(def.k)}
                className={`cursor-pointer rounded-[13px] border-[1.5px] bg-[#fffefb] p-[13px] transition ${
                  L.on ? "border-ink shadow-soft" : "border-line"
                }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-[9px] text-[14px] font-semibold">
                    <span className={`h-[9px] w-[9px] rounded-[3px] border-[1.5px] ${L.on ? "border-ink bg-ink" : "border-line"}`} />
                    {def.name}
                  </span>
                  <span className={`rounded-md px-[7px] py-[3px] font-mono text-[9.5px] uppercase tracking-[0.08em] ${
                    def.tag === "pay" ? "bg-[#eef4ff] text-blue" : "bg-[#fbf2e3] text-amber"
                  }`}>
                    {def.dir === "long" ? "Pay" : "Receive"} premium
                  </span>
                </div>
                <div className="mt-[6px] text-[11px] leading-[1.5] text-muted">
                  {def.sub.replace("YES", `YES (${centsPrice(state.mid)})`).replace("NO", `NO (${centsPrice(1 - state.mid)})`)}
                </div>
                <div className="mt-[11px] flex items-center justify-between border-t border-line pt-[10px]">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">Contracts</span>
                  <input type="number" min={0} step={10} value={L.qty} onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => setQty(def.k, Number(ev.target.value) || 0)}
                    className="w-[74px] rounded-lg border border-line bg-white px-2 py-[5px] text-right font-mono text-[14px] font-semibold" />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">Cash now</span>
                  <span className="font-mono text-[12.5px] font-semibold" style={{ color: cash >= 0 ? "var(--green)" : "var(--red)" }}>
                    {L.on ? money(cash) : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* payoff */}
        <div className="mb-[10px] mt-[22px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          Payoff at resolution
        </div>
        {c.nLegs ? (
          <PayoffChart c={c} mid={state.mid} belief={state.belief} />
        ) : (
          <div className="py-10 text-center text-[13px] text-muted">Select at least one leg.</div>
        )}
      </div>

      {/* RIGHT: stats + scenarios + execute */}
      <div className="rounded-2xl border border-line bg-card p-[22px] shadow-soft">
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Cost &amp; risk</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line bg-line">
          <Stat label="Net premium" value={money(c.netPrem)} sm color={c.netPrem >= 0 ? "var(--green)" : "var(--red)"} />
          <Stat label="Collateral locked" value={money(c.collat)} sm />
          <Stat label="Max profit" value={money(c.maxP)} color="var(--green)" />
          <Stat label="Max loss · capital" value={money(c.maxL)} color="var(--red)" />
          <Stat label="Breakeven" value={c.be != null ? (c.be * 100).toFixed(1) + "%" : "—"} sm />
          <Stat label="EV @ belief" value={money(c.ev)} sm color={c.ev >= 0 ? "var(--green)" : "var(--red)"} />
        </div>

        <div className="mb-1 mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Outcome scenarios</div>
        <div className="mt-2 flex flex-col gap-2">
          {scenarios.map((row) => {
            const win = row.pnl >= 0;
            return (
              <div key={row.outcome}
                className={`flex items-center justify-between rounded-[10px] border px-[14px] py-[11px] ${
                  win ? "border-[#cfe6d6] bg-[#f0f6f1]" : "border-[#eed6d0] bg-[#fbf0ee]"
                }`}>
                <span className="flex items-center gap-[9px] text-[13px] font-medium">
                  <span className="rounded-[5px] border border-line bg-white px-[7px] py-[2px] font-mono text-[9.5px]">{row.outcome}</span>
                  {row.outcome === "YES" ? "deal happens" : "doesn't happen"}
                </span>
                <span className="font-mono text-[16px] font-semibold" style={{ color: win ? "var(--green)" : "var(--red)" }}>
                  {money(row.pnl)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-[14px] flex items-center gap-[7px] font-mono text-[11px] text-muted">
          <span style={{ color: consistent ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{consistent ? "✓" : "✗"}</span>
          capital {money(c.capital)} = max loss {money(-c.maxL)} — single-source {consistent ? "passes" : "FAILS"}
        </div>

        {c.nLegs > 0 && <EvVerdict ev={c.ev} belief={state.belief} />}

        <button onClick={execute} disabled={busy || c.nLegs === 0}
          className="mt-[18px] w-full rounded-xl bg-ink py-[15px] text-[14px] font-semibold text-bg transition hover:bg-[#322c22] disabled:opacity-50">
          {busy ? "Executing…" : `Execute ${c.nLegs} leg${c.nLegs === 1 ? "" : "s"}`}
        </button>
        {msg && (
          <div className="mt-2 text-center font-mono text-[11px]" style={{ color: msg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">{props.label}</span>
      <div className="flex items-center gap-2">
        <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))} className="w-[150px]" />
        <span className="font-mono text-[13px] font-semibold">{props.display}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sm, color }: { label: string; value: string; sm?: boolean; color?: string }) {
  return (
    <div className="bg-card p-[13px_15px] px-[15px] py-[13px]">
      <div className="mb-[5px] font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`font-mono font-semibold tracking-[-0.3px] ${sm ? "text-[15px]" : "text-[19px]"}`} style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function EvVerdict({ ev, belief }: { ev: number; belief: number }) {
  const pct = (belief * 100).toFixed(0);
  if (ev > 0.5)
    return <Box tone="go">{`At ${pct}% belief you have positive edge → EV ${money(ev)}.`}</Box>;
  if (ev < -0.5)
    return <Box tone="no">{`At ${pct}% belief EV is negative (${money(ev)}) — no edge here.`}</Box>;
  return <Box tone="no">Your belief ≈ the market price → EV ≈ 0, effectively a no-trade zone.</Box>;
}

function Box({ tone, children }: { tone: "go" | "no"; children: React.ReactNode }) {
  const cls = tone === "go" ? "border-[#cfe6d6] bg-[#f0f6f1] text-green" : "border-[#eaddc2] bg-[#fbf2e3] text-amber";
  return <div className={`mt-3 rounded-[10px] border px-[13px] py-[10px] text-[12px] leading-[1.6] ${cls}`}>{children}</div>;
}
