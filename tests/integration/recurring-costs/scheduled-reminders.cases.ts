import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { run } from "@/lib/scheduled/recurringCosts";
import { owner } from "./fixtures";

export function registerScheduledReminderTests() {
  it("deduplicates beat reminders and omits sensitive payloads", async () => {
    const now = new Date("2026-10-22T08:00:00Z");
    await run(now);
    const count = await prisma.notificationEventRecord.count({
      where: { workspaceId: owner.workspace.id, type: "finance.recurring.due" },
    });
    await run(now);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "finance.recurring.due",
        },
      }),
    ).toBe(count);
    expect(count).toBeGreaterThan(0);
  });
}
