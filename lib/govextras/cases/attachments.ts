import "server-only";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects, RASTER_IMAGE_TYPES } from "@/lib/storage";
import { GovernanceError, type Actor } from "@/lib/governance/service";
import { caseLock, caseAccess } from "./access";
import { audit } from "./audit";

export async function uploadCaseFile(actor: Actor, caseId: string, file: File) {
  let key: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await caseLock(actor, tx);
        const row = await caseAccess(actor, caseId, tx);
        if (row.closedAt)
          throw new GovernanceError("Closed case evidence is locked.");
        if (
          (await tx.safeguardingAttachment.count({
            where: { workspaceId: actor.workspace.id, caseId },
          })) >= 20
        )
          throw new GovernanceError("Use up to 20 evidence files per case.");
        const upload = await uploadWorkspaceFile({
          workspaceId: actor.workspace.id,
          uploadedById: actor.user.id,
          file,
          folder: "/safeguarding",
          allowedTypes: new Set([...RASTER_IMAGE_TYPES, "application/pdf"]),
          maxBytes: 10 * 1024 * 1024,
          client: tx,
        });
        if (!upload.ok) throw new GovernanceError(upload.error);
        key = upload.file.storageKey;
        await tx.safeguardingAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            caseId,
            fileId: upload.file.id,
          },
        });
        await audit(actor, tx, "file_added", caseId);
        return { id: upload.file.id };
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw e;
  }
}
