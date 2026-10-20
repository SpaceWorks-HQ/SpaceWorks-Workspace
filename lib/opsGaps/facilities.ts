import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { indexSingle,audit, guard, adminRef, OperationsError, parse, write, type OpsActor } from "./context";
import { day,id,optionalText,requestKey,title } from "./rules";
const leaseSchema = z.object({ title,landlordContactId:id,ownerId:id,rentMinor:z.coerce.number().int().min(0).max(2147483647),currency:z.string().regex(/^[A-Z]{3}$/),startsOn:day,renewalOn:day,status:z.enum(["ACTIVE","ENDED"]).default("ACTIVE"),notes:optionalText,requestKey:requestKey.optional(),id:id.optional() });
export async function facilityData(actor: OpsActor) {
  await guard(actor,true);
  const [leases,contacts] = await Promise.all([
    prisma.facilityLease.findMany({ where:{workspaceId:actor.workspace.id},orderBy:{renewalOn:"asc"} }),
    prisma.contact.findMany({ where:{workspaceId:actor.workspace.id,deletedAt:null,kinds:{has:"facilities"}},select:{id:true,displayName:true,emails:true,phones:true},orderBy:{displayName:"asc"} }),
  ]); return { leases,contacts };
}
export async function saveLease(actor: OpsActor,input:unknown) {
  const v=parse(leaseSchema,input); if(v.renewalOn<v.startsOn) throw new OperationsError("Choose a renewal date after the lease start.");
  return write(actor,`lease:${v.id??v.requestKey}`,true,async tx=>{
    if(v.id&&!await tx.facilityLease.findFirst({where:{workspaceId:actor.workspace.id,id:v.id}})) throw new OperationsError("That lease is unavailable.");
    if(!await tx.contact.findFirst({where:{workspaceId:actor.workspace.id,id:v.landlordContactId,deletedAt:null,kinds:{has:"facilities"}}})) throw new OperationsError("Choose a facilities contact in this workspace.");
    await adminRef(actor,v.ownerId,tx);
    const {id:recordId,requestKey:key,...fields}=v; const data={...fields,startsOn:new Date(v.startsOn),renewalOn:new Date(v.renewalOn)};
    const r=recordId?await tx.facilityLease.update({where:{id:recordId,workspaceId:actor.workspace.id},data}):await tx.facilityLease.upsert({where:{workspaceId_requestKey:{workspaceId:actor.workspace.id,requestKey:key??parse(requestKey,"")}},update:{},create:{...data,workspaceId:actor.workspace.id,requestKey:key!}});
    await indexSingle(actor,"ops_lease",r.id,r.title,"safety/facilities",tx);
    await audit(actor,"lease",r.id,"saved",tx);return r;
  });
}
/** Uses the existing CRM contact, with a facilities kind; there is no second address book. */
export async function saveFacilityContact(actor:OpsActor,input:unknown){
 const v=parse(z.object({name:title,email:z.email().or(z.literal("")).default(""),phone:z.string().trim().max(80).default(""),notes:optionalText,id:id.optional()}),input);
 return write(actor,`facility-contact:${v.id??v.name}`,true,async tx=>{
  if(v.id&&!await tx.contact.findFirst({where:{workspaceId:actor.workspace.id,id:v.id,deletedAt:null,kinds:{has:"facilities"}}})) throw new OperationsError("That contact is unavailable.");
  const data={displayName:v.name,emails:v.email?[{type:"work",value:v.email,primary:true}]:[],phones:v.phone?[{type:"work",e164:v.phone,sensitive:false}]:[],notesMd:v.notes,visibility:"PRIVATE" as const,kinds:["facilities"],ownerId:actor.user.id};
  const r=v.id?await tx.contact.update({where:{id:v.id,workspaceId:actor.workspace.id},data}):await tx.contact.create({data:{...data,workspaceId:actor.workspace.id,createdById:actor.user.id}});await audit(actor,"facility_contact",r.id,"saved",tx);return r;
 });
}
