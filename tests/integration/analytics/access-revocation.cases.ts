import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { loadMetrics } from "@/lib/analytics/queries";
import { owner, member, q } from "./fixtures";

export function registerAccessRevocationTests() {
  it("revokes analytics immediately for suspension and archive state", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(loadMetrics(member, q)).rejects.toThrow();
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(loadMetrics(owner, q)).rejects.toThrow();
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: null },
    });
  });
}
