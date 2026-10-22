import { requireWorkspace } from "@/lib/permissions";
import { exportKind,exportResponse } from "@/lib/opsGaps/export";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
export async function GET(_request:Request,{params}:{params:Promise<{workspaceSlug:string;kind:string}>}){
 const {workspaceSlug,kind}=await params;const parsed=exportKind.safeParse(kind);if(!parsed.success)return new Response("Not found",{status:404});
 const actor=await requireWorkspace(workspaceSlug,["hiring","facilities","inspections"].includes(parsed.data)?"ADMIN":"MEMBER");
 if(await isActionRateLimited("apiRead",actor.user.id))return new Response("Try again shortly.",{status:429});
 await recordAuditEvent({workspaceId:actor.workspace.id,actorId:actor.user.id,action:"ops_gaps.exported",targetType:parsed.data});
 return exportResponse(actor,parsed.data);
}
