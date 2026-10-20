// Generated from app/w/[workspaceSlug]/teams/[teamSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getTeam, teamWork } from "@/lib/teams/teams";
import { listMembers } from "@/lib/people/profiles";
import { canManageTeamMembers } from "@/lib/people/access";

export async function loadTeamPage({ params }: PageProps<"/w/[workspaceSlug]/teams/[teamSlug]">) {
const { workspaceSlug, teamSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const team = await getTeam(ctx, teamSlug);
if (!team) notFound();
const work = await teamWork(ctx, team.id);
const manage = canManageTeamMembers(ctx.membership, team.myRole);
const members = manage ? await listMembers(ctx) : [];
const base = `/w/${workspaceSlug}`;
return viewDto({ ctx, team, work, manage, members, base } as const);
}
