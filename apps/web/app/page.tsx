"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, timeToExpiry, type MarketView } from "@/lib/api";
import { Sparkline } from "@/components/Sparkline";
import { outcomeLabel } from "@/components/OutcomeLadder";

const CATS = ["All", "Crypto", "Geopolitics", "Politics"];

export default function MarketsPage() {
  const [markets, setMarkets] = useState<MarketView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const router = useRouter();

  useEffect(() => {
    api.markets().then(setMarkets).catch((e) => setErr((e as Error).message));
  }, []);

  const groups = useMemo(() => {
    if (!markets) return [] as MarketView[][];
    const ql = q.trim().toLowerCase();
    const filtered = markets.filter(
      (m) =>
        (cat === "All" || m.category === cat) &&
        (!ql || m.question.toLowerCase().includes(ql) || m.category.toLowerCase().includes(ql)),
    );
    const byGroup = new Map<string, MarketView[]>();
    for (const m of filtered) {
      const g = byGroup.get(m.groupId) ?? [];
      g.push(m);
      byGroup.set(m.groupId, g);
    }
    return [...byGroup.values()];
  }, [markets, q, cat]);

  if (err)
    return <Note>Can’t reach the API ({err}). Start the backend with <code>npm run dev</code> on port 4000.</Note>;
  if (!markets) return <Note>Loading…</Note>;

  const go = (id: string, side?: "YES" | "NO") => router.push(`/market?id=${id}${side ? `&side=${side}` : ""}`);

  return (
    <div className="pt-8">
      <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">Markets</h1>
      <p className="mt-1 max-w-[600px] text-[13.5px] text-muted">
        Trade on yes/no outcomes. Each contract pays $1 if it resolves true — the price is the implied probability.
      </p>

      {/* controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="flex gap-1">
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${cat === c ? "bg-ink text-white" : "text-muted hover:bg-card hover:text-ink"}`}>
              {c}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets…"
          className="ml-auto w-full max-w-[260px] rounded-full border border-line bg-card px-4 py-2 text-[13px] outline-none placeholder:text-muted focus:border-line-strong" />
      </div>

      {/* card grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          const head = group[0]!;
          const multi = group.length > 1;
          const title = head.groupTitle ?? (head.groupId === "NOMINEE-2028" ? "2028 Nominee" : head.groupId === "IRAN-US-PEACE" ? "US × Iran peace deal" : head.question);
          const sorted = [...group].sort((a, b) => (head.type === "ladder" ? a.expiryTs - b.expiryTs : (b.priceCents ?? 0) - (a.priceCents ?? 0)));
          return (
            <div key={head.groupId} className="flex flex-col rounded-xl border border-line bg-card p-4 shadow-soft transition hover:shadow-pop">
              <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <span className="rounded bg-bg px-1.5 py-0.5">{head.category}</span>
                {multi && <span>{group.length} markets</span>}
                <span className="ml-auto normal-case">{timeToExpiry(head.secondsToExpiry)}</span>
              </div>

              <button onClick={() => go(head.id)} className="mb-3 text-left text-[16px] font-bold leading-snug tracking-[-0.01em] hover:text-green">
                {title}
              </button>

              {multi ? (
                <div className="flex flex-1 flex-col gap-2">
                  {sorted.slice(0, 4).map((m) => {
                    const yes = m.priceCents ?? 0;
                    return (
                      <div key={m.id} className="flex items-center gap-2">
                        <button onClick={() => go(m.id)} className="min-w-0 flex-1 truncate text-left text-[13px] text-muted hover:text-ink">{outcomeLabel(m)}</button>
                        <span className="w-9 text-right text-[14px] font-bold">{yes}%</span>
                        <button onClick={() => go(m.id, "YES")} className="rounded-md bg-green-soft px-2.5 py-1 text-[12px] font-semibold text-green hover:brightness-95">Yes</button>
                        <button onClick={() => go(m.id, "NO")} className="rounded-md bg-red-soft px-2.5 py-1 text-[12px] font-semibold text-red hover:brightness-95">No</button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-1 items-end justify-between gap-3">
                  <div>
                    <div className="font-mono text-[30px] font-extrabold leading-none tracking-[-0.03em]">{head.priceCents ?? "—"}<span className="text-[15px]">%</span></div>
                    <div className="mt-2.5 flex gap-2">
                      <button onClick={() => go(head.id, "YES")} className="rounded-md bg-green-soft px-4 py-1.5 text-[13px] font-semibold text-green hover:brightness-95">Buy Yes</button>
                      <button onClick={() => go(head.id, "NO")} className="rounded-md bg-red-soft px-4 py-1.5 text-[13px] font-semibold text-red hover:brightness-95">Buy No</button>
                    </div>
                  </div>
                  <Sparkline data={head.spark} w={104} h={40} />
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <Note>No markets match “{q}”.</Note>}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="mt-12 rounded-xl border border-line bg-card p-8 text-center text-[13.5px] text-muted">{children}</div>;
}
