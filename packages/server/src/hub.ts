import type { WebSocket } from "ws";
import { Store } from "./store.js";

/** Per-market pub/sub hub for the WS stream (spec §6: WS /markets/:id/stream). */
export class Hub {
  private subs = new Map<string, Set<WebSocket>>();

  constructor(private store: Store) {}

  subscribe(marketId: string, ws: WebSocket): void {
    let set = this.subs.get(marketId);
    if (!set) this.subs.set(marketId, (set = new Set()));
    set.add(ws);
  }

  unsubscribe(marketId: string, ws: WebSocket): void {
    this.subs.get(marketId)?.delete(ws);
  }

  snapshot(marketId: string): object {
    const eng = this.store.engine(marketId);
    return {
      type: "snapshot",
      marketId,
      orderbook: eng.orderbook(),
      priceCents: this.store.lastPriceCents(marketId),
      trades: this.store.tradesForMarket(marketId, 20),
    };
  }

  broadcast(marketId: string): void {
    const set = this.subs.get(marketId);
    if (!set || set.size === 0) return;
    const msg = JSON.stringify(this.snapshot(marketId));
    for (const ws of set) {
      try {
        ws.send(msg);
      } catch {
        set.delete(ws);
      }
    }
  }
}
