import "server-only";

/**
 * Periodic work for the assistant build: ScheduledJob runs (digests → digest.ready / assistant.job.completed).
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so it must be idempotent: claim rows with a
 * conditional update or rely on unique keys, and keep each run short.
 * Placeholder until the assistant build replaces this function body.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
