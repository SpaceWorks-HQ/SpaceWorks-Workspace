import "server-only";

import { createHash } from "crypto";
import { Prisma, type WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { canEditDoc } from "@/lib/docs/rules";
import { publish } from "@/lib/realtime";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { buildStorageKey, checkImageSanity, checkUpload, deleteObjects, getObject, normalizeFolder, putObject, sanitizeFilename, uploadWorkspaceFile } from "@/lib/storage";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { CHAT_FOLDER, fileKind, isReservedFolder, MAX_FILE_VERSIONS, nextVersionNumber, versionsToPrune, type FileKind } from "@/lib/files/versions";

/**
 * Files library rules. The library shows workspace files that belong to no
 * other area (chat attachments, receipts, contracts, evidence,
 * logos and signed PDFs stay with their owners), hiding files of admin-only
 * docs from non-admins and files of tasks in private teams. Downloads still
 * go through /api/files/[id] (lib/files.ts) for the final check.
 *
 * GUEST reads; MEMBER uploads, renames, moves and adds versions; deleting is
 * for the uploader or an admin.
 */

export type FilesActor = {
  workspace: { id: string; slug: string };
  user: { id: string; name: string | null };
  membership: { role: WorkspaceRole };
};

export type FileResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const FILE_NOT_FOUND = "That file doesn't exist or you can't open it.";
export const FILE_NOT_ALLOWED = "You don't have access to do that.";
/** Deleted files can be restored for this long, then they are purged. */
export const FILE_TRASH_DAYS = 30;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function fileDetailUrl(slug: string, fileId: string) {
  return `/w/${slug}/files/${fileId}`;
}

const OTHER_AREA_RELATIONS: Prisma.FileObjectWhereInput = {
  marketingItAttachments: { none: { fromLibrary: false } },
  fundingAttachments: { none: {} },
  governanceAttachments: { none: {} },
  safeguardingAttachments: { none: {} },
  messageAttachments: { none: {} },
  ledgerReceipts: { none: {} },
  financeAttachments: { none: {} },
  moneyControlAttachments: { none: {} },
  subscriptionContracts: { none: {} },
  certificationEvidence: { none: {} },
  statusPageLogos: { none: {} },
  signedPdfs: { none: {} },
  opsAttachments: { none: {} },
};

/** Chat uploads (message attachments, the /chat folder) belong to chat, not the library. */
const NOT_CHAT: Prisma.FileObjectWhereInput = {
  messageAttachments: { none: {} },
  NOT: { OR: [{ folder: { startsWith: "/marketing-it" } }, { folder: { startsWith: "/marketing-assets" } },{ folder: "/safeguarding" }, { folder: { startsWith: "/safeguarding/" } },{ folder: { startsWith: "/money-controls" } },{ folder: "/funding" }, { folder: { startsWith: "/funding/" } },{ folder: "/people-service" }, { folder: { startsWith: "/people-service/" } }, { folder: CHAT_FOLDER }, { folder: { startsWith: `${CHAT_FOLDER}/` } }, { folder: "/governance" }, { folder: { startsWith: "/governance/" } }, { folder: "/calendar" }, { folder: { startsWith: "/calendar/" } }, { folder: { startsWith: "/finance-tools" } }] },
};

const RESERVED_FOLDER = "That folder is managed by its tool. Choose another folder.";

/** Array references have no Prisma relation; keep these files with their owning area. */
async function areaOwnedFileIds(workspaceId: string, client: DbClient = prisma): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT unnest("fileIds") AS id FROM "PurchaseRequest" WHERE "workspaceId"=${workspaceId}
    UNION SELECT unnest("fileIds") AS id FROM "CalendarEntry" WHERE "workspaceId"=${workspaceId}
    UNION SELECT unnest("receiptFileIds") AS id FROM "Reimbursement" WHERE "workspaceId"=${workspaceId}
    UNION SELECT unnest("photoFileIds") AS id FROM "Asset" WHERE "workspaceId"=${workspaceId}`;
  return rows.map((row) => row.id);
}

/** Prisma filter for library files this member may see (`deleted` for the trash view). */
export async function libraryWhere(actor: FilesActor, options: { deleted?: boolean } = {}): Promise<Prisma.FileObjectWhereInput> {
  const admin = hasRoleAtLeast(actor.membership.role, "ADMIN");
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
  return {
    workspaceId: actor.workspace.id,
    deletedAt: options.deleted ? { not: null } : null,
    ...OTHER_AREA_RELATIONS,
    ...NOT_CHAT,
    AND: [
      { id: { notIn: await areaOwnedFileIds(actor.workspace.id) } },
      admin ? {} : { OR: [{ docId: null }, { doc: { visibility: "WORKSPACE" } }] },
      hidden.length === 0 ? {} : { OR: [{ taskId: null }, { task: { projectId: null } }, { task: { project: teamScopeFilter(hidden) } }] },
    ],
  };
}

async function findLibraryFile(actor: FilesActor, fileId: string, options: { deleted?: boolean } = {}) {
  return prisma.fileObject.findFirst({ where: { id: fileId, ...(await libraryWhere(actor, options)) } });
}

/** Search index for a library file (admin-only doc files stay out). */
async function syncFileSearch(slug: string, file: { id: string; workspaceId: string; filename: string; folder: string; deletedAt: Date | null; uploadedById: string | null; docId: string | null; taskId: string | null }, client: DbClient = prisma) {
  const doc = file.docId ? await client.doc.findUnique({ where: { id: file.docId }, select: { visibility: true } }) : null;
  const task = file.taskId ? await client.task.findFirst({ where: { id: file.taskId, workspaceId: file.workspaceId }, select: { projectId: true, project: { select: { teamId: true, team: { select: { visibility: true } } } } } }) : null;
  if (file.deletedAt || doc?.visibility === "ADMINS") {
    await removeSearchDocument("file", file.id, client);
    return;
  }
  await indexSearchDocument({ workspaceId: file.workspaceId, entityType: "file", entityId: file.id, title: file.filename, body: file.folder === "/" ? "" : file.folder, url: fileDetailUrl(slug, file.id), ownerId: file.uploadedById, teamId: task?.project?.teamId ?? null, projectId: task?.projectId ?? null, visibility: task?.project?.team?.visibility === "PRIVATE" ? "TEAM" : "WORKSPACE" }, client);
}

async function filesChanged(actor: FilesActor, fileId: string) {
  await publish(actor.workspace.id, "workspace", { type: "files.changed", data: { fileId }, actorId: actor.user.id });
}

async function checkDocLink(actor: FilesActor, docId: string) {
  const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true, visibility: true } });
  return Boolean(doc && canEditDoc(actor.membership, doc));
}

async function checkTaskLink(actor: FilesActor, taskId: string) {
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId: actor.workspace.id, ...(hidden.length ? { OR: [{ projectId: null }, { project: teamScopeFilter(hidden) }] } : {}) },
    select: { id: true },
  });
  return Boolean(task);
}

// ───────────── Upload ─────────────

export async function uploadLibraryFile(actor: FilesActor, input: { file: File; folder?: string; docId?: string | null; taskId?: string | null }): Promise<FileResult<{ id: string; filename: string; contentType: string }>> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  if (normalizeFolder(input.folder) === "/safeguarding" || normalizeFolder(input.folder).startsWith("/safeguarding/")) return fail("Case files are managed by designated handlers. Choose another folder.");
  if (normalizeFolder(input.folder) === "/governance" || normalizeFolder(input.folder).startsWith("/governance/")) return fail("Governance files are managed from their records. Choose another folder.");
  if (isReservedFolder(normalizeFolder(input.folder))) return fail(RESERVED_FOLDER);
  if (input.docId && !(await checkDocLink(actor, input.docId))) return fail("That page doesn't exist or you can't edit it.");
  if (input.taskId && !(await checkTaskLink(actor, input.taskId))) return fail("That task doesn't exist or you can't open it.");
  const result = await uploadWorkspaceFile({
    workspaceId: actor.workspace.id,
    uploadedById: actor.user.id,
    file: input.file,
    folder: input.folder,
    docId: input.docId ?? null,
    taskId: input.taskId ?? null,
  });
  if (!result.ok) return result;
  const file = result.file;
  await prisma.$transaction(async (tx) => {
    await syncFileSearch(actor.workspace.slug, file, tx);
    await recordAuditEvent({ action: "file.uploaded", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "FileObject", targetId: file.id, metadata: { size: file.size, contentType: file.contentType, docId: file.docId }, client: tx });
    if (!file.docId) {
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "uploaded", entityType: "file", entityId: file.id, summary: `uploaded ${file.filename}` }, tx);
    }
  });
  await filesChanged(actor, file.id);
  return { ok: true, data: { id: file.id, filename: file.filename, contentType: file.contentType } };
}

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

// ───────────── Reads ─────────────

export type UsageSummary = { files: number; bytes: number; versionBytes: number; trashBytes: number; byKind: Array<{ kind: FileKind; files: number; bytes: number }> };

/**
 * Storage used by the workspace's files (library, docs and other areas), with
 * older versions and the trash shown apart. Chat attachments are left out:
 * they belong to chat and never appear in the library.
 */
export async function usageSummary(workspaceId: string): Promise<UsageSummary> {
  const [live, trash, byType, versions] = await Promise.all([
    prisma.fileObject.aggregate({ where: { workspaceId, deletedAt: null, ...NOT_CHAT }, _sum: { size: true }, _count: true }),
    prisma.fileObject.aggregate({ where: { workspaceId, deletedAt: { not: null }, ...NOT_CHAT }, _sum: { size: true } }),
    prisma.fileObject.groupBy({ by: ["contentType"], where: { workspaceId, deletedAt: null, ...NOT_CHAT }, _sum: { size: true }, _count: true }),
    prisma.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT SUM(v."size")::bigint AS bytes FROM "FileVersion" v JOIN "FileObject" f ON f."id" = v."fileId"
      WHERE f."workspaceId" = ${workspaceId} AND v."version" <> f."currentVersion"
        AND f."folder" <> '/people-service' AND f."folder" NOT LIKE '/people-service/%'
        AND f."folder" <> ${CHAT_FOLDER} AND f."folder" NOT LIKE ${`${CHAT_FOLDER}/%`}
        AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" a WHERE a."fileId" = f."id")`,
  ]);
  const kinds = new Map<FileKind, { files: number; bytes: number }>();
  for (const row of byType) {
    const kind = fileKind(row.contentType);
    const entry = kinds.get(kind) ?? { files: 0, bytes: 0 };
    entry.files += row._count;
    entry.bytes += row._sum.size ?? 0;
    kinds.set(kind, entry);
  }
  return {
    files: live._count,
    bytes: live._sum.size ?? 0,
    versionBytes: Number(versions[0]?.bytes ?? 0),
    trashBytes: trash._sum.size ?? 0,
    byKind: [...kinds.entries()].map(([kind, value]) => ({ kind, ...value })).sort((a, b) => b.bytes - a.bytes),
  };
}

// ───────────── Scheduled purge ─────────────

/**
 * Purge library files deleted more than 30 days ago (rows, versions and
 * objects), in small batches, skipping workspaces on legal hold. Safe to run
 * on every replica: rows are claimed under a lock (SKIP LOCKED) and deleted in
 * the same transaction; object removal afterwards is best effort.
 */
export async function purgeDeletedFiles(now: Date, batch = 50) {
  const cutoff = new Date(now.getTime() - FILE_TRASH_DAYS * 86_400_000);
  // Exclude area-owned files before LIMIT so retained receipts cannot starve
  // the library's purge batch. Recheck the references again under the locks.
  const candidates = await prisma.$queryRaw<{ id: string; workspaceId: string }[]>`
    SELECT f."id", f."workspaceId" FROM "FileObject" f
    JOIN "Workspace" w ON w.id=f."workspaceId"
    WHERE f."deletedAt" < ${cutoff} AND NOT w."legalHold"
      AND f.folder <> ${CHAT_FOLDER} AND f.folder NOT LIKE ${`${CHAT_FOLDER}/%`}
      AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" a WHERE a."fileId"=f.id)
      AND f.folder NOT LIKE '/marketing-it%' AND f.folder NOT LIKE '/marketing-assets%'
      AND NOT EXISTS (SELECT 1 FROM "MarketingItAttachment" ma WHERE ma."workspaceId"=f."workspaceId" AND ma."fileId"=f.id AND ma."fromLibrary"=false)
      AND f.folder <> '/funding' AND f.folder NOT LIKE '/funding/%'
      AND NOT EXISTS (SELECT 1 FROM "FundingAttachment" fa WHERE fa."workspaceId"=f."workspaceId" AND fa."fileId"=f.id)
      AND f.folder <> '/calendar'
      AND NOT EXISTS (SELECT 1 FROM "CalendarEntry" c WHERE c."workspaceId"=f."workspaceId" AND f.id=ANY(c."fileIds"))
      AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."receiptFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "FinanceAttachment" r WHERE r."workspaceId"=f."workspaceId" AND r."fileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Subscription" r WHERE r."contractFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Certification" r WHERE r."evidenceFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "StatusPage" r WHERE r."logoFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "SignatureRequest" r WHERE r."pdfFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "PurchaseRequest" r WHERE r."workspaceId"=f."workspaceId" AND f.id=ANY(r."fileIds"))
      AND NOT EXISTS (SELECT 1 FROM "Reimbursement" r WHERE r."workspaceId"=f."workspaceId" AND f.id=ANY(r."receiptFileIds"))
      AND NOT EXISTS (SELECT 1 FROM "Asset" r WHERE r."workspaceId"=f."workspaceId" AND f.id=ANY(r."photoFileIds"))
    ORDER BY f."deletedAt", f.id LIMIT ${batch}`;
  if (candidates.length === 0) return 0;
  const keys = await prisma.$transaction(async (tx) => {
    // Match the legal-hold writer's workspace lock, acquired before file locks.
    const workspaces = await tx.$queryRaw<{ id: string; legalHold: boolean }[]>`
      SELECT "id", "legalHold" FROM "Workspace"
      WHERE "id" IN (${Prisma.join([...new Set(candidates.map((file) => file.workspaceId))])})
      ORDER BY "id" FOR UPDATE`;
    const allowed = workspaces.filter((workspace) => !workspace.legalHold);
    if (!allowed.length) return [];
    // Re-check under a row lock so a file restored meanwhile is never purged.
    const claimed = await tx.$queryRaw<{ id: string; storageKey: string }[]>`
      SELECT "id", "storageKey" FROM "FileObject"
      WHERE "id" IN (${Prisma.join(candidates.map((file) => file.id))}) AND "deletedAt" < ${cutoff}
        AND "workspaceId" IN (${Prisma.join(allowed.map((workspace) => workspace.id))})
      FOR UPDATE SKIP LOCKED`;
    if (claimed.length === 0) return [];
    const excluded = (await Promise.all(allowed.map((workspace) => areaOwnedFileIds(workspace.id, tx)))).flat();
    const files = await tx.fileObject.findMany({ where: { id: { in: claimed.map((file) => file.id), notIn: excluded }, ...OTHER_AREA_RELATIONS, ...NOT_CHAT }, select: { id: true, storageKey: true } });
    const ids = files.map((file) => file.id);
    const versions = await tx.fileVersion.findMany({ where: { fileId: { in: ids } }, select: { storageKey: true } });
    await tx.fileObject.deleteMany({ where: { id: { in: ids } } });
    await tx.searchDocument.deleteMany({ where: { entityType: "file", entityId: { in: ids } } });
    return [...files.map((file) => file.storageKey), ...versions.map((version) => version.storageKey)];
  });
  if (keys.length) await deleteObjects(keys).catch(() => console.warn("[files] purge could not remove some objects"));
  return keys.length;
}
