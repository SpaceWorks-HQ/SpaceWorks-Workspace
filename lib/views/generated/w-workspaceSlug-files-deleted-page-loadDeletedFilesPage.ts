// Generated from app/w/[workspaceSlug]/files/deleted/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { libraryWhere } from "@/lib/files/service";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";

export async function loadDeletedFilesPage({ params }: PageProps<"/w/[workspaceSlug]/files/deleted">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const files = await prisma.fileObject.findMany({
    where: await libraryWhere({ workspace, user, membership }, { deleted: true }),
    orderBy: { deletedAt: "desc" },
    take: 200,
    select: { id: true, filename: true, folder: true, size: true, deletedAt: true, uploadedById: true },
  });
const admin = hasRoleAtLeast(membership.role, "ADMIN");
const contributor = canContribute(membership);
return viewDto({ user, workspace, files, admin, contributor } as const);
}
