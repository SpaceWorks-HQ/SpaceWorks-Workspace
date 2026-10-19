import "server-only";

import { prisma } from "@/lib/db";
import { claimOnce } from "@/lib/monitor/coord";

/**
 * Hourly and daily rollups (computed in SQL from raw checks, idempotent
 * upserts) and retention: raw checks per workspace `monitorRetentionDays`
 * (7–30, default 14), hourly rollups 90 days, daily rollups 2 years, cloud
 * metric samples 7 days, heartbeat pings 30 days. Workspaces on legal hold
 * are skipped. Purges delete in batches of 10 000.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const BATCH = 10_000;

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

async function deleteInBatches(run: () => Promise<number>, maxBatches = 20) {
  let total = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const deleted = await run();
    total += deleted;
    if (deleted < BATCH) break;
  }
  return total;
}

/** Daily retention purge (claimed once per day across replicas). */
export async function runRetention(now: Date, options: { force?: boolean } = {}) {
  if (!options.force && !(await claimOnce(`retention:${iso(dayStart(now))}`, DAY_MS))) return null;
  const workspaces = await prisma.workspace.findMany({ where: { legalHold: false }, select: { id: true, monitorRetentionDays: true } });
  let checks = 0;
  for (const ws of workspaces) {
    const days = Math.min(30, Math.max(7, ws.monitorRetentionDays));
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    checks += await deleteInBatches(() =>
      prisma.$executeRaw`DELETE FROM "MonitorCheck" WHERE "id" IN (SELECT "id" FROM "MonitorCheck" WHERE "workspaceId" = ${ws.id} AND "checkedAt" < (${iso(cutoff)}::timestamptz AT TIME ZONE 'UTC') LIMIT ${BATCH})`,
    );
  }
  const held = new Set((await prisma.workspace.findMany({ where: { legalHold: true }, select: { id: true } })).map((ws) => ws.id));
  const heldIds = [...held];
  const hourly = await prisma.monitorRollup.deleteMany({ where: { granularity: "HOUR", bucketStart: { lt: new Date(now.getTime() - 90 * DAY_MS) }, workspaceId: { notIn: heldIds } } });
  const daily = await prisma.monitorRollup.deleteMany({ where: { granularity: "DAY", bucketStart: { lt: new Date(now.getTime() - 730 * DAY_MS) }, workspaceId: { notIn: heldIds } } });
  const metrics = await deleteInBatches(() =>
    prisma.$executeRaw`DELETE FROM "CloudMetricSample" WHERE "id" IN (SELECT "id" FROM "CloudMetricSample" WHERE "resourceId" IN (SELECT "id" FROM "CloudResource" WHERE "workspaceId" IN (SELECT "id" FROM "Workspace" WHERE NOT "legalHold")) AND "ts" < (${iso(new Date(now.getTime() - 7 * DAY_MS))}::timestamptz AT TIME ZONE 'UTC') LIMIT ${BATCH})`,
  );
  const pings = await prisma.heartbeatPing.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 30 * DAY_MS) }, monitor: { workspaceId: { notIn: heldIds } } } });
  return { checks, hourly: hourly.count, daily: daily.count, metrics, pings: pings.count };
}
