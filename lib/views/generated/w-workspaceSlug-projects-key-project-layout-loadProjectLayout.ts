// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound, redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { findProjectByKey } from "@/lib/tasks/queries";
const STATUS = { ACTIVE: null, PAUSED: { label: "Paused", tone: "warning" }, DONE: { label: "Done", tone: "success" }, ARCHIVED: { label: "Archived", tone: "outline" } } as const;
export async function loadProjectLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/projects/[key]">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const project = await findProjectByKey(context, key);
if (!project) notFound();
if (project.key !== key) redirect(`/w/${context.workspace.slug}/projects/${project.key}`);
const base = `/w/${context.workspace.slug}/projects/${project.key}`;
const status = STATUS[project.status];
return viewDto({ context, project, base, status } as const);
}
