import "server-only";

import { prisma } from "@/lib/db";
import { recordHeartbeatSuccess } from "@/lib/operationalHeartbeat";
import { claimOnce, releaseClaim } from "@/lib/monitor/coord";
import { executeMonitor } from "@/lib/monitor/runner";

/**
 * Check scheduling. Postgres is the source of truth: due monitors are
 * claimed with a lease (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
 * LOCKED)`), so several replicas never claim the same monitor; a Redis lock
 * per monitor guards the run itself. Concurrency: 20 checks per process,
 * at most 5 in flight per target host.
 */

export const CHECKER_HEARTBEAT_KEY = "monitor-checker";
export const CHECKER_OFFLINE_AFTER_MS = 60_000;
const LEASE_SEC = 360;
const TICK_MS = 5_000;

export type ClaimedMonitor = { id: string; type: string; config: unknown };

const utc = (date: Date) => date.toISOString();

export async function claimDueMonitors(now: Date, limit = 50, leaseSec = LEASE_SEC): Promise<ClaimedMonitor[]> {
  if (limit <= 0) return [];
  const lease = new Date(now.getTime() + leaseSec * 1000);
  return prisma.$queryRaw<ClaimedMonitor[]>`
    UPDATE "Monitor" SET "leaseUntil" = (${utc(lease)}::timestamptz AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "Monitor"
      WHERE "enabled" = true
        AND "type" <> 'HEARTBEAT'
        AND EXISTS (SELECT 1 FROM "Workspace" w WHERE w."id" = "Monitor"."workspaceId" AND w."archivedAt" IS NULL)
        AND "nextCheckAt" <= (${utc(now)}::timestamptz AT TIME ZONE 'UTC')
        AND ("leaseUntil" IS NULL OR "leaseUntil" < (${utc(now)}::timestamptz AT TIME ZONE 'UTC'))
      ORDER BY "nextCheckAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type"::text AS "type", "config"`;
}

/** The host a check talks to (per-host concurrency key). */
export function targetHost(monitor: { type: string; config: unknown }): string {
  const config = (monitor.config ?? {}) as Record<string, unknown>;
  const pick = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : null);
  try {
    if (typeof config.url === "string") return new URL(config.url).hostname.toLowerCase();
    if (typeof config.baseUrl === "string") return new URL(config.baseUrl).hostname.toLowerCase();
  } catch {
    // fall through
  }
  return pick(config.host) ?? pick(config.hostname) ?? pick(config.domain) ?? `${monitor.type}:other`;
}

/** Global + per-key concurrency limiter. */
export class Limiter {
  private active = 0;
  private perKey = new Map<string, number>();
  private queue: Array<{ key: string; start: () => void }> = [];
  private idleWaiters: Array<() => void> = [];

  constructor(
    readonly maxConcurrent = 20,
    readonly maxPerKey = 5,
  ) {}

  freeSlots() {
    return Math.max(0, this.maxConcurrent - this.active - this.queue.length);
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        this.perKey.set(key, (this.perKey.get(key) ?? 0) + 1);
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            const left = (this.perKey.get(key) ?? 1) - 1;
            if (left <= 0) this.perKey.delete(key);
            else this.perKey.set(key, left);
            this.drain();
          });
      };
      this.queue.push({ key, start });
      this.drain();
    });
  }

  private drain() {
    for (let i = 0; i < this.queue.length && this.active < this.maxConcurrent; ) {
      const next = this.queue[i];
      if ((this.perKey.get(next.key) ?? 0) >= this.maxPerKey) {
        i += 1;
        continue;
      }
      this.queue.splice(i, 1);
      next.start();
    }
    if (this.active === 0 && this.queue.length === 0) {
      for (const waiter of this.idleWaiters.splice(0)) waiter();
    }
  }

  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}

export async function recordCheckerHeartbeat(checks = 0) {
  await recordHeartbeatSuccess(CHECKER_HEARTBEAT_KEY, { sent: checks }).catch(() => undefined);
}

/** Claim what is due and start it on the limiter (does not wait for the checks). */
export async function tick(limiter: Limiter, now = new Date(), options: { maxRetryWaitMs?: number } = {}): Promise<number> {
  const claimed = await claimDueMonitors(now, Math.min(limiter.freeSlots(), 50));
  for (const monitor of claimed) {
    void limiter
      .run(targetHost(monitor), async () => {
        const lockKey = `lock:${monitor.id}`;
        if (!(await claimOnce(lockKey, LEASE_SEC * 1000))) return;
        try {
          await executeMonitor(monitor.id, new Date(), { maxRetryWaitMs: options.maxRetryWaitMs });
        } catch {
          console.error("[monitor] check run failed");
          await prisma.monitor.updateMany({ where: { id: monitor.id }, data: { leaseUntil: null, nextCheckAt: new Date(Date.now() + 60_000) } }).catch(() => undefined);
        } finally {
          await releaseClaim(lockKey);
        }
      })
      .catch(() => undefined);
  }
  return claimed.length;
}

/**
 * Bounded run for POST /api/internal/jobs (external schedulers call it about
 * once a minute): claim due checks every 5 s for `claimWindowMs`, then wait
 * for the started checks to finish.
 */
export async function runDueChecks(options: { claimWindowMs?: number; maxRetryWaitMs?: number } = {}) {
  const limiter = new Limiter();
  const end = Date.now() + (options.claimWindowMs ?? 20_000);
  let started = 0;
  await recordCheckerHeartbeat();
  for (;;) {
    started += await tick(limiter, new Date(), { maxRetryWaitMs: options.maxRetryWaitMs ?? 5_000 });
    if (Date.now() + TICK_MS >= end) break;
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
  await limiter.idle();
  await recordCheckerHeartbeat(started);
  return { checks: started };
}

export async function checkerHealth(now = new Date()) {
  const row = await prisma.operationalHeartbeat.findUnique({ where: { key: CHECKER_HEARTBEAT_KEY }, select: { lastSucceededAt: true } });
  const last = row?.lastSucceededAt ?? null;
  return { lastHeartbeatAt: last, offline: !last || now.getTime() - last.getTime() > CHECKER_OFFLINE_AFTER_MS };
}
