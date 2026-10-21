import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, cancelDocument } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { findDownloadableFile } from "@/lib/files";
import { purgeWorkspace } from "@/lib/shell/retention";
import { actor, draft, records } from "./fixtures";

export function registerCancellationRetentionTests() {
  it("keeps cancellation number and original artifact", async () => {
    const id = await saveDraft(actor, draft({ title: "Cancelled example" }));
    await issueDocument(actor, id);
    const old = await getDocument(actor, id);
    await cancelDocument(actor, id, "Recipient transaction cancelled");
    const current = await getDocument(actor, id);
    expect(current.number).toBe(old.number);
    expect(current.snapshot).toEqual(old.snapshot);
    expect(current.status).toBe("CANCELLED");
    expect(
      await prisma.documentFile.count({
        where: { workspaceId: actor.workspace.id, documentId: id, kind: "PDF" },
      }),
    ).toBe(1);
    await expect(issueDocument(actor, id)).rejects.toThrow("Cancelled");
  });
  it("retains statutory audit under ordinary retention and legal hold", async () => {
    await prisma.retentionPolicy.create({
      data: {
        workspaceId: actor.workspace.id,
        entityType: "audit",
        keepDays: 1,
        action: "DELETE",
      },
    });
    await purgeWorkspace(actor.workspace.id, new Date("2035-01-01"));
    expect(
      await prisma.auditEvent.count({
        where: { workspaceId: actor.workspace.id, action: "documents.issued" },
      }),
    ).toBeGreaterThan(0);
    expect(
      await findDownloadableFile(records.issuedFileId, actor.user.id),
    ).not.toBeNull();
  });
}
