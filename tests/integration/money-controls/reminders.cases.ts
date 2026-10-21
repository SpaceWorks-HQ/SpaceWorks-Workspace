import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { run } from "@/lib/scheduled/moneyControls";
import { actor, on, date, save } from "./fixtures";

export function registerRemindersTests() {
  it("deduplicates generic reminders across replicas", async () => {
    const id = await save("FILING", {
      dueOn: on,
      ownerId: actor.user.id,
      details: { fiscalYear: 2026, quarter: "Q1", form: "Return" },
    });
    await Promise.all([run(date), run(date)]);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: actor.workspace.id,
          type: "moneycontrols.reminder",
          dedupeKey: { contains: id },
        },
      }),
    ).toBe(1);
  });
}
