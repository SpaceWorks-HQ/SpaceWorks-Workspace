import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isReservedFolder } from "@/lib/files/versions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { removeSearchDocument } from "@/lib/search/documents";
import { normalizeFolder, sanitizeFilename } from "@/lib/storage";

import {
  checkDocLink,
  checkTaskLink,
  findLibraryFile,
  libraryWhere,
  RESERVED_FOLDER,
} from "./access";
import { filesChanged, syncFileSearch } from "./search";
import {
  fail,
  FILE_NOT_ALLOWED,
  FILE_NOT_FOUND,
  type FileResult,
  type FilesActor,
} from "./types";

// ───────────── Rename, move, link, delete ─────────────

export async function renameFile(actor: FilesActor, input: { fileId: string; filename: string }): Promise<FileResult> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  const file = await findLibraryFile(actor, input.fileId);
  if (!file) return fail(FILE_NOT_FOUND);
  const filename = sanitizeFilename(input.filename);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fileObject.update({ where: { id: file.id }, data: { filename } });
    await syncFileSearch(actor.workspace.slug, updated, tx);
    await recordAuditEvent({ action: "file.renamed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: file.id, client: tx });
  });
  await filesChanged(actor, file.id);
  return { ok: true, data: undefined };
}

export async function moveFiles(actor: FilesActor, input: { fileIds: string[]; folder: string }): Promise<FileResult<{ moved: number }>> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  const folder = normalizeFolder(input.folder);
  if (isReservedFolder(folder)) return fail(RESERVED_FOLDER);
  const files = await prisma.fileObject.findMany({ where: { id: { in: input.fileIds }, ...(await libraryWhere(actor)) }, select: { id: true } });
  if (files.length === 0) return fail(FILE_NOT_FOUND);
  await prisma.$transaction(async (tx) => {
    await tx.fileObject.updateMany({ where: { id: { in: files.map((file) => file.id) }, workspaceId: actor.workspace.id }, data: { folder } });
    for (const { id } of files) {
      const updated = await tx.fileObject.findUniqueOrThrow({ where: { id } });
      await syncFileSearch(actor.workspace.slug, updated, tx);
    }
    await recordAuditEvent({ action: "file.moved", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: files[0]!.id, metadata: { files: files.length, folder }, client: tx });
  });
  await filesChanged(actor, files[0]!.id);
  return { ok: true, data: { moved: files.length } };
}

/** Link a file to a doc and/or task (null clears). Linking to an admin-only doc makes the file admin-only. */
export async function linkFile(actor: FilesActor, input: { fileId: string; docId: string | null; taskId: string | null }): Promise<FileResult> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  const file = await findLibraryFile(actor, input.fileId);
  if (!file) return fail(FILE_NOT_FOUND);
  if (input.docId && !(await checkDocLink(actor, input.docId))) return fail("That page doesn't exist or you can't edit it.");
  if (input.taskId && !(await checkTaskLink(actor, input.taskId))) return fail("That task doesn't exist or you can't open it.");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fileObject.update({ where: { id: file.id }, data: { docId: input.docId, taskId: input.taskId } });
    await syncFileSearch(actor.workspace.slug, updated, tx);
    await recordAuditEvent({ action: "file.linked", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: file.id, metadata: { docId: input.docId, taskId: input.taskId }, client: tx });
  });
  await filesChanged(actor, file.id);
  return { ok: true, data: undefined };
}

function canDeleteFile(actor: FilesActor, file: { uploadedById: string | null }) {
  return hasRoleAtLeast(actor.membership.role, "ADMIN") || (canContribute(actor.membership) && file.uploadedById === actor.user.id);
}

/** Soft delete: restorable for 30 days, then purged by the scheduled job. */
export async function deleteFile(actor: FilesActor, input: { fileId: string }, now = new Date()): Promise<FileResult> {
  const file = await findLibraryFile(actor, input.fileId);
  if (!file) return fail(FILE_NOT_FOUND);
  if (!canDeleteFile(actor, file)) return fail("Only the person who uploaded this file or an admin can delete it.");
  await prisma.$transaction(async (tx) => {
    await tx.fileObject.update({ where: { id: file.id }, data: { deletedAt: now } });
    await removeSearchDocument("file", file.id, tx);
    await recordAuditEvent({ action: "file.deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: file.id, client: tx });
  });
  await filesChanged(actor, file.id);
  return { ok: true, data: undefined };
}

export async function restoreFile(actor: FilesActor, input: { fileId: string }): Promise<FileResult> {
  const file = await findLibraryFile(actor, input.fileId, { deleted: true });
  if (!file) return fail(FILE_NOT_FOUND);
  if (!canDeleteFile(actor, file)) return fail("Only the person who uploaded this file or an admin can restore it.");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fileObject.update({ where: { id: file.id }, data: { deletedAt: null } });
    await syncFileSearch(actor.workspace.slug, updated, tx);
    await recordAuditEvent({ action: "file.restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: file.id, client: tx });
  });
  await filesChanged(actor, file.id);
  return { ok: true, data: undefined };
}
