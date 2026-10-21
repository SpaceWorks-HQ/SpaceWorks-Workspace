import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveGrant,
  changeSecrets,
} from "@/lib/secrets/service";
import { searchDocuments } from "@/lib/search/query";
import { owner, member, project } from "./fixtures";

export function registerSearchAccessTests() {
  it("keeps names in search behind live environment access even with stale broad index metadata", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      {
        key: "SEARCHABLE_KEY",
        path: "/",
        value: "never-searchable-value",
        ownerId: member.user.id,
      },
    ]);
    const row = await prisma.applicationSecret.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, environmentId: p.dev.id },
    });
    await prisma.searchDocument.updateMany({
      where: { workspaceId: owner.workspace.id, entityId: row.id },
      data: { visibility: "WORKSPACE" },
    });
    const actor = {
      workspaceId: owner.workspace.id,
      userId: member.user.id,
      role: "MEMBER" as const,
    };
    expect(await searchDocuments(actor, "SEARCHABLE_KEY")).toEqual([]);
    await saveGrant(owner, {
      projectId: p.id,
      userId: member.user.id,
      role: "KEYS",
    });
    expect(
      (await searchDocuments(actor, "SEARCHABLE_KEY")).map((r) => r.entityId),
    ).toContain(row.id);
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "NONE",
    });
    expect(await searchDocuments(actor, "SEARCHABLE_KEY")).toEqual([]);
  });
}
