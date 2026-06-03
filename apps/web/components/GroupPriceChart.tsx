"use client";
import { useRef, useState } from "react";
import type { PricePoint } from "@/lib/api";

export interface Series {
  id: string;
  label: string;
  color: string;
  last: number; // current %
  points: PricePoint[];
}

/** One chart, several outcome lines — the way Polymarket shows a multi-outcome
 *  event. Auto-scales to the data range so low-probability lines are readable. */
export function GroupPriceChart({ series, height = 240 }: { series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);

  const usable = series.filter((s) => s.points.length >= 2);
  if (usable.length === 0)
    return <div style={{ height }} className="flex items-center justify-center text-[12px] text-muted">Not enough data yet</div>;

  const W = 760;
  const H = height;
  const padL = 8;
  const padR = 54;
  const padT = 14;
  const padB = 26;
  const maxLen = Math.max(...usable.map((s) => s.points.length));

  const allY = usable.flatMap((s) => s.points.map((p) => p.midCents));
  const rawLo = Math.min(...allY);
  const rawHi = Math.max(...allY);
  const pad = Math.max(2, (rawHi - rawLo) * 0.2);
  const lo = Math.max(0, Math.floor(rawLo - pad));
  const hi = Math.min(100, Math.ceil(rawHi + pad));

  const ix = (i: number, len: number) => padL + (len <= 1 ? 0 : i / (len - 1)) * (W - padL - padR);
  const iy = (v: number) => padT + ((hi - v) / (hi - lo || 1)) * (H - padT - padB);

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, k) => Math.round(lo + ((hi - lo) * k) / ticks));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((x - padL) / (W - padL - padR)) * (maxLen - 1));
    setHover(Math.max(0, Math.min(maxLen - 1, i)));
  }

  return (
    <div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
        fontFamily="IBM Plex Mono, monospace" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridVals.map((v, k) => (
          <g key={k}>
            <line x1={padL} y1={iy(v)} x2={W - padR} y2={iy(v)} stroke="var(--line)" strokeWidth={0.5} opacity={0.7} />
            <text x={W - padR + 6} y={iy(v) + 3} fontSize={9} fill="#b6ae9c">{v}¢</text>
          </g>
        ))}
        {hover != null && (
          <line x1={ix(hover, maxLen)} y1={padT} x2={ix(hover, maxLen)} y2={H - padB} stroke="var(--line-strong)" strokeWidth={0.5} />
        )}
        {usable.map((s) => {
          const path = "M" + s.points.map((p, i) => `${ix(i, s.points.length).toFixed(1)} ${iy(p.midCents).toFixed(1)}`).join(" L");
          const lastP = s.points[s.points.length - 1]!;
          return (
            <g key={s.id}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" />
              <circle cx={ix(s.points.length - 1, s.points.length)} cy={iy(lastP.midCents)} r={2.5} fill={s.color} />
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 px-1">
        {series.slice(0, 6).map((s) => (
          <div key={s.id} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            <span className="text-muted">{s.label}</span>
            <span className="font-mono font-semibold tabular-nums">{s.last}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const SERIES_COLORS = ["#1D9E75", "#378ADD", "#E0823D", "#9B59B6", "#D9534F", "#2AA198"];
