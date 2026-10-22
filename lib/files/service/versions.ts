import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { MAX_FILE_VERSIONS, nextVersionNumber, versionsToPrune } from "@/lib/files/versions";
import { canContribute } from "@/lib/roles";
import {
  buildStorageKey,
  checkImageSanity,
  checkUpload,
  deleteObjects,
  getObject,
  putObject,
} from "@/lib/storage";
import { createHash } from "crypto";

import { findLibraryFile } from "./access";
import { filesChanged } from "./search";
import {
  fail,
  FILE_NOT_ALLOWED,
  FILE_NOT_FOUND,
  type FileResult,
  type FilesActor,
} from "./types";

/**
 * Store a new current version of a library file. The previous objects stay
 * as `FileVersion` rows (newest 20 kept); the file keeps its id, name and owner.
 */
async function addVersion(actor: FilesActor, fileId: string, input: { body: Buffer; contentType: string; note: string | null }): Promise<FileResult<{ version: number }>> {
  const file = await findLibraryFile(actor, fileId);
  if (!file) return fail(FILE_NOT_FOUND);
  const storageKey = buildStorageKey(actor.workspace.id, file.filename);
  await putObject(storageKey, input.body, input.contentType);
  let pruned: string[] = [];
  try {
    const version = await prisma.$transaction(async (tx) => {
      // Lock the file row so two uploads can't claim the same version number.
      const locked = await tx.$queryRaw<{ currentVersion: number; storageKey: string }[]>`
        SELECT "currentVersion", "storageKey" FROM "FileObject" WHERE "id" = ${file.id} AND "deletedAt" IS NULL FOR UPDATE`;
      const current = locked[0];
      if (!current) return null;
      const versions = await tx.fileVersion.findMany({ where: { fileId: file.id }, select: { id: true, version: true, storageKey: true } });
      if (!versions.some((row) => row.version === current.currentVersion)) {
        const row = await tx.fileVersion.create({
          data: { fileId: file.id, version: current.currentVersion, storageKey: current.storageKey, size: file.size, checksum: file.checksum, contentType: file.contentType, uploadedById: file.uploadedById, createdAt: file.createdAt },
          select: { id: true, version: true, storageKey: true },
        });
        versions.push(row);
      }
      const next = nextVersionNumber(current.currentVersion, versions);
      const checksum = createHash("sha256").update(input.body).digest("hex");
      const created = await tx.fileVersion.create({
        data: { fileId: file.id, version: next, storageKey, size: input.body.length, checksum, contentType: input.contentType, uploadedById: actor.user.id, note: input.note },
        select: { id: true, version: true, storageKey: true },
      });
      await tx.fileObject.update({ where: { id: file.id }, data: { storageKey, size: input.body.length, checksum, contentType: input.contentType, currentVersion: next } });
      const prune = versionsToPrune([...versions, created], { currentVersion: next, storageKey }, MAX_FILE_VERSIONS);
      if (prune.length) await tx.fileVersion.deleteMany({ where: { id: { in: prune.map((row) => row.id) } } });
      pruned = prune.map((row) => row.storageKey);
      await recordAuditEvent({ action: "file.version_added", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: file.id, metadata: { version: next, size: input.body.length, restored: input.note?.startsWith("Restored") ?? false }, client: tx });
      return next;
    });
    if (version === null) {
      await deleteObjects([storageKey]).catch(() => undefined);
      return fail(FILE_NOT_FOUND);
    }
    if (pruned.length) await deleteObjects(pruned).catch(() => console.warn("[files] pruning old versions failed"));
    await filesChanged(actor, file.id);
    return { ok: true, data: { version } };
  } catch (error) {
    await deleteObjects([storageKey]).catch(() => undefined);
    throw error;
  }
}

export async function uploadNewVersion(actor: FilesActor, input: { fileId: string; file: File; note?: string | null }): Promise<FileResult<{ version: number }>> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  const check = checkUpload({ size: input.file.size, type: input.file.type });
  if (!check.ok) return check;
  const body = Buffer.from(await input.file.arrayBuffer());
  const imageError = await checkImageSanity(body, check.contentType);
  if (imageError) return fail(imageError);
  return addVersion(actor, input.fileId, { body, contentType: check.contentType, note: input.note?.trim().slice(0, 200) || null });
}

/** Restoring copies the old object into a new version: history is never rewritten. */
export async function restoreFileVersion(actor: FilesActor, input: { fileId: string; version: number }): Promise<FileResult<{ version: number }>> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  const file = await findLibraryFile(actor, input.fileId);
  if (!file) return fail(FILE_NOT_FOUND);
  if (input.version === file.currentVersion) return fail("That's already the current version.");
  const row = await prisma.fileVersion.findUnique({ where: { fileId_version: { fileId: file.id, version: input.version } } });
  if (!row) return fail("That version doesn't exist any more.");
  const object = await getObject(row.storageKey);
  if (!object) return fail("That version's file is missing from storage.");
  return addVersion(actor, file.id, { body: Buffer.from(object.body), contentType: row.contentType, note: `Restored from version ${row.version}` });
}
