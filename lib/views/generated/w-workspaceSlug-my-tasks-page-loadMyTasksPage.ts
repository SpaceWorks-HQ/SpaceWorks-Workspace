// Generated from app/w/[workspaceSlug]/my-tasks/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listMyTasks, workspaceLabels } from "@/lib/tasks/queries";

export async function loadMyTasksPage({ params }: PageProps<"/w/[workspaceSlug]/my-tasks">) {
const { workspaceSlug } = await params;
const context = await requireWorkspace(workspaceSlug, "MEMBER");
const [tasks, labels] = await Promise.all([listMyTasks(context), workspaceLabels(context.workspace.id)]);
return viewDto({ context, tasks, labels } as const);
}
