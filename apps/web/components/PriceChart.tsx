"use client";
import { useRef, useState } from "react";
import type { PricePoint } from "@/lib/api";

/** A real-feeling price chart (area + grid + axes + crosshair) drawn in SVG. */
export function PriceChart({ history, height = 240 }: { history: PricePoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  if (history.length < 2)
    return <div style={{ height }} className="flex items-center justify-center text-[12px] text-muted">Not enough data yet</div>;

  const W = 760;
  const H = height;
  const padL = 8;
  const padR = 52;
  const padT = 14;
  const padB = 26;
  const ys = history.map((h) => h.midCents);
  const rawLo = Math.min(...ys);
  const rawHi = Math.max(...ys);
  const pad = Math.max(2, (rawHi - rawLo) * 0.25);
  const lo = Math.max(0, Math.floor(rawLo - pad));
  const hi = Math.min(100, Math.ceil(rawHi + pad));
  const ix = (i: number) => padL + (i / (history.length - 1)) * (W - padL - padR);
  const iy = (v: number) => padT + ((hi - v) / (hi - lo || 1)) * (H - padT - padB);

  const up = ys[ys.length - 1]! >= ys[0]!;
  const col = up ? "var(--green)" : "var(--red)";
  const line = history.map((h, i) => `${ix(i).toFixed(1)} ${iy(h.midCents).toFixed(1)}`);
  const linePath = "M" + line.join(" L");
  const areaPath = `${linePath} L${ix(history.length - 1)} ${H - padB} L${ix(0)} ${H - padB} Z`;

  // horizontal grid lines (price levels)
  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, k) => lo + ((hi - lo) * k) / ticks);

  const last = history[history.length - 1]!.midCents;
  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - padL) / (W - padL - padR)) * (history.length - 1));
    setHover(Math.max(0, Math.min(history.length - 1, i)));
  }

  const hp = hover != null ? history[hover]! : null;

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
      fontFamily="IBM Plex Mono, monospace" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.16" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* grid + price axis (right) */}
      {gridVals.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={iy(v)} x2={W - padR} y2={iy(v)} stroke="var(--line)" strokeWidth={1} />
          <text x={W - padR + 6} y={iy(v) + 3} fontSize={9.5} fill="#b3ab99">{Math.round(v)}¢</text>
        </g>
      ))}

      {/* time labels (bottom) */}
      {[0, Math.floor((history.length - 1) / 2), history.length - 1].map((i, k) => (
        <text key={k} x={ix(i)} y={H - 8} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} fontSize={9} fill="#b3ab99">
          {fmtTime(history[i]!.ts)}
        </text>
      ))}

      {/* area + line */}
      <path d={areaPath} fill="url(#pcfill)" />
      <path d={linePath} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* last price marker + tag */}
      <line x1={padL} y1={iy(last)} x2={W - padR} y2={iy(last)} stroke={col} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
      <rect x={W - padR + 2} y={iy(last) - 9} width={padR - 2} height={18} rx={3} fill={col} />
      <text x={W - padR / 2 + 1} y={iy(last) + 3} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">{last}¢</text>

      {/* hover crosshair */}
      {hp && (
        <g>
          <line x1={ix(hover!)} y1={padT} x2={ix(hover!)} y2={H - padB} stroke="var(--ink)" strokeWidth={1} opacity={0.18} />
          <circle cx={ix(hover!)} cy={iy(hp.midCents)} r={3.5} fill={col} stroke="#fff" strokeWidth={1.5} />
          <g transform={`translate(${Math.min(ix(hover!) + 8, W - padR - 70)}, ${padT + 2})`}>
            <rect width={70} height={30} rx={4} fill="var(--ink)" />
            <text x={8} y={13} fontSize={9.5} fill="#fff" fontWeight={600}>{hp.midCents}¢</text>
            <text x={8} y={24} fontSize={8} fill="#cfc7b5">{fmtTime(hp.ts)}</text>
          </g>
        </g>
      )}
    </svg>
  );
}
