import "server-only";

import { generateRecurringTasks } from "@/lib/tasks/recurrenceService";
import { sendDueReminders } from "@/lib/tasks/reminders";

/**
 * Periodic work for the tasks build, called about once a minute by every
 * app replica (outbox worker tick and POST /api/internal/outbox):
 *
 * 1. Recurring tasks: create due instances of TaskRecurrence rules
 *    (claimed with a conditional update, unique per occurrence).
 * 2. Reminders: `task.due` on the due day and `task.overdue` the morning
 *    after, once per task and due date (advisory lock + dedupe key).
 */
export async function run(now: Date): Promise<void> {
  await generateRecurringTasks(now);
  await sendDueReminders(now);
}
