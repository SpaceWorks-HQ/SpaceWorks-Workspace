import "server-only";
import { CronExpressionParser } from "cron-parser";
import { prisma } from "@/lib/db";
import { SCHEDULED_JOBS } from "@/lib/scheduled";
import { getQueues, type Queues } from "./client";
import { jobId, scheduleDefinitions } from "./definitions";

/** SQL is the durable transactional outbox. Redis carries ids, never email content or bearer links. */
export async function enqueueDueOutbox(queues: Queues = getQueues()) {
  const now = new Date();
  const rows = await prisma.outboxMessage.findMany({
    where: { OR: [
      { status: "PENDING", availableAt: { lte: now } },
      { status: "PROCESSING", lockedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    ] },
    select: { id: true }, orderBy: { createdAt: "asc" }, take: 100,
  });
  await queues.outbox.addBulk(rows.map(row => ({ name: "deliver", data: { kind: "outbox" as const, outboxId: row.id }, opts: { jobId: jobId("outbox", row.id) } })));
  return { enqueued: rows.length };
}
/** Compatibility tick for hosts with an external cron. Same time-bucket ids deduplicate repeated calls. */
export async function enqueueScheduledTick(queues: Queues = getQueues(), now = Date.now()) {
  for (const item of scheduleDefinitions(SCHEDULED_JOBS)) {
    let occurrence: number;
    if ("every" in item.schedule) occurrence = Math.floor(now / item.schedule.every) * item.schedule.every;
    else {
      occurrence = CronExpressionParser.parse(item.schedule.pattern, { currentDate: new Date(now + 1), tz: item.schedule.tz ?? "UTC" }).prev().getTime();
      if (now - occurrence >= 60_000) continue;
    }
    await queues[item.queue].add(item.data.area, item.data, { jobId: jobId("tick", `${item.id}-${occurrence}`) });
  }
}
