import "server-only";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects, RASTER_IMAGE_TYPES } from "@/lib/storage";
import { lock, ensure, findRecord, type Actor } from "./access";
import { audit, editable, snapshot } from "./service";
export async function attachFile(untrusted: Actor, recordId: string, file: File) {
 let storageKey: string | undefined;
 try {
  return await prisma.$transaction(async tx => {
   const actor = await lock(untrusted, tx), workspaceId = actor.workspace.id;
   const row = await findRecord(actor, recordId, tx); await editable(actor, tx, row);
   ensure(await tx.productAttachment.count({ where: { workspaceId, recordId, file: { deletedAt: null } } }) < 50, "This record has 50 files. Start a new record for further evidence.");
   const uploaded = await uploadWorkspaceFile({ workspaceId, uploadedById: actor.user.id, file, folder: "/product-ops", allowedTypes: new Set([...RASTER_IMAGE_TYPES, "application/pdf"]), client: tx });
   ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error); storageKey = uploaded.file.storageKey;
   await tx.productAttachment.create({ data: { workspaceId, recordId, fileId: uploaded.file.id } });
   const changed = await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: recordId } }, data: { revision: { increment: 1 } } });
   if (row.kind === "ESTIMATE") await snapshot(actor, tx, changed);
   await audit(actor, tx, recordId, "file_added"); return { id: uploaded.file.id };
  }, { timeout: 30000 });
 } catch (error) { if (storageKey) await deleteObjects([storageKey]).catch(() => undefined); throw error; }
}
export async function detachFile(untrusted: Actor, recordId: string, fileId: string) {
 return prisma.$transaction(async tx => {
  const actor = await lock(untrusted, tx), workspaceId = actor.workspace.id;
  const row = await findRecord(actor, recordId, tx); await editable(actor, tx, row);
  const attachment = await tx.productAttachment.findFirst({ where: { workspaceId, recordId, fileId } }); ensure(attachment && !attachment.generated, "Generated budget sheets stay with their estimate.");
  ensure(row.kind !== "ESTIMATE", "Estimate quotes are retained with their revision history.");
  await tx.fileObject.updateMany({ where: { workspaceId, id: fileId }, data: { deletedAt: new Date() } });
  await tx.productRecord.updateMany({ where: { workspaceId, id: recordId }, data: { revision: { increment: 1 } } });
  await audit(actor, tx, recordId, "file_removed"); return { id: recordId };
 });
}
