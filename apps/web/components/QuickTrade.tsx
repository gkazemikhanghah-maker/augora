"use client";
import { useEffect, useState } from "react";
import { api, moneyC, type MarketView, type OrderBook, type MtmPosition } from "@/lib/api";
import type { Side } from "@augora/core";

/** Polymarket-style buy-box with Buy/Sell. In Sell mode it shows your holdings
 *  and defaults to closing them (sell = buy opposite + merge on the backend). */
export function QuickTrade({
  market,
  book,
  onTraded,
  defaultSide,
}: {
  market: MarketView;
  book: OrderBook | null;
  onTraded?: () => void;
  defaultSide?: Side;
}) {
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [side, setSide] = useState<Side>(defaultSide ?? "YES");
  const [otype, setOtype] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState(10);
  const [sellQty, setSellQty] = useState(0);
  const [limitPrice, setLimitPrice] = useState(50);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fill, setFill] = useState<{ filledQty: number; avgPriceCents: number; feeCents: number; restingQty: number; collateralCents: number } | null>(null);
  const [positions, setPositions] = useState<MtmPosition[]>([]);

  useEffect(() => { if (defaultSide) setSide(defaultSide); }, [defaultSide, market.id]);

  // load holdings for this market
  const loadPositions = () => api.positions().then((p) => setPositions(p.filter((x) => x.marketId === market.id))).catch(() => {});
  useEffect(() => { loadPositions(); /* eslint-disable-next-line */ }, [market.id]);

  const heldYes = positions.find((p) => p.side === "YES")?.qty ?? 0;
  const heldNo = positions.find((p) => p.side === "NO")?.qty ?? 0;
  const held = side === "YES" ? heldYes : heldNo;

  // entering sell mode: default to closing what you hold, or 10 to open a fresh short
  useEffect(() => { if (action === "sell") setSellQty(held > 0 ? held : 10); }, [action, side, held]);

  const yesAsk = book?.yesAsks.length ? Math.min(...book.yesAsks.map((l) => l.priceCents)) : market.priceCents ?? 50;
  const yesBidBest = book?.yesBids.length ? Math.max(...book.yesBids.map((l) => l.priceCents)) : null;
  const noBidBest = book?.yesAsks.length ? 100 - Math.min(...book.yesAsks.map((l) => l.priceCents)) : null;
  const noAsk = yesBidBest != null ? 100 - yesBidBest : market.priceCents != null ? 100 - market.priceCents : 50;
  // when selling, you hit the bid of YOUR side (sell YES → best YES bid; sell NO → best NO bid)
  const yesBidForSell = yesBidBest ?? (market.priceCents != null ? market.priceCents - 1 : 50);
  const noBidForSell = noBidBest ?? (market.priceCents != null ? 100 - market.priceCents - 1 : 50);
  const sellPrice = side === "YES" ? yesBidForSell : noBidForSell;
  const bestAsk = side === "YES" ? yesAsk : noAsk;
  const price = otype === "limit" ? limitPrice : action === "sell" ? sellPrice : bestAsk;

  // buy: dollars -> contracts. sell: explicit share qty.
  const qty = action === "buy" ? Math.max(1, Math.floor((amount * 100) / Math.max(1, price))) : Math.max(0, sellQty);

  useEffect(() => { setLimitPrice(action === "sell" ? sellPrice : bestAsk); }, [side, bestAsk, sellPrice, action]);

  // fill preview (buy previews the side; sell previews buying the OPPOSITE side)
  useEffect(() => {
    if (qty <= 0) { setFill(null); return; }
    let alive = true;
    const previewSide: Side = action === "sell" ? (side === "YES" ? "NO" : "YES") : side;
    const previewPrice = otype === "limit" ? (action === "sell" ? 100 - limitPrice : limitPrice) : undefined;
    api.fillPreview(market.id, [{ side: previewSide, type: otype, priceCents: previewPrice, qty }])
      .then((p) => alive && setFill(p.plans[0] ?? null)).catch(() => alive && setFill(null));
    return () => { alive = false; };
  }, [market.id, side, otype, qty, limitPrice, action]);

  const closed = market.status !== "open";

  // --- the four binary-option states, each a (action, side) pair ---
  const OPT_STATES = [
    { key: "LC", name: "Long Call",  act: "buy" as const,  s: "YES" as Side, verb: "Buy Yes",   flow: "pay" as const,     desc: "Pay premium now · win $1 if it resolves Yes. Max loss = premium." },
    { key: "SC", name: "Short Call", act: "sell" as const, s: "YES" as Side, verb: "Write Yes", flow: "receive" as const, desc: "Receive premium now · collateral blocked · you owe if it resolves Yes." },
    { key: "LP", name: "Long Put",   act: "buy" as const,  s: "NO" as Side,  verb: "Buy No",    flow: "pay" as const,     desc: "Pay premium now · win $1 if it resolves No. Max loss = premium." },
    { key: "SP", name: "Short Put",  act: "sell" as const, s: "NO" as Side,  verb: "Write No",  flow: "receive" as const, desc: "Receive premium now · collateral blocked · you owe if it resolves No." },
  ];
  const activeKey = action === "buy" ? (side === "YES" ? "LC" : "LP") : side === "YES" ? "SC" : "SP";
  const priceFor = (key: string) => (key === "LC" ? yesAsk : key === "SC" ? yesBidForSell : key === "LP" ? noAsk : noBidForSell);

  // --- summary numbers ---
  const buyCostCents = fill ? fill.collateralCents + fill.feeCents : qty * price;
  const buyShares = fill ? fill.filledQty : qty;
  // sell: proceeds = qty*100 (merge) − cost of buying opposite. Closing portion frees collateral.
  const closingQty = Math.min(qty, held);
  const shortQty = Math.max(0, qty - held);
  const oppCostCents = fill ? fill.collateralCents + fill.feeCents : qty * (100 - price);
  const sellProceedsCents = closingQty * 100 - (fill ? fill.collateralCents : closingQty * (100 - price));

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const res = await api.placeOrder({
        market_id: market.id, side, type: otype,
        price: otype === "limit" ? limitPrice : undefined,
        qty, action,
      });
      const filled = res.trades.reduce((s, t) => s + t.qty, 0);
      if (action === "sell") {
        setMsg({ ok: true, text: `Sold ${filled || qty} ${side}${res.mergedPairs ? ` · closed ${res.mergedPairs}` : ""}` });
      } else {
        const rested = res.order.qty - filled;
        setMsg({ ok: true, text: filled ? `Bought ${filled} ${side}${rested ? ` · ${rested} resting` : ""}` : `Resting (${rested} ${side})` });
      }
      loadPositions();
      onTraded?.();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-4 shadow-soft">
      {/* hold indicator */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Position</span>
        {(heldYes > 0 || heldNo > 0) && (
          <span className="font-mono text-[11px] text-muted">
            You hold {heldYes > 0 ? `${heldYes} YES` : ""}{heldYes > 0 && heldNo > 0 ? " · " : ""}{heldNo > 0 ? `${heldNo} NO` : ""}
          </span>
        )}
      </div>

      {/* four binary-option states (the trade actions, framed as options) */}
      <div className="grid grid-cols-2 gap-2">
        {OPT_STATES.map((o) => {
          const on = activeKey === o.key;
          const isCall = o.s === "YES";
          const accent = isCall ? "var(--green)" : "var(--red)";
          return (
            <button key={o.key} onClick={() => { setAction(o.act); setSide(o.s); }}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${on ? "shadow-soft" : "hover:border-line-strong"}`}
              style={{ borderColor: on ? accent : "var(--line)", background: on ? (isCall ? "var(--green-soft)" : "var(--red-soft)") : "var(--card)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-bold" style={{ color: on ? accent : "var(--ink)" }}>{o.name}</span>
                <span className="font-mono text-[13px] font-bold" style={{ color: on ? accent : "var(--ink)" }}>{priceFor(o.key)}¢</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-[10.5px] text-muted">{o.verb}</span>
                <span className="font-mono text-[9px] font-semibold" style={{ color: o.flow === "pay" ? "var(--red)" : "var(--green)" }}>
                  {o.flow === "pay" ? "▲ pay" : "▼ receive"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* plain-language for the selected state + the cash-flow / hedging note */}
      <div className="mt-2 rounded-lg bg-ink/[0.03] px-3 py-2 text-[10.5px] leading-snug text-muted">
        {OPT_STATES.find((o) => o.key === activeKey)?.desc}
        {action === "sell" && (
          <span className="mt-1 block text-[10px]">
            Same payoff as {side === "YES" ? "buying No (Long Put)" : "buying Yes (Long Call)"} — but cash comes in now instead of going out, so it works as an income / hedge leg.
          </span>
        )}
      </div>

      {/* order type */}
      <div className="mt-3 flex items-center gap-2">
        {(["market", "limit"] as const).map((t) => (
          <button key={t} onClick={() => setOtype(t)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition ${otype === t ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{t}</button>
        ))}
        {otype === "limit" && (
          <div className="ml-auto flex items-center gap-2">
            <input type="range" min={1} max={99} value={limitPrice} onChange={(e) => setLimitPrice(Number(e.target.value))} className="w-24" />
            <span className="font-mono text-[12px] font-semibold">{limitPrice}¢</span>
          </div>
        )}
      </div>

      {action === "buy" ? (
        <>
          {/* amount in dollars */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[12px] font-medium text-muted">Amount</span>
            <span className="font-mono text-[11px] text-muted">≈ {buyShares} shares</span>
          </div>
          <div className="mt-1.5 flex items-center rounded-lg border border-line px-3 py-2.5">
            <span className="text-[20px] font-bold text-muted">$</span>
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
              className="w-full bg-transparent text-right font-mono text-[22px] font-bold outline-none" />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {[1, 10, 50, 100].map((n) => (
              <button key={n} onClick={() => setAmount((a) => a + n)} className="rounded-md border border-line py-1 text-[11px] font-medium text-muted hover:border-line-strong hover:text-ink">+${n}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* shares to write / sell */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[12px] font-medium text-muted">{held > 0 ? "Shares to sell" : "Contracts to write"}</span>
            <span className="font-mono text-[11px] text-muted">{held} held</span>
          </div>
          <div className="mt-1.5 flex items-center rounded-lg border border-line px-3 py-2.5">
            <input type="number" min={0} value={sellQty} onChange={(e) => setSellQty(Math.max(0, Number(e.target.value) || 0))}
              className="w-full bg-transparent text-right font-mono text-[22px] font-bold outline-none" />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {held > 0
              ? [25, 50, 100].map((pct) => (
                  <button key={pct} onClick={() => setSellQty(Math.floor((held * pct) / 100))} className="rounded-md border border-line py-1 text-[11px] font-medium text-muted hover:border-line-strong hover:text-ink">{pct}%</button>
                ))
              : [10, 50, 100].map((n) => (
                  <button key={n} onClick={() => setSellQty((q) => q + n)} className="rounded-md border border-line py-1 text-[11px] font-medium text-muted hover:border-line-strong hover:text-ink">+{n}</button>
                ))}
          </div>
          {shortQty > 0 && closingQty > 0 && (
            <p className="mt-2 text-[10.5px] leading-snug text-amber">{closingQty} closes your holding; the remaining {shortQty} opens a short (premium in, collateral blocked).</p>
          )}
        </>
      )}

      {/* summary */}
      <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[12.5px]">
        {action === "buy" ? (
          <>
            <Row label="Avg price" value={fill && fill.filledQty > 0 ? `${Math.round(fill.avgPriceCents)}¢` : `${price}¢`} />
            <Row label="Premium paid · max loss" value={moneyC(buyCostCents)} color="var(--red)" strong />
            <Row label="Max profit" value={moneyC(Math.max(0, buyShares * 100 - buyCostCents))} color="var(--green)" />
          </>
        ) : (
          <>
            {closingQty > 0 && (
              <>
                <Row label="Sell price" value={`${price}¢`} />
                <Row label="Close proceeds" value={`+${moneyC(Math.max(0, sellProceedsCents))}`} color="var(--green)" strong />
                <Row label="Closing" value={`${closingQty} ${side}`} />
              </>
            )}
            {shortQty > 0 && (
              <>
                <Row label="Premium received · max profit" value={`+${moneyC(shortQty * price)}`} color="var(--green)" strong />
                <Row label="Max loss · collateral" value={moneyC(shortQty * (100 - price))} color="var(--red)" />
                <Row label={`Writing ${shortQty} ${side}`} value={`${price}¢`} />
              </>
            )}
          </>
        )}
      </div>

      <button onClick={submit} disabled={busy || closed || qty <= 0}
        className={`mt-3 w-full rounded-lg py-3 text-[14px] font-bold text-white transition hover:brightness-95 disabled:opacity-50 ${action === "sell" ? "bg-ink" : "bg-green"}`}>
        {closed ? "Market closed" : busy ? "Working…" : action === "sell"
          ? shortQty > 0 && closingQty === 0 ? `Write ${qty} ${side}` : `Sell ${qty} ${side}`
          : `Buy · ${moneyC(buyCostCents)}`}
      </button>
      {msg && <div className="mt-2 text-center text-[11px] font-medium" style={{ color: msg.ok ? "var(--green)" : "var(--red)" }}>{msg.ok ? "✓ " : "✗ "}{msg.text}</div>}
      <p className="mt-2.5 text-center text-[10.5px] text-muted">Fully collateralized — you can never lose more than the cost.</p>
    </div>
  );
}

function Row({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-mono ${strong ? "font-bold" : "font-medium"}`} style={{ color }}>{value}</span>
    </div>
  );
}
