import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Files" };

/** Placeholder: replaced by the files build. */
export default async function FilesPage({ params }: PageProps<"/w/[workspaceSlug]/files">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Files" description="Shared files for the whole workspace." />;
}
