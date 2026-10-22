// Generated from app/w/[workspaceSlug]/settings/export/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canManageWorkspace } from "@/lib/roles";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export async function loadExportPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/export">) {
const { workspaceSlug } = await params;
const context = await requireWorkspace(workspaceSlug, "ADMIN");
const { workspace, membership } = context;
if (!canManageWorkspace(membership)) notFound();
const jobs = await prisma.exportJob.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
return viewDto({ workspace, jobs } as const);
}
