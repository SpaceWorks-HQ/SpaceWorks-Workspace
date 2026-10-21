import { it, expect } from "vitest";
import { saveDraft, issueDocument, cancelDocument, saveEvidence } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { actor, draft } from "./fixtures";

export function registerTaxComplianceTests() {
  it("reserves e-invoice facts and refuses IRN-only completion", async () => {
    const id = await saveDraft(
      actor,
      draft({ title: "IRP evidence", irnRequired: true }),
    );
    await issueDocument(actor, id);
    expect((await getDocument(actor, id)).status).toBe("RESERVED");
    await saveEvidence(actor, id, {
      irn: "a".repeat(64),
      acknowledgement: "ACK-1",
      acknowledgementAt: "2026-10-01T10:00:00Z",
    });
    await expect(issueDocument(actor, id)).rejects.toThrow("signed QR");
    await cancelDocument(actor, id, "Abandoned portal submission");
    expect((await getDocument(actor, id)).number).not.toBeNull();
  });
  it("blocks unsupported donation deductions", async () => {
    const id = await saveDraft(
      actor,
      draft({
        type: "DONATION_CERTIFICATE",
        registrationId: "",
        paymentOn: "2026-10-01",
        paymentMode: "CASH",
        cashMinor: 300000,
        paymentReference: "Cash",
        lines: [
          {
            description: "Donation",
            quantity: "1",
            unitMinor: 300000,
            rateBps: 0,
          },
        ],
      }),
    );
    await expect(issueDocument(actor, id)).rejects.toThrow();
  });
  it("requires FCRA source and account confirmation", async () => {
    const id = await saveDraft(
      actor,
      draft({
        type: "FCRA_RECEIPT",
        paymentOn: "2026-10-01",
        paymentMode: "BANK",
        cashMinor: 1000000,
        paymentReference: "Bank",
        lines: [
          {
            description: "Foreign contribution",
            quantity: "1",
            unitMinor: 1000000,
            rateBps: 0,
          },
        ],
      }),
    );
    await expect(issueDocument(actor, id)).rejects.toThrow("FCRA");
  });
}
