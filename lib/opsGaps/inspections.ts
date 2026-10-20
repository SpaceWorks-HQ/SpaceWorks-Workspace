import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { startTemplateRun } from "@/lib/people/checklists";
import { indexSingle,audit, guard, adminRef, OperationsError, parse, unavailable, write, type OpsActor } from "./context";
import { body,day,id,optionalText,title } from "./rules";
const marker="safety_inspection";
export async function inspectionData(actor:OpsActor){
 await guard(actor,true);
 const [templates,runs]=await Promise.all([
  prisma.checklistTemplate.findMany({where:{workspaceId:actor.workspace.id,autoStartFor:marker},select:{id:true,name:true},orderBy:{name:"asc"}}),
  prisma.checklistRun.findMany({where:{workspaceId:actor.workspace.id,items:{some:{sourceType:marker}}},include:{items:{orderBy:{sortOrder:"asc"}}},orderBy:{createdAt:"desc"}}),
 ]);return {templates,runs};
}
export async function createInspectionTemplate(actor:OpsActor,input:unknown){
 const v=parse(z.object({title,steps:z.array(title).min(1).max(50)}),input);
 return write(actor,`inspection-template:${v.title}`,true,async tx=>{
  const r=await tx.checklistTemplate.create({data:{workspaceId:actor.workspace.id,kind:"CUSTOM",name:v.title,autoStartFor:marker,createdById:actor.user.id,items:v.steps.map(title=>({title,descriptionMd:"",assigneeRule:"USER",assigneeRef:actor.user.id,dueOffsetDays:0,required:true,link:null}))}});await audit(actor,"inspection_template",r.id,"created",tx);
 });
}
export async function startInspection(actor:OpsActor,input:unknown){
 const v=parse(z.object({templateId:id,ownerId:id,date:day}),input);
 return write(actor,`inspection:${v.templateId}:${v.date}`,true,async tx=>{
  await adminRef(actor,v.ownerId,tx);const template=await tx.checklistTemplate.findFirst({where:{workspaceId:actor.workspace.id,id:v.templateId,autoStartFor:marker}});if(!template)throw unavailable();
  const existing=await tx.checklistRun.findFirst({where:{workspaceId:actor.workspace.id,templateId:v.templateId,dueAt:new Date(v.date),items:{some:{sourceType:marker}}}});if(existing)return existing;
  const run=await startTemplateRun(tx,{workspaceId:actor.workspace.id,template,subjectUserId:null,subjectName:null,actorId:actor.user.id});
  await indexSingle(actor,"ops_inspection",run.id,template.name,"safety/inspections",tx);
  await tx.checklistRun.update({where:{id:run.id,workspaceId:actor.workspace.id},data:{dueAt:new Date(v.date)}});
  await tx.checklistRunItem.updateMany({where:{runId:run.id,run:{workspaceId:actor.workspace.id}},data:{sourceType:marker,assigneeId:v.ownerId,dueAt:new Date(v.date)}});return run;
 });
}
export async function recordFinding(actor:OpsActor,input:unknown){
 const v=parse(z.object({runId:id,itemId:id,note:body}),input);
 return write(actor,`inspection:${v.runId}`,true,async tx=>{
  const item=await tx.checklistRunItem.findFirst({where:{id:v.itemId,runId:v.runId,sourceType:marker,run:{workspaceId:actor.workspace.id,status:"OPEN"}}});if(!item)throw unavailable();
  if(item.doneAt)throw new OperationsError("This finding is already signed off.");
  await tx.checklistRunItem.update({where:{id:item.id,run:{workspaceId:actor.workspace.id}},data:{note:v.note,doneAt:new Date(),doneById:actor.user.id}});await audit(actor,"inspection",v.runId,"finding_recorded",tx);
 });
}
export async function addInspectionAction(actor:OpsActor,input:unknown){
 const v=parse(z.object({runId:id,title,ownerId:id,dueOn:day,note:optionalText}),input);
 return write(actor,`inspection:${v.runId}`,true,async tx=>{
  if(!await tx.checklistRun.findFirst({where:{workspaceId:actor.workspace.id,id:v.runId,status:"OPEN",items:{some:{sourceType:marker}}}}))throw unavailable();
  await adminRef(actor,v.ownerId,tx);
  const last=await tx.checklistRunItem.aggregate({where:{runId:v.runId,run:{workspaceId:actor.workspace.id}},_max:{sortOrder:true}});
  await tx.checklistRunItem.create({data:{runId:v.runId,title:v.title,descriptionMd:v.note,sourceType:marker,sourceId:"corrective_action",assigneeId:v.ownerId,dueAt:new Date(v.dueOn),sortOrder:(last._max.sortOrder??0)+1}});await audit(actor,"inspection",v.runId,"action_added",tx);
 });
}
export async function finishInspection(actor:OpsActor,input:unknown){
 const v=parse(z.object({id}),input);
 return write(actor,`inspection:${v.id}`,true,async tx=>{
  const run=await tx.checklistRun.findFirst({where:{workspaceId:actor.workspace.id,id:v.id,status:"OPEN",items:{some:{sourceType:marker}}},include:{items:true}});if(!run)throw unavailable();
  if(run.items.some(i=>!i.doneAt))throw new OperationsError("Record every finding and complete corrective actions before closing.");
  await tx.checklistRun.update({where:{id:v.id,workspaceId:actor.workspace.id},data:{status:"DONE",completedAt:new Date()}});await audit(actor,"inspection",v.id,"completed",tx);
 });
}
