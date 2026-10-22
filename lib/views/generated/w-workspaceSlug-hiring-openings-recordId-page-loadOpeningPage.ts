// Generated from app/w/[workspaceSlug]/hiring/openings/[recordId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { hiringData } from "@/lib/opsGaps/hiring";
import { members } from "@/lib/opsGaps/context";

export async function loadOpeningPage({params}:{params:Promise<{workspaceSlug:string;recordId:string}>}) {
const {workspaceSlug,recordId}=await params;
const actor=await requireWorkspace(workspaceSlug,"ADMIN");
const data=await hiringData(actor);
const r=data.openings.find(o=>o.id===recordId);
if(!r)notFound();
const people=(await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
return viewDto({ r, people } as const);
}
