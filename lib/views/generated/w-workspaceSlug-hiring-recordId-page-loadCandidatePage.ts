// Generated from app/w/[workspaceSlug]/hiring/[recordId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getCandidate, hiringData } from "@/lib/opsGaps/hiring";
import { listAttachments } from "@/lib/opsGaps/attachments";
import { members, names } from "@/lib/opsGaps/context";

export async function loadCandidatePage({params}:{params:Promise<{workspaceSlug:string;recordId:string}>}) {
const {workspaceSlug,recordId}=await params;
const actor=await requireWorkspace(workspaceSlug,"ADMIN");
const r=await getCandidate(actor,recordId);
if(!r)notFound();
const [people,data,files]=await Promise.all([members(actor),hiringData(actor),listAttachments(actor,"candidate",recordId)]);
const n=await names(actor,r.interviews.map(i=>i.interviewerId));
const admins=people.filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
return viewDto({ r, people, data, files, n, admins } as const);
}
