import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canUseAssets, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Assets" };

/** Placeholder: replaced by the ops-money build (see docs/ROADMAP-BUILD.md). */
export default async function AssetsPage({ params }: PageProps<"/w/[workspaceSlug]/assets">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canUseAssets(membership)) notFound();
  return <ComingSoon title="Assets" description="Tools, kits and machines: where they are, who has them, and bookings." />;
}
