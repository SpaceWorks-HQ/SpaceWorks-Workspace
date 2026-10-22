// Generated from app/w/[workspaceSlug]/analytics/print/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { packData } from "@/lib/analytics/packs";
import { context } from "@/lib/analytics/queries";

export async function loadAnalyticsPrintPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/analytics/print">) {
const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN"),
    q = await searchParams;
const id = typeof q.preset === "string" ? q.preset : "",
    kind = q.kind === "board" ? "board" : "management";
const data = await packData(actor, id, kind),
    period = (await context(actor, data.q)).p;
return viewDto({ data, period } as const);
}
