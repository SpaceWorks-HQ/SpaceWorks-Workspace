// Generated from app/admin/backups/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadBackupsPage() {
await requireSuperAdminMfa();
const rows = await prisma.backupRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });
const staleBefore = new Date().getTime() - 48 * 3600000;
const latest = ["DB", "FILES"].map((kind) => ({
    kind,
    row: rows.find((r) => r.kind === kind && r.status === "SUCCEEDED"),
  }));
return viewDto({ rows, staleBefore, latest } as const);
}
