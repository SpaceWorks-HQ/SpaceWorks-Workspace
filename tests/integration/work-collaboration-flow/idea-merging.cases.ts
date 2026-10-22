import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutateIdea } from "@/lib/ideas/service";
import { owner, member, outsider } from "./fixtures";

export function registerIdeaMergingTests() {
  it("merges duplicate ideas and overlapping votes without losing discussion", async () => {
    const a = await mutateIdea(member, { op: "create", title: "Repair shelf" }),
      b = await mutateIdea(owner, { op: "create", title: "A repair shelf" });
    for (const ideaId of [a.id, b.id])
      await mutateIdea(member, { op: "vote", ideaId });
    await mutateIdea(owner, { op: "vote", ideaId: b.id });
    await mutateIdea(member, {
      op: "comment",
      ideaId: a.id,
      body: "We have spare timber.",
    });
    await mutateIdea(owner, { op: "merge", ideaId: a.id, targetId: b.id });
    expect(await prisma.ideaVote.count({ where: { ideaId: b.id } })).toBe(2);
    expect(
      await prisma.activityEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "idea_comment",
          entityId: a.id,
        },
      }),
    ).toBe(1);
    expect(await prisma.idea.findUnique({ where: { id: a.id } })).toMatchObject(
      { convertedType: "idea", convertedId: b.id },
    );
    await expect(
      mutateIdea(outsider, { op: "merge", ideaId: b.id, targetId: a.id }),
    ).rejects.toThrow();
  });
}
