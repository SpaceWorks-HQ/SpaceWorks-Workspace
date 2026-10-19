import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";

/**
 * Shared front half of every people/teams/rota/contacts Server Action:
 * resolve the workspace from the slug server-side (never a client-sent id),
 * then rate-limit. Capability checks, validation and writes happen in the
 * services, which take the returned context as their actor.
 */

const slugSchema = z.string().min(1).max(64);

export async function actionContext(slug: unknown): Promise<WorkspaceContext | ActionResult<never>> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return actionError(NOT_ALLOWED);
  const ctx = await getWorkspaceForAction(parsed.data, "GUEST");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return ctx;
}

export function isFailure(value: WorkspaceContext | ActionResult<never>): value is ActionResult<never> {
  return "ok" in value;
}

/** Revalidate one area's pages (and the workspace home). */
export function refreshArea(slug: string, ...areas: string[]) {
  for (const area of areas) revalidatePath(`/w/${slug}/${area}`, "layout");
  revalidatePath(`/w/${slug}`);
}
