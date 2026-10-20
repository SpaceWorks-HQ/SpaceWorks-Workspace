import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewGovernance } from "@/lib/roles";
import { GovernanceScreen } from "@/components/governance/Screen";
import { loadGovernance } from "@/lib/governance/service";
export const metadata = { title: "Governance" };
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/governance/registers">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canViewGovernance(actor.membership)) notFound();
  const query = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(query).map(([k, v]) => [
      k,
      typeof v === "string" ? v : undefined,
    ]),
  );
  const data = await loadGovernance(
    actor,
    "registers",
    filters,
    typeof query.edit === "string" ? query.edit : undefined,
  );
  if (query.edit && !data.selected) notFound();
  return (
    <GovernanceScreen
      actor={actor}
      section="registers"
      params={query}
      data={data}
    />
  );
}
