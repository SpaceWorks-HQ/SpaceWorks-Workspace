import "server-only";

import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isReservedFolder } from "@/lib/files/versions";
import { canContribute } from "@/lib/roles";
import { normalizeFolder, uploadWorkspaceFile } from "@/lib/storage";

import { checkDocLink, checkTaskLink, RESERVED_FOLDER } from "./access";
import { filesChanged, syncFileSearch } from "./search";
import {
  fail,
  FILE_NOT_ALLOWED,
  type FileResult,
  type FilesActor,
} from "./types";

// ───────────── Upload ─────────────

export async function uploadLibraryFile(actor: FilesActor, input: { file: File; folder?: string; docId?: string | null; taskId?: string | null }): Promise<FileResult<{ id: string; filename: string; contentType: string }>> {
  if (!canContribute(actor.membership)) return fail(FILE_NOT_ALLOWED);
  if (normalizeFolder(input.folder).startsWith("/org-people")) return fail("People register files are uploaded from their record. Choose another folder.");
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
