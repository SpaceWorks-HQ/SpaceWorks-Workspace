import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  changeSecrets,
} from "@/lib/secrets/service";
import { run } from "@/lib/scheduled/secrets";
import { owner, project } from "./fixtures";

export function registerRotationReminderTests() {
  it("deduplicates rotation reminders and never includes secret values", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      {
        key: "ROTATE",
        path: "/",
        value: "rotation-private-value",
        rotateEveryDays: 1,
      },
    ]);
    await prisma.applicationSecret.updateMany({
      where: { workspaceId: owner.workspace.id, environmentId: p.dev.id },
      data: { rotatedAt: new Date(Date.now() - 3 * 86400000) },
    });
    await run();
    await run();
    const events = await prisma.notificationEventRecord.findMany({
      where: { workspaceId: owner.workspace.id, type: "secrets.rotation_due" },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("rotation-private-value");
  });
}
