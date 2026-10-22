// Generated from app/w/[workspaceSlug]/teams/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listTeams } from "@/lib/teams/teams";

export async function loadTeamsPage({ params }: PageProps<"/w/[workspaceSlug]/teams">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const teams = await listTeams(ctx, { includeArchived: true });
return viewDto({ ctx, teams } as const);
}
