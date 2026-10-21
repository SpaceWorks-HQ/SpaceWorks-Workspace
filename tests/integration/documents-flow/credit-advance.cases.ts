import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, allocatePayment } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { documentExport } from "@/lib/documents/export";
import { listDocuments } from "@/lib/documents/queries";
import type { DocumentSnapshot } from "@/lib/documents/service";
import { actor, draft, records } from "./fixtures";

export function registerCreditAdvanceTests() {
  it("allocates one commercial credit across two original invoices", async () => {
    const originals = await Promise.all([
      saveDraft(actor, draft({ title: "First original" })),
      saveDraft(actor, draft({ title: "Second original" })),
    ]);
    for (const id of originals) await issueDocument(actor, id);
    const docs = await Promise.all(
      originals.map((id) => getDocument(actor, id)),
    );
    const id = await saveDraft(
      actor,
      draft({
        type: "CREDIT_NOTE",
        gstAdjustment: false,
        overrideReason: "Goodwill discount without changing the original GST",
        registrationId: "",
        noteAllocations: `${docs[0].number} | 50.00\n${docs[1].number} | 50.00`,
        lines: [
          {
            description: "Goodwill adjustment",
            quantity: "1",
            unitMinor: 10000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, id);
    const snapshot = (await getDocument(actor, id))
      .snapshot as unknown as DocumentSnapshot;
    expect(snapshot.source.noteAllocations).toHaveLength(2);
    const register = await listDocuments(actor);
    for (const original of originals)
      expect(register.rows.find((r) => r.id === original)?.balance).toBe(
        1175000,
      );
    const exported = await documentExport(
      actor,
      "gst",
      "2026-10-01",
      "2026-10-31",
    );
    expect(exported.body).not.toContain((await getDocument(actor, id)).number);
  });
  it("exports an earlier advance adjustment without duplicating cash", async () => {
    const id = await saveDraft(
      actor,
      draft({
        type: "RECEIPT_VOUCHER",
        issuedOn: "2026-09-20",
        supplyOn: "2026-09-20",
        paymentOn: "2026-09-20",
        paymentMode: "BANK",
        paymentReference: "ADVANCE-REFERENCE",
        cashMinor: 11800,
        lines: [
          {
            description: "Advance for programme",
            quantity: "1",
            unitMinor: 10000,
            rateBps: 1800,
            hsn: "998599",
            unit: "NOS",
          },
        ],
      }),
    );
    await issueDocument(actor, id);
    await allocatePayment(actor, {
      receiptId: id,
      invoiceId: records.invoiceId,
      cashMinor: 11800,
      tdsMinor: 0,
      key: randomUUID(),
    });
    const hsn = await documentExport(actor, "hsn", "2026-09-01", "2026-09-30");
    expect(hsn.body.trim().split("\r\n")).toHaveLength(1);
    const day = new Date().toISOString().slice(0, 10);
    const exported = await documentExport(actor, "gst", day, day);
    expect(exported.body).toContain("ADVANCE_ALLOCATION");
    expect(exported.body).toContain("ATADJ");
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: actor.workspace.id },
      }),
    ).toBe(0);
  });
}
