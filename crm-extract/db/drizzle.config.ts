// drizzle-kit config. Copy to the new project ROOT as drizzle.config.ts and fix
// the two paths (they are relative to wherever the config lives).
//
//   npm run db:generate   → writes SQL into ./drizzle
//   npm run db:migrate    → applies pending migrations
//
// Migrations are FILES, checked into git, applied in order — not `db push`. The
// source app ran 62 sequential migrations against a live database this way; the
// discipline is what let it add columns to a running system without drama.

import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Never inline a connection string — this reads the env var by name only.
    url: process.env.DATABASE_URL!,
  },
  // Fail loudly rather than silently dropping a column that drizzle-kit can't
  // reconcile; review every generated migration before applying it.
  strict: true,
  verbose: true,
} satisfies Config;
