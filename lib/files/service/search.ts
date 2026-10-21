import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";

import { fileDetailUrl, type FilesActor } from "./types";

/** Search index for a library file (admin-only doc files stay out). */
export async function syncFileSearch(slug: string, file: { id: string; workspaceId: string; filename: string; folder: string; deletedAt: Date | null; uploadedById: string | null; docId: string | null; taskId: string | null }, client: DbClient = prisma) {
  const doc = file.docId ? await client.doc.findUnique({ where: { id: file.docId }, select: { visibility: true } }) : null;
  const task = file.taskId ? await client.task.findFirst({ where: { id: file.taskId, workspaceId: file.workspaceId }, select: { projectId: true, project: { select: { teamId: true, team: { select: { visibility: true } } } } } }) : null;
  if (file.deletedAt || doc?.visibility === "ADMINS") {
    await removeSearchDocument("file", file.id, client);
    return;
  }
  await indexSearchDocument({ workspaceId: file.workspaceId, entityType: "file", entityId: file.id, title: file.filename, body: file.folder === "/" ? "" : file.folder, url: fileDetailUrl(slug, file.id), ownerId: file.uploadedById, teamId: task?.project?.teamId ?? null, projectId: task?.projectId ?? null, visibility: task?.project?.team?.visibility === "PRIVATE" ? "TEAM" : "WORKSPACE" }, client);
}

export async function filesChanged(actor: FilesActor, fileId: string) {
  await publish(actor.workspace.id, "workspace", { type: "files.changed", data: { fileId }, actorId: actor.user.id });
}
