import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutateIdea } from "@/lib/ideas/service";
import { owner, member } from "./fixtures";

export function registerStaleMembershipTests() {
  it("rejects suspended membership even when a stale actor object is supplied", async () => {
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    await expect(
      mutateIdea(member, { op: "create", title: "Stale membership" }),
    ).rejects.toThrow();
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
        },
      },
      data: { status: "ACTIVE" },
    });
  });
}
