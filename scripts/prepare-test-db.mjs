#!/usr/bin/env node
// Apply migrations to the disposable integration-test database named by
// TEST_DATABASE_URL (never DATABASE_URL).
//
//   node --env-file-if-exists=.env scripts/prepare-test-db.mjs
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const url = process.env.TEST_DATABASE_URL?.trim();
if (!url) {
  console.error("Set TEST_DATABASE_URL to a disposable database first.");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
});
process.exit(result.status ?? 1);
