import "server-only";
import { prisma } from "@/lib/db";
import {
  uploadWorkspaceFile,
  deleteObjects,
  RASTER_IMAGE_TYPES,
} from "@/lib/storage";
import {
  lock,
  ensure,
  type Actor,
} from "./access";
import { audit } from "./activity";

const PROOF_TYPES = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export async function attachFile(actor: Actor, recordId: string, file: File) {
  let storageKey: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lock(actor, tx);
        const row = await tx.fundingRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: recordId,
            archivedAt: null,
          },
        });
        ensure(row && !row.signedAt, "This record is unavailable or locked.");
        ensure(
          (await tx.fundingAttachment.count({
            where: {
              workspaceId: actor.workspace.id,
              recordId,
              file: { deletedAt: null },
            },
          })) < 20,
          "This record has 20 files. Remove an unused file first.",
        );
        const uploaded = await uploadWorkspaceFile({
          workspaceId: actor.workspace.id,
          uploadedById: actor.user.id,
          file,
          folder: "/funding",
          allowedTypes: PROOF_TYPES,
          client: tx,
        });
        ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error);
        storageKey = uploaded.file.storageKey;
        await tx.fundingAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            recordId,
            fileId: uploaded.file.id,
          },
        });
        await audit(actor, tx, row, "file_added");
        return { id: uploaded.file.id };
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (storageKey) await deleteObjects([storageKey]).catch(() => undefined);
    throw e;
  }
}
export async function detachFile(
  actor: Actor,
  recordId: string,
  fileId: string,
) {
  await prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const row = await tx.fundingRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: recordId,
        archivedAt: null,
      },
    });
    ensure(
      row && !row.signedAt && row.receiptFileId !== fileId,
      "Generated receipts and signed reviews keep their files.",
    );
    ensure(
      await tx.fundingAttachment.findFirst({
        where: { workspaceId: actor.workspace.id, recordId, fileId },
      }),
    );
    ensure(
      !(await tx.documentFile.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          fileId,
          document: { status: { in: ["ISSUED", "CANCELLED", "RESERVED"] } },
        },
      })),
      "Issued documents retain this proof. Add a correction instead of removing it.",
    );
    await tx.fileObject.updateMany({
      where: { workspaceId: actor.workspace.id, id: fileId },
      data: { deletedAt: new Date() },
    });
    await audit(actor, tx, row, "file_removed");
  });
}
