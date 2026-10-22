import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { purgeWorkspace } from "@/lib/shell/retention";
import { workspaceId, otherId } from "./fixtures";

export function registerRetentionTests() {
  it("preserves old records on hold and only purges the configured tenant", async () => {
    const old = new Date("2020-01-01");
    const one = await prisma.linkItem.create({
      data: {
        workspaceId,
        title: "Old",
        url: "https://example.org",
        createdAt: old,
      },
    });
    const two = await prisma.linkItem.create({
      data: {
        workspaceId: otherId,
        title: "Other",
        url: "https://example.org",
        createdAt: old,
      },
    });
    await prisma.retentionPolicy.create({
      data: { workspaceId, entityType: "links", keepDays: 30 },
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { legalHold: true },
    });
    expect(await purgeWorkspace(workspaceId, new Date())).toBe(0);
    expect(
      await prisma.linkItem.findUnique({ where: { id: one.id } }),
    ).not.toBeNull();
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { legalHold: false },
    });
    expect(await purgeWorkspace(workspaceId, new Date())).toBe(1);
    expect(
      await prisma.linkItem.findUnique({ where: { id: two.id } }),
    ).not.toBeNull();
  });
}
