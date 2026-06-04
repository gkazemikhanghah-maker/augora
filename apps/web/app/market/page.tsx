"use client";
import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  api, centsPrice, moneyC, timeToExpiry, MARKET_TYPE_LABEL,
  type MarketView, type OrderBook, type PricePoint,
} from "@/lib/api";
import type { Side, Trade } from "@augora/core";
import { StrategyBuilder } from "@/components/StrategyBuilder";
import { GroupStrategyBuilder } from "@/components/GroupStrategyBuilder";
import { QuickTrade } from "@/components/QuickTrade";
import { ResolvePanel } from "@/components/ResolvePanel";
import { OutcomeRows } from "@/components/OutcomeRows";
import { OrderBookView, DepthChart } from "@/components/MarketCharts";
import { PriceChart } from "@/components/PriceChart";
import { GroupPriceChart, SERIES_COLORS, type Series } from "@/components/GroupPriceChart";

export default function MarketDetailPage() {
  return (
    <Suspense fallback={<div className="mt-16 text-center text-[13px] text-muted">Loading…</div>}>
      <MarketDetail />
    </Suspense>
  );
}

function MarketDetail() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const sideParam = sp.get("side");
  const defaultSide: Side | undefined = sideParam === "NO" ? "NO" : sideParam === "YES" ? "YES" : undefined;
  const [market, setMarket] = useState<MarketView | null>(null);
  const [siblings, setSiblings] = useState<MarketView[]>([]);
  const [book, setBook] = useState<OrderBook | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [groupSeries, setGroupSeries] = useState<Series[]>([]);
  const [balance, setBalance] = useState<{ balanceCents: number; lockedCents: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [tab, setTab] = useState<"trade" | "strategy" | "spread">("trade");
  const wsRef = useRef<WebSocket | null>(null);

  const refreshAccount = useCallback(() => {
    api.balance().then(setBalance).catch(() => {});
    api.market(id).then(setMarket).catch(() => {});
    api.history(id).then(setHistory).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api.market(id).then(setMarket).catch((e) => setErr((e as Error).message));
    api.history(id).then(setHistory).catch(() => {});
    api.balance().then(setBalance).catch(() => {});
    api.markets().then(setSiblings).catch(() => {});
    let alive = true;
    try {
      const ws = new WebSocket(api.streamUrl(id));
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        if (!alive) return;
        const msg = JSON.parse(ev.data);
        if (msg.orderbook) setBook(msg.orderbook);
        if (msg.priceCents !== undefined && msg.priceCents !== null) {
          setPrice((prev) => {
            if (prev != null && msg.priceCents !== prev) { setFlash(msg.priceCents > prev ? "up" : "down"); setTimeout(() => setFlash(null), 800); }
            return msg.priceCents;
          });
        }
        if (msg.trades) setTrades(msg.trades);
      };
      ws.onerror = () => { api.orderbook(id).then(setBook).catch(() => {}); api.trades(id).then(setTrades).catch(() => {}); };
    } catch { api.orderbook(id).then(setBook).catch(() => {}); }
    return () => { alive = false; wsRef.current?.close(); };
  }, [id]);

  // build the multi-line series for a multi-outcome group (Polymarket-style)
  useEffect(() => {
    if (!market) return;
    const g = siblings.filter((m) => m.groupId === market.groupId);
    if (g.length <= 1) { setGroupSeries([]); return; }
    const top = [...g].sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0)).slice(0, 6);
    let alive = true;
    Promise.all(
      top.map((m) =>
        api.history(m.id).then((pts) => ({
          id: m.id,
          label: m.optionLabel ?? m.question,
          color: "",
          last: m.priceCents ?? 0,
          points: pts,
        })).catch(() => null),
      ),
    ).then((rows) => {
      if (!alive) return;
      setGroupSeries(rows.filter((r): r is Series => r != null).map((r, i) => ({ ...r, color: SERIES_COLORS[i % SERIES_COLORS.length]! })));
    });
    return () => { alive = false; };
  }, [market, siblings]);

  if (!id) return <Center>No market selected. <Link href="/" className="text-green underline">Markets</Link>.</Center>;
  if (err) return <Center>Error: {err}</Center>;
  if (!market) return <Center>Loading…</Center>;

  const yesPrice = price ?? market.priceCents;
  const group = siblings.filter((m) => m.groupId === market.groupId);
  const multi = group.length > 1;
  const change = history.length > 1 && history[0]!.midCents ? ((history[history.length - 1]!.midCents - history[0]!.midCents) / history[0]!.midCents) * 100 : 0;
  const groupTitle = market.groupTitle ?? (market.groupId === "NOMINEE-2028" ? "2028 Nominee" : market.groupId === "IRAN-US-PEACE" ? "US × Iran peace deal" : market.question);

  return (
    <div className="pt-6">
      <Link href="/" className="text-[12.5px] font-medium text-muted hover:text-ink">← Markets</Link>

      {/* tabs */}
      <div className="mt-3 flex items-center gap-1 border-b border-line">
        {(([["trade", "Trade"], ["strategy", "Strategy"], ...(multi ? [["spread", "Spread"]] : [])]) as [("trade" | "strategy" | "spread"), string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-semibold transition ${tab === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
            {k === "strategy" && <span className="ml-1.5 rounded bg-green-soft px-1.5 py-0.5 text-[9px] font-bold uppercase text-green">Pro</span>}
            {k === "spread" && <span className="ml-1.5 rounded bg-ink/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted">New</span>}
          </button>
        ))}
      </div>

      {tab === "trade" ? (
        <div className="mt-5 grid grid-cols-1 gap-7 lg:grid-cols-[1fr_340px]">
          {/* MAIN */}
          <div className="min-w-0">
            {/* header */}
            <div className="flex items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                  <span className="rounded bg-card px-1.5 py-0.5 ring-1 ring-line">{MARKET_TYPE_LABEL[market.type]}</span>
                  <span>{market.category}</span>
                  {market.source === "polymarket" && (
                    <span className="rounded bg-blue/10 px-1.5 py-0.5 font-semibold text-blue">Paper · Polymarket</span>
                  )}
                </div>
                <h1 className="mt-2 text-[24px] font-extrabold leading-[1.15] tracking-[-0.02em]">{multi ? groupTitle : market.question}</h1>
                <div className="mt-2 flex items-center gap-3 text-[12px] text-muted">
                  {market.asset && <span>{market.asset} · strike {market.strike}</span>}
                  <span>{market.resolution ? "closed" : `ends in ${timeToExpiry(market.secondsToExpiry)}`}</span>
                  {!market.resolution && <span className="flex items-center gap-1"><span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-green" />live</span>}
                </div>
              </div>
              {!multi && (
                <div className="shrink-0 text-right">
                  {market.resolution ? (
                    <div className="text-[24px] font-extrabold" style={{ color: market.resolution.outcome === "YES" ? "var(--green)" : "var(--red)" }}>{market.resolution.outcome} won</div>
                  ) : (
                    <>
                      <div className={`font-mono text-[46px] font-extrabold leading-none tracking-[-0.03em] ${flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""}`}>{yesPrice ?? "—"}<span className="text-[22px]">%</span></div>
                      {history.length > 1 && <div className="mt-1 text-[12px] font-semibold" style={{ color: change >= 0 ? "var(--green)" : "var(--red)" }}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%</div>}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* chart — one multi-line chart for groups (Polymarket-style), single line otherwise */}
            <div className="mt-5 rounded-xl border border-line bg-card p-3 shadow-soft">
              {multi ? <GroupPriceChart series={groupSeries} /> : <PriceChart history={history} />}
            </div>

            {/* outcome rows for multi-markets */}
            {multi && (
              <div className="mt-5">
                <SectionLabel>Outcomes</SectionLabel>
                <OutcomeRows siblings={group} currentId={market.id} />
              </div>
            )}

            {/* de-emphasized data */}
            <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div><SectionLabel>Order book</SectionLabel><OrderBookView book={book} /></div>
              <div>
                <SectionLabel>Depth</SectionLabel><DepthChart book={book} />
                <SectionLabel className="mt-5">Recent trades</SectionLabel>
                <div className="flex max-h-[100px] flex-col gap-1 overflow-auto">
                  {trades.length ? trades.slice(0, 8).map((t) => (
                    <div key={t.id} className="flex justify-between font-mono text-[11px] text-muted"><span>{t.qty} @ {centsPrice(t.yesPriceCents / 100)}</span></div>
                  )) : <span className="text-[11px] text-muted">no trades yet</span>}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT RAIL */}
          <div className="lg:sticky lg:top-[76px] lg:self-start">
            <div className="flex flex-col gap-4">
              {balance && (
                <div className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3 text-[13px] shadow-soft">
                  <span className="text-muted">Balance</span><span className="font-mono font-semibold">{moneyC(balance.balanceCents)}</span>
                </div>
              )}
              <QuickTrade market={market} book={book} onTraded={refreshAccount} defaultSide={defaultSide} />
              <ResolvePanel market={market} siblings={group} onSettled={refreshAccount} />
            </div>
          </div>
        </div>
      ) : tab === "spread" ? (
        <div className="mt-5">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">Build a spread</h2>
            <span className="text-[12.5px] text-muted">Combine legs across outcomes — all fill together or nothing commits.</span>
          </div>
          <GroupStrategyBuilder group={group} title={groupTitle} onExecuted={refreshAccount} />
        </div>
      ) : (
        <div className="mt-5">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">Build a strategy</h2>
            <span className="text-[12.5px] text-muted">More than yes/no — combine legs and see your risk before executing.</span>
          </div>
          {/* Per-outcome strategy: the single-market builder, scoped to the
              outcome the user opened. The cross-outcome (spread) builder is kept
              in GroupStrategyBuilder for a later, deliberate re-introduction. */}
          <StrategyBuilder market={market} onExecuted={refreshAccount} />
          {/* Templates will live here next */}
          <div className="mt-6 rounded-xl border border-dashed border-line bg-card p-5 text-center text-[12.5px] text-muted">
            Strategy templates (e.g. “cheap long shot”, “fade the favorite”) are coming here next.
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted ${className}`}>{children}</div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="mt-16 text-center text-[13px] text-muted">{children}</div>;
}
