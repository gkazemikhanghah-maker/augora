// Suppress the harmless "SQLite is experimental" warning before node:sqlite loads.
const _emit = process.emit;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(process as any).emit = function (name: string, data: any, ...rest: any[]) {
  if (name === "warning" && data && data.name === "ExperimentalWarning" && /SQLite/i.test(String(data.message))) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (_emit as any).call(process, name, data, ...rest);
};

import { DatabaseSync } from "node:sqlite";

/**
 * Tiny persistence layer: stores the whole app snapshot as JSON in one SQLite
 * row. No native build needed (node:sqlite is built into Node). Good enough for
 * the in-memory MVP — survives restarts without a real database server.
 */
export class Persistence {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  load<T>(): T | null {
    const row = this.db.prepare("SELECT v FROM kv WHERE k = ?").get("state") as { v: string } | undefined;
    return row ? (JSON.parse(row.v) as T) : null;
  }

  save(snapshot: unknown): void {
    this.db
      .prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
      .run("state", JSON.stringify(snapshot));
  }

  close(): void {
    this.db.close();
  }
}

/** Debounce helper so we persist at most once per `ms` after a burst of writes. */
export function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}
