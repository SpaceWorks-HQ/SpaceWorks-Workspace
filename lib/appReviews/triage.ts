import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import { canViewAppReviews } from "@/lib/roles";
import { actionError, validationError, NOT_ALLOWED, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { nextWorkspaceSequence } from "@/lib/counters";
import { indexTask } from "@/lib/tasks/search";
import { sanitizeDescription } from "@/lib/tasks/sanitize";
import { escapeHtml } from "@/lib/email/templates";
import { POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { triageSchema } from "./validation";
import { reviewUrl } from "./events";

export async function triageReview(ctx: WorkspaceContext, raw: unknown): Promise<ActionResult> {
  if (!canViewAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = triageSchema.safeParse(raw); if (!parsed.success) return validationError(parsed.error); const d = parsed.data; const workspaceId = ctx.workspace.id;
  if (d.assigneeId && !await prisma.membership.findFirst({ where: { workspaceId, userId: d.assigneeId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, select: { userId: true } })) return actionError("Choose an active member of this workspace.");
  return prisma.$transaction(async tx => {
    const updated = await tx.appReview.updateMany({ where: { workspaceId, id: d.reviewId }, data: { status: d.status, assigneeId: d.assigneeId || null, tags: [...new Set(d.tags)] } });
    if (!updated.count) return actionError("That review isn't available.");
    await recordAuditEvent({ action: "app_review.triaged", workspaceId, actorId: ctx.user.id, targetType: "AppReview", targetId: d.reviewId, metadata: { status: d.status }, client: tx });
    await recordActivity({ workspaceId, actorId: ctx.user.id, verb: "triaged", entityType: "app_review", entityId: d.reviewId, summary: "Updated review triage", visibility: "PRIVATE" }, tx);
    return { ok: true };
  });
}
export async function createReviewTask(ctx: WorkspaceContext, raw: unknown): Promise<ActionResult<{ id: string; number: number }>> {
  if (!canViewAppReviews(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = z.object({ reviewId: z.string().min(1).max(100) }).safeParse(raw); if (!parsed.success) return validationError(parsed.error);
  const workspaceId = ctx.workspace.id;
  const changes: { id: string; project: { id: string; teamId: string | null } | null }[] = [];
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AppReview" WHERE "workspaceId" = ${workspaceId} AND id = ${parsed.data.reviewId} FOR UPDATE`;
    const review = await tx.appReview.findFirst({ where: { workspaceId, id: parsed.data.reviewId }, include: { app: { select: { linkedProjectId: true, name: true } } } });
    if (!review) return actionError("That review isn't available.");
    if (review.linkedTaskId) {
      const hidden = await hiddenTeamIds(workspaceId, { userId: ctx.user.id, role: ctx.membership.role }, tx);
      const task = await tx.task.findFirst({ where: { workspaceId, id: review.linkedTaskId, OR: [{ projectId: null }, { project: { ...teamScopeFilter(hidden) } }] }, select: { id: true, number: true } });
      return task ? { ok: true as const, data: task } : actionError("A task is already linked to this review. Ask a project member for access.");
    }
    // Create and link in one transaction. A process failure cannot leave an
    // unlinked task that a later retry creates again.
    const hidden = await hiddenTeamIds(workspaceId, { userId: ctx.user.id, role: ctx.membership.role }, tx);
    const project = review.app.linkedProjectId ? await tx.project.findFirst({ where: { workspaceId, id: review.app.linkedProjectId, status: { not: "ARCHIVED" }, ...teamScopeFilter(hidden) } }) : null;
    if (review.app.linkedProjectId && !project) return actionError("The linked project isn't available. Ask an admin to update this app's project.");
    const column = project ? await tx.boardColumn.findFirst({ where: { projectId: project.id, project: { workspaceId } }, orderBy: { position: "asc" } }) : null;
    const edge = column ? await tx.task.aggregate({ where: { workspaceId, columnId: column.id, parentId: null, archivedAt: null }, _max: { position: true } }) : null;
    const number = await nextWorkspaceSequence(tx, workspaceId, "task");
    const url = new URL(reviewUrl(ctx.workspace.slug, review.id), process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3230").toString();
    const task = await tx.task.create({ data: {
      workspaceId, number, projectId: project?.id ?? null, columnId: column?.id ?? null,
      position: (edge?._max.position ?? 0) + POSITION_GAP, creatorId: ctx.user.id,
      completedAt: column?.category === "DONE" ? new Date() : null,
      title: `${review.app.name}: ${review.title || `${review.rating} out of 5 review`}`.slice(0, 180),
      description: sanitizeDescription(`<p>${escapeHtml(review.author)}</p><p>${escapeHtml(review.body).replaceAll("\n", "<br>")}</p><p><a href="${escapeHtml(url)}">Open review</a></p>`),
      assignees: { create: { userId: ctx.user.id } }, activities: { create: { actorId: ctx.user.id, kind: "created" } },
    } });
    await indexTask(tx, ctx.workspace.slug, task, project);
    await recordActivity({ workspaceId, actorId: ctx.user.id, verb: "created", entityType: "task", entityId: task.id, summary: `Created task #${number} from app feedback`, projectId: project?.id, teamId: project?.teamId }, tx);
    await tx.appReview.update({ where: { workspaceId, id: review.id }, data: { linkedTaskId: task.id } });
    await recordAuditEvent({ action: "app_review.task_created", workspaceId, actorId: ctx.user.id, targetType: "AppReview", targetId: review.id, metadata: { taskId: task.id }, client: tx });
    changes.push({ id: task.id, project });
    return { ok: true as const, data: { id: task.id, number: task.number } };
  }, { timeout: 20_000 });
  for (const change of changes) await publishTaskChange({ workspaceId, project: change.project, taskIds: [change.id], type: "task.created", actorId: ctx.user.id });
  return result;
}
