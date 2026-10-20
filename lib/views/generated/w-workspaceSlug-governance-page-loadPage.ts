// Generated from app/w/[workspaceSlug]/governance/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewGovernance } from "@/lib/roles";
import { loadGovernanceScreen } from "@/lib/governance/service";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/governance">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canViewGovernance(actor.membership)) notFound();
const query = await searchParams;
const data = await loadGovernanceScreen(actor, "compliance", query);
return viewDto({ actor, data } as const);
}
