import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Blog" };

/** Placeholder: replaced by the blog build. */
export default async function BlogPage({ params }: PageProps<"/w/[workspaceSlug]/blog">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "ADMIN");
  return <ComingSoon title="Blog" description="Write and publish posts for the public blog." />;
}
