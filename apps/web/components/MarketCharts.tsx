"use client";
import type { OrderBook, PricePoint, BookLevel } from "@/lib/api";
import { centsPrice } from "@/lib/api";

/** Order book ladder: YES asks (sell) on top, YES bids (buy) below, with depth bars. */
export function OrderBookView({ book }: { book: OrderBook | null }) {
  if (!book) return <Empty>loading book…</Empty>;
  const asks = [...book.yesAsks].sort((a, b) => b.priceCents - a.priceCents);
  const bids = [...book.yesBids].sort((a, b) => b.priceCents - a.priceCents);
  const maxQty = Math.max(1, ...asks.map((l) => l.qty), ...bids.map((l) => l.qty));
  const best = (arr: BookLevel[]) => (arr.length ? arr[arr.length === asks.length ? arr.length - 1 : 0] : null);
  const spread =
    asks.length && bids.length ? asks[asks.length - 1]!.priceCents - bids[0]!.priceCents : null;

  const Row = ({ l, kind }: { l: BookLevel; kind: "ask" | "bid" }) => (
    <div className="relative flex items-center justify-between px-3 py-[5px] font-mono text-[12px]">
      <div className={`absolute inset-y-0 ${kind === "ask" ? "right-0 bg-[#fbf0ee]" : "right-0 bg-[#f0f6f1]"}`}
        style={{ width: `${(l.qty / maxQty) * 100}%` }} />
      <span className="relative z-10" style={{ color: kind === "ask" ? "var(--red)" : "var(--green)" }}>
        {centsPrice(l.priceCents / 100)}
      </span>
      <span className="relative z-10 text-ink">{l.qty}</span>
    </div>
  );

  return (
    <div>
      <div className="flex justify-between px-3 pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
        <span>YES price</span>
        <span>size</span>
      </div>
      <div className="flex flex-col">
        {asks.length ? asks.map((l, i) => <Row key={"a" + i} l={l} kind="ask" />) : <Empty>no asks</Empty>}
      </div>
      <div className="my-1 flex items-center justify-center gap-2 border-y border-line py-1 font-mono text-[10px] text-muted">
        spread {spread != null ? centsPrice(spread / 100) : "—"}
      </div>
      <div className="flex flex-col">
        {bids.length ? bids.map((l, i) => <Row key={"b" + i} l={l} kind="bid" />) : <Empty>no bids</Empty>}
      </div>
    </div>
  );
}

/** Cumulative depth chart (YES side): bids left/green, asks right/red. */
export function DepthChart({ book }: { book: OrderBook | null }) {
  if (!book || (!book.yesBids.length && !book.yesAsks.length)) return <Empty>no depth</Empty>;
  const W = 520, H = 140, padB = 18, padT = 8;
  const bids = [...book.yesBids].sort((a, b) => b.priceCents - a.priceCents);
  const asks = [...book.yesAsks].sort((a, b) => a.priceCents - b.priceCents);
  let cb = 0, ca = 0;
  const bidPts = bids.map((l) => ({ p: l.priceCents, q: (cb += l.qty) }));
  const askPts = asks.map((l) => ({ p: l.priceCents, q: (ca += l.qty) }));
  const maxQ = Math.max(1, cb, ca);
  const ix = (p: number) => padT + (p / 100) * (W - 2 * padT);
  const iy = (q: number) => H - padB - (q / maxQ) * (H - padB - padT);
  const path = (pts: { p: number; q: number }[]) =>
    pts.length ? "M" + pts.map((pt) => `${ix(pt.p).toFixed(1)} ${iy(pt.q).toFixed(1)}`).join(" L") : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} fontFamily="IBM Plex Mono, monospace">
      <line x1={padT} y1={H - padB} x2={W - padT} y2={H - padB} stroke="#d9d2c1" />
      {bidPts.length > 0 && <path d={`${path(bidPts)} L${ix(bidPts[bidPts.length - 1]!.p)} ${H - padB} L${ix(bidPts[0]!.p)} ${H - padB} Z`} fill="#1f7a4d" opacity={0.12} />}
      {bidPts.length > 0 && <path d={path(bidPts)} fill="none" stroke="#1f7a4d" strokeWidth={2} />}
      {askPts.length > 0 && <path d={`${path(askPts)} L${ix(askPts[askPts.length - 1]!.p)} ${H - padB} L${ix(askPts[0]!.p)} ${H - padB} Z`} fill="#bb3b2c" opacity={0.12} />}
      {askPts.length > 0 && <path d={path(askPts)} fill="none" stroke="#bb3b2c" strokeWidth={2} />}
      <text x={padT} y={H - 4} fontSize={9} fill="#b3ab99">0¢</text>
      <text x={W - padT} y={H - 4} textAnchor="end" fontSize={9} fill="#b3ab99">100¢</text>
    </svg>
  );
}

/** Price history line (mid in ¢ over time). */
export function PriceHistoryChart({ history }: { history: PricePoint[] }) {
  if (!history.length) return <Empty>no history</Empty>;
  const W = 520, H = 150, padL = 28, padR = 10, padT = 10, padB = 18;
  const ys = history.map((h) => h.midCents);
  const lo = Math.max(0, Math.min(...ys) - 4), hi = Math.min(100, Math.max(...ys) + 4);
  const ix = (i: number) => padL + (i / Math.max(1, history.length - 1)) * (W - padL - padR);
  const iy = (v: number) => padT + ((hi - v) / (hi - lo || 1)) * (H - padT - padB);
  const d = "M" + history.map((h, i) => `${ix(i).toFixed(1)} ${iy(h.midCents).toFixed(1)}`).join(" L");
  const last = history[history.length - 1]!.midCents;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} fontFamily="IBM Plex Mono, monospace">
      <path d={`${d} L${ix(history.length - 1)} ${H - padB} L${padL} ${H - padB} Z`} fill="#2f6aa6" opacity={0.08} />
      <path d={d} fill="none" stroke="#2f6aa6" strokeWidth={2} />
      <text x={padL - 4} y={iy(hi) + 8} textAnchor="end" fontSize={9} fill="#b3ab99">{hi}¢</text>
      <text x={padL - 4} y={iy(lo)} textAnchor="end" fontSize={9} fill="#b3ab99">{lo}¢</text>
      <circle cx={ix(history.length - 1)} cy={iy(last)} r={3} fill="#2f6aa6" />
    </svg>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-[12px] text-muted">{children}</div>;
}
