import "server-only";

/**
 * Periodic work for the tasks build: recurring task instances (TaskRecurrence), task.due / task.overdue reminders.
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so it must be idempotent: claim rows with a
 * conditional update or rely on unique keys, and keep each run short.
 * Placeholder until the tasks build replaces this function body.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
