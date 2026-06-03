"use client";
import type { CalcResult } from "@augora/core";
import { money, centsPrice } from "@/lib/api";

/** Ported verbatim from PayoffBuilder.html chart(): line from (p=0,P0) to (p=1,P1),
 *  split-colored at breakeven, with market & belief markers. */
export function PayoffChart({ c, mid, belief }: { c: CalcResult; mid: number; belief: number }) {
  const W = 560,
    H = 250,
    padL = 20,
    padR = 20,
    padT = 22,
    padB = 34;
  const ix = (p: number) => padL + p * (W - padL - padR);
  let lo = Math.min(c.P0, c.P1, 0),
    hi = Math.max(c.P0, c.P1, 0);
  const m = (hi - lo) * 0.16 || 1;
  lo -= m;
  hi += m;
  const iy = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const x0 = ix(0),
    x1 = ix(1),
    y0 = iy(c.P0),
    y1 = iy(c.P1),
    yz = iy(0);
  const GREEN = "#1f7a4d",
    RED = "#bb3b2c",
    INK = "#1b1813";

  const seg = (xa: number, ya: number, xb: number, yb: number, pos: boolean) => (
    <path d={`M${xa} ${ya} L${xb} ${yb} L${xb} ${yz} L${xa} ${yz} Z`} fill={pos ? GREEN : RED} opacity={0.1} />
  );

  const marker = (p: number, col: string, lab: string, up: boolean) => {
    const x = ix(p);
    return (
      <g key={lab}>
        <line x1={x} y1={padT - 4} x2={x} y2={H - padB} stroke={col} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.7} />
        <text x={x} y={up ? padT + 6 : H - padB + 16} textAnchor="middle" fontSize={9} fill={col}>
          {lab}
        </text>
      </g>
    );
  };

  const xb = c.be != null ? ix(c.be) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" fontFamily="IBM Plex Mono, monospace" style={{ width: "100%", height: "auto", display: "block" }}>
      {/* fills split at breakeven */}
      {xb != null ? (
        <>
          {seg(x0, y0, xb, yz, c.P0 > 0)}
          {seg(xb, yz, x1, y1, c.P1 > 0)}
        </>
      ) : (
        seg(x0, y0, x1, y1, c.P1 >= 0)
      )}
      {/* zero axis */}
      <line x1={padL} y1={yz} x2={W - padR} y2={yz} stroke="#d9d2c1" strokeWidth={1} />
      <text x={W - padR} y={yz - 5} textAnchor="end" fontSize={9} fill="#b3ab99">
        $0
      </text>
      {/* pnl line, split colors at breakeven */}
      {xb != null ? (
        <>
          <line x1={x0} y1={y0} x2={xb} y2={yz} stroke={c.P0 > 0 ? GREEN : RED} strokeWidth={2.5} />
          <line x1={xb} y1={yz} x2={x1} y2={y1} stroke={c.P1 > 0 ? GREEN : RED} strokeWidth={2.5} />
          <circle cx={xb} cy={yz} r={3.5} fill={INK} />
          <text x={xb} y={H - padB + 16} textAnchor="middle" fontSize={9.5} fill={INK}>
            breakeven {(c.be! * 100).toFixed(1)}%
          </text>
        </>
      ) : (
        <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={c.P1 >= 0 ? GREEN : RED} strokeWidth={2.5} />
      )}
      {/* markers */}
      {marker(mid, "#a59c88", "market " + centsPrice(mid), true)}
      {marker(belief, "#bf7d2a", "belief " + (belief * 100).toFixed(0) + "%", false)}
      {/* endpoints */}
      <circle cx={x0} cy={y0} r={4.5} fill={c.P0 >= 0 ? GREEN : RED} />
      <circle cx={x1} cy={y1} r={4.5} fill={c.P1 >= 0 ? GREEN : RED} />
      <text x={x0 + 6} y={y0 + (c.P0 >= 0 ? -8 : 16)} fontSize={11} fontWeight={600} fill={c.P0 >= 0 ? GREEN : RED}>
        NO {money(c.P0)}
      </text>
      <text x={x1 - 6} y={y1 + (c.P1 >= 0 ? -8 : 16)} textAnchor="end" fontSize={11} fontWeight={600} fill={c.P1 >= 0 ? GREEN : RED}>
        YES {money(c.P1)}
      </text>
      {/* x labels */}
      <text x={x0} y={H - 4} fontSize={9} fill="#b3ab99">
        0% · NO wins
      </text>
      <text x={x1} y={H - 4} textAnchor="end" fontSize={9} fill="#b3ab99">
        100% · YES wins
      </text>
    </svg>
  );
}
