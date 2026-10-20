// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/overview/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectOverview } from "@/lib/projects/queries";
import { findProjectByKey, projectSummary } from "@/lib/tasks/queries";
import { prisma } from "@/lib/db";

export async function loadProjectOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/overview">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const project = await findProjectByKey(context, key);
if (!project) notFound();
const timeZone = context.workspace.timezone;
const [overview, summary, owner, linkedRepo] = await Promise.all([
    getProjectOverview(context, project),
    projectSummary(project),
    project.ownerId ? prisma.user.findUnique({ where: { id: project.ownerId }, select: { name: true, image: true } }) : Promise.resolve(null),
    prisma.githubRepo.findFirst({ where: { workspaceId: context.workspace.id, linkedProjectId: project.id, connection: { workspaceId: context.workspace.id, status: "ACTIVE" } }, select: { id: true } }),
  ]);
const total = overview.columns.reduce((sum, column) => sum + column.count, 0);
const done = overview.columns.filter((column) => column.category === "DONE").reduce((sum, column) => sum + column.count, 0);
const base = `/w/${context.workspace.slug}/projects/${project.key}`;
return viewDto({ project, timeZone, overview, summary, owner, linkedRepo, total, done, base } as const);
}
