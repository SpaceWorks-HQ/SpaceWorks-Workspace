// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { findProjectByKey } from "@/lib/tasks/queries";

export async function loadgenerateMetadata({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const project = await findProjectByKey(context, key);
return { title: project ? `${project.name} board` : "Project" };

}
