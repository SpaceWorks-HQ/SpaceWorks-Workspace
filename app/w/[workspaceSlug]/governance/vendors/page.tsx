import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewGovernance } from "@/lib/roles";
import { GovernanceScreen } from "@/components/governance/Screen";
export const metadata = { title: "Governance" };
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/governance/vendors">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canViewGovernance(actor.membership)) notFound();
  return (
    <GovernanceScreen
      actor={actor}
      section="vendors"
      params={await searchParams}
    />
  );
}
