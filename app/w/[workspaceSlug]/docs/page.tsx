import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Docs" };

/** Placeholder: replaced by the docs build. */
export default async function DocsPage({ params }: PageProps<"/w/[workspaceSlug]/docs">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Docs" description="Shared notes, guides and how-tos." />;
}
