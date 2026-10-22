import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord } from "@/lib/governance/service";
import { createCase } from "@/lib/govextras/cases";
import { run as remind } from "@/lib/scheduled/govextras";
import { run as remindGovernance } from "@/lib/scheduled/governance";
import { owner, handler, docId } from "./fixtures";

export function registerRemindersTests() {
  it("reminds for policy reviews and renewals once across replica ticks", async () => {
    const review = await saveRecord(owner, {
      kind: "SOP_REVIEW",
      title: "Review evacuation SOP",
      status: "DUE",
      ownerId: owner.user.id,
      dueOn: "2027-01-10",
      details: { docId },
    });
    await prisma.doc.updateMany({
      where: { workspaceId: owner.workspace.id, id: docId },
      data: {
        verifiedUntil: new Date("2027-01-10"),
        verifiedById: owner.user.id,
      },
    });
    const now = new Date("2027-01-05T04:00:00Z");
    await Promise.all([
      remind(now),
      remind(now),
      remindGovernance(now),
      remindGovernance(now),
    ]);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "governance.review_due",
          dedupeKey: { contains: review.id },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "doc.review_due",
          dedupeKey: { contains: docId },
        },
      }),
    ).toBe(1);
  }, 60000);
  it("dispatches generic case reminders only to currently assigned appointed handlers", async () => {
    const row = await createCase(handler, {
      kind: "SAFEGUARDING",
      receivedOn: "2026-10-01",
      dueOn: "2026-10-15",
      handlerIds: [handler.user.id],
      details: "Never send this concern",
    });
    await Promise.all([
      remind(new Date("2026-10-20T04:00:00Z")),
      remind(new Date("2026-10-20T04:00:00Z")),
    ]);
    const events = await prisma.notificationEventRecord.findMany({
      where: {
        workspaceId: owner.workspace.id,
        type: "safeguarding.review_due",
        dedupeKey: { contains: row.id },
      },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("Never send this concern");
    const notifications = await prisma.notification.findMany({
      where: { workspaceId: owner.workspace.id, eventId: events[0].id },
    });
    expect(notifications.map((n) => n.userId)).toEqual([handler.user.id]);
  }, 60000);
}
