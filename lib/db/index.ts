import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// Lazy Neon HTTP (serverless) client. We must NOT connect — or throw — at
// import time: `next build` imports every route module during its
// "collecting page data" step, and that must not require DATABASE_URL (a
// runtime secret). The connection is created on first query instead, so the
// throw only happens at request time if the var is genuinely missing.
let _db: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  }
  // no-store: the Neon driver issues queries via fetch(), which Next.js would
  // otherwise cache in its Data Cache — serving stale reads (e.g. rows inserted
  // out-of-band wouldn't appear). Force every query to be a live read.
  _db = drizzle(neon(connectionString, { fetchOptions: { cache: "no-store" } }), {
    schema,
  });
  return _db;
}

// Proxy so callers can `import { db }` and use it like a normal Drizzle client;
// the real client is materialized on first property access (i.e. first query).
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
