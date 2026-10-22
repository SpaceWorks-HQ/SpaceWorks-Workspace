// Generated from app/w/[workspaceSlug]/settings/import/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadImportPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/import">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const jobs = await prisma.importJob.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
return viewDto({ workspace, jobs } as const);
}
