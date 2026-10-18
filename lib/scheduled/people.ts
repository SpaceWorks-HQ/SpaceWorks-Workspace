import "server-only";

/**
 * Periodic work for the people-relationships build: onboarding.task_due, certification.expiring, shift reminders and recurring shifts, contact follow-ups.
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so it must be idempotent: claim rows with a
 * conditional update or rely on unique keys, and keep each run short.
 * Placeholder until the people-relationships build replaces this function body.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
