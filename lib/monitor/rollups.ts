import "server-only";

import { prisma } from "@/lib/db";
import { claimOnce } from "@/lib/monitor/coord";

/**
 * Hourly and daily rollups (computed in SQL from raw checks, idempotent
 * upserts) and retention: raw checks per workspace `monitorRetentionDays`
 * (7–30, default 14), hourly rollups 90 days, daily rollups 2 years, cloud
 * metric samples 7 days, heartbeat pings 30 days. Workspaces on legal hold
 * are skipped. Purges share the workspace lock with legal-hold changes.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const iso = (date: Date) => date.toISOString();

export function hourStart(date: Date) {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export function dayStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Upsert rollups for [start, end) of one granularity (optionally one monitor). Returns rows written. */
export async function computeRollups(granularity: "HOUR" | "DAY", start: Date, end: Date, monitorId?: string): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "MonitorRollup" ("id", "monitorId", "workspaceId", "granularity", "bucketStart", "total", "up", "degraded", "down", "maintenance", "downtimeSec", "latencyAvg", "latencyMin", "latencyMax", "latencyP50", "latencyP95")
    SELECT
      'r' || replace(gen_random_uuid()::text, '-', ''),
      c."monitorId",
      c."workspaceId",
      ${granularity}::"RollupGranularity",
      date_trunc(${granularity.toLowerCase()}, c."checkedAt"),
      count(*)::int,
      (count(*) FILTER (WHERE c."status" = 'UP' AND NOT c."inMaintenance"))::int,
      (count(*) FILTER (WHERE c."status" = 'DEGRADED' AND NOT c."inMaintenance"))::int,
      (count(*) FILTER (WHERE c."status" = 'DOWN' AND NOT c."inMaintenance"))::int,
      (count(*) FILTER (WHERE c."inMaintenance"))::int,
      ((count(*) FILTER (WHERE c."status" = 'DOWN' AND NOT c."inMaintenance")) * max(m."intervalSec"))::int,
      avg(c."latencyMs")::float8,
      min(c."latencyMs"),
      max(c."latencyMs"),
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY c."latencyMs"))::numeric)::int,
      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY c."latencyMs"))::numeric)::int
    FROM "MonitorCheck" c
    JOIN "Monitor" m ON m."id" = c."monitorId" AND m."workspaceId" = c."workspaceId"
    WHERE c."checkedAt" >= (${iso(start)}::timestamptz AT TIME ZONE 'UTC')
      AND c."checkedAt" < (${iso(end)}::timestamptz AT TIME ZONE 'UTC')
      AND c."status" IN ('UP', 'DEGRADED', 'DOWN')
      AND (${monitorId ?? null}::text IS NULL OR c."monitorId" = ${monitorId ?? null}::text)
    GROUP BY c."monitorId", c."workspaceId", 5
    ON CONFLICT ("monitorId", "granularity", "bucketStart") DO UPDATE SET
      "total" = EXCLUDED."total",
      "up" = EXCLUDED."up",
      "degraded" = EXCLUDED."degraded",
      "down" = EXCLUDED."down",
      "maintenance" = EXCLUDED."maintenance",
      "downtimeSec" = EXCLUDED."downtimeSec",
      "latencyAvg" = EXCLUDED."latencyAvg",
      "latencyMin" = EXCLUDED."latencyMin",
      "latencyMax" = EXCLUDED."latencyMax",
      "latencyP50" = EXCLUDED."latencyP50",
      "latencyP95" = EXCLUDED."latencyP95"`;
}

/** Called about once a minute: previous + current hour, and yesterday + today once per hour. Claims keep replicas from repeating work. */
export async function runRollupJobs(now: Date) {
  const thisHour = hourStart(now);
  const previousHour = new Date(thisHour.getTime() - HOUR_MS);
  let written = 0;
  if (await claimOnce(`rollup:hour:${iso(thisHour)}:${Math.floor(now.getUTCMinutes() / 5)}`, 5 * 60_000)) {
    if (now.getUTCMinutes() < 10) written += await computeRollups("HOUR", previousHour, thisHour);
    written += await computeRollups("HOUR", thisHour, new Date(thisHour.getTime() + HOUR_MS));
  }
  // Backfill retained raw data after missed scheduler runs, including full days.
  // One grouped query per granularity avoids a round trip for every bucket.
  if (await claimOnce(`rollup:backfill:${iso(thisHour)}`, HOUR_MS)) {
    const oldest = new Date(dayStart(now).getTime() - 31 * DAY_MS);
    written += await computeRollups("HOUR", oldest, new Date(thisHour.getTime() + HOUR_MS));
    written += await computeRollups("DAY", oldest, new Date(dayStart(now).getTime() + DAY_MS));
  }
  return written;
}

/** Daily retention purge (claimed once per day across replicas). */
export async function runRetention(now: Date, options: { force?: boolean } = {}) {
  if (!options.force && !(await claimOnce(`retention:${iso(dayStart(now))}`, DAY_MS))) return null;
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  const totals = { checks: 0, hourly: 0, daily: 0, metrics: 0, pings: 0 };
  for (const ws of workspaces) {
    const counts = await prisma.$transaction(async tx => {
      const [locked] = await tx.$queryRaw<Array<{ legalHold: boolean; monitorRetentionDays: number }>>`SELECT "legalHold", "monitorRetentionDays" FROM "Workspace" WHERE id=${ws.id} FOR NO KEY UPDATE`;
      if (!locked || locked.legalHold) return null;
      const policy = await tx.retentionPolicy.findUnique({ where: { workspaceId_entityType: { workspaceId: ws.id, entityType: "monitor_results" } } });
      const days = Math.max(locked.monitorRetentionDays, policy?.keepDays ?? 0);
      const checks = policy && policy.action !== "DELETE" ? { count: 0 } : await tx.monitorCheck.deleteMany({ where: { workspaceId: ws.id, checkedAt: { lt: new Date(now.getTime() - days * DAY_MS) } } });
      const hourly = await tx.monitorRollup.deleteMany({ where: { workspaceId: ws.id, granularity: "HOUR", bucketStart: { lt: new Date(now.getTime() - 90 * DAY_MS) } } });
      const daily = await tx.monitorRollup.deleteMany({ where: { workspaceId: ws.id, granularity: "DAY", bucketStart: { lt: new Date(now.getTime() - 730 * DAY_MS) } } });
      const metrics = await tx.cloudMetricSample.deleteMany({ where: { resource: { workspaceId: ws.id }, ts: { lt: new Date(now.getTime() - 7 * DAY_MS) } } });
      const pings = await tx.heartbeatPing.deleteMany({ where: { monitor: { workspaceId: ws.id }, receivedAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } } });
      return { checks: checks.count, hourly: hourly.count, daily: daily.count, metrics: metrics.count, pings: pings.count };
    }, { timeout: 30000 });
    if (counts) for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += counts[key];
  }
  return totals;
}
