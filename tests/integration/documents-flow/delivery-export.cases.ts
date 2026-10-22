import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { queueDocumentEmail, renderDocumentEmail } from "@/lib/documents/email";
import { documentExport } from "@/lib/documents/export";
import { run } from "@/lib/scheduled/documents";
import { actor, member, records } from "./fixtures";

export function registerDeliveryExportTests() {
  it("queues the frozen PDF through the outbox with delivery history", async () => {
    await queueDocumentEmail(actor, records.invoiceId, "accounts@example.org");
    const d = await prisma.documentDelivery.findFirstOrThrow({
        where: { workspaceId: actor.workspace.id, documentId: records.invoiceId },
      }),
      job = await prisma.outboxMessage.findUniqueOrThrow({
        where: { id: d.outboxId },
      });
    expect(job.kind).toBe("documents.email");
    const rendered = await renderDocumentEmail(job.payload);
    expect(rendered.to).toBe("accounts@example.org");
    expect(rendered.email.attachments?.[0].contentType).toBe("application/pdf");
    await expect(
      queueDocumentEmail(member, records.invoiceId, "accounts@example.org"),
    ).rejects.toThrow();
  });
  it("sends one reminder per day only for remaining balances", async () => {
    const day = new Date("2026-10-20T12:00:00Z");
    await run(day);
    await run(day);
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: actor.workspace.id,
          targetId: records.invoiceId,
          action: "documents.followup_reminded",
        },
      }),
    ).toBe(1);
  });
  it("exports escaped accountant CSV and complete snapshots", async () => {
    const out = await documentExport(actor, "gst", "2026-10-01", "2026-10-31");
    expect(out.body).not.toContain("GSTR portal");
    expect(out.body).toContain("B2CS");
    expect(out.body).toContain("998599");
    const json = await documentExport(
      actor,
      "json",
      "2026-10-01",
      "2026-10-31",
    );
    expect(
      JSON.parse(json.body).documents.find(
        (d: { id: string }) => d.id === records.invoiceId,
      ).snapshot.identity.name,
    ).toBe("Community Office Society");
    await expect(
      documentExport(member, "json", "2026-10-01", "2026-10-31"),
    ).rejects.toThrow();
  });
}
