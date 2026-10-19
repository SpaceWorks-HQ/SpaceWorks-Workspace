import "server-only";

/**
 * Periodic work for chat. Nothing runs on a timer today: unread counts are
 * computed from read markers on demand, notifications go out through
 * dispatch when a message is posted, and typing indicators expire in the
 * browser.
 *
 * Called about once a minute by every app replica (outbox worker tick and
 * POST /api/internal/outbox), so anything added here must be idempotent.
 */
export async function run(now: Date): Promise<void> {
  void now;
}
