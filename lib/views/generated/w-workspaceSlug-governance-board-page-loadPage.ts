// Generated from app/w/[workspaceSlug]/governance/board/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewGovernance } from "@/lib/roles";
import { loadGovernance } from "@/lib/governance/service";

export async function loadPage({params,searchParams}: PageProps<"/w/[workspaceSlug]/governance/board">) {
const {workspaceSlug} = await params;
const actor = await requireWorkspace(workspaceSlug,"ADMIN");
if(!canViewGovernance(actor.membership)) notFound();
const query = await searchParams;
const filters = Object.fromEntries(Object.entries(query).map(([k,v]) => [k,typeof v === "string" ? v : undefined]));
const data = await loadGovernance(actor,"board",filters,typeof query.edit === "string" ? query.edit : undefined);
if(query.edit && !data.selected) notFound();
return viewDto({ actor, data } as const);
}
