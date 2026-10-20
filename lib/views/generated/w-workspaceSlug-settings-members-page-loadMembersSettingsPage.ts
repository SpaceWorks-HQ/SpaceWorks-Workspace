// Generated from app/w/[workspaceSlug]/settings/members/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";

export async function loadMembersSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/members">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
const members = await prisma.membership.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    select: { id: true, role: true, status: true, title: true, joinedAt: true, user: { select: { id: true, name: true, email: true, image: true } } },
  });
return viewDto({ user, workspace, membership, members } as const);
}
