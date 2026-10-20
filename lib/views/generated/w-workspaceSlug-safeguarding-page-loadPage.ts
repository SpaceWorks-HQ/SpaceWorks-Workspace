// Generated from app/w/[workspaceSlug]/safeguarding/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadCases } from "@/lib/govextras/cases";
import { GovernanceError } from "@/lib/governance/service";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/safeguarding">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const query = await searchParams;
const filters = Object.fromEntries(
    Object.entries(query).map(([k, v]) => [
      k,
      typeof v === "string" ? v : undefined,
    ]),
  );
const data = await loadCases(
    actor,
    filters,
    typeof query.edit === "string" ? query.edit : undefined,
  ).catch((e) => {
    if (e instanceof GovernanceError) notFound();
    throw e;
  });
return viewDto({ actor, data } as const);
}
