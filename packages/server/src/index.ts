import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Store } from "./store.js";
import { Hub } from "./hub.js";
import { seed } from "./seed.js";
import { registerRoutes } from "./routes.js";
import { Persistence, debounce } from "./persistence.js";
import { syncLiveSettlements, syncLivePrices } from "./liveimport.js";

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.AUGORA_DB ?? "augora.db";

async function main() {
  const store = new Store();
  const persistence = new Persistence(DB_PATH);

  // load prior state if present, otherwise seed fresh
  const prior = persistence.load<ReturnType<Store["snapshot"]>>();
  if (prior) {
    store.restore(prior);
  } else {
    seed(store);
    persistence.save(store.snapshot());
  }

  // debounced write-through: persist shortly after any mutation
  const save = debounce(() => persistence.save(store.snapshot()), 250);
  const hub = new Hub(store);

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: true });
  await app.register(websocket);
  await app.register(async (instance) => registerRoutes(instance, store, hub, save));

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(
    `Augora API on http://localhost:${PORT} — ${store.markets.size} markets ${prior ? "restored from" : "seeded, persisting to"} ${DB_PATH}`,
  );

  // refresh imported live-market prices from Polymarket every 30s
  setInterval(async () => {
    try {
      const moved = await syncLivePrices(store);
      if (moved.length) {
        for (const id of moved) hub.broadcast(id);
        save();
      }
    } catch {
      /* ignore — retry next tick */
    }
  }, 30_000);

  // periodically settle any imported live markets that Polymarket has resolved
  setInterval(async () => {
    try {
      const ids = await syncLiveSettlements(store);
      if (ids.length) {
        for (const id of ids) hub.broadcast(id);
        save();
        app.log.info(`auto-settled live markets: ${ids.join(", ")}`);
      }
    } catch {
      /* ignore — retry next tick */
    }
  }, 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
