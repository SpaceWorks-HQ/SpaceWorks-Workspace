#!/usr/bin/env node
// Space Works Workspace scheduler: triggers the bearer-protected internal
// endpoints that do periodic work.
//
//   POST /api/internal/outbox   deliver queued email + retention cleanup
//   POST /api/internal/jobs     periodic jobs (assistant schedules, monitor checks)
//
// Continuous mode (default) runs every SCHEDULER_INTERVAL_SECONDS (60) and is what
// the VPS `scheduler` container runs. `--once` makes one pass and exits
// non-zero on failure: Kubernetes CronJob, Render cron, DO scheduled job.
//
// Environment:
//   APP_URL       origin of the app, e.g. http://app:3000 or https://work.example.org
//   CRON_SECRET   the app's CRON_SECRET (32+ characters)
//   SCHEDULER_ENDPOINTS        comma list, default "outbox,jobs"
//   SCHEDULER_INTERVAL_SECONDS interval, default 60 (minimum 15)
//
// It never logs the secret, URLs with credentials or response bodies; only
// endpoint names and status codes.

const ENDPOINTS = { outbox: "/api/internal/outbox", jobs: "/api/internal/jobs" };
const TIMEOUT_MS = 55_000;

function config() {
  let origin;
  try {
    const url = new URL(process.env.APP_URL ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    origin = url.origin;
  } catch {
    throw new Error("APP_URL must be an http(s) origin without credentials.");
  }
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32) throw new Error("CRON_SECRET is missing or shorter than 32 characters.");
  const names = (process.env.SCHEDULER_ENDPOINTS || "outbox,jobs").split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of names) if (!(name in ENDPOINTS)) throw new Error(`Unknown scheduler endpoint: ${name}`);
  const interval = Math.max(15, Number.parseInt(process.env.SCHEDULER_INTERVAL_SECONDS || "60", 10) || 60);
  return { origin, secret, names, intervalMs: interval * 1000 };
}

const inFlight = new Set();

/** One call; resolves to true on a 2xx. Overlapping runs of the same endpoint are skipped. */
async function trigger({ origin, secret }, name) {
  if (inFlight.has(name)) return true;
  inFlight.add(name);
  try {
    const response = await fetch(`${origin}${ENDPOINTS[name]}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "User-Agent": "spaceworks-workspace-scheduler" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (response.ok) return true;
    // 404 means the bearer value does not match the app's CRON_SECRET.
    console.error(`[scheduler] ${name} returned HTTP ${response.status}`);
    return false;
  } catch (error) {
    console.error(`[scheduler] ${name} request failed (${error instanceof Error ? error.name : "error"})`);
    return false;
  } finally {
    inFlight.delete(name);
  }
}

async function pass(settings) {
  const results = await Promise.all(settings.names.map((name) => trigger(settings, name)));
  return results.every(Boolean);
}

let settings;
try {
  settings = config();
} catch (error) {
  console.error(`[scheduler] ${error.message}`);
  process.exit(2);
}

if (process.argv.includes("--once")) {
  process.exitCode = (await pass(settings)) ? 0 : 1;
} else {
  console.log(`[scheduler] calling ${settings.names.join(", ")} every ${settings.intervalMs / 1000}s`);
  const timer = setInterval(() => void pass(settings), settings.intervalMs);
  void pass(settings);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      clearInterval(timer);
      process.exit(0);
    });
  }
}
