import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "SEO" };

/** Placeholder: replaced by the seo build. */
export default async function SeoPage({ params }: PageProps<"/w/[workspaceSlug]/seo">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "ADMIN");
  return <ComingSoon title="SEO" description="Search performance and on-page checks for your sites." />;
}
