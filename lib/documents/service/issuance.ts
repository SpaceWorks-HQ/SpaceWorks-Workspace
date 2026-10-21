import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { assertOpen, lockFinance } from "@/lib/finance/tools/access";
import { deleteObjects, getObject, uploadWorkspaceFile } from "@/lib/storage";
import {
  documentsAccess,
  DocumentsError,
  getDocument,
  lockDocuments,
  type DocumentsActor,
} from "../access";
import { creditsByInvoice, frozenNoteAllocations } from "../corrections";
import { makeDocumentPdf } from "../pdf";
import { draftSchema } from "../rules";
import { validateSources } from "./drafts";
import { reserveSnapshot } from "./numbering";
import { publishDocument } from "./publication";
import { audit, date, object } from "./shared";
import type { DocumentSnapshot } from "../service";

export async function issueDocument(
  actor: DocumentsActor,
  id: string,
  options?: { client: DbClient; onStored?: (key: string) => void },
) {
  await documentsAccess(actor);
  let storageKey: string | undefined;
  try {
    const run = async (tx: DbClient): Promise<string> => {
      await lockFinance(tx, actor.workspace.id);
      const candidate = await tx.businessDocument.findFirst({
        where: { workspaceId: actor.workspace.id, id },
        select: { sourceType: true },
      });
      if (candidate?.sourceType === "FUNDING")
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
      await lockDocuments(tx, actor.workspace.id);
      const row = await getDocument(actor, id, tx);
      if (row.status === "ISSUED") return row.id;
      if (!["DRAFT", "RESERVED"].includes(row.status))
        throw new DocumentsError("Cancelled documents cannot be issued.");
      const v = draftSchema.parse(row.input);
      await documentsAccess(actor, v.type, tx);
      await validateSources(actor, v, tx);
      await assertOpen(tx, actor.workspace.id, date(v.issuedOn));
      let snapshot: DocumentSnapshot;
      if (row.status === "RESERVED")
        snapshot = row.snapshot as unknown as DocumentSnapshot;
      else {
        snapshot = await reserveSnapshot(actor, v, id, tx);
        if (v.irnRequired) {
          await audit(actor, "reserved", id, tx);
          return id;
        }
      }
      if (v.irnRequired) {
        const evidence = await tx.documentReference.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            kind: "EVIDENCE",
            name: id,
          },
        });
        const e = object(evidence?.data);
        const qr = await tx.documentFile.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              documentId: id,
              kind: "IRP_QR",
            },
          }),
          signed = await tx.documentFile.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              documentId: id,
              kind: "IRP_JSON",
            },
          });
        if (
          !e.irn ||
          !e.acknowledgement ||
          !e.acknowledgementAt ||
          !qr ||
          !signed
        )
          throw new DocumentsError(
            "Add the imported IRN, acknowledgement, official signed QR and signed JSON before final issue.",
          );
        snapshot.evidence = { ...e, qrFileId: qr.fileId };
      }
      if (v.type === "CREDIT_NOTE") {
        const amounts = frozenNoteAllocations(
            snapshot,
            row.parentId,
            snapshot.calculation.totalMinor,
          ),
          credits = await creditsByInvoice(actor.workspace.id, tx);
        for (const allocation of amounts) {
          const original = await getDocument(actor, allocation.invoiceId, tx);
          if (
            original.status !== "ISSUED" ||
            (credits.get(original.id) ?? 0) + allocation.amountMinor >
              original.totalMinor
          )
            throw new DocumentsError(
              "This correction exceeds the original amount.",
            );
        }
      }
      if (v.type === "REFUND_VOUCHER" || v.type === "PAYMENT_REFUND") {
        const parent = await getDocument(actor, v.parentId, tx);
        const prior = await tx.businessDocument.aggregate({
          where: {
            workspaceId: actor.workspace.id,
            parentId: parent.id,
            type: { in: ["PAYMENT_REFUND", "REFUND_VOUCHER"] },
            status: "ISSUED",
          },
          _sum: { totalMinor: true },
        });
        if (
          (prior._sum.totalMinor ?? 0) + snapshot.calculation.totalMinor >
          (v.type === "PAYMENT_REFUND"
            ? draftSchema.parse(parent.input).cashMinor
            : parent.totalMinor)
        )
          throw new DocumentsError(
            "This correction exceeds the original amount.",
          );
      }
      const sourceProofs = Array.isArray(snapshot.source.proofFiles)
        ? (snapshot.source.proofFiles as Array<{ fileId: string }>)
        : [];
      for (const proof of sourceProofs) {
        const retained = await tx.documentFile.findUnique({
          where: {
            workspaceId_fileId: {
              workspaceId: actor.workspace.id,
              fileId: proof.fileId,
            },
          },
        });
        if (!retained)
          await tx.documentFile.create({
            data: {
              workspaceId: actor.workspace.id,
              documentId: id,
              fileId: proof.fileId,
              kind: "SOURCE",
            },
          });
      }
      const body = await makeDocumentPdf(snapshot, async (fileId) => {
        const f = await tx.documentFile.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fileId,
            kind: { in: ["PROFILE", "IRP_QR"] },
          },
          include: { file: true },
        });
        return f ? await getObject(f.file.storageKey) : null;
      });
      const upload = await uploadWorkspaceFile({
        workspaceId: actor.workspace.id,
        uploadedById: actor.user.id,
        file: new File(
          [new Uint8Array(body)],
          `${snapshot.number.replaceAll("/", "-")}.pdf`,
          { type: "application/pdf" },
        ),
        folder: "/documents/pdf",
        allowedTypes: new Set(["application/pdf"]),
        client: tx,
      });
      if (!upload.ok) throw new DocumentsError(upload.error);
      storageKey = upload.file.storageKey;
      options?.onStored?.(storageKey);
      await tx.documentFile.create({
        data: {
          workspaceId: actor.workspace.id,
          documentId: id,
          kind: "PDF",
          fileId: upload.file.id,
        },
      });
      await publishDocument(
        actor,
        v,
        id,
        snapshot,
        row.parentId,
        upload.file.id,
        tx,
      );
      return id;
    };
    return options?.client
      ? await run(options.client)
      : await prisma.$transaction(run, { timeout: 60000 });
  } catch (e) {
    if (storageKey) await deleteObjects([storageKey]).catch(() => undefined);
    throw e;
  }
}
