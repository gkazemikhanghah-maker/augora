/**
 * Thin proxy over Polymarket's public Gamma API with a short in-memory cache.
 * Keeps us off rate limits, solves CORS (frontend hits OUR server), and lets us
 * normalize Polymarket's shape into something the UI understands.
 *
 * NOTE: field names below follow Polymarket's documented Gamma shape. If the live
 * JSON differs, adjust `normalize()` — that's the only place that needs changing.
 */

const GAMMA = "https://gamma-api.polymarket.com";
const TTL_MS = 10_000;

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();

async function cachedGet(url: string): Promise<unknown> {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.data;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Polymarket ${res.status} for ${url}`);
  const data = await res.json();
  cache.set(url, { at: now, data });
  return data;
}

export interface LiveOutcome {
  label: string;
  priceCents: number | null;
}
export interface LiveMarket {
  id: string;
  slug: string;
  question: string;
  category: string;
  outcomes: LiveOutcome[];
  volume: number | null;
  volume24hr: number | null;
  liquidity: number | null;
  endDate: string | null;
  closed: boolean;
  /** "YES" | "NO" once Polymarket has resolved it, else null. */
  resolvedOutcome: "YES" | "NO" | null;
  oneDayChange: number | null;
  bestBidCents: number | null;
  bestAskCents: number | null;
  image: string | null;
  source: "polymarket";
}

/* Polymarket sometimes returns numbers as strings and arrays as JSON strings. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}
function parseMaybeJson<T>(v: unknown, fallback: T): T {
  if (Array.isArray(v)) return v as T;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Extract a numeric ordering key from an outcome label so ordered/ranged groups
 * (price buckets like "$50k", by-date thresholds like "December 31") can be
 * sorted and plotted on a value axis. Returns null for unordered labels
 * (candidate names, teams, etc.). Dates win over bare numbers so "December 31"
 * isn't read as the number 31. `yearHint` fills a missing year (e.g. the
 * market's resolution year) so "December 31" lands in the right year.
 */
export function parseOrderKey(
  raw: string,
  yearHint?: number,
): { value: number; kind: "number" | "date"; axisLabel: string } | null {
  const s = String(raw).trim();
  const hasMonth = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s);

  if (!hasMonth) {
    // money / count: $50k, 50,000, 1.2M, 70K, 100, <50000
    const m = s.match(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|m|bn|b)?/i);
    if (m) {
      let v = parseFloat(m[1]!.replace(/,/g, ""));
      const suf = (m[2] || "").toLowerCase();
      if (suf === "k") v *= 1e3;
      else if (suf === "m") v *= 1e6;
      else if (suf === "b" || suf === "bn") v *= 1e9;
      if (Number.isFinite(v)) {
        const lt = /<|under|below|fewer|less/i.test(s);
        const gt = />|over|above|more|\+|at least/i.test(s);
        // nudge open-ended buckets so "<$50k" sorts before "$50k–$60k" and "$70k+" after
        const value = lt ? v - 1 : gt ? v + 1 : v;
        const axis = lt ? `<${compact(v)}` : gt ? `${compact(v)}+` : compact(v);
        return { value, kind: "number", axisLabel: axis };
      }
    }
    return null;
  }

  // date: month name (+ optional day) (+ optional year)
  const dm = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})?(?:[,\s]+(\d{4}))?/i);
  if (dm) {
    const mon = MONTHS[dm[1]!.toLowerCase().slice(0, 3)]!;
    const day = dm[2] ? parseInt(dm[2], 10) : 1;
    const year = dm[3] ? parseInt(dm[3], 10) : yearHint ?? new Date().getUTCFullYear();
    const value = Date.UTC(year, mon, day);
    if (Number.isFinite(value)) {
      const axisLabel = new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return { value, kind: "date", axisLabel };
    }
  }
  return null;
}

function compact(v: number): string {
  if (v >= 1e9) return `$${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${+(v / 1e3).toFixed(0)}k`;
  return `${v}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(m: any): LiveMarket {
  const names = parseMaybeJson<string[]>(m.outcomes, []);
  const prices = parseMaybeJson<string[]>(m.outcomePrices, []);
  const outcomes: LiveOutcome[] = names.map((label, i) => {
    const p = num(prices[i]);
    return { label, priceCents: p == null ? null : Math.round(p * 100) };
  });

  // when Polymarket resolves a market, it's closed and the winning outcome's
  // price snaps to ~1 (the other to ~0). We read YES (first outcome) accordingly.
  const closed = Boolean(m.closed);
  let resolvedOutcome: "YES" | "NO" | null = null;
  if (closed && outcomes.length >= 2) {
    const yesP = outcomes[0]!.priceCents;
    if (yesP != null && yesP >= 99) resolvedOutcome = "YES";
    else if (yesP != null && yesP <= 1) resolvedOutcome = "NO";
  }

  return {
    id: String(m.id ?? m.conditionId ?? m.slug ?? ""),
    slug: String(m.slug ?? ""),
    question: String(m.question ?? m.title ?? "Untitled market"),
    category: String((Array.isArray(m.events) && m.events[0]?.title) ?? m.category ?? "Other"),
    outcomes,
    volume: num(m.volumeNum ?? m.volume),
    volume24hr: num(m.volume24hr),
    liquidity: num(m.liquidityNum ?? m.liquidity),
    endDate: m.endDateIso ?? m.endDate ?? null,
    closed,
    resolvedOutcome,
    oneDayChange: num(m.oneDayPriceChange),
    bestBidCents: m.bestBid != null ? Math.round(num(m.bestBid)! * 100) : null,
    bestAskCents: m.bestAsk != null ? Math.round(num(m.bestAsk)! * 100) : null,
    image: m.image ?? m.icon ?? null,
    source: "polymarket",
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A Polymarket *event* groups several related markets (e.g. one market per
 * candidate). `negRisk: true` means the options are mutually exclusive — exactly
 * one resolves YES — which maps to our `categorical` type. Otherwise the inner
 * markets are independent yes/no questions that merely share an event page.
 */
export interface LiveEvent {
  id: string;
  slug: string;
  title: string;
  category: string;
  /** mutually-exclusive (one winner). null when Polymarket didn't say. */
  negRisk: boolean | null;
  volume: number | null;
  liquidity: number | null;
  endDate: string | null;
  closed: boolean;
  image: string | null;
  markets: LiveMarket[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Normalize a Gamma `/events` item. THIS is the only place to adjust if the live
 * JSON shape differs from what we assumed. Each inner market is run through the
 * existing `normalize()`; we also lift `groupItemTitle` onto the market's
 * question-derived label by stashing it where the importer can read it.
 */
function normalizeEvent(e: any): LiveEvent {
  const rawMarkets: any[] = Array.isArray(e.markets) ? e.markets : [];
  const markets = rawMarkets.map((m) => {
    const lm = normalize(m);
    // groupItemTitle is Polymarket's short per-option label ("Donald Trump").
    // Carry it on `question` is wrong; expose it via a side channel the importer reads.
    (lm as LiveMarket & { groupLabel?: string }).groupLabel =
      (typeof m.groupItemTitle === "string" && m.groupItemTitle.trim()) || lm.question;
    return lm;
  });
  return {
    id: String(e.id ?? e.slug ?? ""),
    slug: String(e.slug ?? ""),
    title: String(e.title ?? e.question ?? "Untitled event"),
    category: String(e.category ?? (Array.isArray(e.tags) && e.tags[0]?.label) ?? "Live"),
    negRisk: typeof e.negRisk === "boolean" ? e.negRisk : null,
    volume: num(e.volume ?? e.volumeNum),
    liquidity: num(e.liquidity ?? e.liquidityNum),
    endDate: e.endDate ?? e.endDateIso ?? null,
    closed: Boolean(e.closed),
    image: e.image ?? e.icon ?? null,
    markets: markets.filter((m) => m.outcomes.length > 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Per-option short label carried alongside a LiveMarket inside an event. */
export function liveGroupLabel(m: LiveMarket): string {
  const x = m as LiveMarket & { groupLabel?: string; groupItemTitle?: string };
  return x.groupLabel ?? x.groupItemTitle ?? m.question;
}

/** List active multi-outcome events, most liquid first. */
export async function listLiveEvents(limit = 20): Promise<LiveEvent[]> {
  const url = `${GAMMA}/events?closed=false&active=true&limit=${limit}&order=volume&ascending=false`;
  const data = (await cachedGet(url)) as unknown;
  const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
  return (arr as unknown[]).map(normalizeEvent).filter((e) => e.markets.length > 0);
}

/** Fetch a single event by id or slug, with fallbacks mirroring getLiveMarket. */
export async function getLiveEvent(idOrSlug: string): Promise<LiveEvent | null> {
  try {
    const data = await cachedGet(`${GAMMA}/events/${encodeURIComponent(idOrSlug)}`);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const ev = normalizeEvent(data);
      if (ev.markets.length) return ev;
    }
  } catch {
    /* fall through */
  }
  try {
    const data = (await cachedGet(`${GAMMA}/events?slug=${encodeURIComponent(idOrSlug)}`)) as unknown;
    const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
    if ((arr as unknown[])[0]) return normalizeEvent((arr as unknown[])[0]);
  } catch {
    /* fall through */
  }
  try {
    const all = await listLiveEvents(100);
    return all.find((e) => e.id === idOrSlug || e.slug === idOrSlug) ?? null;
  } catch {
    return null;
  }
}

/** List active markets, most liquid first. */
export async function listLiveMarkets(limit = 24): Promise<LiveMarket[]> {
  // active + not closed, ordered by liquidity desc
  const url = `${GAMMA}/markets?closed=false&active=true&limit=${limit}&order=liquidity&ascending=false`;
  const data = (await cachedGet(url)) as unknown;
  const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
  return (arr as unknown[]).map(normalize).filter((m) => m.outcomes.length > 0);
}

/** Fetch a single market by Polymarket id or slug, with robust fallbacks. */
export async function getLiveMarket(idOrSlug: string): Promise<LiveMarket | null> {
  // 1) try the by-id endpoint
  try {
    const data = await cachedGet(`${GAMMA}/markets/${encodeURIComponent(idOrSlug)}`);
    if (data && typeof data === "object" && !Array.isArray(data)) return normalize(data);
  } catch {
    /* fall through */
  }
  // 2) try query by id
  try {
    const data = (await cachedGet(`${GAMMA}/markets?id=${encodeURIComponent(idOrSlug)}`)) as unknown;
    const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
    if ((arr as unknown[])[0]) return normalize((arr as unknown[])[0]);
  } catch {
    /* fall through */
  }
  // 3) try query by slug
  try {
    const data = (await cachedGet(`${GAMMA}/markets?slug=${encodeURIComponent(idOrSlug)}`)) as unknown;
    const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] }).data ?? []);
    if ((arr as unknown[])[0]) return normalize((arr as unknown[])[0]);
  } catch {
    /* fall through */
  }
  // 4) last resort: scan the active list for a matching id/slug
  try {
    const all = await listLiveMarkets(100);
    return all.find((m) => m.id === idOrSlug || m.slug === idOrSlug) ?? null;
  } catch {
    return null;
  }
}
