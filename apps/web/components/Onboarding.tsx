"use client";
import { useEffect, useMemo, useState } from "react";

const SEEN_KEY = "augora_onboarded_v1";

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  // auto-open on first visit (real app on the user's machine; localStorage is fine here)
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  function close() {
    setOpen(false);
    setI(0);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  const slides = [Slide1, Slide2, Slide3, Slide4];
  const Current = slides[i]!;
  const last = i === slides.length - 1;

  return (
    <>
      <button
        onClick={() => {
          setI(0);
          setOpen(true);
        }}
        className="rounded-full border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-muted transition hover:border-line-strong hover:text-ink"
      >
        How it works
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(27,24,19,0.55)" }}>
          <div className="relative w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
            {/* skip */}
            <button onClick={close} className="absolute right-4 top-4 z-10 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted hover:text-ink">
              Skip
            </button>

            <div className="px-7 pb-6 pt-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber">How Augora works</div>
              <Current />
            </div>

            {/* footer nav */}
            <div className="flex items-center justify-between border-t border-line px-7 py-4">
              <div className="flex gap-[6px]">
                {slides.map((_, n) => (
                  <span key={n} className="h-[6px] rounded-full transition-all"
                    style={{ width: n === i ? 20 : 6, background: n === i ? "var(--ink)" : "var(--line)" }} />
                ))}
              </div>
              <div className="flex gap-2">
                {i > 0 && (
                  <button onClick={() => setI((x) => x - 1)} className="rounded-lg border border-line bg-white px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                    Back
                  </button>
                )}
                <button onClick={() => (last ? close() : setI((x) => x + 1))}
                  className="rounded-lg bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-bg">
                  {last ? "Start trading" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- Slide 1: probability ---------------- */
function Slide1() {
  const price = 60;
  return (
    <Frame title="It’s just a probability" sub={`A YES price of ${price}¢ means the market thinks there’s a ${price}% chance. If it comes true, each share becomes $1. If not, $0.`}>
      <svg viewBox="0 0 480 120" style={{ width: "100%" }} fontFamily="IBM Plex Mono, monospace">
        <rect x="20" y="46" width="440" height="20" rx="10" fill="#eee7d8" />
        <rect x="20" y="46" width={(440 * price) / 100} height="20" rx="10" fill="#1f7a4d" opacity={0.25} />
        <line x1={20 + (440 * price) / 100} y1="38" x2={20 + (440 * price) / 100} y2="74" stroke="#1b1813" strokeWidth="2" />
        <circle cx={20 + (440 * price) / 100} cy="56" r="7" fill="#1b1813" />
        <text x={20 + (440 * price) / 100} y="30" textAnchor="middle" fontSize="13" fontWeight="600" fill="#1b1813">{price}¢</text>
        <text x="20" y="92" fontSize="11" fill="#7a7263">0¢ · NO</text>
        <text x="460" y="92" textAnchor="end" fontSize="11" fill="#7a7263">100¢ · YES</text>
      </svg>
      <div className="mt-3 flex gap-2">
        <span className="flex-1 rounded-lg border border-[#cfe6d6] bg-[#f0f6f1] py-2 text-center font-mono text-[12px] text-green">Buy YES 60¢</span>
        <span className="flex-1 rounded-lg border border-[#eed6d0] bg-[#fbf0ee] py-2 text-center font-mono text-[12px] text-red">Buy NO 40¢</span>
      </div>
    </Frame>
  );
}

/* ---------------- Slide 2: sealed downside vs leverage (interactive) ---------------- */
function Slide2() {
  const [lev, setLev] = useState(3);
  const stake = 100;
  const W = 480, H = 180, padL = 38, padR = 14, padT = 12, padB = 28;
  const ix = (m: number) => padL + (m / 25) * (W - padL - padR); // m = % move against you, 0..25
  const lo = -200, hi = 20;
  const iy = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const liqMove = 100 / lev; // % move that wipes a leveraged position
  // futures polyline points
  const fut: string[] = [];
  for (let m = 0; m <= 25; m += 1) fut.push(`${ix(m).toFixed(1)} ${iy(Math.max(lo, -lev * (m / liqMove) * stake)).toFixed(1)}`);
  return (
    <Frame title="You can’t lose more than you put in" sub="No liquidation. No margin calls. Whatever happens, the most you can lose is the cash you put up.">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }} fontFamily="IBM Plex Mono, monospace">
        {/* liquidation zone */}
        <rect x={padL} y={iy(-100)} width={W - padL - padR} height={H - padB - iy(-100)} fill="#bb3b2c" opacity={0.07} />
        <text x={W - padR - 4} y={iy(-100) + 14} textAnchor="end" fontSize="9" fill="#bb3b2c">liquidation zone</text>
        {/* zero line */}
        <line x1={padL} y1={iy(0)} x2={W - padR} y2={iy(0)} stroke="#d9d2c1" />
        <text x={padL - 4} y={iy(0) + 3} textAnchor="end" fontSize="9" fill="#b3ab99">$0</text>
        <text x={padL - 4} y={iy(-100) + 3} textAnchor="end" fontSize="9" fill="#b3ab99">−${stake}</text>
        {/* futures line */}
        <polyline points={fut.join(" ")} fill="none" stroke="#9a9282" strokeWidth="2.5" strokeDasharray="5 3" />
        <text x={ix(25)} y={iy(-200) + 4} textAnchor="end" fontSize="9.5" fill="#7a7263">{lev}× futures</text>
        {/* augora floor */}
        <line x1={padL} y1={iy(-stake)} x2={W - padR} y2={iy(-stake)} stroke="#1f7a4d" strokeWidth="3" />
        <text x={padL + 6} y={iy(-stake) - 6} fontSize="10.5" fontWeight="600" fill="#1f7a4d">Augora — sealed at −${stake}</text>
        <text x={(padL + W - padR) / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#b3ab99">→ market moves against you</text>
      </svg>
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Futures leverage</span>
        <input type="range" min={1} max={5} step={1} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="flex-1" />
        <span className="font-mono text-[13px] font-semibold">{lev}×</span>
      </div>
      <p className="mt-2 font-mono text-[11px] leading-[1.6] text-muted">
        Augora: worst case stays <b className="text-green">−${stake}</b>, always. Futures at {lev}×: wiped out after a ~{liqMove.toFixed(0)}% move.
      </p>
    </Frame>
  );
}

/* ---------------- Slide 3: express a view (interactive payoff) ---------------- */
function Slide3() {
  const price = 60, qty = 100;
  const [belief, setBelief] = useState(75);
  const W = 480, H = 170, padL = 40, padR = 14, padT = 14, padB = 26;
  const pnl = (p: number) => qty * (p / 100 - price / 100); // linear payoff, $
  const lo = -price * qty / 100, hi = (100 - price) * qty / 100;
  const ix = (p: number) => padL + (p / 100) * (W - padL - padR);
  const iy = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const beMarker = ix(price);
  const expected = pnl(belief);
  return (
    <Frame title="Say what you think — and see it" sub="You’re not stuck with a plain yes/no. Tell us where you think it lands and see your profit or loss instantly — before spending a cent.">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }} fontFamily="IBM Plex Mono, monospace">
        <line x1={padL} y1={iy(0)} x2={W - padR} y2={iy(0)} stroke="#d9d2c1" />
        {/* payoff line split at breakeven */}
        <line x1={ix(0)} y1={iy(pnl(0))} x2={beMarker} y2={iy(0)} stroke="#bb3b2c" strokeWidth="2.5" />
        <line x1={beMarker} y1={iy(0)} x2={ix(100)} y2={iy(pnl(100))} stroke="#1f7a4d" strokeWidth="2.5" />
        {/* belief marker */}
        <line x1={ix(belief)} y1={padT} x2={ix(belief)} y2={H - padB} stroke="#bf7d2a" strokeWidth="1.4" strokeDasharray="4 3" />
        <circle cx={ix(belief)} cy={iy(expected)} r="5" fill="#bf7d2a" />
        <text x="6" y={iy(hi) + 8} fontSize="9" fill="#b3ab99">+${hi.toFixed(0)}</text>
        <text x="6" y={iy(lo)} fontSize="9" fill="#b3ab99">−${Math.abs(lo).toFixed(0)}</text>
        <text x={ix(0)} y={H - 6} fontSize="9" fill="#b3ab99">NO</text>
        <text x={ix(100)} y={H - 6} textAnchor="end" fontSize="9" fill="#b3ab99">YES</text>
      </svg>
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Where it lands</span>
        <input type="range" min={0} max={100} value={belief} onChange={(e) => setBelief(Number(e.target.value))} className="flex-1" />
        <span className="font-mono text-[13px] font-semibold">{belief}%</span>
      </div>
      <p className="mt-2 font-mono text-[11px] text-muted">
        If you’re right, this trade is worth about <b style={{ color: expected >= 0 ? "var(--green)" : "var(--red)" }}>{expected >= 0 ? "+" : "−"}${Math.abs(expected).toFixed(0)}</b>.
      </p>
    </Frame>
  );
}

/* ---------------- Slide 4: edge gauge (interactive) ---------------- */
function Slide4() {
  const market = 60;
  const [belief, setBelief] = useState(72);
  const edge = belief - market;
  const favor = edge > 1;
  const against = edge < -1;
  // needle angle: -90 (left/against) .. +90 (right/favor)
  const angle = Math.max(-80, Math.min(80, (edge / 30) * 80));
  return (
    <Frame title="Is this trade in your favor?" sub="The market price is its best guess. Drag your own belief — if it’s higher than the market, the odds are tilted your way.">
      <svg viewBox="0 0 480 150" style={{ width: "100%" }} fontFamily="IBM Plex Mono, monospace">
        <path d="M 90 130 A 150 150 0 0 1 390 130" fill="none" stroke="#eee7d8" strokeWidth="14" strokeLinecap="round" />
        <path d="M 240 130 A 150 150 0 0 1 390 130" fill="none" stroke="#1f7a4d" strokeWidth="14" strokeLinecap="round" opacity={0.35} />
        <path d="M 90 130 A 150 150 0 0 1 240 130" fill="none" stroke="#bb3b2c" strokeWidth="14" strokeLinecap="round" opacity={0.35} />
        <g transform={`rotate(${angle} 240 130)`}>
          <line x1="240" y1="130" x2="240" y2="38" stroke="#1b1813" strokeWidth="3" />
          <circle cx="240" cy="130" r="7" fill="#1b1813" />
        </g>
        <text x="96" y="148" fontSize="10" fill="#bb3b2c">not yet</text>
        <text x="384" y="148" textAnchor="end" fontSize="10" fill="#1f7a4d">in your favor</text>
      </svg>
      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div className="rounded-lg border border-line bg-white px-3 py-2 text-center">market <b>{market}¢</b></div>
        <div className="rounded-lg border border-line bg-white px-3 py-2 text-center">your belief <b>{belief}%</b></div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">Your belief</span>
        <input type="range" min={20} max={95} value={belief} onChange={(e) => setBelief(Number(e.target.value))} className="flex-1" />
      </div>
      <p className="mt-2 text-center font-mono text-[12px] font-semibold" style={{ color: favor ? "var(--green)" : against ? "var(--red)" : "var(--muted)" }}>
        {favor ? "✓ In your favor — buy YES" : against ? "✗ Not yet — the market looks rich" : "≈ Fair — about the market price"}
      </p>
    </Frame>
  );
}

function Frame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mt-2 font-disp text-[24px] font-semibold leading-tight tracking-[-0.4px]">{title}</h2>
      <p className="mt-2 text-[13px] leading-[1.65] text-muted">{sub}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}
