import "server-only";

import { failStaleBoardrooms } from "@/lib/assistant/boardroom";
import { runDueJobs } from "@/lib/assistant/jobs";

/**
 * Periodic work for the assistant: run due ScheduledJobs (digests →
 * `digest.ready` / `assistant.job.completed`) and fail Boardroom sessions a
 * crashed process left running.
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox). Idempotent: jobs are claimed with a conditional
 * update on `nextRunAt`, boardroom sessions with a conditional status update.
 */
export async function run(now: Date): Promise<void> {
  await runDueJobs(now);
  await failStaleBoardrooms(now);
}
