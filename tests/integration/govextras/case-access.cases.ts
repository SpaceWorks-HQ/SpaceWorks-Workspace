import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  appointHandler,
  createCase,
  loadCases,
  uploadCaseFile,
  caseAccess,
} from "@/lib/govextras/cases";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { indexSearchDocument } from "@/lib/search/documents";
import {
  suffix,
  owner,
  admin,
  handler,
  second,
  other,
  guest,
  committee,
  proof,
  records,
} from "./fixtures";

export function registerCaseAccessTests() {
  it("lets only owners record explicit current committee appointments", async () => {
    await expect(
      appointHandler(admin, {
        userId: handler.user.id,
        committeeId: committee,
        endsOn: "2099-12-31",
      }),
    ).rejects.toThrow();
    await expect(
      appointHandler(owner, {
        userId: other.user.id,
        committeeId: committee,
        endsOn: "2099-12-31",
      }),
    ).rejects.toThrow();
    for (const userId of [handler.user.id, second.user.id])
      await appointHandler(owner, {
        userId,
        committeeId: committee,
        endsOn: "2099-12-31",
      });
    expect((await loadCases(owner, {})).appointed).toBe(false);
    expect((await loadCases(handler, {})).appointed).toBe(true);
  });
  it("keeps case details from owners, admins, guests and unassigned handlers", async () => {
    records.caseId = (
      await createCase(handler, {
        kind: "POSH",
        receivedOn: "2026-10-01",
        dueOn: "2026-10-31",
        handlerIds: [handler.user.id],
        details: "Private concern for committee",
      })
    ).id;
    const stored = await prisma.safeguardingCase.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: records.caseId },
    });
    expect(stored.detailsEnc).not.toContain("Private concern");
    for (const denied of [
      owner,
      admin,
      guest,
      second,
      other,
      { ...admin, membership: { role: "OWNER" as const } },
    ])
      await expect(caseAccess(denied, records.caseId)).rejects.toThrow();
    expect(
      (
        await loadCases(handler, {
          q: "999999999999999999999999999999999999999",
        })
      ).rows,
    ).toHaveLength(0);
    expect((await loadCases(handler, {}, records.caseId)).selected?.details).toBe(
      "Private concern for committee",
    );
    await expect(
      createCase(admin, {
        kind: "POSH",
        receivedOn: "2026-10-01",
        dueOn: "2026-10-31",
        handlerIds: [admin.user.id],
        details: "Concern",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.searchDocument.count({
        where: { workspaceId: owner.workspace.id, entityId: records.caseId },
      }),
    ).toBe(0);
  });
  it("stores case photos and PDFs with source-specific access outside the file library", async () => {
    const file = await uploadCaseFile(handler, records.caseId, proof());
    expect(await findDownloadableFile(file.id, handler.user.id)).not.toBeNull();
    for (const denied of [owner, admin, second, other, guest])
      expect(await findDownloadableFile(file.id, denied.user.id)).toBeNull();
    const exported = await buildWorkspaceExport(owner.workspace.id);
    expect(JSON.stringify(exported)).not.toContain(file.id);
    await indexSearchDocument({
      workspaceId: owner.workspace.id,
      entityType: "file",
      entityId: file.id,
      title: `Restricted proof ${suffix}`,
      url: `/api/files/${file.id}`,
      visibility: "WORKSPACE",
    });
    expect(
      await searchDocuments(
        {
          workspaceId: owner.workspace.id,
          userId: owner.user.id,
          role: "OWNER",
        },
        suffix,
        "file",
      ),
    ).toHaveLength(0);
    const user = await prisma.user.findFirstOrThrow({
      where: { id: handler.user.id },
    });
    expect(
      await prisma.fileObject.count({
        where: {
          ...(await libraryWhere({
            ...handler,
            user: { id: user.id, name: user.name },
          })),
          id: file.id,
        },
      }),
    ).toBe(0);
    await expect(
      uploadCaseFile(
        handler,
        records.caseId,
        new File(["bad"], "bad.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow();
    await expect(uploadCaseFile(admin, records.caseId, proof())).rejects.toThrow();
    const orphan = await prisma.fileObject.create({
      data: {
        workspaceId: owner.workspace.id,
        folder: "/safeguarding",
        filename: "orphan.pdf",
        storageKey: `orphan-${suffix}`,
        contentType: "application/pdf",
        size: 1,
      },
    });
    expect(await findDownloadableFile(orphan.id, owner.user.id)).toBeNull();
  });
}
