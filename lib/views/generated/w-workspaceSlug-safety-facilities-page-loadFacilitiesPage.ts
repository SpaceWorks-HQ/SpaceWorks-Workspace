// Generated from app/w/[workspaceSlug]/safety/facilities/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { leaseFinanceView } from "@/lib/finance/recurring/queries";
import { requireWorkspace } from "@/lib/permissions";
import { facilityData } from "@/lib/opsGaps/facilities";
import { members } from "@/lib/opsGaps/context";
import { listAttachments } from "@/lib/opsGaps/attachments";

export async function loadFacilitiesPage({params}:{params:Promise<{workspaceSlug:string}>}) {
const {workspaceSlug}=await params;
const actor=await requireWorkspace(workspaceSlug,"ADMIN");
const data=await facilityData(actor);
const rentView=await leaseFinanceView(actor,data.leases.map(r=>r.id));
const people=(await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
const files=await Promise.all(data.leases.map(r=>listAttachments(actor,"lease",r.id)));
return viewDto({ data, rentView, people, files } as const);
}
