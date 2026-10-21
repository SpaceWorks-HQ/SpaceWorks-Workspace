import "server-only";

import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  canCreateDocs,
  canEditDoc,
  contentChanged,
  startsNewRevision,
} from "@/lib/docs/rules";
import { extractMentionIds, htmlToText, sanitizeDocHtml } from "@/lib/docs/sanitize";
import { BUILTIN_DOC_TEMPLATES, applyTemplateVariables, templateBodyFromContent, templateTitleFromContent } from "@/lib/docs/templates";
import { formatDate } from "@/lib/format/datetime";
import { userTeamIds } from "@/lib/teamAccess";
import { Prisma, type DocVisibility } from "@prisma/client";

import {
  DOC_CONFLICT,
  DOC_NOT_ALLOWED,
  DOC_NOT_FOUND,
  type DocResult,
  type DocsActor,
  fail,
  findVisibleDoc,
  nextChildPosition,
  normalizeTitle,
  notifyNewMentions,
  nudge,
  syncDocSearch,
  treeChanged,
} from "./context";

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
