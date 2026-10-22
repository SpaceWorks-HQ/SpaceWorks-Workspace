import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { financeAccess } from "@/lib/finance/tools/access";
import { indexSearchDocument } from "@/lib/search/documents";
import {
  documentsAccess,
  DocumentsError,
  getDocument,
  lockDocuments,
  type DocumentsActor,
} from "../access";
import { draftSchema, type DraftInput } from "../rules";
import { audit, date, json } from "./shared";

export async function validateSources(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
) {
  const workspaceId = actor.workspace.id;
  if (
    v.contactId &&
    !(await tx.contact.findFirst({
      where: { id: v.contactId, workspaceId, deletedAt: null },
    }))
  )
    throw new DocumentsError("Choose a CRM contact in this workspace.");
  if (
    v.organisationId &&
    !(await tx.organisation.findFirst({
      where: { id: v.organisationId, workspaceId, deletedAt: null },
    }))
  )
    throw new DocumentsError("Choose a CRM organisation in this workspace.");
  if (
    v.personId &&
    !(await tx.memberProfile.findFirst({
      where: { workspaceId, userId: v.personId },
    }))
  )
    throw new DocumentsError("Choose a person in this workspace.");
  const where = { workspaceId, id: v.sourceId };
  let source: unknown;
  if (v.sourceType === "INVOICE")
    source = await tx.invoice.findFirst({ where });
  if (v.sourceType === "LEDGER")
    source = await tx.ledgerEntry.findFirst({
      where: { ...where, privatePayroll: false, voidedAt: null },
    });
  if (v.sourceType === "FUND")
    source = await tx.financeFund.findFirst({
      where: { ...where, archivedAt: null },
    });
  if (v.sourceType === "DEAL") source = await tx.deal.findFirst({ where });
  if (v.sourceType === "CONTRACT")
    source = await tx.governanceRecord.findFirst({
      where: { ...where, kind: "CONTRACT", archivedAt: null },
    });
  if (v.sourceType === "PAY_RUN") {
    await financeAccess(actor, "PAY_MANAGE", tx);
    source = await tx.financePayRun.findFirst({ where });
  }
  if (v.sourceType === "FUNDING")
    source = await tx.fundingRecord.findFirst({
      where: {
        ...where,
        archivedAt: null,
        kind: { in: ["DONATION", "GRANT"] },
      },
    });
  if (v.sourceType && !source)
    throw new DocumentsError("Choose a source record in this workspace.");
  if (v.parentId) {
    const parent = await getDocument(actor, v.parentId, tx);
    if (
      !["ISSUED", "CANCELLED"].includes(parent.status) ||
      parent.currency !== v.currency
    )
      throw new DocumentsError(
        "Choose an issued original in the same currency.",
      );
  }
}
export async function saveDraft(actor: DocumentsActor, raw: unknown) {
  const v = draftSchema.parse(raw);
  if (v.type === "PAYSLIP")
    throw new DocumentsError(
      "Generate the paid payslip from Payroll so it uses the approved run.",
    );
  await documentsAccess(actor, v.type);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await documentsAccess(actor, v.type, tx);
    await validateSources(actor, v, tx);
    if (v.id) {
      const old = await getDocument(actor, v.id, tx);
      if (old.status !== "DRAFT")
        throw new DocumentsError(
          "Issued or reserved documents cannot be edited. Create a linked correction.",
        );
    }
    const row = await tx.businessDocument.upsert({
      where: { id: v.id || "__new__" },
      create: {
        workspaceId: actor.workspace.id,
        type: v.type,
        title: v.title,
        issuedOn: date(v.issuedOn),
        dueOn: v.dueOn ? date(v.dueOn) : null,
        currency: v.currency,
        ownerId: actor.user.id,
        registrationId: v.registrationId,
        input: json(v),
        sourceType: v.sourceType || null,
        sourceId: v.sourceId || null,
        parentId: v.parentId || null,
      },
      update: {
        type: v.type,
        title: v.title,
        issuedOn: date(v.issuedOn),
        dueOn: v.dueOn ? date(v.dueOn) : null,
        currency: v.currency,
        registrationId: v.registrationId,
        input: json(v),
        sourceType: v.sourceType || null,
        sourceId: v.sourceId || null,
        parentId: v.parentId || null,
      },
    });
    await audit(actor, "draft_saved", row.id, tx);
    if (v.sourceType !== "PAY_RUN")
      await indexSearchDocument(
        {
          workspaceId: actor.workspace.id,
          entityType: "business_document",
          entityId: row.id,
          title: v.title,
          url: `/w/${actor.workspace.slug}/documents/${row.id}`,
          visibility: "PRIVATE",
          ownerId: actor.user.id,
        },
        tx,
      );
    return row.id;
  });
}
