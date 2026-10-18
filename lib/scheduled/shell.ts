import "server-only";

/**
 * Periodic work for the platform-shell build: notification digests (NotificationDigestItem), retention policies, export/import jobs.
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so it must be idempotent: claim rows with a
 * conditional update or rely on unique keys, and keep each run short.
 * Placeholder until the platform-shell build replaces this function body.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
