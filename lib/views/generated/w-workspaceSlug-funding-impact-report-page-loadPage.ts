// Generated from app/w/[workspaceSlug]/funding/impact/report/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewFunding } from "@/lib/roles";
import { loadFunding } from "@/lib/funding/service";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/funding/impact/report">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canViewFunding(actor.membership)) notFound();
const data = await loadFunding(actor, "impact", {});
const programmes = data.choices.filter(r => r.kind === "PROGRAMME");
return viewDto({ actor, data, programmes } as const);
}
