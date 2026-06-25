import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

// Neon HTTP driver over the pooled connection string (build spec section 3).
// HTTP fetch model is serverless-friendly: no long-lived connections, which
// matches the Vercel deploy target.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
export { schema };
