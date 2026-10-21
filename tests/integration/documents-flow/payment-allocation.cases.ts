import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, allocatePayment } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { listDocuments } from "@/lib/documents/queries";
import { actor, draft, records } from "./fixtures";

export function registerPaymentAllocationTests() {
  it("keeps partial cash and TDS separate and idempotent", async () => {
    records.receiptId = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_RECEIPT",
        title: "Part-payment",
        registrationId: "",
        paymentOn: "2026-10-10",
        paymentMode: "BANK",
        paymentReference: "BANK-DEMO-1",
        cashMinor: 500000,
        tdsMinor: 100000,
        tdsSection: "393",
        lines: [
          {
            description: "Part-payment",
            quantity: "1",
            unitMinor: 600000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, records.receiptId);
    const payment = {
      receiptId: records.receiptId,
      invoiceId: records.invoiceId,
      cashMinor: 500000,
      tdsMinor: 100000,
      key: randomUUID(),
    };
    const first = await allocatePayment(actor, payment);
    expect(await allocatePayment(actor, payment)).toBe(first);
    const { rows } = await listDocuments(actor);
    expect(rows.find((r) => r.id === records.invoiceId)?.balance).toBe(580000);
    await expect(
      allocatePayment(actor, {
        ...payment,
        key: randomUUID(),
        cashMinor: 1,
        tdsMinor: 0,
      }),
    ).rejects.toThrow("balance");
    await expect(
      allocatePayment(actor, { ...payment, tdsMinor: 0 }),
    ).rejects.toThrow("different allocation");
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: actor.workspace.id },
      }),
    ).toBe(0);
  });
  it("refuses over-crediting and retains the original", async () => {
    const id = await saveDraft(
      actor,
      draft({
        type: "CREDIT_NOTE",
        parentId: records.invoiceId,
        title: "Credit correction",
        lines: [
          {
            description: "Correction",
            quantity: "1",
            unitMinor: 2000000,
            rateBps: 1800,
            hsn: "998599",
            unit: "NOS",
          },
        ],
      }),
    );
    await expect(issueDocument(actor, id)).rejects.toThrow("exceeds");
    expect((await getDocument(actor, records.invoiceId)).status).toBe("ISSUED");
  });
}
