// Generated from app/w/[workspaceSlug]/t/[ref]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { parseTaskReference } from "@/lib/tasks/links";
import { getTaskDetail } from "@/lib/tasks/queries";
async function load(workspaceSlug: string, ref: string) {
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const reference = parseTaskReference(decodeURIComponent(ref));
  const task = reference ? await getTaskDetail(context, reference.number) : null;
  if (!task || (reference?.key && task.project?.key !== reference.key)) return { context, task: null };
  return { context, task };
}
export async function loadgenerateMetadata({ params }: PageProps<"/w/[workspaceSlug]/t/[ref]">) {
const { workspaceSlug, ref } = await params;
const { task } = await load(workspaceSlug, ref);
return { title: task ? `${task.reference} ${task.title}` : "Task" };

}
