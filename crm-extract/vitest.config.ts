// Standalone test config for the packet, so its suite can be run independently of
// whatever repo the directory currently sits in:
//
//   npx vitest run --config crm-extract/vitest.config.ts
//
// Once this directory becomes its own project, this file moves to the root and the
// `root` line below can go away. The suite is pure — no database, no network, no
// environment variables — because everything it covers is a pure function
// (revisit predicates, CSV parsing, key normalization, value coercion,
// suppression rules). The parts that need Postgres are covered by database
// constraints instead; see PACKET.md §3.

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
