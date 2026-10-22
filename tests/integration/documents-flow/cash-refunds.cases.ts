import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, cancelDocument, allocatePayment } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { listDocuments } from "@/lib/documents/queries";
import { run } from "@/lib/scheduled/documents";
import type { DocumentSnapshot } from "@/lib/documents/service";
import { actor, draft, records } from "./fixtures";

export function registerCashRefundsTests() {
  it("retains customer refunds and rejects over-refunding", async () => {
    const id = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_REFUND",
        registrationId: "",
        parentId: records.receiptId,
        title: "Customer refund",
        notes: "Agreed partial refund",
        paymentOn: "2026-10-20",
        paymentMode: "BANK",
        paymentReference: "REFUND-1",
        cashMinor: 100000,
        lines: [
          {
            description: "Refund",
            quantity: "1",
            unitMinor: 100000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, id);
    expect((await getDocument(actor, id)).type).toBe("PAYMENT_REFUND");
    expect(
      (await listDocuments(actor)).rows.find((r) => r.id === records.invoiceId)
        ?.balance,
    ).toBe(680000);
    const second = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_REFUND",
        registrationId: "",
        parentId: records.receiptId,
        title: "Excess refund",
        notes: "Review",
        paymentOn: "2026-10-20",
        paymentMode: "BANK",
        paymentReference: "REFUND-2",
        cashMinor: 700000,
        lines: [
          {
            description: "Refund",
            quantity: "1",
            unitMinor: 700000,
            rateBps: 0,
          },
        ],
      }),
    );
    await expect(issueDocument(actor, second)).rejects.toThrow("exceeds");
  });
  it("refunds settled cash without reusing it and keeps credits separate", async () => {
    const original = await saveDraft(
      actor,
      draft({ title: "Paid invoice to credit" }),
    );
    await issueDocument(actor, original);
    const payment = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_RECEIPT",
        registrationId: "",
        paymentOn: "2026-10-10",
        paymentMode: "BANK",
        paymentReference: "PAID-REFUND",
        cashMinor: 1180000,
        lines: [
          {
            description: "Payment",
            quantity: "1",
            unitMinor: 1180000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, payment);
    await allocatePayment(actor, {
      receiptId: payment,
      invoiceId: original,
      cashMinor: 1180000,
      tdsMinor: 0,
      key: randomUUID(),
    });
    const credit = await saveDraft(
      actor,
      draft({
        type: "CREDIT_NOTE",
        parentId: original,
        registrationId: "",
        gstAdjustment: false,
        overrideReason:
          "Reviewed commercial goodwill credit without changing GST",
        lines: [
          {
            description: "Commercial credit",
            quantity: "1",
            unitMinor: 118000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, credit);
    const refund = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_REFUND",
        parentId: payment,
        registrationId: "",
        paymentOn: "2026-10-20",
        paymentMode: "BANK",
        paymentReference: "CASH-RETURN",
        notes: "Returned the agreed credited cash",
        cashMinor: 118000,
        lines: [
          {
            description: "Cash returned",
            quantity: "1",
            unitMinor: 118000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, refund);
    const snapshot = (await getDocument(actor, refund))
      .snapshot as unknown as DocumentSnapshot;
    expect(snapshot.source.refundAllocations).toEqual([
      expect.objectContaining({ invoiceId: original, cashMinor: 118000 }),
    ]);
    expect(
      (await listDocuments(actor)).rows.find((r) => r.id === original)?.balance,
    ).toBe(0);
    await expect(
      allocatePayment(actor, {
        receiptId: payment,
        invoiceId: records.invoiceId,
        key: randomUUID(),
        cashMinor: 1,
        tdsMinor: 0,
      }),
    ).rejects.toThrow("balance");
    await cancelDocument(actor, credit, "Credit was entered incorrectly");
    expect(
      (await listDocuments(actor)).rows.find((r) => r.id === original)?.balance,
    ).toBe(118000);
    await run(new Date("2026-10-22T08:00:00Z"));
    expect(
      await prisma.auditEvent.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          targetId: original,
          action: "documents.followup_reminded",
          metadata: { path: ["day"], equals: "2026-10-22" },
        },
      }),
    ).not.toBeNull();
  });
  it("shares the cash refund bound across payment and advance refund variants", async () => {
    const advance = await saveDraft(
      actor,
      draft({
        type: "RECEIPT_VOUCHER",
        paymentOn: "2026-10-10",
        paymentMode: "BANK",
        paymentReference: "ADVANCE-TO-RETURN",
        cashMinor: 118000,
        lines: [
          {
            description: "Advance",
            quantity: "1",
            unitMinor: 100000,
            rateBps: 1800,
            hsn: "998599",
            unit: "NOS",
          },
        ],
      }),
    );
    await issueDocument(actor, advance);
    const first = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_REFUND",
        registrationId: "",
        parentId: advance,
        paymentOn: "2026-10-20",
        paymentMode: "BANK",
        paymentReference: "PARTIAL-ADVANCE-RETURN",
        notes: "First half returned",
        cashMinor: 59000,
        lines: [
          {
            description: "Refund",
            quantity: "1",
            unitMinor: 59000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, first);
    await expect(
      cancelDocument(actor, advance, "Incorrect source cancellation"),
    ).rejects.toThrow("refunded");
    const excess = await saveDraft(
      actor,
      draft({
        type: "REFUND_VOUCHER",
        parentId: advance,
        paymentOn: "2026-10-20",
        paymentMode: "BANK",
        paymentReference: "EXCESS-RETURN",
        notes: "Review returned advance",
        cashMinor: 59100,
        lines: [
          {
            description: "Refund",
            quantity: "1",
            unitMinor: 59100,
            rateBps: 0,
            hsn: "998599",
            unit: "NOS",
          },
        ],
      }),
    );
    await expect(issueDocument(actor, excess)).rejects.toThrow("exceeds");
  });
}
