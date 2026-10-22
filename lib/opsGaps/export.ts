import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guard,admin,type OpsActor } from "./context";
import { ticketWhere } from "./helpdesk";
import { csvText } from "./rules";
export const exportKind=z.enum(["hours","leave","hiring","helpdesk","safety","facilities","inspections"]);
export type ExportKind=z.infer<typeof exportKind>;
const headers:Record<ExportKind,string[]>={hours:["Id","Person id","Activity","Start UTC","End UTC","Break minutes","Worked minutes","Status","Reviewer id","Review note"],leave:["Id","Person id","Status","First day","Last day","Leave type id","Note"],hiring:["Id","Name","Email","Phone","Opening id","Source","Stage","Owner id","Next follow-up","Offer","Decision","Notes"],helpdesk:["Id","Number","Title","Category","Priority","Status","Requester id","Owner id","Due UTC","Confidential"],safety:["Id","Title","Kind","Status","Reporter id","Occurred UTC","Location","Details","Immediate action","Closure note"],facilities:["Id","Premises","Landlord contact id","Owner id","Rent minor","Currency","Lease start","Renewal","Status","Notes"],inspections:["Id","Checklist","Inspection date","Status","Findings and actions"]};
export async function exportBatch(actor:OpsActor,kind:ExportKind,cursor?:string):Promise<{id:string;cells:unknown[]}[]>{
 await guard(actor,["hiring","facilities","inspections"].includes(kind));
 const tenant={workspaceId:actor.workspace.id};const paging={orderBy:{id:"asc" as const},take:200,...(cursor?{cursor:{id:cursor},skip:1}:{})};
 switch(kind){
 case "hours":return (await prisma.volunteerLog.findMany({where:{...tenant,...(admin(actor)?{}:{userId:actor.user.id})},...paging})).map(r=>({id:r.id,cells:[r.id,r.userId,r.activity,r.startsAt,r.endsAt,r.breakMinutes,r.minutes,r.status,r.reviewedById,r.reviewNote]}));
 case "leave":return (await prisma.checklistRun.findMany({where:{...tenant,...(admin(actor)?{}:{subjectUserId:actor.user.id}),items:{some:{sourceType:"availability_request"}}},include:{items:{where:{sourceType:"availability_request"},select:{descriptionMd:true}}},...paging})).map(r=>{let v:Record<string,string>={};try{v=JSON.parse(r.items[0]?.descriptionMd??"{}");}catch{/* Invalid legacy request. */}return{id:r.id,cells:[r.id,r.subjectUserId,r.status,v.from,v.to,v.leaveTypeId,v.note]};});
 case "hiring":return (await prisma.hiringCandidate.findMany({where:tenant,...paging})).map(r=>({id:r.id,cells:[r.id,r.name,r.email,r.phone,r.openingId,r.source,r.stage,r.ownerId,r.dueOn,r.offer,r.decision,r.notes]}));
 case "helpdesk":return (await prisma.helpTicket.findMany({where:ticketWhere(actor),...paging})).map(r=>({id:r.id,cells:[r.id,r.number,r.title,r.category,r.priority,r.status,r.requesterId,r.assigneeId,r.slaDueAt,r.confidential]}));
 case "safety":return (await prisma.safetyReport.findMany({where:{...tenant,...(admin(actor)?{}:{reporterId:actor.user.id})},...paging})).map(r=>({id:r.id,cells:[r.id,r.title,r.kind,r.status,r.reporterId,r.occurredAt,r.location,r.description,r.immediateAction,r.closureNote]}));
 case "facilities":return (await prisma.facilityLease.findMany({where:tenant,...paging})).map(r=>({id:r.id,cells:[r.id,r.title,r.landlordContactId,r.ownerId,r.rentMinor,r.currency,r.startsOn,r.renewalOn,r.status,r.notes]}));
 case "inspections":return (await prisma.checklistRun.findMany({where:{...tenant,items:{some:{sourceType:"safety_inspection"}}},include:{items:{orderBy:{sortOrder:"asc"}}},...paging})).map(r=>({id:r.id,cells:[r.id,r.title,r.dueAt,r.status,JSON.stringify(r.items.map(i=>({check:i.title,finding:i.note,owner:i.assigneeId,due:i.dueAt,completed:i.doneAt})))]}));
 }
}
export async function exportResponse(actor:OpsActor,kind:ExportKind){
 // Resolve the first page before sending headers so unauthorised exports cannot start.
 let batch=await exportBatch(actor,kind);let cursor:string|undefined;let started=false;const encoder=new TextEncoder();
 return new Response(new ReadableStream<Uint8Array>({async pull(controller){
  try{if(!started){started=true;controller.enqueue(encoder.encode("\uFEFF"+csvText([headers[kind]])+"\r\n"));}
   await guard(actor,["hiring","facilities","inspections"].includes(kind));
   if(!batch.length){controller.close();return;}
   controller.enqueue(encoder.encode(csvText(batch.map(r=>r.cells))+"\r\n"));cursor=batch[batch.length-1].id;
   if(batch.length<200){controller.close();return;}batch=await exportBatch(actor,kind,cursor);
  }catch(error){controller.error(error);}
 }}),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="space-works-${kind}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
