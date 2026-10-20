import "server-only";
import { prisma } from "@/lib/db";
import { getQueues } from "./client";
import { QUEUE_NAMES, type QueueName } from "./definitions";
function safeFailureSummary(value: string) {
  return /^(?:Error|[A-Za-z]{1,30}Error)(?: \([A-Z0-9_-]{1,40}\))?$/.test(value) ? value : "Error";
}

/** Safe projection only. Never expose data, stack traces or raw provider errors. */
export async function getJobsHealth() {
  const queues = getQueues();
  return Promise.all(QUEUE_NAMES.map(async name => {
    const queue = queues[name];
    const [counts, paused, failed] = await Promise.all([
      queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused"),
      queue.isPaused(), queue.getFailed(0, 9),
    ]);
    return { name, counts, paused, failures: failed.map(job => ({
      id: job.id!, attempts: job.attemptsMade, at: job.finishedOn ?? job.timestamp,
      reason: `Job failed: ${safeFailureSummary(job.failedReason)}. Check service configuration before retrying.`,
    })) };
  }));
}
export type JobsHealth = Awaited<ReturnType<typeof getJobsHealth>>;
export async function manageQueue(input: { queue: QueueName; operation: "pause" | "resume" | "retry" | "remove"; jobId?: string }) {
  const queue = getQueues()[input.queue];
  if (input.operation === "pause") { await queue.pause(); return; }
  if (input.operation === "resume") { await queue.resume(); return; }
  const job = input.jobId ? await queue.getJob(input.jobId) : null;
  if (!job || await job.getState() !== "failed") throw new Error("Failed job not found.");
  if (input.operation === "remove") { await job.remove(); return; }
  if (job.data.kind === "outbox") {
    // Only revive a terminal SQL row referenced by this queue job, never a sent delivery.
    await prisma.outboxMessage.updateMany({
      where: { id: job.data.outboxId, status: "FAILED" },
      data: { status: "PENDING", attempts: 0, availableAt: new Date(), lockedAt: null, lastError: null },
    });
  }
  await job.retry("failed", { resetAttemptsMade: true });
}
