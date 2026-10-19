import "server-only";

import { publishDueAnnouncements } from "@/lib/community/announcements";
import { sendDueReminders } from "@/lib/community/events";

/**
 * Periodic work for the community area, called about once a minute by every
 * app replica (outbox worker tick and POST /api/internal/outbox):
 * - publish scheduled announcements whose time has come (`announcement.published`);
 * - send event reminders a day and an hour before the start (`event.reminder`).
 *
 * Both are idempotent: each send is keyed (announcement + publish time, event
 * + reminder + start time), serialised with a transaction advisory lock and
 * skipped when the stored notification event already exists.
 */
export async function run(now: Date): Promise<void> {
  await publishDueAnnouncements(now);
  await sendDueReminders(now);
}
