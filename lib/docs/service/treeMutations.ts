import "server-only";

import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  canArchiveDoc,
  canCreateDocs,
  canEditDoc,
  canManageDocVisibility,
  canSeeDoc,
} from "@/lib/docs/rules";
import { checkDocMove, descendantIds, placeAmongSiblings } from "@/lib/docs/tree";
import { removeSearchDocument } from "@/lib/search/documents";
import { Prisma, type DocVisibility } from "@prisma/client";

import {
  DOC_NOT_ALLOWED,
  DOC_NOT_FOUND,
  type DocResult,
  type DocsActor,
  fail,
  findVisibleDoc,
  nextChildPosition,
  normalizeTitle,
  nudge,
  syncDocSearch,
  treeChanged,
} from "./context";

// ───────────── Tree: move, visibility, archive, duplicate ─────────────

export async function moveDoc(actor: DocsActor, input: { docId: string; parentId: string | null; index: number }): Promise<DocResult> {
  if (!canCreateDocs(actor.membership)) return fail(DOC_NOT_ALLOWED);
  const all = await prisma.doc.findMany({
    where: { workspaceId: actor.workspace.id, archivedAt: null },
    select: { id: true, parentId: true, visibility: true, position: true, title: true, updatedAt: true },
  });
  const doc = all.find((item) => item.id === input.docId);
  if (!doc || !canEditDoc(actor.membership, doc)) return fail(DOC_NOT_FOUND);
  const parent = input.parentId ? all.find((item) => item.id === input.parentId) : null;
  if (input.parentId && (!parent || !canEditDoc(actor.membership, parent))) return fail("Choose a page that still exists.");
  const check = checkDocMove(all, doc.id, input.parentId);
  if (!check.ok) return fail(check.error);

  const siblings = all
    .filter((item) => item.parentId === input.parentId && item.id !== doc.id)
    // Members only see (and order among) workspace pages; hidden siblings keep their relative order.
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  const visibleSiblings = siblings.filter((item) => canSeeDoc(actor.membership, item));
  const anchor = visibleSiblings[Math.max(0, Math.min(input.index, visibleSiblings.length)) - 1];
  const order = placeAmongSiblings(siblings.map((item) => item.id), doc.id, anchor ? siblings.indexOf(anchor) + 1 : 0);
  const byId = new Map(all.map((item) => [item.id, item]));
  const makeAdminOnly = parent?.visibility === "ADMINS" ? [doc.id, ...descendantIds(all, doc.id)].filter((id) => byId.get(id)?.visibility === "WORKSPACE") : [];

  await prisma.$transaction(async (tx) => {
    // Structure changes keep `updatedAt` (the content version) so open editors don't see a false conflict.
    for (const [index, id] of order.entries()) {
      const item = byId.get(id)!;
      const data: Prisma.DocUpdateInput = { position: index + 1, updatedAt: item.updatedAt };
      if (id === doc.id) data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
      if (id === doc.id || item.position !== index + 1) await tx.doc.update({ where: { id }, data });
    }
    for (const id of makeAdminOnly) {
      await tx.doc.update({ where: { id }, data: { visibility: "ADMINS", updatedAt: byId.get(id)!.updatedAt } });
      await removeSearchDocument("doc", id, tx);
    }
    await recordAuditEvent({ action: "doc.moved", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { parentId: input.parentId, madeAdminOnly: makeAdminOnly.length }, client: tx });
  });
  await treeChanged(actor, doc.id, makeAdminOnly.length ? "WORKSPACE" : doc.visibility);
  return { ok: true, data: undefined };
}

export async function setDocVisibility(actor: DocsActor, input: { docId: string; visibility: DocVisibility }): Promise<DocResult<{ changed: number }>> {
  if (!canManageDocVisibility(actor.membership)) return fail(DOC_NOT_ALLOWED);
  const all = await prisma.doc.findMany({
    where: { workspaceId: actor.workspace.id },
    select: { id: true, parentId: true, visibility: true, updatedAt: true, title: true, contentText: true, archivedAt: true, createdById: true, workspaceId: true },
  });
  const doc = all.find((item) => item.id === input.docId && item.archivedAt === null);
  if (!doc) return fail(DOC_NOT_FOUND);
  if (input.visibility === "WORKSPACE" && doc.parentId && all.find((item) => item.id === doc.parentId)?.visibility === "ADMINS") {
    return fail("This page sits inside an admin-only page. Move it out first, then share it with everyone.");
  }
  // Admin-only applies to the whole branch; sharing applies to this page (sub-pages keep their setting).
  const ids = input.visibility === "ADMINS" ? [doc.id, ...descendantIds(all, doc.id)] : [doc.id];
  const targets = all.filter((item) => ids.includes(item.id) && item.visibility !== input.visibility);
  if (targets.length === 0) return { ok: true, data: { changed: 0 } };
  await prisma.$transaction(async (tx) => {
    for (const item of targets) {
      await tx.doc.update({ where: { id: item.id }, data: { visibility: input.visibility, updatedAt: item.updatedAt } });
      await syncDocSearch(actor.workspace.slug, { ...item, visibility: input.visibility }, tx);
    }
    await recordAuditEvent({ action: "doc.visibility_changed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { visibility: input.visibility, pages: targets.length }, client: tx });
  });
  // Everyone's tree may gain or lose pages.
  await treeChanged(actor, doc.id, "WORKSPACE");
  return { ok: true, data: { changed: targets.length } };
}

export async function archiveDoc(actor: DocsActor, input: { docId: string }, now = new Date()): Promise<DocResult<{ archived: number }>> {
  const doc = await findVisibleDoc(actor, input.docId);
  if (!doc) return fail(DOC_NOT_FOUND);
  if (!canArchiveDoc(actor.membership, doc, actor.user.id)) return fail("Only the page's creator or an admin can archive it.");
  const all = await prisma.doc.findMany({ where: { workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true, parentId: true } });
  const ids = [doc.id, ...descendantIds(all, doc.id)];
  await prisma.$transaction(async (tx) => {
    await tx.doc.updateMany({ where: { workspaceId: actor.workspace.id, id: { in: ids }, archivedAt: null }, data: { archivedAt: now } });
    await tx.searchDocument.deleteMany({ where: { entityType: "doc", entityId: { in: ids } } });
    await recordAuditEvent({ action: "doc.archived", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { pages: ids.length }, client: tx });
    if (doc.visibility === "WORKSPACE") {
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "archived", entityType: "doc", entityId: doc.id, summary: `archived the page ${doc.title}` }, tx);
    }
  });
  await treeChanged(actor, doc.id, doc.visibility);
  await nudge(actor.workspace.id, `doc:${doc.id}`, "doc.archived", { docId: doc.id }, actor.user.id, doc.visibility);
  return { ok: true, data: { archived: ids.length } };
}

/** Restore a page and the sub-pages archived with it. If its parent is still archived, it returns at the top level. */
export async function restoreDoc(actor: DocsActor, input: { docId: string }): Promise<DocResult> {
  const doc = await findVisibleDoc(actor, input.docId, { archived: true });
  if (!doc) return fail(DOC_NOT_FOUND);
  if (!canArchiveDoc(actor.membership, doc, actor.user.id)) return fail("Only the page's creator or an admin can restore it.");
  const all = await prisma.doc.findMany({ where: { workspaceId: actor.workspace.id }, select: { id: true, parentId: true, archivedAt: true } });
  const parent = doc.parentId ? all.find((item) => item.id === doc.parentId) : null;
  const ids = [doc.id, ...descendantIds(all, doc.id)].filter((id) => all.find((item) => item.id === id)?.archivedAt?.getTime() === doc.archivedAt!.getTime());
  await prisma.$transaction(async (tx) => {
    await tx.doc.updateMany({ where: { workspaceId: actor.workspace.id, id: { in: ids } }, data: { archivedAt: null } });
    if (parent?.archivedAt) {
      await tx.doc.update({ where: { id: doc.id }, data: { parentId: null, position: await nextChildPosition(tx, actor.workspace.id, null) } });
    }
    const restored = await tx.doc.findMany({ where: { id: { in: ids } }, select: { id: true, workspaceId: true, title: true, contentText: true, visibility: true, archivedAt: true, createdById: true } });
    for (const item of restored) await syncDocSearch(actor.workspace.slug, item, tx);
    await recordAuditEvent({ action: "doc.restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { pages: ids.length }, client: tx });
  });
  await treeChanged(actor, doc.id, doc.visibility);
  return { ok: true, data: undefined };
}

export async function duplicateDoc(actor: DocsActor, input: { docId: string }): Promise<DocResult<{ id: string }>> {
  const doc = await findVisibleDoc(actor, input.docId);
  if (!doc) return fail(DOC_NOT_FOUND);
  if (!canEditDoc(actor.membership, doc)) return fail(DOC_NOT_ALLOWED);
  const next = await prisma.doc.findFirst({
    where: { workspaceId: actor.workspace.id, parentId: doc.parentId, archivedAt: null, position: { gt: doc.position } },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.doc.create({
      data: {
        workspaceId: actor.workspace.id,
        parentId: doc.parentId,
        title: normalizeTitle(`${doc.title} (copy)`),
        contentHtml: doc.contentHtml,
        contentText: doc.contentText,
        visibility: doc.visibility,
        position: next ? (doc.position + next.position) / 2 : doc.position + 1,
        createdById: actor.user.id,
        updatedById: actor.user.id,
      },
    });
    if (created.contentHtml) await tx.docRevision.create({ data: { docId: created.id, title: created.title, contentHtml: created.contentHtml, authorId: actor.user.id } });
    await syncDocSearch(actor.workspace.slug, created, tx);
    await recordAuditEvent({ action: "doc.duplicated", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: created.id, metadata: { sourceId: doc.id }, client: tx });
    return created;
  });
  await treeChanged(actor, copy.id, copy.visibility);
  return { ok: true, data: { id: copy.id } };
}
