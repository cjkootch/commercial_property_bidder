import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../lib/db/schema";

// One-off: clear placeholder public phone/email from the company record so the
// marketing footer stops showing seed defaults. Safe + reversible (sets null).
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const db = drizzle(neon(url), { schema });

async function main() {
  const before = await db.select().from(schema.company);
  for (const co of before) {
    console.log(`Company ${co.id} (${co.name}): phone=${co.phone ?? "—"} email=${co.email ?? "—"}`);
  }
  const res = await db
    .update(schema.company)
    .set({ phone: null, email: null })
    .returning({ id: schema.company.id, name: schema.company.name });
  console.log(`Cleared phone/email on ${res.length} company row(s).`);
}

main().then(() => process.exit(0));
