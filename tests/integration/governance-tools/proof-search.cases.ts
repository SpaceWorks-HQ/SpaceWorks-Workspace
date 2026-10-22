import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, operate, attachFile, detachFile } from "@/lib/governance/service";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import { suffix, actor, other, member, guest, obligation } from "./fixtures";

export function registerProofSearchTests() {
  it("stores multiple proof files privately and excludes them from the library", async () => {
    const obligationRow = await saveRecord(actor, obligation());
    const uploaded = await attachFile(
      actor,
      obligationRow.id,
      new File(["%PDF-1.4\nproof"], "acknowledgement.pdf", {
        type: "application/pdf",
      }),
    );
    await attachFile(
      actor,
      obligationRow.id,
      new File(["%PDF-1.4\nsecond"], "second.pdf", { type: "application/pdf" }),
    );
    expect(
      await findDownloadableFile(uploaded.id, actor.user.id),
    ).not.toBeNull();
    for (const denied of [member, guest, other])
      expect(
        await findDownloadableFile(uploaded.id, denied.user.id),
      ).toBeNull();
    const actorFull = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: actor.workspace.id, userId: actor.user.id },
    });
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: actor.workspace.id },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.user.id },
    });
    expect(
      await prisma.fileObject.count({
        where: {
          ...(await libraryWhere({
            workspace,
            user: { id: user.id, name: user.name },
            membership: actorFull,
          })),
          id: uploaded.id,
        },
      }),
    ).toBe(0);
    await expect(
      attachFile(
        member,
        obligationRow.id,
        new File(["proof"], "proof.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow();
    await expect(
      attachFile(
        actor,
        obligationRow.id,
        new File(["bad"], "bad.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow();
    await detachFile(actor, obligationRow.id, uploaded.id);
    expect(await findDownloadableFile(uploaded.id, actor.user.id)).toBeNull();
  });
  it("checks source permissions for private governance search and removes archived records", async () => {
    const record = await saveRecord(
      actor,
      obligation({ title: `Governance unique ${suffix}` }),
    );
    for (const viewer of [member, guest, other])
      expect(
        await searchDocuments(
          {
            workspaceId: viewer.workspace.id,
            userId: viewer.user.id,
            role: viewer.membership.role,
          },
          suffix,
          "governance",
        ),
      ).toHaveLength(0);
    expect(
      (
        await searchDocuments(
          {
            workspaceId: actor.workspace.id,
            userId: actor.user.id,
            role: "OWNER",
          },
          suffix,
          "governance",
        )
      ).some((r) => r.entityId === record.id),
    ).toBe(true);
    await operate(actor, { op: "archive", id: record.id });
    expect(
      await prisma.searchDocument.count({
        where: { workspaceId: actor.workspace.id, entityId: record.id },
      }),
    ).toBe(0);
  });
}
