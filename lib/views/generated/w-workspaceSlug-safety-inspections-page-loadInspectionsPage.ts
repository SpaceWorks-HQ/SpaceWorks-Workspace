// Generated from app/w/[workspaceSlug]/safety/inspections/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { inspectionData } from "@/lib/opsGaps/inspections";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { members, names } from "@/lib/opsGaps/context";

export async function loadInspectionsPage({params}:{params:Promise<{workspaceSlug:string}>}) {
const {workspaceSlug}=await params;
const actor=await requireWorkspace(workspaceSlug,"ADMIN");
const data=await inspectionData(actor);
const people=(await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
const n=await names(actor,data.runs.flatMap(r=>r.items.map(i=>i.assigneeId)));
const files=await Promise.all(data.runs.map(r=>listAttachments(actor,"inspection",r.id)));
return viewDto({ data, people, n, files } as const);
}
