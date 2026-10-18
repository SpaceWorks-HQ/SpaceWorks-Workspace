import { EmptyState } from "@/components/ui/display";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "API tokens" };

export default async function ApiTokensPage({ params }: PageProps<"/w/[workspaceSlug]/settings/api-tokens">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "ADMIN");
  return <EmptyState mood="thinking" title="Coming in the next build.">Tokens for the machine API and the assistant&apos;s MCP endpoint will be managed here.</EmptyState>;
}
