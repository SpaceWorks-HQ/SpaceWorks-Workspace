import "server-only";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects, RASTER_IMAGE_TYPES } from "@/lib/storage";
import { type Actor, lock, ensure } from "./access";
import { audit } from "./activity";

const PROOF_TYPES = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export async function attachFile(actor: Actor, recordId: string, file: File) {
  let key: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lock(actor, tx);
        const record = await tx.governanceRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: recordId,
            archivedAt: null,
          },
        });
        ensure(record);
        ensure(
          !record.approvedAt,
          "Approved minutes and their attachments are locked.",
        );
        ensure(
          (await tx.governanceAttachment.count({
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
          folder: "/governance",
          allowedTypes: PROOF_TYPES,
          maxBytes: 10 * 1024 * 1024,
          client: tx,
        });
        ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error);
        key = uploaded.file.storageKey;
        await tx.governanceAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            recordId,
            fileId: uploaded.file.id,
          },
        });
        await audit(actor, tx, record, "file_added");
        return { id: uploaded.file.id };
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw error;
  }
}
export async function detachFile(
  actor: Actor,
  recordId: string,
  fileId: string,
) {
  await prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const record = await tx.governanceRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: recordId,
        archivedAt: null,
      },
    });
    ensure(
      record && !record.approvedAt,
      "Approved minutes and their attachments are locked.",
    );
    ensure(
      await tx.governanceAttachment.findFirst({
        where: { workspaceId: actor.workspace.id, recordId, fileId },
      }),
    );
    // Soft-delete for the existing storage retention writer, keeping the private attachment link.
    await tx.fileObject.updateMany({
      where: { workspaceId: actor.workspace.id, id: fileId },
      data: { deletedAt: new Date() },
    });
    await audit(actor, tx, record, "file_removed");
  });
}
