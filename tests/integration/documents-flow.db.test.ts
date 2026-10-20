import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
import { prisma } from "@/lib/db";
import {
  saveDraft,
  issueDocument,
  cancelDocument,
  saveReference,
  saveSettings,
  allocatePayment,
  saveEvidence,
} from "@/lib/documents/service";
import { getDocument } from "@/lib/documents/access";
import type { DocumentsActor } from "@/lib/documents/access";
import { draftSchema } from "@/lib/documents/rules";
import { uploadDocumentFiles } from "@/lib/documents/files";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { queueDocumentEmail, renderDocumentEmail } from "@/lib/documents/email";
import { documentExport } from "@/lib/documents/export";
import { listDocuments } from "@/lib/documents/queries";
import { run } from "@/lib/scheduled/documents";
import { addPreArn, saveFilingBatch } from "@/lib/documents/filings";
import { evidenceBundle } from "@/lib/documents/bundle";
import { makeDocumentPdf } from "@/lib/documents/pdf";
import type { DocumentSnapshot } from "@/lib/documents/service";
import QRCode from "qrcode";
import { purgeWorkspace } from "@/lib/shell/retention";
import { deleteObjects, getObject } from "@/lib/storage";
const suffix = randomUUID().slice(0, 8);
let actor: DocumentsActor,
  other: DocumentsActor,
  member: DocumentsActor,
  signatoryId: string,
  registrationId: string,
  invoiceId: string,
  receiptId: string,
  issuedFileId: string;
let workspaceIds: string[] = [],
  userIds: string[] = [];
const draft = (extra: Record<string, unknown> = {}) =>
  draftSchema.parse({
    type: "TAX_INVOICE",
    title: "Programme support",
    issuedOn: "2026-10-01",
    dueOn: "2026-10-15",
    currency: "INR",
    partyName: "Community Foundation",
    partyAddress: "Kochi, Kerala",
    placeOfSupply: "32",
    placeRule: "Ordinary domestic services",
    supplyOn: "2026-10-01",
    registrationId,
    signatoryId,
    reviewed: true,
    lines: [
      {
        description: "Programme support",
        quantity: "1",
        unitMinor: 1000000,
        discountMinor: 0,
        hsn: "998599",
        unit: "NOS",
        rateBps: 1800,
      },
    ],
    ...extra,
  });
beforeAll(async () => {
  const u = await prisma.user.create({
      data: {
        email: `documents-${suffix}@example.org`,
        name: "Documents operator",
      },
    }),
    m = await prisma.user.create({
      data: { email: `documents-member-${suffix}@example.org`, name: "Member" },
    });
  userIds = [u.id, m.id];
  const w = await prisma.workspace.create({
      data: {
        slug: `documents-${suffix}`,
        name: "Community Office",
        financeVisibleToMembers: true,
      },
    }),
    w2 = await prisma.workspace.create({
      data: { slug: `documents-other-${suffix}`, name: "Other office" },
    });
  workspaceIds = [w.id, w2.id];
  await prisma.membership.createMany({
    data: [
      { workspaceId: w.id, userId: u.id, role: "OWNER" },
      { workspaceId: w2.id, userId: u.id, role: "OWNER" },
      { workspaceId: w.id, userId: m.id, role: "MEMBER" },
    ],
  });
  actor = {
    workspace: w,
    user: { id: u.id, name: u.name },
    membership: { role: "OWNER" },
  };
  other = { ...actor, workspace: w2 };
  member = {
    workspace: w,
    user: { id: m.id, name: m.name },
    membership: { role: "OWNER" },
  };
  await prisma.governanceRecord.create({
    data: {
      workspaceId: w.id,
      kind: "LEGAL_ENTITY",
      title: "Community Office Society",
      details: {
        address: "Kochi, Kerala, India",
        pan: "ABCDE1234F",
        registration: "DEMO-SOCIETY",
      },
    },
  });
  signatoryId = await saveReference(actor, "SIGNATORY", "Secretary", {
    name: "Anita",
    designation: "Secretary",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    signatureFileId: "",
  });
  registrationId = await saveReference(actor, "REGISTRATION", "Kerala GST", {
    kind: "GST",
    identifier: "32ABCDE1234F1Z5",
    state: "32",
    address: "Kochi",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    reviewed: true,
  });
}, 60000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { storageKey: true },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await deleteObjects(files.map((f) => f.storageKey));
  await prisma.outboxMessage.deleteMany({
    where: { payload: { path: ["workspaceId"], equals: workspaceIds[0] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}, 60000);
describe("Documents controlled issuance and privacy", () => {
  it("rechecks membership instead of trusting a forged role", async () => {
    await expect(saveDraft(member, draft())).rejects.toThrow("access");
  });
  it("rejects cross-workspace registrations", async () => {
    const id = await saveDraft(other, draft());
    await expect(issueDocument(other, id)).rejects.toThrow();
  });
  it("requires INR preparation for GST tax records", async () => {
    const id = await saveDraft(actor, draft({ currency: "USD" }));
    await expect(issueDocument(actor, id)).rejects.toThrow("GST values in INR");
  });
  it("rejects cross-workspace CRM and sources", async () => {
    const c = await prisma.contact.create({
      data: { workspaceId: other.workspace.id, displayName: "Foreign contact" },
    });
    await expect(saveDraft(actor, draft({ contactId: c.id }))).rejects.toThrow(
      "workspace",
    );
    await expect(
      saveDraft(actor, draft({ sourceType: "LEDGER", sourceId: "foreign" })),
    ).rejects.toThrow("workspace");
  });
  it("issues an immutable A4 PDF with correct tax", async () => {
    invoiceId = await saveDraft(actor, draft());
    await issueDocument(actor, invoiceId);
    const r = await getDocument(actor, invoiceId);
    expect(r.status).toBe("ISSUED");
    expect(r.totalMinor).toBe(1180000);
    const pdf = await prisma.documentFile.findFirstOrThrow({
      where: {
        workspaceId: actor.workspace.id,
        documentId: invoiceId,
        kind: "PDF",
      },
      include: { file: true },
    });
    issuedFileId = pdf.fileId;
    const bytes = await getObject(pdf.file.storageKey);
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!.body).subarray(0, 5).toString()).toBe("%PDF-");
    await mkdir("tmp/pdfs", { recursive: true });
    await writeFile("tmp/pdfs/documents-invoice.pdf", bytes!.body);
  });
  it("issue retries keep the same number and artifact", async () => {
    const prior = await getDocument(actor, invoiceId);
    await Promise.all([
      issueDocument(actor, invoiceId),
      issueDocument(actor, invoiceId),
    ]);
    const next = await getDocument(actor, invoiceId);
    expect(next.number).toBe(prior.number);
    expect(
      await prisma.documentFile.count({
        where: {
          workspaceId: actor.workspace.id,
          documentId: invoiceId,
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
        where: { id: invoiceId },
        data: { totalMinor: 5 },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      prisma.businessDocument.delete({ where: { id: invoiceId } }),
    ).rejects.toThrow("retained");
    await expect(saveDraft(actor, draft({ id: invoiceId }))).rejects.toThrow(
      "cannot be edited",
    );
  });
  it("keeps artifacts unchanged after settings edits", async () => {
    const prior = await getDocument(actor, invoiceId);
    await saveSettings(actor, {
      country: "IN",
      footer: "New footer",
      fiscalStartMonth: 4,
    });
    await prisma.governanceRecord.updateMany({
      where: { workspaceId: actor.workspace.id, kind: "LEGAL_ENTITY" },
      data: { title: "Changed legal name" },
    });
    const r = await getDocument(actor, invoiceId);
    expect(r.snapshot).toEqual(prior.snapshot);
  });
  it("keeps partial cash and TDS separate and idempotent", async () => {
    receiptId = await saveDraft(
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
    await issueDocument(actor, receiptId);
    const payment = {
      receiptId,
      invoiceId,
      cashMinor: 500000,
      tdsMinor: 100000,
      key: randomUUID(),
    };
    const first = await allocatePayment(actor, payment);
    expect(await allocatePayment(actor, payment)).toBe(first);
    const { rows } = await listDocuments(actor);
    expect(rows.find((r) => r.id === invoiceId)?.balance).toBe(580000);
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
        parentId: invoiceId,
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
    expect((await getDocument(actor, invoiceId)).status).toBe("ISSUED");
  });
  it("excludes document files from the library and denies ordinary members", async () => {
    expect(await findDownloadableFile(issuedFileId, member.user.id)).toBeNull();
    expect(
      await findDownloadableFile(issuedFileId, actor.user.id),
    ).not.toBeNull();
    expect(
      await prisma.fileObject.count({
        where: { id: issuedFileId, ...(await libraryWhere(actor)) },
      }),
    ).toBe(0);
    await expect(
      prisma.fileObject.update({
        where: { id: issuedFileId },
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
    expect(await findDownloadableFile(issuedFileId, actor.user.id)).toBeNull();
    await expect(getDocument(actor, invoiceId)).rejects.toThrow("access");
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
  it("queues the frozen PDF through the outbox with delivery history", async () => {
    await queueDocumentEmail(actor, invoiceId, "accounts@example.org");
    const d = await prisma.documentDelivery.findFirstOrThrow({
        where: { workspaceId: actor.workspace.id, documentId: invoiceId },
      }),
      job = await prisma.outboxMessage.findUniqueOrThrow({
        where: { id: d.outboxId },
      });
    expect(job.kind).toBe("documents.email");
    const rendered = await renderDocumentEmail(job.payload);
    expect(rendered.to).toBe("accounts@example.org");
    expect(rendered.email.attachments?.[0].contentType).toBe("application/pdf");
    await expect(
      queueDocumentEmail(member, invoiceId, "accounts@example.org"),
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
          targetId: invoiceId,
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
        (d: { id: string }) => d.id === invoiceId,
      ).snapshot.identity.name,
    ).toBe("Community Office Society");
    await expect(
      documentExport(member, "json", "2026-10-01", "2026-10-31"),
    ).rejects.toThrow();
  });
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
      await findDownloadableFile(issuedFileId, actor.user.id),
    ).not.toBeNull();
  });
  it("rejects foreign uploads and invalid files", async () => {
    await expect(
      uploadDocumentFiles(other, invoiceId, "SOURCE", [
        new File(["proof"], "proof.pdf", { type: "application/pdf" }),
      ]),
    ).rejects.toThrow();
    await expect(
      uploadDocumentFiles(actor, invoiceId, "SOURCE", [
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
  it("retains customer refunds and rejects over-refunding", async () => {
    const id = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_REFUND",
        registrationId: "",
        parentId: receiptId,
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
      (await listDocuments(actor)).rows.find((r) => r.id === invoiceId)
        ?.balance,
    ).toBe(680000);
    const second = await saveDraft(
      actor,
      draft({
        type: "PAYMENT_REFUND",
        registrationId: "",
        parentId: receiptId,
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
        invoiceId,
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
  it("issues letters from approved merge wording and retains correction links", async () => {
    const templateId = await saveReference(
      actor,
      "TEMPLATE",
      "Volunteer completion",
      {
        type: "VOLUNTEER",
        body: "{{person}} served as {{role}} from {{start}} to {{end}} for {{hours}} hours.",
        version: "1",
      },
    );
    const id = await saveDraft(
      actor,
      draft({
        type: "VOLUNTEER",
        registrationId: "",
        templateId,
        partyName: "Meera",
        startsOn: "2026-04-01",
        endsOn: "2026-09-30",
        role: "Programme volunteer",
        hours: "40",
        lines: [],
      }),
    );
    await issueDocument(actor, id);
    expect((await getDocument(actor, id)).snapshot).toMatchObject({
      letter:
        "Meera served as Programme volunteer from 2026-04-01 to 2026-09-30 for 40 hours.",
    });
  });
  it("freezes accepted filing snapshots and prevents repeated originals", async () => {
    const invoice = await getDocument(actor, invoiceId);
    const input = {
      name: "October preparation",
      form: "GSTR1",
      start: "2026-10-01",
      end: "2026-10-31",
      status: "ACCEPTED",
      acknowledgement: "MANUAL-PORTAL-ACK",
      documentIds: invoice.number!,
    };
    const id = await saveFilingBatch(actor, input);
    await expect(saveFilingBatch(actor, { ...input, id })).rejects.toThrow(
      "frozen",
    );
    await expect(
      saveFilingBatch(actor, { ...input, name: "Repeated original" }),
    ).rejects.toThrow("already");
    await expect(
      prisma.documentReference.delete({ where: { id } }),
    ).rejects.toThrow("retained");
  });
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
      invoiceId,
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
  it("issues a reviewed utilisation certificate from the existing fund", async () => {
    const fund = await prisma.financeFund.create({
      data: {
        workspaceId: actor.workspace.id,
        name: "Community programme",
        currency: "INR",
      },
    });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "INCOME",
          description: "Grant received",
          amountMinor: 100000,
          currency: "INR",
          occurredOn: new Date("2026-04-01"),
        },
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "EXPENSE",
          description: "Programme materials",
          amountMinor: 80000,
          currency: "INR",
          occurredOn: new Date("2026-05-01"),
        },
      ],
    });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "INCOME",
          description: "Bank interest",
          amountMinor: 1000,
          currency: "INR",
          occurredOn: new Date("2026-06-01"),
        },
        {
          workspaceId: actor.workspace.id,
          fundId: fund.id,
          kind: "EXPENSE",
          description: "Unused funds returned",
          amountMinor: 500,
          currency: "INR",
          occurredOn: new Date("2026-09-30"),
        },
      ],
    });
    const id = await saveDraft(
      actor,
      draft({
        type: "CSR_UC",
        registrationId: "",
        fundId: fund.id,
        sourceType: "FUND",
        sourceId: fund.id,
        periodStart: "2026-04-01",
        periodEnd: "2026-09-30",
        sanction: "Programme agreement dated 1 April 2026",
        schedules: "Equipment schedule checked against ledger",
        outcomes: "Three community workshops",
        receiptsMinor: 100000,
        interestMinor: 1000,
        refundsMinor: 500,
        expenditureMinor: 80000,
        lines: [],
      }),
    );
    await issueDocument(actor, id);
    const snapshot = (await getDocument(actor, id))
      .snapshot as unknown as DocumentSnapshot;
    expect(snapshot.source.fundId).toBe(fund.id);
    expect(snapshot.source.incomeMinor).toBe(101000);
    expect(snapshot.source.expenseMinor).toBe(80500);
    expect((await getDocument(actor, id)).status).toBe("ISSUED");
  });
  it("exports a complete evidence ZIP with checksums", async () => {
    const bytes = await evidenceBundle(actor, "2026-10-01", "2026-10-31");
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from("manifest.json"))).toBe(true);
    await writeFile("tmp/pdfs/documents-evidence.zip", bytes);
  });
  it("paginates long PDF content without truncating the final line", async () => {
    const row = await getDocument(actor, invoiceId),
      snapshot = row.snapshot as unknown as DocumentSnapshot;
    const long = {
      ...snapshot,
      calculation: {
        ...snapshot.calculation,
        rows: Array.from({ length: 45 }, (_, i) => ({
          ...snapshot.calculation.rows[0],
          description: `Programme schedule item ${i + 1}: a detailed description that wraps safely onto another line when necessary.`,
        })),
      },
    };
    const bytes = await makeDocumentPdf(long);
    await writeFile("tmp/pdfs/documents-long.pdf", bytes);
    expect(bytes.length).toBeGreaterThan(10000);
  });
});
