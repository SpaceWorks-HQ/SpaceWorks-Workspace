import { PageHeader } from "@/components/ui/display";
import { AssistantTabs } from "@/components/assistant/AssistantTabs";
import { hasRoleAtLeast, requireWorkspace } from "@/lib/permissions";

export default async function AssistantLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/assistant">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Assistant" description={`Ask the Space Works Assistant about anything in ${workspace.name}: tasks, people, docs, events and the kitty.`} />
      <AssistantTabs slug={workspace.slug} admin={hasRoleAtLeast(membership.role, "ADMIN")} />
      <div>{children}</div>
    </div>
  );
}
