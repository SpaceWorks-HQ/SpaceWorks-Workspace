import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  canEditDoc,
  verifiedUntilFrom,
  type VerifyPeriod,
} from "@/lib/docs/rules";
import { htmlToText, sanitizeDocHtml } from "@/lib/docs/sanitize";
import { Prisma } from "@prisma/client";

import {
  DOC_NOT_ALLOWED,
  DOC_NOT_FOUND,
  type DocResult,
  type DocsActor,
  fail,
  findVisibleDoc,
  normalizeTitle,
  nudge,
  syncDocSearch,
  treeChanged,
} from "./context";

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
