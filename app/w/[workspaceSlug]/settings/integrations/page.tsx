import { EmptyState } from "@/components/ui/display";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/integrations">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "ADMIN");
  return <EmptyState mood="thinking" title="Coming in the next build.">Connect Google, GitHub and Telegram here.</EmptyState>;
}
