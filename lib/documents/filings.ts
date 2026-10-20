import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { dateSchema, donationForm, draftSchema, GST_TYPES } from "./rules";
import {
  documentsAccess,
  getDocument,
  lockDocuments,
  DocumentsError,
  type DocumentsActor,
} from "./access";
import { audit, object } from "./service";
export async function addPreArn(actor: DocumentsActor, raw: unknown) {
  const v = z
    .object({
      reference: z.string().trim().min(1).max(100),
      donationYear: z.string().regex(/^\d{4}-\d{2}$/),
      form: z.enum(["10BE", "114"]),
    })
    .parse(raw);
  await documentsAccess(actor);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await documentsAccess(actor, undefined, tx);
    const name = `${v.form}:${v.reference}`;
    if (
      await tx.documentReference.findFirst({
        where: { workspaceId: actor.workspace.id, kind: "PRE_ARN", name },
      })
    )
      throw new DocumentsError("That portal reference is already registered.");
    const r = await tx.documentReference.create({
      data: {
        workspaceId: actor.workspace.id,
        kind: "PRE_ARN",
        name,
        data: { ...v, status: "UNUSED" },
        createdById: actor.user.id,
      },
    });
    await audit(actor, "pre_arn_imported", r.id, tx);
    return r.id;
  });
}
export async function saveFilingBatch(actor: DocumentsActor, raw: unknown) {
  const v = z
    .object({
      id: z.string().max(64).default(""),
      correctionOf: z.string().max(64).default(""),
      name: z.string().trim().min(1).max(200),
      form: z.enum(["GSTR1", "10BD", "113"]),
      start: dateSchema,
      end: dateSchema,
      status: z.enum(["PREPARED", "SUBMITTED", "ACCEPTED"]),
      acknowledgement: z.string().max(200).default(""),
      documentIds: z.string().min(1).max(30000),
    })
    .parse(raw);
  const ids = [...new Set(v.documentIds.split(/[\s,]+/).filter(Boolean))];
  if (ids.length > 1000 || v.end < v.start)
    throw new DocumentsError(
      "Choose a valid period with up to 1,000 documents.",
    );
  return prisma.$transaction(
    async (tx) => {
      await lockDocuments(tx, actor.workspace.id);
      await documentsAccess(actor, undefined, tx);
      const prior = v.id
        ? await tx.documentReference.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              id: v.id,
              kind: "FILING_BATCH",
            },
          })
        : null;
      if (v.id && !prior)
        throw new DocumentsError("That filing batch is unavailable.");
      if (prior && object(prior.data).status === "ACCEPTED")
        throw new DocumentsError(
          "Accepted filing batches are frozen. Prepare a separate correction.",
        );
      if (v.status !== "PREPARED" && !v.acknowledgement)
        throw new DocumentsError("Retain the portal filing acknowledgement.");
      if (v.correctionOf) {
        const original = await tx.documentReference.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: v.correctionOf,
            kind: "FILING_BATCH",
          },
        });
        if (
          !original ||
          object(original.data).status !== "ACCEPTED" ||
          object(original.data).form !== v.form
        )
          throw new DocumentsError(
            "Choose an accepted original filing for this correction.",
          );
      }
      const allBatches = await tx.documentReference.findMany({
        where: {
          workspaceId: actor.workspace.id,
          kind: "FILING_BATCH",
          ...(prior ? { id: { not: prior.id } } : {}),
        },
      });
      const records: Record<string, unknown>[] = [];
      const sources = new Set<string>();
      for (const id of ids) {
        const found = await tx.businessDocument.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            OR: [{ id }, { number: id }],
          },
          select: { id: true },
        });
        if (!found)
          throw new DocumentsError("Check the issued document number.");
        const r = await getDocument(actor, found.id, tx);
        if (
          r.status !== "ISSUED" ||
          r.issuedOn < new Date(v.start) ||
          r.issuedOn > new Date(v.end)
        )
          throw new DocumentsError(
            "Choose issued documents within the filing period.",
          );
        if (
          r.sourceType === "PAY_RUN" ||
          (v.form === "GSTR1" && !GST_TYPES.includes(r.type))
        )
          throw new DocumentsError(
            "Choose documents appropriate to this filing. Payroll is excluded.",
          );
        const input = draftSchema.parse(r.input);
        const sourceKey =
          r.sourceType && r.sourceId ? `${r.sourceType}:${r.sourceId}` : r.id;
        const previouslyReported =
          !v.correctionOf &&
          allBatches.some((b) =>
            (
              object(b.data).records as
                Array<Record<string, unknown>> | undefined
            )?.some((record) => record.sourceKey === sourceKey),
          );
        if (
          v.form !== "GSTR1" &&
          (sources.has(sourceKey) || previouslyReported)
        )
          throw new DocumentsError(
            "This donation already appears in an original filing batch.",
          );
        sources.add(sourceKey);
        if (
          v.form !== "GSTR1" &&
          (!["DONATION_CERTIFICATE", "DONATION_RECEIPT"].includes(r.type) ||
            donationForm(input.paymentOn).statement !== v.form ||
            !input.donorId ||
            !input.donorIdType ||
            !input.deductionSection)
        )
          throw new DocumentsError(
            "Check the donation year, identity, section and form version before preparing this filing.",
          );
        if (
          !v.correctionOf &&
          allBatches.some(
            (b) =>
              object(b.data).form === v.form &&
              (object(b.data).documentIds as string[] | undefined)?.includes(
                r.id,
              ),
          )
        )
          throw new DocumentsError(
            "This document is already in an original filing batch. Retain that batch and prepare a correction outside this original batch tool.",
          );
        const files = await tx.documentFile.findMany({
          where: { workspaceId: actor.workspace.id, documentId: r.id },
          include: { file: { select: { checksum: true, filename: true } } },
        });
        records.push({
          id: r.id,
          sourceKey,
          number: r.number,
          snapshot: r.snapshot,
          files: files.map((f) => ({
            kind: f.kind,
            fileId: f.fileId,
            ...f.file,
          })),
        });
      }
      const contents = JSON.stringify(records),
        checksum = createHash("sha256").update(contents).digest("hex");
      const data = {
        ...v,
        documentIds: records.map((r) => String(r.id)),
        records,
        checksum,
        version: 1,
        preparedById: actor.user.id,
      };
      const row = await tx.documentReference.upsert({
        where: { id: prior?.id ?? "__new__" },
        create: {
          workspaceId: actor.workspace.id,
          kind: "FILING_BATCH",
          name: v.name,
          data: JSON.parse(JSON.stringify(data)),
          createdById: actor.user.id,
        },
        update: { name: v.name, data: JSON.parse(JSON.stringify(data)) },
      });
      await audit(actor, `filing_${v.status.toLowerCase()}`, row.id, tx);
      return row.id;
    },
    { timeout: 30000 },
  );
}
