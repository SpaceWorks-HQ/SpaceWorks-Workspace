import { it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, saveSettings } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { getObject } from "@/lib/storage";
import { actor, draft, records } from "./fixtures";

export function registerIssuanceTests() {
  it("issues an immutable A4 PDF with correct tax", async () => {
    records.invoiceId = await saveDraft(actor, draft());
    await issueDocument(actor, records.invoiceId);
    const r = await getDocument(actor, records.invoiceId);
    expect(r.status).toBe("ISSUED");
    expect(r.totalMinor).toBe(1180000);
    const pdf = await prisma.documentFile.findFirstOrThrow({
      where: {
        workspaceId: actor.workspace.id,
        documentId: records.invoiceId,
        kind: "PDF",
      },
      include: { file: true },
    });
    records.issuedFileId = pdf.fileId;
    const bytes = await getObject(pdf.file.storageKey);
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!.body).subarray(0, 5).toString()).toBe("%PDF-");
    await mkdir("tmp/pdfs", { recursive: true });
    await writeFile("tmp/pdfs/documents-invoice.pdf", bytes!.body);
  });
  it("issue retries keep the same number and artifact", async () => {
    const prior = await getDocument(actor, records.invoiceId);
    await Promise.all([
      issueDocument(actor, records.invoiceId),
      issueDocument(actor, records.invoiceId),
    ]);
    const next = await getDocument(actor, records.invoiceId);
    expect(next.number).toBe(prior.number);
    expect(
      await prisma.documentFile.count({
        where: {
          workspaceId: actor.workspace.id,
          documentId: records.invoiceId,
          kind: "PDF",
        },
      }),
    ).toBe(1);
  });
  it("allocates distinct numbers under concurrent issuance", async () => {
    const ids = await Promise.all([
      saveDraft(actor, draft({ title: "Concurrent A" })),
      saveDraft(actor, draft({ title: "Concurrent B" })),
    ]);
    await Promise.all(ids.map((id) => issueDocument(actor, id)));
    const rows = await prisma.businessDocument.findMany({
      where: { workspaceId: actor.workspace.id, id: { in: ids } },
    });
    expect(new Set(rows.map((r) => r.number)).size).toBe(2);
  });
  it("enforces immutable facts even through direct database edits", async () => {
    await expect(
      prisma.businessDocument.update({
        where: { id: records.invoiceId },
        data: { totalMinor: 5 },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      prisma.businessDocument.delete({ where: { id: records.invoiceId } }),
    ).rejects.toThrow("retained");
    await expect(saveDraft(actor, draft({ id: records.invoiceId }))).rejects.toThrow(
      "cannot be edited",
    );
  });
  it("keeps artifacts unchanged after settings edits", async () => {
    const prior = await getDocument(actor, records.invoiceId);
    await saveSettings(actor, {
      country: "IN",
      footer: "New footer",
      fiscalStartMonth: 4,
    });
    await prisma.governanceRecord.updateMany({
      where: { workspaceId: actor.workspace.id, kind: "LEGAL_ENTITY" },
      data: { title: "Changed legal name" },
    });
    const r = await getDocument(actor, records.invoiceId);
    expect(r.snapshot).toEqual(prior.snapshot);
  });
}
