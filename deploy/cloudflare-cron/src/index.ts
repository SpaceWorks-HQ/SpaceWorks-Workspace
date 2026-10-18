/**
 * Space Works Workspace scheduler (Cloudflare Worker, Cron Trigger every minute).
 *
 * Free hosting plans (Render free) put an idle instance to sleep, which also
 * stops the app's in-process outbox worker. Each run:
 *   1. GET  {APP_URL}/api/health            wakes the app (cold start ~30-60 s)
 *   2. POST {APP_URL}/api/internal/outbox   delivers queued email + retention cleanup
 *   3. POST {APP_URL}/api/internal/jobs     periodic jobs (assistant schedules,
 *                                           monitor checks); 204 when idle
 * Steps 2 and 3 send `Authorization: Bearer {CRON_SECRET}`. Because step 2
 * queries the database every minute, it also keeps a free Supabase project awake.
 *
 * Secrets (set with `wrangler secret put`): APP_URL, CRON_SECRET.
 * Never log the secret or response bodies; only status codes are logged.
 */

interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

// Minimal local shapes so this folder needs no type packages beyond wrangler.
interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const WAKE_TIMEOUT_MS = 90_000;
const CALL_TIMEOUT_MS = 55_000;
const USER_AGENT = "spaceworks-workspace-cron";

function appOrigin(value: string | undefined): string {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:") throw new Error("APP_URL must be an https:// origin");
  return url.origin;
}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<number> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  // Drain the body so the connection is released; its content is not logged.
  await response.arrayBuffer();
  return response.status;
}

async function trigger(origin: string, secret: string, name: "outbox" | "jobs"): Promise<boolean> {
  try {
    const status = await call(`${origin}/api/internal/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "User-Agent": USER_AGENT },
    }, CALL_TIMEOUT_MS);
    console.log(`${name} ${status}`);
    // 404 means the bearer secret does not match the app's CRON_SECRET.
    return status >= 200 && status < 300;
  } catch (error) {
    console.warn(`${name} failed: ${error instanceof Error ? error.name : "error"}`);
    return false;
  }
}

async function run(env: Env): Promise<void> {
  const origin = appOrigin(env.APP_URL);
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) throw new Error("CRON_SECRET is missing or too short");

  try {
    const status = await call(`${origin}/api/health`, { headers: { "User-Agent": USER_AGENT } }, WAKE_TIMEOUT_MS);
    console.log(`health ${status}`);
  } catch (error) {
    // Still attempt the other calls; they also wake a sleeping instance.
    console.warn(`health failed: ${error instanceof Error ? error.name : "error"}`);
  }

  const results = await Promise.all([trigger(origin, env.CRON_SECRET, "outbox"), trigger(origin, env.CRON_SECRET, "jobs")]);
  if (!results.every(Boolean)) throw new Error("a scheduled call failed");
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },
};
