import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canViewServices, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Services" };

/** Placeholder: replaced by the monitor build (see docs/ROADMAP-BUILD.md). */
export default async function ServicesPage({ params }: PageProps<"/w/[workspaceSlug]/services">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewServices(membership)) notFound();
  return <ComingSoon title="Services" description="Uptime, incidents, maintenance, the status page and cloud costs for everything the community runs." />;
}
