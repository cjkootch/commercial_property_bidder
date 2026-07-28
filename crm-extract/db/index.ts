// Lazy Neon HTTP (serverless) client.
//
// Two footguns this solves, both learned the hard way in the source app:
//
//  1. NO CONNECT AT IMPORT TIME. `next build` imports every route module during
//     its "collecting page data" step. If this module connected (or threw) on
//     import, the build would require DATABASE_URL — a runtime secret — to be
//     present at build time. The client is materialized on first query instead,
//     so a missing var throws at request time, where it belongs.
//
//  2. NO FETCH CACHING. The Neon HTTP driver issues queries via fetch(), which
//     Next.js would otherwise store in its Data Cache and serve stale — rows
//     written out-of-band (a cron, a webhook, psql) would not appear. `cache:
//     "no-store"` forces every query to be a live read.
//
// TRANSACTION CAVEAT: the HTTP driver has no interactive transactions. See
// PACKET.md → "Port notes" — either accept the source app's compensating
// patterns (unique indexes + onConflict + idempotency markers) or swap the
// import to drizzle-orm/neon-serverless (WebSocket Pool) and get db.transaction().

import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  _db = drizzle(neon(connectionString, { fetchOptions: { cache: "no-store" } }), {
    schema,
  });
  return _db;
}

// Proxy so callers can `import { db }` and use it like a normal Drizzle client;
// the real client is created on first property access (i.e. first query).
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
