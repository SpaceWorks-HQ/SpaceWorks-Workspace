// Generated from app/w/[workspaceSlug]/settings/labels/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";

export async function loadLabelsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/labels">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const labels = await prisma.label.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, tone: true, _count: { select: { tasks: true } } },
  });
return viewDto({ workspace, labels } as const);
}
