import "server-only";

import { type WorkspaceRole } from "@prisma/client";

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

export const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function fileDetailUrl(slug: string, fileId: string) {
  return `/w/${slug}/files/${fileId}`;
}
