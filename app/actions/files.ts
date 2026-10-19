"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { deleteFile, linkFile, moveFiles, renameFile, restoreFile, restoreFileVersion, type FilesActor } from "@/lib/files/service";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { idSchema } from "@/lib/validation";

/**
 * Files library mutations (uploads, including new versions, go through
 * the upload route handler so the browser can show progress). Pattern:
 * workspace from slug → capability → rate limit → zod → lib/files/service
 * → revalidate.
 */

const slugSchema = z.string().min(1).max(64);

async function actor(slug: unknown): Promise<FilesActor | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "GUEST");
  if (!ctx) return null;
  return { workspace: ctx.workspace, user: ctx.user, membership: ctx.membership };
}

function revalidateFiles(slug: string) {
  revalidatePath(`/w/${slug}/files`, "layout");
}

const filenameSchema = z.string().trim().min(1, "Enter a file name.").max(180, "Keep the name under 180 characters.");
const folderSchema = z.string().trim().max(300).regex(/^\//, "Folders start with /.");

export async function renameFileAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ fileId: idSchema, filename: filenameSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await renameFile(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateFiles(ctx.workspace.slug);
  return { ok: true };
}

export async function moveFilesAction(slug: string, input: unknown): Promise<ActionResult<{ moved: number }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ fileIds: z.array(idSchema).min(1).max(200), folder: folderSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await moveFiles(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateFiles(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

export async function linkFileAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ fileId: idSchema, docId: idSchema.nullable(), taskId: idSchema.nullable() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await linkFile(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateFiles(ctx.workspace.slug);
  revalidatePath(`/w/${ctx.workspace.slug}/docs`, "layout");
  return { ok: true };
}

const fileIdSchema = z.object({ fileId: idSchema });

export async function deleteFileAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = fileIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await deleteFile(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateFiles(ctx.workspace.slug);
  return { ok: true };
}

export async function restoreFileAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = fileIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await restoreFile(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateFiles(ctx.workspace.slug);
  return { ok: true };
}

export async function restoreFileVersionAction(slug: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("upload", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ fileId: idSchema, version: z.number().int().min(1).max(1_000_000) }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await restoreFileVersion(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateFiles(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

export type LinkTarget = { type: "doc" | "task"; id: string; label: string; detail: string };

/** Docs and tasks a member may link a file to, matching `query` (title or task number). */
export async function searchLinkTargetsAction(slug: string, input: unknown): Promise<ActionResult<LinkTarget[]>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("search", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ query: z.string().trim().max(100) }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const query = parsed.data.query;
  const admin = hasRoleAtLeast(ctx.membership.role, "ADMIN");
  const hidden = await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role });
  const number = /^#?\d{1,9}$/.test(query) ? Number(query.replace("#", "")) : null;
  const [docs, tasks] = await Promise.all([
    prisma.doc.findMany({
      where: { workspaceId: ctx.workspace.id, archivedAt: null, ...(admin ? {} : { visibility: "WORKSPACE" }), ...(query ? { title: { contains: query, mode: "insensitive" } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, title: true, visibility: true },
    }),
    prisma.task.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        archivedAt: null,
        ...(hidden.length ? { OR: [{ projectId: null }, { project: teamScopeFilter(hidden) }] } : {}),
        ...(number !== null ? { number } : query ? { title: { contains: query, mode: "insensitive" } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, title: true, number: true, project: { select: { key: true } } },
    }),
  ]);
  return {
    ok: true,
    data: [
      ...docs.map((doc) => ({ type: "doc" as const, id: doc.id, label: doc.title, detail: doc.visibility === "ADMINS" ? "Page · Admins only" : "Page" })),
      ...tasks.map((task) => ({ type: "task" as const, id: task.id, label: task.title, detail: `Task ${task.project ? `${task.project.key}-` : "#"}${task.number}` })),
    ],
  };
}
