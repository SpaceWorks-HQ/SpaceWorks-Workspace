import "server-only";

import { Prisma, type DocVisibility, type WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { formatDate } from "@/lib/format/datetime";
import { dispatch } from "@/lib/notify";
import { publish } from "@/lib/realtime";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { hasRoleAtLeast } from "@/lib/roles";
import { userTeamIds } from "@/lib/teamAccess";
import {
  canArchiveDoc,
  canCreateDocs,
  canEditDoc,
  canManageDocVisibility,
  canSeeDoc,
  contentChanged,
  MAX_DOC_TITLE,
  startsNewRevision,
  verifiedUntilFrom,
  type VerifyPeriod,
} from "@/lib/docs/rules";
import { extractMentionIds, htmlToText, sanitizeDocHtml } from "@/lib/docs/sanitize";
import { applyTemplateVariables, BUILTIN_DOC_TEMPLATES, templateBodyFromContent, templateTitleFromContent } from "@/lib/docs/templates";
import { checkDocMove, descendantIds, placeAmongSiblings } from "@/lib/docs/tree";

/**
 * Docs business rules. Server Actions (app/actions/docs.ts) resolve the
 * workspace and membership, rate limit and validate, then call these; tests
 * call them directly. Every query filters by workspace, and a doc the actor
 * may not see answers exactly like a missing one.
 *
 * Doc HTML is canonical: the editor sends HTML, it is sanitised here, and
 * `content` (editor JSON) is cleared so it can never go stale.
 */

export type DocsActor = {
  workspace: { id: string; slug: string; name: string; timezone: string };
  user: { id: string; name: string | null };
  membership: { role: WorkspaceRole };
};

export type DocResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean };

export const DOC_NOT_FOUND = "That page doesn't exist or you can't open it.";
export const DOC_NOT_ALLOWED = "You don't have access to do that.";
export const DOC_CONFLICT = "Someone else edited this page. Reload to see their changes.";

const fail = (error: string, extra: { conflict?: boolean } = {}): { ok: false; error: string; conflict?: boolean } => ({ ok: false, error, ...extra });

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
async function nudge(workspaceId: string, channel: string, type: string, data: Record<string, string | null>, actorId: string, visibility: DocVisibility) {
  const audience = visibility === "ADMINS" ? await adminUserIds(workspaceId) : undefined;
  await publish(workspaceId, channel, { type, data, actorId, ...(audience ? { audience } : {}) });
}

async function treeChanged(actor: DocsActor, docId: string, visibility: DocVisibility) {
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

async function findVisibleDoc(actor: DocsActor, docId: string, options: { archived?: boolean } = {}) {
  const doc = await prisma.doc.findFirst({
    where: { id: docId, workspaceId: actor.workspace.id, archivedAt: options.archived ? { not: null } : null },
    select: { id: true, workspaceId: true, parentId: true, title: true, contentHtml: true, contentText: true, visibility: true, createdById: true, updatedAt: true, archivedAt: true, position: true },
  });
  if (!doc || !canSeeDoc(actor.membership, doc)) return null;
  return doc;
}

async function nextChildPosition(client: DbClient, workspaceId: string, parentId: string | null) {
  const last = await client.doc.findFirst({ where: { workspaceId, parentId, archivedAt: null }, orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? 0) + 1;
}

// ───────────── Templates ─────────────

export type TemplateChoice = { id: string; name: string; description: string };

/** Built-ins plus workspace DOC templates the actor may use (scope WORKSPACE, own TEAM, own PRIVATE). */
export async function listDocTemplates(actor: DocsActor): Promise<TemplateChoice[]> {
  const teamIds = await userTeamIds(actor.workspace.id, actor.user.id);
  const rows = await prisma.template.findMany({
    where: {
      workspaceId: actor.workspace.id,
      kind: "DOC",
      OR: [{ scope: "WORKSPACE" }, { scope: "TEAM", teamId: { in: teamIds } }, { scope: "PRIVATE", createdById: actor.user.id }],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
    take: 50,
  });
  return [
    ...BUILTIN_DOC_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })),
    ...rows.map((row) => ({ id: row.id, name: row.name, description: row.description ?? "" })),
  ];
}

async function resolveTemplate(actor: DocsActor, templateId: string): Promise<{ title: string; html: string } | null> {
  const builtin = BUILTIN_DOC_TEMPLATES.find((template) => template.id === templateId);
  if (builtin) return { title: builtin.title, html: builtin.html };
  const usable = await listDocTemplates(actor);
  if (!usable.some((template) => template.id === templateId)) return null;
  const row = await prisma.template.findFirst({ where: { id: templateId, workspaceId: actor.workspace.id, kind: "DOC" }, select: { name: true, content: true } });
  const html = row ? templateBodyFromContent(row.content) : null;
  if (!row || html === null) return null;
  return { title: templateTitleFromContent(row.content) ?? row.name, html };
}

// ───────────── Create, save ─────────────

export async function createDoc(actor: DocsActor, input: { parentId?: string | null; title?: string | null; templateId?: string | null }): Promise<DocResult<{ id: string }>> {
  if (!canCreateDocs(actor.membership)) return fail(DOC_NOT_ALLOWED);
  let visibility: DocVisibility = "WORKSPACE";
  if (input.parentId) {
    const parent = await findVisibleDoc(actor, input.parentId);
    if (!parent || !canEditDoc(actor.membership, parent)) return fail(DOC_NOT_FOUND);
    visibility = parent.visibility;
  }
  let title = input.title ?? "";
  let html = "";
  if (input.templateId) {
    const template = await resolveTemplate(actor, input.templateId);
    if (!template) return fail("That template isn't available any more. Choose another one.");
    const vars = { date: formatDate(new Date(), actor.workspace.timezone), author: actor.user.name ?? "A member", workspace: actor.workspace.name };
    title = title || applyTemplateVariables(template.title, vars, false);
    html = applyTemplateVariables(template.html, vars);
  }
  const contentHtml = sanitizeDocHtml(html);
  const contentText = htmlToText(contentHtml);
  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.doc.create({
      data: {
        workspaceId: actor.workspace.id,
        parentId: input.parentId ?? null,
        title: normalizeTitle(title),
        contentHtml,
        contentText,
        visibility,
        position: await nextChildPosition(tx, actor.workspace.id, input.parentId ?? null),
        createdById: actor.user.id,
        updatedById: actor.user.id,
      },
    });
    if (contentHtml) await tx.docRevision.create({ data: { docId: created.id, title: created.title, contentHtml, authorId: actor.user.id } });
    await syncDocSearch(actor.workspace.slug, created, tx);
    await recordAuditEvent({ action: "doc.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: created.id, metadata: { template: input.templateId ? (input.templateId.startsWith("builtin:") ? input.templateId : "workspace") : null }, client: tx });
    if (visibility === "WORKSPACE") {
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "created", entityType: "doc", entityId: created.id, summary: `created the page ${created.title}` }, tx);
    }
    return created;
  });
  await treeChanged(actor, doc.id, doc.visibility);
  return { ok: true, data: { id: doc.id } };
}

/**
 * Autosave. `baseVersion` is the `updatedAt` the editor loaded; a save made
 * against an older version is refused with `conflict` so nobody overwrites
 * someone else's edit. Saves by one person within 10 minutes refresh their
 * latest revision; otherwise a new revision is recorded.
 */
export async function saveDoc(actor: DocsActor, input: { docId: string; title: string; html: string; baseVersion: string }, now = new Date()): Promise<DocResult<{ version: string; title: string }>> {
  const doc = await findVisibleDoc(actor, input.docId);
  if (!doc) return fail(DOC_NOT_FOUND);
  if (!canEditDoc(actor.membership, doc)) return fail(DOC_NOT_ALLOWED);
  const base = new Date(input.baseVersion);
  if (Number.isNaN(base.getTime())) return fail(DOC_CONFLICT, { conflict: true });
  const title = normalizeTitle(input.title);
  const contentHtml = sanitizeDocHtml(input.html);
  if (doc.updatedAt.getTime() !== base.getTime()) return fail(DOC_CONFLICT, { conflict: true });
  if (!contentChanged(doc, { title, contentHtml })) return { ok: true, data: { version: doc.updatedAt.toISOString(), title } };
  const contentText = htmlToText(contentHtml);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.doc.updateMany({
      where: { id: doc.id, workspaceId: actor.workspace.id, updatedAt: base, archivedAt: null },
      data: { title, contentHtml, contentText, content: Prisma.DbNull, updatedById: actor.user.id },
    });
    if (updated.count === 0) return null;
    const latest = await tx.docRevision.findFirst({ where: { docId: doc.id }, orderBy: { createdAt: "desc" }, select: { id: true, authorId: true, createdAt: true } });
    const newSession = startsNewRevision(latest, actor.user.id, now);
    if (newSession || !latest) await tx.docRevision.create({ data: { docId: doc.id, title, contentHtml, authorId: actor.user.id } });
    else await tx.docRevision.update({ where: { id: latest.id }, data: { title, contentHtml } });
    const fresh = await tx.doc.findUniqueOrThrow({ where: { id: doc.id }, select: { id: true, workspaceId: true, title: true, contentText: true, visibility: true, archivedAt: true, createdById: true, updatedAt: true } });
    await syncDocSearch(actor.workspace.slug, fresh, tx);
    if (newSession && fresh.visibility === "WORKSPACE") {
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "edited", entityType: "doc", entityId: doc.id, summary: `edited the page ${title}` }, tx);
    }
    return fresh;
  });
  if (!result) return fail(DOC_CONFLICT, { conflict: true });

  await notifyNewMentions(actor, { id: doc.id, title, visibility: doc.visibility }, extractMentionIds(doc.contentHtml), extractMentionIds(contentHtml));
  await nudge(actor.workspace.id, `doc:${doc.id}`, "doc.updated", { docId: doc.id, version: result.updatedAt.toISOString() }, actor.user.id, doc.visibility);
  if (title !== doc.title) await treeChanged(actor, doc.id, doc.visibility);
  return { ok: true, data: { version: result.updatedAt.toISOString(), title } };
}

/** `mention` for people newly @-mentioned who can see the doc (never the author). */
async function notifyNewMentions(actor: DocsActor, doc: { id: string; title: string; visibility: DocVisibility }, before: string[], after: string[]) {
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

// ───────────── Revisions and verification ─────────────

/** Restore a revision as a new edit (history is never rewritten). */
export async function restoreRevision(actor: DocsActor, input: { docId: string; revisionId: string }): Promise<DocResult<{ version: string }>> {
  const doc = await findVisibleDoc(actor, input.docId);
  if (!doc) return fail(DOC_NOT_FOUND);
  if (!canEditDoc(actor.membership, doc)) return fail(DOC_NOT_ALLOWED);
  const revision = await prisma.docRevision.findFirst({ where: { id: input.revisionId, docId: doc.id }, select: { id: true, title: true, contentHtml: true, createdAt: true } });
  if (!revision) return fail("That version doesn't exist any more.");
  const title = normalizeTitle(revision.title);
  const contentHtml = sanitizeDocHtml(revision.contentHtml);
  const contentText = htmlToText(contentHtml);
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.doc.update({ where: { id: doc.id }, data: { title, contentHtml, contentText, content: Prisma.DbNull, updatedById: actor.user.id } });
    await tx.docRevision.create({ data: { docId: doc.id, title, contentHtml, authorId: actor.user.id } });
    await syncDocSearch(actor.workspace.slug, saved, tx);
    await recordAuditEvent({ action: "doc.revision_restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { revisionId: revision.id }, client: tx });
    return saved;
  });
  await nudge(actor.workspace.id, `doc:${doc.id}`, "doc.updated", { docId: doc.id, version: updated.updatedAt.toISOString() }, actor.user.id, doc.visibility);
  if (title !== doc.title) await treeChanged(actor, doc.id, doc.visibility);
  return { ok: true, data: { version: updated.updatedAt.toISOString() } };
}

/** Mark a page verified for a period (or clear it). The verifier becomes its review owner. */
export async function verifyDoc(actor: DocsActor, input: { docId: string; days: VerifyPeriod | null }, now = new Date()): Promise<DocResult<{ verifiedUntil: string | null }>> {
  const doc = await findVisibleDoc(actor, input.docId);
  if (!doc) return fail(DOC_NOT_FOUND);
  if (!canEditDoc(actor.membership, doc)) return fail(DOC_NOT_ALLOWED);
  const verifiedUntil = input.days ? verifiedUntilFrom(now, input.days) : null;
  await prisma.$transaction(async (tx) => {
    await tx.doc.update({ where: { id: doc.id }, data: { verifiedUntil, verifiedById: verifiedUntil ? actor.user.id : null, updatedAt: doc.updatedAt } });
    await recordAuditEvent({ action: verifiedUntil ? "doc.verified" : "doc.verification_cleared", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Doc", targetId: doc.id, metadata: { days: input.days }, client: tx });
  });
  return { ok: true, data: { verifiedUntil: verifiedUntil?.toISOString() ?? null } };
}

// ───────────── Reads ─────────────

export async function listTreeDocs(workspaceId: string, role: WorkspaceRole) {
  return prisma.doc.findMany({
    where: { ...visibleDocsWhere(workspaceId, role), archivedAt: null },
    select: { id: true, parentId: true, title: true, position: true, visibility: true },
    orderBy: [{ position: "asc" }, { title: "asc" }],
  });
}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Full-text + title search over live docs the role may see. */
export async function searchDocs(workspaceId: string, role: WorkspaceRole, query: string, take = 30) {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const adminFilter = hasRoleAtLeast(role, "ADMIN") ? Prisma.empty : Prisma.sql`AND "visibility" = 'WORKSPACE'`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Doc"
    WHERE "workspaceId" = ${workspaceId} AND "archivedAt" IS NULL ${adminFilter}
      AND ("searchVector" @@ websearch_to_tsquery('simple', ${q}) OR "title" ILIKE ${likePattern(q)})
    ORDER BY ("title" ILIKE ${likePattern(q)}) DESC, ts_rank("searchVector", websearch_to_tsquery('simple', ${q})) DESC, "updatedAt" DESC
    LIMIT ${take}`;
  if (rows.length === 0) return [];
  const docs = await prisma.doc.findMany({
    where: { id: { in: rows.map((row) => row.id) }, workspaceId },
    select: { id: true, title: true, contentText: true, updatedAt: true, visibility: true },
  });
  const order = new Map(rows.map((row, index) => [row.id, index]));
  return docs.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
