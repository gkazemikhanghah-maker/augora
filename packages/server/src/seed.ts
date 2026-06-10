import type { Market, Side } from "@augora/core";
import { Store } from "./store.js";

/**
 * Seed sample markets of all THREE types (spec §2.10) and populate each book
 * with two-sided liquidity from a market-maker bot, so previews/fills work and
 * the depth chart + price history have data on day one.
 */

const MM = "mm-bot"; // market-maker, funded large
const DAY = 86_400_000;

function mkMarket(p: Partial<Market> & Pick<Market, "id" | "question" | "type" | "groupId">): Market {
  return {
    asset: undefined,
    strike: undefined,
    expiryTs: Date.now() + 30 * DAY,
    status: "open",
    feeMult: 0,
    tickSize: 1,
    createdTs: Date.now(),
    ...p,
  };
}

/** Quote a two-sided market around a fair YES price (in cents) with a spread.
 *  Posts a 5-level ladder on each side so the order book / depth have real depth. */
function quote(store: Store, marketId: string, fairYes: number, spreadC: number, qty: number): void {
  const eng = store.engine(marketId);
  store.ensureUser(MM);
  // a 5-level ladder ties up more collateral than a single quote; keep the MM funded
  if (store.ledger.bal(MM) < qty * 100 * 12) store.ledger.deposit(MM, qty * 100 * 30);
  const LEVELS = 5;
  const yesBid0 = Math.max(1, Math.round(fairYes - spreadC / 2));
  const noBid0 = Math.max(1, Math.round(100 - fairYes - spreadC / 2)); // YES ask = 100 - noBid
  for (let k = 0; k < LEVELS; k++) {
    const lvlQty = Math.round(qty * (1 + 0.5 * k)); // a little more size away from the touch
    const yb = yesBid0 - k;
    const nb = noBid0 - k;
    if (yb >= 1) eng.submit({ userId: MM, side: "YES", type: "limit", priceCents: yb, qty: lvlQty });
    if (nb >= 1) eng.submit({ userId: MM, side: "NO", type: "limit", priceCents: nb, qty: lvlQty });
  }
}

/** Build a short synthetic price history so the chart isn't empty. */
function seedHistory(store: Store, marketId: string, startC: number, endC: number, n = 24): void {
  const hist = store.priceHistory.get(marketId)!;
  const t0 = Date.now() - n * 3_600_000;
  for (let i = 0; i <= n; i++) {
    const base = startC + ((endC - startC) * i) / n;
    const noise = Math.sin(i * 1.3) * 1.5;
    hist.push({ ts: t0 + i * 3_600_000, midCents: Math.round(Math.min(99, Math.max(1, base + noise))) });
  }
}

export function seed(store: Store): void {
  store.ensureUser(MM);
  // give the MM extra room beyond the default playground balance
  store.ledger.deposit(MM, 9_000_000); // total ~$100k

  // 1) BINARY — the reference market
  const btc = mkMarket({
    id: "BTC-68K",
    question: "Will BTC be \u2265 $68,000 at expiry?",
    type: "binary",
    groupId: "BTC-68K",
    asset: "BTC",
    strike: 68000,
    feeMult: 0.07,
    expiryTs: Date.now() + 14 * DAY,
  });
  store.addMarket(btc);
  quote(store, btc.id, 60, 2, 400);
  seedHistory(store, btc.id, 52, 60);

  // 2) LADDER (dated) — "صلحِ ایران و آمریکا تا تاریخِ X". Cumulative: later date ≥
  //    earlier date. Prices must be monotone non-decreasing and NOT sum to 1.
  const ladderGroup = "IRAN-US-PEACE";
  const ladder: Array<{ id: string; label: string; short: string; days: number; fair: number }> = [
    { id: "PEACE-2026Q3", label: "by end of Q3 2026", short: "Q3 2026", days: 120, fair: 18 },
    { id: "PEACE-2026EOY", label: "by end of 2026", short: "end of 2026", days: 215, fair: 31 },
    { id: "PEACE-2027EOY", label: "by end of 2027", short: "end of 2027", days: 580, fair: 52 },
  ];
  for (const l of ladder) {
    const m = mkMarket({
      id: l.id,
      question: `Iran\u2013US peace deal ${l.label}?`,
      type: "ladder",
      groupId: ladderGroup,
      orderLabel: l.short,
      orderingType: "INTERVAL",
      representation: "CUMULATIVE",
      axisDirection: "INCREASING",
      taxonomyConfirmed: true,
      expiryTs: Date.now() + l.days * DAY,
    });
    store.addMarket(m);
    quote(store, m.id, l.fair, 3, 250);
    seedHistory(store, m.id, Math.max(1, l.fair - 6), l.fair);
  }

  // 3) CATEGORICAL (mutually exclusive) — "نامزدِ نهاییِ ۲۰۲۸". Σ YES ≈ 100¢.
  const elGroup = "NOMINEE-2028";
  const cands: Array<{ id: string; label: string; fair: number }> = [
    { id: "NOM-A", label: "Candidate A", fair: 38 },
    { id: "NOM-B", label: "Candidate B", fair: 31 },
    { id: "NOM-C", label: "Candidate C", fair: 19 },
    { id: "NOM-D", label: "Candidate D", fair: 12 },
  ];
  for (const c of cands) {
    const m = mkMarket({
      id: c.id,
      question: `2028 nominee: ${c.label}?`,
      type: "categorical",
      groupId: elGroup,
      orderingType: "NOMINAL",
      taxonomyConfirmed: true,
      expiryTs: Date.now() + 365 * DAY,
    });
    store.addMarket(m);
    quote(store, m.id, c.fair, 2, 300);
    seedHistory(store, m.id, Math.max(1, c.fair - 4), c.fair);
  }
}

export const SEED_BOT = MM;
