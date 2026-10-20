// Generated from app/w/[workspaceSlug]/settings/retention/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadRetentionPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/retention">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const policies = await prisma.retentionPolicy.findMany({
    where: { workspaceId: workspace.id },
  });
return viewDto({ workspace, policies } as const);
}
