import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, loadGovernance } from "@/lib/governance/service";
import { searchWorkspace } from "@/lib/assistant/tools/workspace";
import type { Principal } from "@/lib/assistant/principal";
import { suffix, actor, other, obligation } from "./fixtures";

export function registerAssistantAccessTests() {
  it("keeps governance out of assistant jobs and rechecks live source access", async () => {
    const record = await saveRecord(
      actor,
      obligation({
        title: `Assistant governance ${suffix}`,
        ownerId: actor.user.id,
      }),
    );
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: actor.workspace.id },
    });
    const principal: Principal = {
      kind: "user",
      userId: actor.user.id,
      userName: "Owner",
      role: "OWNER",
      workspace,
    };
    const search = async (p: Principal) =>
      (
        await searchWorkspace.run(
          { principal: p, via: "chat", now: new Date() },
          { query: suffix, types: ["governance"], limit: 30 },
        )
      ).data as { results: Array<{ id: string }> };
    expect(
      (await search(principal)).results.some((r) => r.id === record.id),
    ).toBe(true);
    expect(
      (await search({ ...principal, kind: "job", role: "MEMBER" })).results,
    ).toHaveLength(0);
    expect(
      (await search({ ...principal, role: "MEMBER" })).results,
    ).toHaveLength(0);
    await prisma.governanceRecord.update({
      where: { id: record.id },
      data: { archivedAt: new Date() },
    });
    expect(
      (await search(principal)).results.some((r) => r.id === record.id),
    ).toBe(false);
  });
  it("denies stale suspended members and archived workspaces", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: other.workspace.id, userId: other.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(saveRecord(other, obligation())).rejects.toThrow();
    await prisma.workspace.update({
      where: { id: other.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(loadGovernance(other, "board", {})).rejects.toThrow();
  });
}
