import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewGovernance } from "@/lib/roles";
import { loadGovernanceScreen } from "@/lib/governance/service";
import { GovernanceScreen } from "@/components/governance/Screen";
export const metadata = { title: "Governance" };
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/governance">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canViewGovernance(actor.membership)) notFound();
  const query = await searchParams;
  const data = await loadGovernanceScreen(actor, "compliance", query);
  return (
    <GovernanceScreen
      actor={actor}
      section="compliance"
      params={query}
      data={data}
    />
  );
}
