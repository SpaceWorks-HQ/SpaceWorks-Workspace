// Generated from app/w/[workspaceSlug]/governance/vendors/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewGovernance } from "@/lib/roles";
import { loadGovernanceScreen } from "@/lib/governance/service";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/governance/vendors">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canViewGovernance(actor.membership)) notFound();
const query = await searchParams;
const data = await loadGovernanceScreen(actor, "vendors", query);
return viewDto({ actor, data } as const);
}
