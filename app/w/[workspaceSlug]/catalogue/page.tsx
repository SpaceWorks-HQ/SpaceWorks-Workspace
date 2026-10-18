import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canViewCatalogue, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Service catalogue" };

/** Placeholder: replaced by the ops-money build (see docs/ROADMAP-BUILD.md). */
export default async function CataloguePage({ params }: PageProps<"/w/[workspaceSlug]/catalogue">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewCatalogue(membership)) notFound();
  return <ComingSoon title="Service catalogue" description="What we run, who owns it, how to fix it and when it renews." />;
}
