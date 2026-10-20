import { describe, expect, it } from "vitest";
import { JOB_OPTIONS, jobId, queueConcurrency, scheduleDefinitions } from "@/lib/queue/definitions";
import { queueConnection } from "@/lib/queue/client";
const run = async () => undefined;
describe("background queue definitions", () => {
  it("maps unchanged registrations to the existing one-minute cadence", () => {
    expect(scheduleDefinitions([{ area: "people", run }])).toEqual([{ id: "registry-people", queue: "scheduled", schedule: { every: 60_000 }, data: { kind: "registered", area: "people" } }]);
  });
  it("preserves interval and timezone-aware cron schedules", () => {
    const definitions = scheduleDefinitions([{ area: "checks", queue: "monitor", schedule: { every: 5000 }, run }, { area: "daily", schedule: { pattern: "0 9 * * *", tz: "Asia/Kolkata" }, run }]);
    expect(definitions[0].queue).toBe("monitor");
    expect(definitions[1].schedule).toEqual({ pattern: "0 9 * * *", tz: "Asia/Kolkata" });
  });
  it("rejects duplicate registrations and invalid intervals", () => {
    expect(() => scheduleDefinitions([{ area: "same", run }, { area: "same", run }])).toThrow();
    expect(() => scheduleDefinitions([{ area: "fast", run, schedule: { every: 0 } }])).toThrow();
  });
  it("creates stable, non-revealing ids without BullMQ separators", () => {
    const id = jobId("outbox", "private@example.test:capability");
    expect(id).toBe(jobId("outbox", "private@example.test:capability"));
    expect(id).not.toBe(jobId("outbox", "another"));
    expect(id).toMatch(/^outbox-[a-f0-9]{64}$/);
  });
  it("bounds retention and retries with exponential backoff", () => {
    expect(JOB_OPTIONS.attempts).toBe(8);
    expect(JOB_OPTIONS.backoff).toEqual({ type: "exponential", delay: 5000 });
    expect(JOB_OPTIONS.removeOnFail).toEqual({ age: 2592000, count: 5000 });
    expect(JOB_OPTIONS.removeOnComplete).toEqual({ age: 86400, count: 2000 });
  });
  it("validates concurrency overrides", () => {
    expect(queueConcurrency("outbox", {})).toBe(5);
    expect(queueConcurrency("outbox", { QUEUE_OUTBOX_CONCURRENCY: "3" })).toBe(3);
    for (const value of ["0", "65", "NaN", "1.5"]) expect(() => queueConcurrency("outbox", { QUEUE_OUTBOX_CONCURRENCY: value })).toThrow();
  });
  it("uses TLS and database selection without weakening certificate checks", () => {
    expect(queueConnection(true, "rediss://default:secret@redis.example.test:6380/0")).toMatchObject({ tls: {}, db: 0, port: 6380, maxRetriesPerRequest: null });
    expect(queueConnection(false, "redis://127.0.0.1:6395/0")).toMatchObject({ maxRetriesPerRequest: 1, enableOfflineQueue: false });
    expect(() => queueConnection(false, "memory://")).toThrow();
  });
});
