import { MyTasks } from "@/components/tasks/MyTasks";
import { PageHeader } from "@/components/ui/display";
import { requireWorkspace } from "@/lib/permissions";
import { listMyTasks, workspaceLabels } from "@/lib/tasks/queries";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage({ params }: PageProps<"/w/[workspaceSlug]/my-tasks">) {
  const { workspaceSlug } = await params;
  const context = await requireWorkspace(workspaceSlug, "MEMBER");
  const [tasks, labels] = await Promise.all([listMyTasks(context), workspaceLabels(context.workspace.id)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My tasks" description="Everything assigned to you, across projects, by when it's due." />
      <MyTasks slug={context.workspace.slug} initial={tasks} labels={labels} timeZone={context.workspace.timezone} projectsHref={`/w/${context.workspace.slug}/projects`} />
    </div>
  );
}
