"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageBlog, getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import { zonedInputToIso } from "@/lib/timeZone";
import { idSchema } from "@/lib/validation";
import { EXCERPT_MAX, MAX_POST_HTML, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, TITLE_MAX } from "@/lib/blog/rules";
import * as blog from "@/lib/blog/service";

/**
 * Blog CMS Server Actions (admins). Pattern: workspace from the slug →
 * canManageBlog → rate limit → zod → lib/blog/service (sanitises, audits,
 * indexes published posts).
 */

const slugSchema = z.string().min(1).max(64);

async function managerContext(slug: unknown): Promise<WorkspaceContext | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "ADMIN");
  return ctx && canManageBlog(ctx.membership) ? ctx : null;
}

function revalidateBlog(ctx: WorkspaceContext) {
  revalidatePath(`/w/${ctx.workspace.slug}/blog`, "layout");
  revalidatePath(`/blog/${ctx.workspace.slug}`, "layout");
}

const optional = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => value || null);

const titleSchema = z.string().trim().min(1, "Give the post a title.").max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`);

export async function createPostAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = z.object({ title: titleSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await blog.createPost(ctx, parsed.data.title);
  if (result.ok) revalidateBlog(ctx);
  return result;
}

const postSchema = z.object({
  postId: idSchema,
  title: titleSchema,
  slug: z.string().trim().toLowerCase().max(60, "Keep the address under 60 characters."),
  excerpt: optional(EXCERPT_MAX, `Keep the excerpt under ${EXCERPT_MAX} characters.`),
  contentHtml: z.string().max(MAX_POST_HTML, "That post is too long to save."),
  // Hints say what fits search results; the hard limit only stops abuse.
  seoTitle: optional(SEO_TITLE_MAX * 2, `Keep the search title under ${SEO_TITLE_MAX * 2} characters.`),
  seoDescription: optional(SEO_DESCRIPTION_MAX * 2, `Keep the search description under ${SEO_DESCRIPTION_MAX * 2} characters.`),
});

export async function savePostAction(slug: string, input: unknown): Promise<ActionResult<{ slug: string }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { postId, ...values } = parsed.data;
  const result = await blog.savePost(ctx, postId, values);
  if (result.ok) revalidateBlog(ctx);
  return result;
}

const postOnly = z.object({ postId: idSchema });

export async function publishPostAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = postOnly.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await blog.publishPost(ctx, parsed.data.postId);
  if (result.ok) revalidateBlog(ctx);
  return result;
}

const scheduleSchema = z.object({ postId: idSchema, publishAt: z.string().trim().max(32) });

/** `publishAt` is a datetime-local value in the workspace time zone. */
export async function schedulePostAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const iso = zonedInputToIso(parsed.data.publishAt, ctx.workspace.timezone);
  if (!iso) return actionError("Pick a date and time.", { publishAt: ["Pick a date and time."] });
  const result = await blog.schedulePost(ctx, parsed.data.postId, new Date(iso));
  if (result.ok) revalidateBlog(ctx);
  return result;
}

export async function unpublishPostAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = postOnly.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await blog.unpublishPost(ctx, parsed.data.postId);
  if (result.ok) revalidateBlog(ctx);
  return result;
}

export async function deletePostAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = postOnly.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await blog.deletePost(ctx, parsed.data.postId);
  if (result.ok) revalidateBlog(ctx);
  return result;
}

/** FormData: `postId`, and `cover` (an image) or `remove=1`. */
export async function setCoverAction(slug: string, form: FormData): Promise<ActionResult<{ coverFileId: string | null }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("upload", `blog:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const postId = idSchema.safeParse(form.get("postId"));
  if (!postId.success) return actionError("That post isn't available any more. Refresh and try again.");
  const value = form.get("cover");
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file && form.get("remove") !== "1") return actionError("Choose an image.", { cover: ["Choose an image."] });
  const result = await blog.setCover(ctx, postId.data, file);
  if (result.ok) revalidateBlog(ctx);
  return result;
}
