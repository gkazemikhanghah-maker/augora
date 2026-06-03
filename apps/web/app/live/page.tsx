"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type LiveMarket, type LiveEvent } from "@/lib/api";

export default function LivePage() {
  const [markets, setMarkets] = useState<LiveMarket[] | null>(null);
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const router = useRouter();

  async function openMarket(m: LiveMarket) {
    setImporting(m.id);
    try {
      const { marketId } = await api.importLive(m.id, m);
      router.push(`/market?id=${encodeURIComponent(marketId)}`);
    } catch (e) {
      setErr((e as Error).message);
      setImporting(null);
    }
  }

  async function openEvent(e: LiveEvent) {
    setImporting(e.id);
    try {
      const res = await api.importLiveEvent(e.id, e);
      const dest = res.primaryId ?? res.marketIds[0];
      if (dest) router.push(`/market?id=${encodeURIComponent(dest)}`);
    } catch (err) {
      setErr((err as Error).message);
      setImporting(null);
    }
  }

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.liveMarkets().then((m) => alive && setMarkets(m)).catch((e) => alive && setErr((e as Error).message));
      api.liveEvents().then((e) => alive && setEvents(e)).catch(() => { /* events are optional; ignore */ });
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const fmtVol = (v: number | null) => (v == null || v <= 0 ? null : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`);

  return (
    <div className="pt-8">
      <div className="flex items-center gap-2">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Live</h1>
        <span className="rounded bg-green-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green">Polymarket</span>
      </div>
      <p className="mt-1 max-w-[620px] text-[13.5px] text-muted">
        Real markets and prices from Polymarket, refreshing every 10 seconds. Import any of them to paper-trade with
        virtual money on your own ledger. Multi-outcome events import as a single grouped market.
      </p>

      {err && (
        <div className="mt-6 rounded-xl border border-line bg-card p-6 text-[13px] text-muted">
          Couldn’t load live data: <span className="font-mono text-red">{err}</span>
          <div className="mt-2 text-[12px]">Make sure the backend is running and can reach the internet.</div>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="mt-7">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[15px] font-bold tracking-[-0.01em]">Multi-outcome events</h2>
            <span className="text-[11.5px] text-muted">import as a group</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {events.map((ev) => {
              const top = [...ev.markets]
                .sort((a, b) => (b.outcomes[0]?.priceCents ?? 0) - (a.outcomes[0]?.priceCents ?? 0))
                .slice(0, 4);
              const vol = fmtVol(ev.volume);
              return (
                <button key={ev.id} onClick={() => openEvent(ev)} disabled={importing === ev.id}
                  className="flex flex-col rounded-xl border border-line bg-card p-4 text-left shadow-soft transition hover:shadow-pop disabled:opacity-60">
                  <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium text-muted">
                    <span className="rounded bg-[#eef3fb] px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[#3b6fb0]">
                      {ev.negRisk ? "Categorical" : "Multi"}
                    </span>
                    <span className="text-muted">{ev.markets.length} options</span>
                    {vol && <span className="ml-auto">{vol} Vol</span>}
                  </div>
                  <div className="mb-3 flex gap-2.5">
                    {ev.image && <img src={ev.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />}
                    <div className="text-[14.5px] font-bold leading-snug tracking-[-0.01em] line-clamp-3">{ev.title}</div>
                  </div>
                  <div className="flex flex-1 flex-col justify-end gap-1.5">
                    {top.map((mk, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
                          {((mk as { groupLabel?: string }).groupLabel) ?? mk.question}
                        </span>
                        <span className="font-mono text-[14px] font-bold tabular-nums">
                          {mk.outcomes[0]?.priceCents == null ? "—" : `${mk.outcomes[0]!.priceCents}%`}
                        </span>
                      </div>
                    ))}
                    {ev.markets.length > top.length && (
                      <span className="text-[11px] text-muted">+{ev.markets.length - top.length} more</span>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center justify-end border-t border-line pt-2">
                    <span className="text-[11px] font-semibold text-green">{importing === ev.id ? "Importing…" : "Paper-trade group →"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!markets && !err && <div className="mt-10 text-center text-[13px] text-muted">Loading live markets…</div>}

      {markets && (
        <>
          {events && events.length > 0 && (
            <h2 className="mt-8 text-[15px] font-bold tracking-[-0.01em]">Single markets</h2>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search live markets…"
            className="mt-3 w-full max-w-[280px] rounded-full border border-line bg-card px-4 py-2 text-[13px] outline-none placeholder:text-muted focus:border-line-strong" />
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {markets
              .filter((m) => !q || m.question.toLowerCase().includes(q.toLowerCase()))
              .map((m) => {
                const top = [...m.outcomes].sort((a, b) => (b.priceCents ?? 0) - (a.priceCents ?? 0)).slice(0, 4);
                const vol = fmtVol(m.volume);
                const chg = m.oneDayChange;
                return (
                  <button key={m.id} onClick={() => openMarket(m)} disabled={importing === m.id}
                    className="flex flex-col rounded-xl border border-line bg-card p-4 text-left shadow-soft transition hover:shadow-pop disabled:opacity-60">
                    <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium text-muted">
                      <span className="flex items-center gap-1 rounded bg-green-soft px-1.5 py-0.5 font-semibold uppercase tracking-wide text-green">
                        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-green" />Live
                      </span>
                      {vol && <span className="ml-auto">{vol} Vol</span>}
                    </div>
                    <div className="mb-3 flex gap-2.5">
                      {m.image && <img src={m.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />}
                      <div className="text-[14.5px] font-bold leading-snug tracking-[-0.01em] line-clamp-3">{m.question}</div>
                    </div>
                    <div className="flex flex-1 flex-col justify-end gap-1.5">
                      {top.map((o, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{o.label}</span>
                          <span className="font-mono text-[14px] font-bold tabular-nums">{o.priceCents == null ? "—" : `${o.priceCents}%`}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2">
                      {chg != null && Math.abs(chg) >= 0.01 ? (
                        <span className="text-[11px] font-semibold" style={{ color: chg >= 0 ? "var(--green)" : "var(--red)" }}>
                          {chg >= 0 ? "▲" : "▼"} {Math.abs(chg * 100).toFixed(0)}% today
                        </span>
                      ) : <span />}
                      <span className="text-[11px] font-semibold text-green">{importing === m.id ? "Opening…" : "Paper-trade →"}</span>
                    </div>
                  </button>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
