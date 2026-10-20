import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { startTemplateRun } from "@/lib/people/checklists";
import { adminRef, audit, guard, index, OperationsError, parse, unavailable, write, type OpsActor } from "./context";
import { body, CANDIDATE_STAGES, day, ENGAGEMENT_TYPES, id, optionalText, requestKey, title } from "./rules";
const due = day.or(z.literal("")).default("");
const openingSchema = z.object({ title, description: body, engagementType: z.enum(ENGAGEMENT_TYPES), ownerId: id, dueOn: due, requestKey });
const candidateSchema = z.object({ openingId: id, name: title, email: z.email().max(254), phone: z.string().trim().max(80).default(""), source: z.string().trim().max(160).default(""), notes: optionalText, ownerId: id, dueOn: due, requestKey });
export async function hiringData(actor: OpsActor, stage = "", query = "", page = 1) {
  await guard(actor,true);
  const where = { workspaceId: actor.workspace.id, ...(CANDIDATE_STAGES.includes(stage as typeof CANDIDATE_STAGES[number]) ? { stage } : {}), ...(query ? { name: { contains: query.slice(0,160), mode: "insensitive" as const } } : {}) };
  const [openings,candidates,total,templates] = await Promise.all([
    prisma.hiringOpening.findMany({ where: { workspaceId: actor.workspace.id }, orderBy: { createdAt: "desc" } }),
    prisma.hiringCandidate.findMany({ where, include: { opening: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 25, skip: (page-1)*25 }),
    prisma.hiringCandidate.count({ where }),
    prisma.checklistTemplate.findMany({ where: { workspaceId: actor.workspace.id, kind: "ONBOARDING" }, select: { id: true, name: true } }),
  ]);
  return { openings,candidates,total,templates };
}
export async function getCandidate(actor: OpsActor, recordId: string) {
  await guard(actor,true);
  return prisma.hiringCandidate.findFirst({ where: { workspaceId: actor.workspace.id, id: recordId }, include: { opening: true, interviews: { orderBy: { heldOn: "desc" } } } });
}
export async function createOpening(actor: OpsActor, input: unknown) {
  const v = parse(openingSchema,input);
  return write(actor,`opening:${v.requestKey}`,true,async tx => {
    const prior = await tx.hiringOpening.findFirst({ where: { workspaceId: actor.workspace.id, requestKey: v.requestKey } }); if (prior) return prior;
    await adminRef(actor,v.ownerId,tx);
    const r = await tx.hiringOpening.create({ data: { ...v, dueOn: v.dueOn ? new Date(v.dueOn) : null, workspaceId: actor.workspace.id } });
    await index(actor,"ops_opening",r.id,r.title,"hiring/openings",tx,actor.user.id); await audit(actor,"opening",r.id,"created",tx); return r;
  });
}
export async function updateOpening(actor: OpsActor, input: unknown) {
  const v = parse(openingSchema.omit({ requestKey:true }).extend({ id, status: z.enum(["OPEN","PAUSED","CLOSED"]) }),input);
  return write(actor,`opening:${v.id}`,true,async tx => {
    if (!await tx.hiringOpening.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id } })) throw unavailable();
    await adminRef(actor,v.ownerId,tx);
    const r = await tx.hiringOpening.update({ where: { workspaceId_id: { workspaceId: actor.workspace.id,id:v.id } }, data: { ...v, dueOn: v.dueOn ? new Date(v.dueOn) : null } });
    await index(actor,"ops_opening",r.id,r.title,"hiring/openings",tx,actor.user.id); await audit(actor,"opening",r.id,"updated",tx);
  });
}
export async function createCandidate(actor: OpsActor, input: unknown) {
  const v = parse(candidateSchema,input);
  return write(actor,`candidate:${v.requestKey}`,true,async tx => {
    const prior = await tx.hiringCandidate.findFirst({ where: { workspaceId: actor.workspace.id, requestKey: v.requestKey } }); if (prior) return prior;
    if (!await tx.hiringOpening.findFirst({ where: { workspaceId: actor.workspace.id, id: v.openingId, status: "OPEN" } })) throw new OperationsError("Choose an open position in this workspace.");
    await adminRef(actor,v.ownerId,tx);
    const r = await tx.hiringCandidate.create({ data: { ...v, workspaceId: actor.workspace.id, dueOn: v.dueOn ? new Date(v.dueOn) : null } });
    await index(actor,"ops_candidate",r.id,r.name,"hiring",tx,actor.user.id); await audit(actor,"candidate",r.id,"created",tx); return r;
  });
}
export async function updateCandidate(actor: OpsActor, input: unknown) {
  const v = parse(candidateSchema.omit({ requestKey:true, openingId:true }).extend({ id, stage:z.enum(CANDIDATE_STAGES), offer:optionalText, decision:optionalText, expectedUpdatedAt: z.iso.datetime() }),input);
  return write(actor,`candidate:${v.id}`,true,async (tx,emit) => {
    const row = await tx.hiringCandidate.findFirst({ where: { workspaceId: actor.workspace.id, id:v.id } }); if (!row) throw unavailable();
    if (row.updatedAt.toISOString() !== v.expectedUpdatedAt) throw new OperationsError("This candidate changed. Refresh before saving.");
    if (row.onboardingRunId && v.stage !== "HIRED") throw new OperationsError("This candidate has started onboarding. Keep the hired stage.");
    if (["HIRED","DECLINED"].includes(v.stage) && !v.decision) throw new OperationsError("Add a decision note before recording the outcome.");
    await adminRef(actor,v.ownerId,tx);
    const { expectedUpdatedAt: _version, ...data } = v; void _version;
    const r = await tx.hiringCandidate.update({ where: { workspaceId_id: { workspaceId:actor.workspace.id,id:v.id } }, data: { ...data, dueOn: v.dueOn ? new Date(v.dueOn) : null } });
    await index(actor,"ops_candidate",r.id,r.name,"hiring",tx,actor.user.id); await audit(actor,"candidate",r.id,"updated",tx);
    await emit("ops.people_changed",r.id,"A candidate assigned to you has an update","hiring",[v.ownerId]);
  });
}
export async function addInterview(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, heldOn:day, note:body }),input);
  return write(actor,`candidate:${v.id}`,true,async tx => {
    if (!await tx.hiringCandidate.findFirst({ where: { workspaceId:actor.workspace.id,id:v.id } })) throw unavailable();
    const r = await tx.hiringInterview.create({ data: { workspaceId:actor.workspace.id,candidateId:v.id,interviewerId:actor.user.id,heldOn:new Date(v.heldOn),note:v.note } }); await audit(actor,"interview",r.id,"added",tx);
  });
}
export async function convertCandidate(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, userId:id, templateId:id }),input);
  return write(actor,`candidate:${v.id}`,true,async (tx,emit) => {
    const r = await tx.hiringCandidate.findFirst({ where: { workspaceId:actor.workspace.id,id:v.id } }); if (!r) throw unavailable();
    if (r.onboardingRunId) return r.onboardingRunId;
    if (r.stage !== "HIRED") throw new OperationsError("Record the hiring decision before starting onboarding.");
    const [member,template] = await Promise.all([
      tx.membership.findFirst({ where: { workspaceId:actor.workspace.id,userId:v.userId,status:"ACTIVE",role:{not:"GUEST"},user: { email: { equals:r.email,mode:"insensitive" },disabledAt:null } },include:{user:true} }),
      tx.checklistTemplate.findFirst({ where: { workspaceId:actor.workspace.id,id:v.templateId,kind:"ONBOARDING" } }),
    ]);
    if (!member || !template) throw new OperationsError("Invite the candidate first, then choose their matching account and an onboarding template.");
    const run = await startTemplateRun(tx,{ workspaceId:actor.workspace.id,template,subjectUserId:v.userId,subjectName:r.name,actorId:actor.user.id });
    await tx.hiringCandidate.update({ where: { workspaceId_id: { workspaceId:actor.workspace.id,id:r.id } },data:{onboardingRunId:run.id} });
    await audit(actor,"candidate",r.id,"onboarding_started",tx); await emit("ops.people_changed",run.id,"Your onboarding checklist is ready","onboarding",[v.userId]); return run.id;
  });
}
