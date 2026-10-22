import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { adminIds } from "@/lib/opsGaps/context";
import { localDay } from "@/lib/opsGaps/rules";
import type { Prisma } from "@prisma/client";
type Reminder={workspaceId:string;id:string;key:string;path:string;recipients:string[]};
async function remind(tx:Prisma.TransactionClient,r:Reminder,now:Date){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ops_gaps:reminder:${r.workspaceId}:${r.key}`}))`;
 if(await tx.notificationEventRecord.findFirst({where:{workspaceId:r.workspaceId,dedupeKey:r.key},select:{id:true}}))return null;
 return dispatch(r.workspaceId,{type:"ops.reminder",title:"A people or service record needs your attention",url:r.path,resource:{type:"people-service",id:r.id},recipients:r.recipients,useWorkspaceRules:false,dedupeKey:r.key,data:{recordId:r.id}},{tx,now});
}
export async function run(now:Date):Promise<void>{
 const workspaces=await prisma.workspace.findMany({where:{archivedAt:null},select:{id:true,slug:true,timezone:true}});
 for(const workspace of workspaces){
  const day=localDay(now,workspace.timezone);const admins=await adminIds(workspace.id);const base=`/w/${workspace.slug}`;
  let cursor:string|undefined;
  // Each source is visited in bounded pages. No record details enter notification payloads.
  for(;;){
   const rows=await prisma.helpTicket.findMany({where:{workspaceId:workspace.id,status:{in:["OPEN","IN_PROGRESS","WAITING"]},slaDueAt:{lte:now}},orderBy:{id:"asc"},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
   for(const r of rows)await send({workspaceId:workspace.id,id:r.id,key:`ticket:${r.id}:${r.slaDueAt.toISOString()}:${day}`,path:`${base}/helpdesk/${r.id}`,recipients:r.confidential?r.handlerIds:admins},now);
   if(rows.length<100)break;cursor=rows.at(-1)!.id;
  }
  for(const source of ["candidate","lease","safety","inspection","leave","hours"] as const){
   let cursor:string|undefined;
   for(;;){
    const paging={take:100,orderBy:{id:"asc" as const},...(cursor?{cursor:{id:cursor},skip:1}:{})};const w={workspaceId:workspace.id};
    let reminders:Array<{id:string;recipients:string[];path:string;anchor:string}>=[];
    if(source==="candidate")reminders=(await prisma.hiringCandidate.findMany({where:{...w,stage:{notIn:["HIRED","DECLINED","WITHDRAWN"]},dueOn:{lte:new Date(day)}},...paging})).map(r=>({id:r.id,recipients:[r.ownerId],path:`${base}/hiring/${r.id}`,anchor:r.dueOn!.toISOString()}));
    if(source==="lease")reminders=(await prisma.facilityLease.findMany({where:{...w,status:"ACTIVE",renewalOn:{lte:new Date(Date.parse(day)+30*86400000)}},...paging})).map(r=>({id:r.id,recipients:[r.ownerId],path:`${base}/safety/facilities`,anchor:r.renewalOn.toISOString()}));
    if(source==="safety")reminders=(await prisma.safetyFollowUp.findMany({where:{...w,completedAt:null,dueAt:{lte:now},report:{status:{not:"CLOSED"}}},...paging})).map(r=>({id:r.id,recipients:[r.assigneeId],path:`${base}/safety/${r.reportId}`,anchor:r.dueAt.toISOString()}));
    if(source==="inspection")reminders=(await prisma.checklistRun.findMany({where:{...w,status:"OPEN",items:{some:{sourceType:"safety_inspection",doneAt:null,dueAt:{lte:now}}}},include:{items:{where:{sourceType:"safety_inspection",doneAt:null,dueAt:{lte:now}},select:{assigneeId:true}}},...paging})).map(r=>({id:r.id,recipients:r.items.flatMap(i=>i.assigneeId?[i.assigneeId]:[]),path:`${base}/safety/inspections`,anchor:r.dueAt?.toISOString()??""}));
    if(source==="leave")reminders=(await prisma.checklistRun.findMany({where:{...w,status:"OPEN",items:{some:{sourceType:"availability_request"}}},...paging})).map(r=>({id:r.id,recipients:admins.filter(id=>id!==r.subjectUserId),path:`${base}/leave`,anchor:r.createdAt.toISOString()}));
    if(source==="hours")reminders=(await prisma.volunteerLog.findMany({where:{...w,status:"PENDING"},...paging})).map(r=>({id:r.id,recipients:admins.filter(id=>id!==r.userId),path:`${base}/volunteering/${r.id}`,anchor:r.createdAt.toISOString()}));
    for(const r of reminders)await send({...r,workspaceId:workspace.id,key:`${source}:${r.id}:${r.anchor}:${day}`},now);
    if(reminders.length<100)break;cursor=reminders.at(-1)!.id;
   }
  }
 }
}
async function send(r:Reminder,now:Date){const result=await prisma.$transaction(tx=>remind(tx,r,now),{timeout:15000});await result?.afterCommit();}
