#!/usr/bin/env node
// Runs the Prisma CLI with DIRECT_URL defaulted to DATABASE_URL.
//
// prisma/schema.prisma declares `directUrl = env("DIRECT_URL")` so migrations
// can bypass a transaction pooler (Supabase Supavisor on :6543). Prisma fails
// when a referenced variable is missing, so local development, CI, and the
// migration image fall back to DATABASE_URL when no separate direct connection
// exists. Usage: node scripts/prisma.mjs migrate deploy
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const env = { ...process.env };
if (!env.DIRECT_URL?.trim() && env.DATABASE_URL?.trim()) env.DIRECT_URL = env.DATABASE_URL;

const child = spawn(process.execPath, [require.resolve("prisma/build/index.js"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
