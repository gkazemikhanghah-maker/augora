"use client";
import { useState } from "react";
import { api, type MarketView } from "@/lib/api";

type Kind = "cumulative" | "atomic" | "nominal";

/** Asks a human to confirm an imported market's spread taxonomy before any
 *  corridor / credit-spread product is enabled (addendum v1.1 §6 safety gate).
 *  The auto-detected suggestion is pre-highlighted but can be overridden. */
export function TaxonomyConfirm({ group, onConfirmed }: { group: MarketView[]; onConfirmed: () => void }) {
  const head = group[0];
  const groupId = head?.groupId ?? "";
  const suggested: Kind = head?.representation === "CUMULATIVE" ? "cumulative" : head?.representation === "ATOMIC" ? "atomic" : "nominal";
  const [busy, setBusy] = useState<Kind | null>(null);

  async function confirm(kind: Kind) {
    setBusy(kind);
    try {
      await api.confirmTaxonomy(
        groupId,
        kind === "cumulative"
          ? { orderingType: "INTERVAL", representation: "CUMULATIVE", axisDirection: head?.axisDirection ?? "INCREASING" }
          : kind === "atomic"
          ? { orderingType: "INTERVAL", representation: "ATOMIC" }
          : { orderingType: "NOMINAL" },
      );
      onConfirmed();
    } catch {
      setBusy(null);
    }
  }

  const Btn = ({ k, label, desc }: { k: Kind; label: string; desc: string }) => (
    <button onClick={() => confirm(k)} disabled={!!busy}
      className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-50 ${suggested === k ? "border-ink bg-[#fffdf7]" : "border-line bg-white hover:border-ink"}`}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        {label}
        {suggested === k && <span className="rounded bg-ink/10 px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-muted">suggested</span>}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{desc}</div>
    </button>
  );

  return (
    <div className="mb-4 rounded-2xl border border-line bg-[#fbf6ee] p-4">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-semibold">Confirm this market's structure</div>
        {head?.taxonomyConfidence && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
            style={{
              background: head.taxonomyConfidence === "HIGH" ? "var(--green-soft)" : head.taxonomyConfidence === "LOW" ? "var(--red-soft)" : "#fbf2e3",
              color: head.taxonomyConfidence === "HIGH" ? "var(--green)" : head.taxonomyConfidence === "LOW" ? "var(--red)" : "var(--amber)",
            }}
          >
            {head.taxonomyConfidence} confidence
          </span>
        )}
      </div>
      <div className="mt-1 text-[11.5px] leading-[1.5] text-muted">
        Imported markets get a quick human check before corridor / credit-spread products turn on — auto-detection isn't always right.
        {head?.representation && (
          <> Detected:{" "}
            <span className="font-semibold text-ink">{head.representation === "CUMULATIVE" ? "cumulative ladder" : "distinct buckets"}</span>
            {head.taxonomyConfidence === "LOW" && <span className="text-red"> — low confidence, please double-check</span>}.
          </>
        )}
      </div>

      {/* the "why" — the cues behind the guess, so a human can validate it */}
      {head?.taxonomySignals?.length ? (
        <div className="mt-3 rounded-xl border border-line bg-white/60 p-2.5">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Why this guess</div>
          <div className="flex flex-col gap-1">
            {head.taxonomySignals.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="text-muted"><span className="font-medium text-ink">{s.label}:</span> {s.detail}</span>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
                  style={{
                    background: s.toward === "CUMULATIVE" ? "var(--green-soft)" : s.toward === "ATOMIC" ? "#eef3fb" : "transparent",
                    color: s.toward === "CUMULATIVE" ? "var(--green)" : s.toward === "ATOMIC" ? "#3b6fb0" : "var(--muted)",
                  }}
                >
                  {s.toward === "CUMULATIVE" ? "ladder" : s.toward === "ATOMIC" ? "buckets" : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Btn k="cumulative" label="Cumulative ladder" desc="Nested thresholds — by date, ≥ level. Enables corridors & credit spreads." />
        <Btn k="atomic" label="Distinct buckets" desc="Mutually-exclusive ranges (2–3, 50–60). Back adjacent buckets." />
        <Btn k="nominal" label="Unordered" desc="No natural order — basket & relative only." />
      </div>
    </div>
  );
}
