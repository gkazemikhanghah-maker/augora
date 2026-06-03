"use client";
import { useRouter } from "next/navigation";
import { centsPrice, type MarketView } from "@/lib/api";
import { outcomeLabel } from "@/components/OutcomeLadder";

/** Polymarket-style outcome rows: label + vol, big %, Buy Yes/No per row. */
export function OutcomeRows({ siblings, currentId }: { siblings: MarketView[]; currentId: string }) {
  const router = useRouter();
  const type = siblings[0]?.type;
  const sorted = [...siblings].sort((a, b) =>
    type === "ladder" ? a.expiryTs - b.expiryTs : (b.priceCents ?? 0) - (a.priceCents ?? 0),
  );
  const go = (id: string, side?: "YES" | "NO") => router.push(`/market?id=${id}${side ? `&side=${side}` : ""}`);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card shadow-soft">
      {sorted.map((m, i) => {
        const yes = m.priceCents ?? 0;
        const active = m.id === currentId;
        return (
          <div key={m.id} className={`flex items-center gap-4 px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""} ${active ? "bg-bg" : "hover:bg-bg/60"}`}>
            <button onClick={() => go(m.id)} className="min-w-0 flex-1 text-left">
              <div className={`truncate text-[14px] ${active ? "font-semibold" : "font-medium"}`}>{outcomeLabel(m)}</div>
            </button>
            <div className="font-mono text-[20px] font-extrabold tabular-nums">{yes}%</div>
            <div className="flex gap-2">
              <button onClick={() => go(m.id, "YES")} className="rounded-md bg-green-soft px-3.5 py-2 text-[12.5px] font-semibold text-green hover:brightness-95">Yes {centsPrice(yes / 100)}</button>
              <button onClick={() => go(m.id, "NO")} className="rounded-md bg-red-soft px-3.5 py-2 text-[12.5px] font-semibold text-red hover:brightness-95">No {centsPrice((100 - yes) / 100)}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
