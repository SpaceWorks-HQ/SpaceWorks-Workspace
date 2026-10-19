import "server-only";

/**
 * Periodic work for the ops-money build: renewal.due, asset reminders, vault.rotation_due, approval reminders, catalogue.gap, budget thresholds.
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so it must be idempotent: claim rows with a
 * conditional update or rely on unique keys, and keep each run short.
 * Placeholder until the ops-money build replaces this function body.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
