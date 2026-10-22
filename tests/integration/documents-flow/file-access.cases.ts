import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { getDocument } from "@/lib/documents/access";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { actor, member, records } from "./fixtures";

export function registerFileAccessTests() {
  it("excludes document files from the library and denies ordinary members", async () => {
    expect(await findDownloadableFile(records.issuedFileId, member.user.id)).toBeNull();
    expect(
      await findDownloadableFile(records.issuedFileId, actor.user.id),
    ).not.toBeNull();
    expect(
      await prisma.fileObject.count({
        where: { id: records.issuedFileId, ...(await libraryWhere(actor)) },
      }),
    ).toBe(0);
    await expect(
      prisma.fileObject.update({
        where: { id: records.issuedFileId },
        data: { deletedAt: new Date() },
      }),
    ).rejects.toThrow("protected");
  });
  it("checks workspace archive and membership suspension for file reads", async () => {
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: actor.user.id,
          workspaceId: actor.workspace.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    expect(await findDownloadableFile(records.issuedFileId, actor.user.id)).toBeNull();
    await expect(getDocument(actor, records.invoiceId)).rejects.toThrow("access");
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: actor.user.id,
          workspaceId: actor.workspace.id,
        },
      },
      data: { status: "ACTIVE" },
    });
  });
}
