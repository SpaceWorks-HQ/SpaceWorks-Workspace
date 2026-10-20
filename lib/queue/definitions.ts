import { createHash } from "node:crypto";
import type { JobsOptions } from "bullmq";

export const QUEUE_NAMES = ["outbox", "scheduled", "sync", "monitor", "documents"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
export type RepeatSchedule = { every: number } | { pattern: string; tz?: string };
export type QueueJob = { kind: "registered"; area: string } | { kind: "outbox"; outboxId: string };
export type JobDefinition = { area: string; queue?: QueueName; schedule?: RepeatSchedule; run: (now: Date) => Promise<void> };
export const JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 2_000 },
  // The failed set is the dead-letter store, bounded in both time and size.
  removeOnFail: { age: 30 * 86_400, count: 5_000 },
  stackTraceLimit: 0,
};
const DEFAULT_CONCURRENCY: Record<QueueName, number> = { outbox: 5, scheduled: 2, sync: 2, monitor: 1, documents: 1 };
export function queueConcurrency(name: QueueName, env: Record<string, string | undefined> = process.env): number {
  const value = env[`QUEUE_${name.toUpperCase()}_CONCURRENCY`];
  if (!value) return DEFAULT_CONCURRENCY[name];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64) throw new Error(`Invalid concurrency for ${name}. Use 1 to 64.`);
  return parsed;
}
export function jobId(kind: string, key: string): string {
  return `${kind}-${createHash("sha256").update(key).digest("hex")}`;
}
export function scheduleDefinitions(jobs: readonly JobDefinition[]) {
  const ids = new Set<string>();
  return jobs.map(job => {
    if (ids.has(job.area)) throw new Error("Duplicate job area.");
    ids.add(job.area);
    const schedule = job.schedule ?? { every: 60_000 };
    if ("every" in schedule && (!Number.isSafeInteger(schedule.every) || schedule.every < 1_000)) throw new Error("Invalid job interval.");
    return { id: `registry-${job.area}`, queue: job.queue ?? "scheduled", schedule, data: { kind: "registered", area: job.area } satisfies QueueJob };
  });
}
