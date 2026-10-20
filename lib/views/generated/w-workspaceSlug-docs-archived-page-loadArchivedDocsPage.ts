// Generated from app/w/[workspaceSlug]/docs/archived/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { visibleDocsWhere } from "@/lib/docs/service";
import { requireWorkspace } from "@/lib/permissions";

export async function loadArchivedDocsPage({ params }: PageProps<"/w/[workspaceSlug]/docs/archived">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const archived = await prisma.doc.findMany({
    where: { ...visibleDocsWhere(workspace.id, membership.role), archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    take: 200,
    select: { id: true, title: true, archivedAt: true, visibility: true, createdById: true, parent: { select: { archivedAt: true } }, _count: { select: { children: true } } },
  });
const roots = archived.filter((doc) => doc.parent?.archivedAt?.getTime() !== doc.archivedAt!.getTime());
return viewDto({ user, workspace, membership, roots } as const);
}
