import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" so tests can import modules that use the alias.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // crm-extract/ is a standalone extraction packet destined for a different
    // project, not part of this app. It has its own passing suite; run it with
    // `npx vitest run --config crm-extract/vitest.config.ts`.
    exclude: ["**/node_modules/**", "**/dist/**", "crm-extract/**"],
  },
});
