import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageWorkspace, canContribute } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";

export async function shellContext(
  slug: string,
  minRole: WorkspaceRole = "GUEST",
  bucket: "apiWrite" | "search" = "apiWrite",
) {
  const ctx = await getWorkspaceForAction(slug, minRole);
  if (
    !ctx ||
    (minRole === "ADMIN" && !canManageWorkspace(ctx.membership)) ||
    (minRole === "MEMBER" && !canContribute(ctx.membership)) ||
    (await isActionRateLimited(bucket, `${ctx.workspace.id}:${ctx.user.id}`))
  )
    return null;
  return ctx;
}
export function searchActor(ctx: {
  workspace: { id: string };
  user: { id: string };
  membership: { role: WorkspaceRole };
}) {
  return {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    role: ctx.membership.role,
  };
}
export function safeWorkspaceUrl(url: string | null, slug: string) {
  const base = `/w/${slug}`;
  return url &&
    (url === base || url.startsWith(`${base}/`)) &&
    !/[\\\r\n]/.test(url)
    ? url
    : null;
}
