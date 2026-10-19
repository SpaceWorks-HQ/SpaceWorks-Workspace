/**
 * Uptime and latency maths (pure; mirrors the SQL rollup job so unit tests
 * can compare both). Uptime is check-based: (up + degraded) / (total −
 * maintenance), null when nothing counted. Percentiles use linear
 * interpolation, like Postgres `percentile_cont`.
 */

export type CheckSample = { status: string; latencyMs: number | null; inMaintenance: boolean };

export type Summary = {
  total: number;
  up: number;
  degraded: number;
  down: number;
  maintenance: number;
  downtimeSec: number;
  latencyAvg: number | null;
  latencyMin: number | null;
  latencyMax: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
};

const COUNTED = new Set(["UP", "DEGRADED", "DOWN"]);

export function percentileCont(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function summarizeChecks(checks: CheckSample[], intervalSec: number): Summary {
  let up = 0;
  let degraded = 0;
  let down = 0;
  let maintenance = 0;
  let total = 0;
  const latencies: number[] = [];
  for (const check of checks) {
    if (!COUNTED.has(check.status)) continue;
    total += 1;
    if (check.latencyMs !== null && check.latencyMs !== undefined) latencies.push(check.latencyMs);
    if (check.inMaintenance) {
      maintenance += 1;
      continue;
    }
    if (check.status === "UP") up += 1;
    else if (check.status === "DEGRADED") degraded += 1;
    else down += 1;
  }
  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((acc, value) => acc + value, 0);
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  return {
    total,
    up,
    degraded,
    down,
    maintenance,
    downtimeSec: down * intervalSec,
    latencyAvg: latencies.length ? sum / latencies.length : null,
    latencyMin: latencies.length ? latencies[0] : null,
    latencyMax: latencies.length ? latencies[latencies.length - 1] : null,
    latencyP50: round(percentileCont(latencies, 0.5)),
    latencyP95: round(percentileCont(latencies, 0.95)),
  };
}

export function uptimePercent(counts: { up: number; degraded: number; total: number; maintenance: number }): number | null {
  const denominator = counts.total - counts.maintenance;
  if (denominator <= 0) return null;
  return ((counts.up + counts.degraded) / denominator) * 100;
}

export type RollupLike = Omit<Summary, "latencyMin" | "latencyMax"> & { latencyMin?: number | null; latencyMax?: number | null };

/**
 * Combine rollups for long ranges. Averages and percentiles are weighted by
 * check count; the p95 of hourly p95s is an approximation (label it so).
 */
export function mergeRollups(rollups: RollupLike[]): Summary {
  const out: Summary = { total: 0, up: 0, degraded: 0, down: 0, maintenance: 0, downtimeSec: 0, latencyAvg: null, latencyMin: null, latencyMax: null, latencyP50: null, latencyP95: null };
  let weight = 0;
  let avg = 0;
  let p50 = 0;
  let p95 = 0;
  for (const rollup of rollups) {
    out.total += rollup.total;
    out.up += rollup.up;
    out.degraded += rollup.degraded;
    out.down += rollup.down;
    out.maintenance += rollup.maintenance;
    out.downtimeSec += rollup.downtimeSec;
    if (rollup.latencyMin != null) out.latencyMin = out.latencyMin === null ? rollup.latencyMin : Math.min(out.latencyMin, rollup.latencyMin);
    if (rollup.latencyMax != null) out.latencyMax = out.latencyMax === null ? rollup.latencyMax : Math.max(out.latencyMax, rollup.latencyMax);
    if (rollup.latencyAvg != null && rollup.total > 0) {
      weight += rollup.total;
      avg += rollup.latencyAvg * rollup.total;
      p50 += (rollup.latencyP50 ?? rollup.latencyAvg) * rollup.total;
      p95 += (rollup.latencyP95 ?? rollup.latencyAvg) * rollup.total;
    }
  }
  if (weight > 0) {
    out.latencyAvg = avg / weight;
    out.latencyP50 = Math.round(p50 / weight);
    out.latencyP95 = Math.round(p95 / weight);
  }
  return out;
}

export function formatUptime(value: number | null): string {
  if (value === null) return "No data";
  if (value >= 99.995) return "100%";
  return `${value >= 99 ? value.toFixed(2) : value.toFixed(1)}%`;
}

/** Day buckets (UTC midnight) for the last `days` days, oldest first, filled from daily rollups. */
export function dailyBars(rollups: Array<{ bucketStart: Date } & Pick<Summary, "up" | "degraded" | "down" | "total" | "maintenance">>, days: number, now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const byDay = new Map(rollups.map((rollup) => [rollup.bucketStart.getTime(), rollup]));
  const bars: Array<{ day: Date; uptime: number | null; down: number; degraded: number; maintenance: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = today - i * 86_400_000;
    const rollup = byDay.get(day);
    bars.push({ day: new Date(day), uptime: rollup ? uptimePercent(rollup) : null, down: rollup?.down ?? 0, degraded: rollup?.degraded ?? 0, maintenance: rollup?.maintenance ?? 0 });
  }
  return bars;
}

/** Worst-first ordering for overall status (status page banner, catalogue cachedStatus). */
export const STATUS_SEVERITY: Record<string, number> = { DOWN: 5, DEGRADED: 4, MAINTENANCE: 3, UNKNOWN: 2, PENDING: 1, PAUSED: 0, UP: 0 };

export function worstStatus(statuses: string[]): string | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, status) => ((STATUS_SEVERITY[status] ?? 0) > (STATUS_SEVERITY[worst] ?? 0) ? status : worst), statuses[0]);
}
