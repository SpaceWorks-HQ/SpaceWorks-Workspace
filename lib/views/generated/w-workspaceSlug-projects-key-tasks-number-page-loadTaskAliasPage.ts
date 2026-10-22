// Generated from app/w/[workspaceSlug]/projects/[key]/tasks/[number]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound, redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { taskUrl } from "@/lib/tasks/links";
import { findVisibleTaskByNumber } from "@/lib/tasks/queries";

export async function loadTaskAliasPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/tasks/[number]">) {
const { workspaceSlug, number } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const task = /^\d{1,9}$/.test(number) ? await findVisibleTaskByNumber(context, Number(number)) : null;
if (!task) notFound();
redirect(taskUrl(context.workspace.slug, task.project?.key, task.number));

}
