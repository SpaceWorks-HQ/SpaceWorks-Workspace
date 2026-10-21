import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { notificationCentre } from "@/lib/shell/notifications";
import { dispatch } from "@/lib/notify";
import { ownerId, memberId, workspaceId, otherId, publicDoc } from "./fixtures";

export function registerNotificationsTests() {
  it("counts only this member's active notifications in this tenant", async () => {
    for (const [ws, user] of [
      [workspaceId, memberId],
      [workspaceId, ownerId],
      [otherId, ownerId],
    ])
      await dispatch(ws, {
        type: "mention",
        title: "Maker mention",
        recipients: [user],
        data: { sourceType: "doc", sourceId: publicDoc, channelId: null },
      });
    const centre = await notificationCentre(workspaceId, memberId);
    expect(centre.unread).toBe(1);
    expect(centre.mentions).toBe(1);
    await prisma.notification.updateMany({
      where: { workspaceId, userId: memberId },
      data: { archivedAt: new Date() },
    });
    expect((await notificationCentre(workspaceId, memberId)).unread).toBe(0);
  });
}
