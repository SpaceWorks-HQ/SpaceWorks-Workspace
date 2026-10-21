import "server-only";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
/** Proof is admin-only. Report snapshots are private to their author, including when the view is shared. */
export async function canDownloadAnalyticsFile(
  file: { id: string; workspaceId: string; folder: string },
  userId: string,
  role: Parameters<typeof hasRoleAtLeast>[0],
) {
  const [adjustment, preset] = await Promise.all([
    prisma.analyticsAdjustment.findFirst({
      where: { workspaceId: file.workspaceId, fileIds: { has: file.id } },
      select: { id: true },
    }),
    prisma.analyticsPreset.findFirst({
      where: { workspaceId: file.workspaceId, fileIds: { has: file.id } },
      select: { ownerId: true },
    }),
  ]);
  if (!file.folder.startsWith("/analytics") && !adjustment && !preset)
    return true;
  if (!hasRoleAtLeast(role, "ADMIN")) return false;
  return !!adjustment || preset?.ownerId === userId;
}
