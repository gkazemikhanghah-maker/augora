"use client";

export function Sparkline({ data, w = 96, h = 30 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) return <div style={{ width: w, height: h }} />;
  const lo = Math.min(...data), hi = Math.max(...data);
  const span = hi - lo || 1;
  const ix = (i: number) => (i / (data.length - 1)) * w;
  const iy = (v: number) => h - ((v - lo) / span) * (h - 4) - 2;
  const d = "M" + data.map((v, i) => `${ix(i).toFixed(1)} ${iy(v).toFixed(1)}`).join(" L");
  const up = data[data.length - 1]! >= data[0]!;
  const col = up ? "#1f7a4d" : "#bb3b2c";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill={col} opacity={0.08} />
      <path d={d} fill="none" stroke={col} strokeWidth={1.5} />
    </svg>
  );
}
