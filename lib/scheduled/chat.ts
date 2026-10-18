import "server-only";

/**
 * Periodic work for the chat build: nothing yet (e.g. purge of expired drafts).
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so it must be idempotent: claim rows with a
 * conditional update or rely on unique keys, and keep each run short.
 * Placeholder until the chat build replaces this function body.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
