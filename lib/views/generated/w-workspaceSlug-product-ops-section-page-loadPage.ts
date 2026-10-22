// Generated from app/w/[workspaceSlug]/product-ops/[section]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageProductEstimates } from "@/lib/roles";
import { loadProductOps } from "@/lib/productOps/load";
import { SECTIONS, SECTION_KINDS, type Section } from "@/lib/productOps/schema";

export async function loadPage({params,searchParams}:PageProps<"/w/[workspaceSlug]/product-ops/[section]">) {
const {workspaceSlug,section:rawSection}=await params;
const actor=await requireWorkspace(workspaceSlug,"MEMBER");
if(!SECTIONS.includes(rawSection as Section))notFound();
const section=rawSection as Section;
if(section==="estimates"&&!canManageProductEstimates(actor.membership))notFound();
const search=await searchParams;
const filters=Object.fromEntries(Object.entries(search).flatMap(([k,v])=>typeof v==="string"?[[k,v]]:[]));
const data=await loadProductOps(actor,section,filters);
const kind=SECTION_KINDS[section].find(k=>k===filters.kind)??SECTION_KINDS[section][0]??"ROADMAP";
return viewDto({ actor, section, filters, data, kind } as const);
}
