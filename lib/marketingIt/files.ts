import "server-only";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects, RASTER_IMAGE_TYPES } from "@/lib/storage";
import { libraryWhere } from "@/lib/files/service";
import { canRead, canEdit, hydrateDevice, lock, readRecord, ensure, audit, type Actor } from "./service";
import { isMarketing } from "./schema";
const PROOF_TYPES = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export async function attachFile(supplied: Actor, recordId: string, file: File | string) {
 let storageKey: string | undefined;
 try {
  return await prisma.$transaction(async tx => {
   const actor = await lock(supplied, tx), workspaceId = actor.workspace.id, row = await readRecord(actor, recordId, tx);
   ensure(canEdit(actor, row) && !row.archivedAt && !row.completedAt, "This record is read-only.");
   ensure(await tx.marketingItAttachment.count({ where: { workspaceId, recordId, file: { deletedAt: null } } }) < 20, "This record has 20 files. Remove an unused file first.");
   let fileId: string;
   if (typeof file === "string") {
    ensure(["CONTENT", "BRAND"].includes(row.kind), "Use a dedicated proof upload for private records.");
    ensure(await tx.fileObject.findFirst({ where: { AND: [{ id: file, workspaceId, docId: null, taskId: null }, await libraryWhere({ ...actor, user: { id: actor.user.id, name: null } })] } }), "Choose a standalone workspace file from the library.");
    fileId = file;
   } else {
    const uploaded = await uploadWorkspaceFile({ workspaceId, uploadedById: actor.user.id, file, folder: isMarketing(row.kind) && ["CONTENT", "BRAND"].includes(row.kind) ? "/marketing-assets" : "/marketing-it", allowedTypes: PROOF_TYPES, client: tx });
    ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error); storageKey = uploaded.file.storageKey; fileId = uploaded.file.id;
   }
   await tx.marketingItAttachment.create({ data: { workspaceId, recordId, fileId, fromLibrary: typeof file === "string" } });
   await audit(actor, tx, row.id, "file_added"); return { id: fileId };
  }, { timeout: 30000 });
 } catch (e) { if (storageKey) await deleteObjects([storageKey]).catch(() => undefined); throw e; }
}
export async function detachFile(supplied: Actor, recordId: string, fileId: string) {
 await prisma.$transaction(async tx => {
  const actor = await lock(supplied, tx), workspaceId = actor.workspace.id, row = await readRecord(actor, recordId, tx);
  ensure(canEdit(actor, row) && !row.archivedAt && !row.completedAt, "This record is read-only.");
  const link = await tx.marketingItAttachment.findFirst({ where: { workspaceId, recordId, fileId } }); ensure(link);
  if (row.kind === "BRAND" && row.status === "APPROVED" && ["LOGO", "PHOTO", "TEMPLATE"].includes(String((row.details as Record<string, unknown>).category))) ensure(await tx.marketingItAttachment.count({ where: { workspaceId, recordId, fileId: { not: fileId }, file: { deletedAt: null } } }), "Mark this asset draft before removing its last file.");
  await tx.marketingItAttachment.deleteMany({ where: { workspaceId, recordId, fileId } });
  if (!link.fromLibrary) await tx.fileObject.updateMany({ where: { workspaceId, id: fileId }, data: { deletedAt: new Date() } });
  await audit(actor, tx, row.id, "file_removed");
 });
}
export async function canDownloadMarketingItFile(file: { id: string; workspaceId: string; folder: string }, actor: Actor) {
 const links = await prisma.marketingItAttachment.findMany({ where: { workspaceId: file.workspaceId, fileId: file.id }, select: { fromLibrary: true, record: true } });
 if (!links.length) return !file.folder.startsWith("/marketing-it") && !file.folder.startsWith("/marketing-assets");
 // A library link does not change the pre-existing library file audience.
 if (links.every(l => l.fromLibrary)) return true;
 const readable = await Promise.all(links.map(async l => { const row = await hydrateDevice(l.record); return !row.archivedAt && canRead(actor, row); }));
 return readable.some(Boolean);
}
