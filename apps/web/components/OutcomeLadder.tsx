"use client";
import { useRouter } from "next/navigation";
import { centsPrice, type MarketView } from "@/lib/api";

/** Short outcome label derived from the question (works with the seeded markets). */
export function outcomeLabel(m: MarketView): string {
  // imported/live markets carry an explicit label; prefer it over string parsing
  if (m.optionLabel) return m.optionLabel;
  if (m.type === "categorical") return m.question.split(": ").pop()?.replace("?", "") ?? m.question;
  if (m.type === "ladder") return m.question.replace(/^.*deal /, "").replace("?", "");
  return m.question;
}

/** All markets in a group, shown together (Kalshi-style threshold list). Clicking a
 *  row switches the selected market; Yes/No pre-selects a side in the buy-box. */
export function OutcomeLadder({ siblings, currentId }: { siblings: MarketView[]; currentId: string }) {
  const router = useRouter();
  const type = siblings[0]?.type;
  const sorted = [...siblings].sort((a, b) =>
    type === "ladder" ? a.expiryTs - b.expiryTs : (b.priceCents ?? 0) - (a.priceCents ?? 0),
  );
  const sumYes = siblings.reduce((s, m) => s + (m.priceCents ?? 0), 0);
  const go = (id: string, side?: "YES" | "NO") =>
    router.push(`/market?id=${id}${side ? `&side=${side}` : ""}`);

  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          {type === "ladder" ? "Thresholds" : "Outcomes"}
        </span>
        {type === "categorical" && (
          <span className="font-mono text-[10.5px] text-muted">
            Σ YES {sumYes}¢ {Math.abs(sumYes - 100) <= 2 ? "✓" : ""}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {sorted.map((m) => {
          const active = m.id === currentId;
          const yes = m.priceCents ?? 0;
          return (
            <div
              key={m.id}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 transition ${active ? "border border-line bg-[#fffefb]" : "border border-transparent hover:bg-[#fffefb]"}`}
            >
              <button onClick={() => go(m.id)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13px]">{outcomeLabel(m)}</div>
                <div className="mt-[5px] h-[5px] overflow-hidden rounded bg-[#eee7d8]">
                  <div className="h-full rounded" style={{ width: `${yes}%`, background: "rgba(31,122,77,0.45)" }} />
                </div>
              </button>
              <span className="w-12 text-right font-mono text-[13px] font-semibold">{centsPrice(yes / 100)}</span>
              <div className="flex gap-1">
                <button onClick={() => go(m.id, "YES")} className="rounded-md border border-[#cfe6d6] bg-[#f0f6f1] px-[9px] py-1 font-mono text-[11px] text-green">Yes</button>
                <button onClick={() => go(m.id, "NO")} className="rounded-md border border-[#eed6d0] bg-[#fbf0ee] px-[9px] py-1 font-mono text-[11px] text-red">No</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
