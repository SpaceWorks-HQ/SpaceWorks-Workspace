import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { MAX_DOC_TITLE, canSeeDoc } from "@/lib/docs/rules";
import { dispatch } from "@/lib/notify";
import { publish } from "@/lib/realtime";
import { hasRoleAtLeast } from "@/lib/roles";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { Prisma, type DocVisibility, type WorkspaceRole } from "@prisma/client";

export type DocsActor = {
  workspace: { id: string; slug: string; name: string; timezone: string };
  user: { id: string; name: string | null };
  membership: { role: WorkspaceRole };
};

export type DocResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean };

export const DOC_NOT_FOUND = "That page doesn't exist or you can't open it.";
export const DOC_NOT_ALLOWED = "You don't have access to do that.";
export const DOC_CONFLICT = "Someone else edited this page. Reload to see their changes.";

export const fail = (error: string, extra: { conflict?: boolean } = {}): { ok: false; error: string; conflict?: boolean } => ({ ok: false, error, ...extra });

export function docUrl(slug: string, docId: string) {
  return `/w/${slug}/docs/${docId}`;
}

export function visibleDocsWhere(workspaceId: string, role: WorkspaceRole): Prisma.DocWhereInput {
  return hasRoleAtLeast(role, "ADMIN") ? { workspaceId } : { workspaceId, visibility: "WORKSPACE" };
}

export function normalizeTitle(title: string | null | undefined) {
  const clean = (title ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_DOC_TITLE);
  return clean || "Untitled";
}

export async function adminUserIds(workspaceId: string, client: DbClient = prisma) {
  const rows = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

/** Realtime nudge (ids only). Admin-only docs reach admins only. */
export async function nudge(workspaceId: string, channel: string, type: string, data: Record<string, string | null>, actorId: string, visibility: DocVisibility) {
  const audience = visibility === "ADMINS" ? await adminUserIds(workspaceId) : undefined;
  await publish(workspaceId, channel, { type, data, actorId, ...(audience ? { audience } : {}) });
}

export async function treeChanged(actor: DocsActor, docId: string, visibility: DocVisibility) {
  await nudge(actor.workspace.id, "workspace", "docs.tree_changed", { docId }, actor.user.id, visibility);
}

/** Global search: only live, workspace-visible docs are indexed. */
export async function syncDocSearch(workspaceSlug: string, doc: { id: string; workspaceId: string; title: string; contentText: string; visibility: DocVisibility; archivedAt: Date | null; createdById: string | null }, client: DbClient = prisma) {
  if (doc.archivedAt || doc.visibility !== "WORKSPACE") {
    await removeSearchDocument("doc", doc.id, client);
    return;
  }
  await indexSearchDocument({ workspaceId: doc.workspaceId, entityType: "doc", entityId: doc.id, title: doc.title, body: doc.contentText, url: docUrl(workspaceSlug, doc.id), ownerId: doc.createdById }, client);
}

export async function findVisibleDoc(actor: DocsActor, docId: string, options: { archived?: boolean } = {}) {
  const doc = await prisma.doc.findFirst({
    where: { id: docId, workspaceId: actor.workspace.id, archivedAt: options.archived ? { not: null } : null },
    select: { id: true, workspaceId: true, parentId: true, title: true, contentHtml: true, contentText: true, visibility: true, createdById: true, updatedAt: true, archivedAt: true, position: true },
  });
  if (!doc || !canSeeDoc(actor.membership, doc)) return null;
  return doc;
}

export async function nextChildPosition(client: DbClient, workspaceId: string, parentId: string | null) {
  const last = await client.doc.findFirst({ where: { workspaceId, parentId, archivedAt: null }, orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? 0) + 1;
}

/** `mention` for people newly @-mentioned who can see the doc (never the author). */
export async function notifyNewMentions(actor: DocsActor, doc: { id: string; title: string; visibility: DocVisibility }, before: string[], after: string[]) {
  const added = after.filter((id) => !before.includes(id) && id !== actor.user.id);
  if (added.length === 0) return;
  const members = await prisma.membership.findMany({
    where: { workspaceId: actor.workspace.id, status: "ACTIVE", userId: { in: added } },
    select: { userId: true, role: true },
  });
  const recipients = members.filter((member) => canSeeDoc(member, doc)).map((member) => member.userId);
  if (recipients.length === 0) return;
  await dispatch(actor.workspace.id, {
    type: "mention",
    title: `${actor.user.name ?? "Someone"} mentioned you in ${doc.title}`.slice(0, 150),
    url: docUrl(actor.workspace.slug, doc.id),
    actorId: actor.user.id,
    recipients,
    resource: { type: "doc", id: doc.id },
    dedupeKey: `doc-mention:${doc.id}`,
    data: { sourceType: "doc", sourceId: doc.id, channelId: null },
  });
}
