import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveDraft, issueDocument, saveReference, saveEvidence } from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import { uploadDocumentFiles } from "@/lib/documents/files";
import { documentExport } from "@/lib/documents/export";
import { addPreArn } from "@/lib/documents/filings";
import QRCode from "qrcode";
import { actor, other, draft, records } from "./fixtures";

export function registerDocumentEvidenceTests() {
  it("rejects foreign uploads and invalid files", async () => {
    await expect(
      uploadDocumentFiles(other, records.invoiceId, "SOURCE", [
        new File(["proof"], "proof.pdf", { type: "application/pdf" }),
      ]),
    ).rejects.toThrow();
    await expect(
      uploadDocumentFiles(actor, records.invoiceId, "SOURCE", [
        new File(["bad"], "proof.exe", { type: "application/octet-stream" }),
      ]),
    ).rejects.toThrow("type");
  });
  it("generates current donation certificates with consumed portal references", async () => {
    const approvalId = await saveReference(
      actor,
      "REGISTRATION",
      "Reviewed 354 approval",
      {
        kind: "DONATION_APPROVAL",
        identifier: "DEMO-APPROVAL-URN",
        state: "",
        address: "Kochi",
        validFrom: "2026-04-01",
        validTo: "2027-03-31",
        section: "354",
        orderDate: "2026-04-01",
        reviewed: true,
      },
    );
    await addPreArn(actor, {
      reference: "IMPORTED-PRE-ARN-TEST",
      donationYear: "2026-27",
      form: "114",
    });
    const id = await saveDraft(
      actor,
      draft({
        type: "DONATION_CERTIFICATE",
        registrationId: "",
        approvalId,
        paymentOn: "2026-10-01",
        paymentMode: "BANK",
        paymentReference: "DONATION-BANK-1",
        cashMinor: 100000,
        donorIdType: "PAN",
        donorId: "ABCDE1234F",
        deductionSection: "354",
        portalReference: "IMPORTED-PRE-ARN-TEST",
        lines: [
          {
            description: "Voluntary contribution",
            quantity: "1",
            unitMinor: 100000,
            rateBps: 0,
          },
        ],
      }),
    );
    await issueDocument(actor, id);
    const r = await getDocument(actor, id);
    expect(r.status).toBe("ISSUED");
    const pre = await prisma.documentReference.findFirstOrThrow({
      where: { workspaceId: actor.workspace.id, kind: "PRE_ARN" },
    });
    expect(pre.data).toMatchObject({ status: "CONSUMED", documentId: id });
    const out = await documentExport(
      actor,
      "donations",
      "2026-10-01",
      "2026-10-31",
    );
    expect(out.body).toContain('"113"');
    expect(out.body).toContain('"354"');
    const second = await saveDraft(
      actor,
      draft({ ...(r.input as object), id: "", title: "Duplicate certificate" }),
    );
    await expect(issueDocument(actor, second)).rejects.toThrow("consumed");
  });
  it("completes a reserved invoice only with both signed evidence files", async () => {
    const id = await saveDraft(
      actor,
      draft({ title: "Complete IRP test", irnRequired: true }),
    );
    await issueDocument(actor, id);
    await saveEvidence(actor, id, {
      irn: "b".repeat(64),
      acknowledgement: "ACK-2",
      acknowledgementAt: "2026-10-01T10:00:00Z",
    });
    const qr = await QRCode.toBuffer("test-imported-signed-qr");
    await uploadDocumentFiles(actor, id, "IRP_QR", [
      new File([new Uint8Array(qr)], "irp-qr.png", { type: "image/png" }),
    ]);
    await uploadDocumentFiles(actor, id, "IRP_JSON", [
      new File(
        [JSON.stringify({ SignedInvoice: "test-signed-evidence" })],
        "signed.json",
        { type: "application/json" },
      ),
    ]);
    await issueDocument(actor, id);
    expect((await getDocument(actor, id)).status).toBe("ISSUED");
  });
}
