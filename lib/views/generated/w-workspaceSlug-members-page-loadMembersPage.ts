// Generated from app/w/[workspaceSlug]/members/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";

export async function loadMembersPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/members">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const query = await searchParams;
const str = (v: string | string[] | undefined) => typeof v === "string" ? v : "";
const filters = { q: str(query.q), skill: str(query.skill), role: str(query.role), team: str(query.team) };
const [all, members, teams] = await Promise.all([listMembers(ctx), listMembers(ctx, filters), listTeams(ctx)]);
const skills = [...new Set(all.flatMap(m => m.skills.map(s => s.skill)))].sort();
const base = `/w/${workspaceSlug}`;
return viewDto({ filters, all, members, teams, skills, base } as const);
}
