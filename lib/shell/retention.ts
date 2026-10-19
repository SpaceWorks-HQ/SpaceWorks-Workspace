import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
export const RETENTION_AREAS = {
  notifications: "Notifications",
  exports: "Export bundles",
  imports: "Import history",
  links: "Links library",
  saved_views: "Saved views",
} as const;
export type RetentionArea = keyof typeof RETENTION_AREAS;
export function retentionCutoff(now: Date, keepDays: number): Date {
  if (!Number.isInteger(keepDays) || keepDays < 1 || keepDays > 36500)
    throw new Error("Invalid retention period");
  return new Date(now.getTime() - keepDays * 86400000);
}
/** The workspace lock serialises a purge with changes to legal hold. */
export async function purgeWorkspace(workspaceId: string, now: Date) {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ legalHold: boolean }>
      >`SELECT "legalHold" FROM "Workspace" WHERE id=${workspaceId} FOR UPDATE`;
      if (!rows[0] || rows[0].legalHold) return 0;
      const policies = await tx.retentionPolicy.findMany({
        where: { workspaceId },
      });
      let count = 0;
      for (const p of policies) {
        if (p.action !== "DELETE") continue;
        const cutoff = retentionCutoff(now, p.keepDays);
        const where = { workspaceId, createdAt: { lt: cutoff } };
        switch (p.entityType) {
          case "notifications":
            count += (await tx.notification.deleteMany({ where })).count;
            break;
          case "imports":
            count += (
              await tx.importJob.deleteMany({
                where: {
                  ...where,
                  status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
                },
              })
            ).count;
            break;
          case "links": {
            const links = await tx.linkItem.findMany({
              where,
              select: { id: true },
            });
            const ids = links.map((l) => l.id);
            await tx.searchDocument.deleteMany({
              where: { workspaceId, entityType: "link", entityId: { in: ids } },
            });
            await tx.bookmark.deleteMany({
              where: { workspaceId, entityType: "link", entityId: { in: ids } },
            });
            count += (
              await tx.linkItem.deleteMany({
                where: { ...where, id: { in: ids } },
              })
            ).count;
            break;
          }
          case "saved_views":
            count += (await tx.savedView.deleteMany({ where })).count;
            break;
          // Export objects are expired by the object-cleanup job before rows are removed.
          case "exports":
            count += (
              await tx.exportJob.deleteMany({
                where: {
                  ...where,
                  storageKey: null,
                  status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
                },
              })
            ).count;
            break;
        }
      }
      if (count)
        await recordAuditEvent({
          workspaceId,
          action: "shell.retention_purged",
          metadata: { count },
          client: tx,
        });
      return count;
    },
    { timeout: 30000 },
  );
}
