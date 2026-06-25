import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env for CLI invocations (drizzle-kit generate/migrate). In the app
// runtime the platform injects env vars directly.
config({ path: ".env" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Keep generated SQL stable and reviewable.
  verbose: true,
  strict: true,
});
