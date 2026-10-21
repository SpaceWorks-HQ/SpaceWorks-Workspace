// Generated from app/w/[workspaceSlug]/projects/blockers/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listProjectBlockers } from "@/lib/projects/plusQueries";

export async function loadProjectBlockersPage({ params }: PageProps<"/w/[workspaceSlug]/projects/blockers">) {
const { workspaceSlug } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const rows = await listProjectBlockers(context);
const base = `/w/${context.workspace.slug}/projects`;
return viewDto({ rows, base } as const);
}
