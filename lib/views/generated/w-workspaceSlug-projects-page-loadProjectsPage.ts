// Generated from app/w/[workspaceSlug]/projects/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { canContribute, requireWorkspace } from "@/lib/permissions";
import { listProjects, listVisibleTeams, parseStatusFilter } from "@/lib/projects/queries";
const STATUS_LABEL = { ACTIVE: "Active", PAUSED: "Paused", DONE: "Done", ARCHIVED: "Archived" } as const;
const STATUS_TONE = { ACTIVE: "accent", PAUSED: "warning", DONE: "success", ARCHIVED: "outline" } as const;
export async function loadProjectsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/projects">) {
const { workspaceSlug } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const { workspace, membership } = context;
const filter = parseStatusFilter((await searchParams).status);
const [projects, teams] = await Promise.all([listProjects(context, filter), canContribute(membership) ? listVisibleTeams(context) : Promise.resolve([])]);
const base = `/w/${workspace.slug}/projects`;
return viewDto({ workspace, membership, filter, projects, teams, base } as const);
}
