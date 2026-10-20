import { deleteObjects,fileResponse } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { type OpsActor } from "@/lib/opsGaps/context";
import { createTicket, getTicket, listTickets, commentTicket, triageTicket } from "@/lib/opsGaps/helpdesk";
import { createSafety, listSafety, getSafety, addSafetyAction, completeSafetyAction, updateSafety } from "@/lib/opsGaps/safety";
import { submitHours, listHours, getHours, reviewHours, withdrawHours } from "@/lib/opsGaps/volunteering";
import { searchDocuments } from "@/lib/search/query";
import { run } from "@/lib/scheduled/opsGaps";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
const suffix = uniqueSuffix(), domain = `@opsgaps-${suffix}.test`, slugs = [`ops-a-${suffix}`,`ops-b-${suffix}`];
let owner: OpsActor, manager: OpsActor, member: OpsActor, peer: OpsActor, guest: OpsActor, other: OpsActor;
const request = () => ({ title: "Internal identity portal", description: "Please help the operating team sign in.", category: "IT support", priority: "NORMAL", requestKey: randomUUID() });
const safety = () => ({ title: "Confidential sample near miss", description: "An operator tripped in the office.", immediateAction: "Cleared the walkway", location: "Office", kind: "NEAR_MISS", occurredAt: new Date("2026-01-01T09:00:00Z"), requestKey: randomUUID() });
const hours = (start = "2026-01-01T09:00:00Z", end = "2026-01-01T11:00:00Z") => ({ activity: "Internal documentation", startsAt: new Date(start), endsAt: new Date(end), breakMinutes: 15, requestKey: randomUUID() });
const search = (a: OpsActor, q: string) => searchDocuments({ workspaceId: a.workspace.id, userId: a.user.id, role: a.membership.role },q);
beforeAll(async () => {
  const users = await Promise.all(["owner","manager","member","peer","guest"].map(n => createUser(`${n}${domain}`,n)));
  const a = await createWorkspace(slugs[0],users[0].id), b = await createWorkspace(slugs[1],users[2].id);
  for (const [i,role] of [[1,"ADMIN"],[2,"MEMBER"],[3,"MEMBER"],[4,"GUEST"]] as const) await addMember(a.id,users[i].id,role);
  [owner,manager,member,peer,guest] = users.map((u,i) => ({ user: u, workspace: a, membership: { role: (["OWNER","ADMIN","MEMBER","MEMBER","GUEST"] as const)[i] } }));
  other = { user: users[2], workspace: b, membership: { role: "OWNER" } };
},60000);
afterAll(async () => { const files = await prisma.fileObject.findMany({ where: { workspace: { slug: { in: slugs } }, folder: "/people-service" }, select: { storageKey: true } }); await deleteObjects(files.map(f=>f.storageKey)); await cleanup(slugs,domain); },60000);

describe("help desk isolation and workflow", () => {
  it("creates idempotently and indexes only for requester/admin", async () => {
    const input = request(); const [a,b] = await Promise.all([createTicket(member,input),createTicket(member,input)]);
    expect(a.id).toBe(b.id);
    expect((await listTickets(peer)).rows.some(r => r.id === a.id)).toBe(false);
    expect(await getTicket(other,a.id)).toBeNull();
    expect(await getTicket(peer,a.id)).toBeNull();
    expect((await search(member,"identity portal")).some(r => r.entityId === a.id)).toBe(true);
    expect((await search(owner,"identity portal")).some(r => r.entityId === a.id)).toBe(true);
    expect((await search(peer,"identity portal")).some(r => r.entityId === a.id)).toBe(false);
    expect((await search(guest,"identity portal")).some(r => r.entityId === a.id)).toBe(false);
  });
  it("rejects guests, foreign assignees and stale updates", async () => {
    await expect(createTicket(guest,request())).rejects.toThrow("access");
    const r = await createTicket(member,request());
    const input = { id: r.id, priority: "HIGH", status: "IN_PROGRESS", assigneeId: manager.user.id, expectedUpdatedAt: r.updatedAt.toISOString() };
    await expect(triageTicket(member,input)).rejects.toThrow("access");
    await expect(triageTicket(other,input)).rejects.toThrow("unavailable");
    await expect(triageTicket(owner,{ ...input, assigneeId: peer.user.id })).rejects.toThrow("active admin");
    await triageTicket(owner,input);
    await expect(triageTicket(owner,input)).rejects.toThrow("changed");
  });
  it("keeps internal notes out of the requester payload", async () => {
    const r = await createTicket(member,request());
    await commentTicket(owner,{ id: r.id, body: "Private handling detail", internal: true });
    await commentTicket(member,{ id: r.id, body: "Thank you", internal: false });
    expect((await getTicket(member,r.id))?.comments.map(c => c.body)).toEqual(["Thank you"]);
    expect((await getTicket(owner,r.id))?.comments).toHaveLength(2);
    await expect(commentTicket(member,{ id: r.id, body: "Secret", internal: true })).rejects.toThrow("Only admins");
    await expect(commentTicket(peer,{ id: r.id, body: "Intrusion" })).rejects.toThrow("unavailable");
  });
  it("closes, blocks replies, and reopens with a fresh target", async () => {
    const r = await createTicket(member,request());
    const closed = await triageTicket(owner,{ id: r.id, priority: r.priority, status: "CLOSED", assigneeId: "", expectedUpdatedAt: r.updatedAt.toISOString() });
    await expect(commentTicket(member,{ id: r.id, body: "Reply" })).rejects.toThrow("closed");
    await expect(triageTicket(owner,{ id: r.id, priority: r.priority, status: "WAITING", assigneeId: "", expectedUpdatedAt: closed.updatedAt.toISOString() })).rejects.toThrow("Reopen");
    const reopened = await triageTicket(owner,{ id: r.id, priority: "HIGH", status: "OPEN", assigneeId: "", expectedUpdatedAt: closed.updatedAt.toISOString() });
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.slaDueAt.getTime()-Date.now()).toBeGreaterThan(23*3600000);
  });
});

describe("confidential safety reports", () => {
  it("restricts all reads and keeps details out of activity and notifications and scopes search to reporter/admin", async () => {
    const input = safety(); const r = await createSafety(member,input); expect((await createSafety(member,input)).id).toBe(r.id);
    expect(await getSafety(peer,r.id)).toBeNull(); expect(await getSafety(other,r.id)).toBeNull();
    expect((await listSafety(peer)).rows.some(v => v.id === r.id)).toBe(false);
    await expect(listSafety(guest)).rejects.toThrow("access");
    expect(await prisma.searchDocument.count({ where: { workspaceId: owner.workspace.id, entityId: r.id, visibility: "PRIVATE", ownerId: member.user.id } })).toBe(1);
    expect((await search(peer,"Confidential sample near miss")).some(v=>v.entityId===r.id)).toBe(false);
    expect((await search(member,"Confidential sample near miss")).some(v=>v.entityId===r.id)).toBe(true);
    expect(await prisma.activityEvent.count({ where: { workspaceId: owner.workspace.id, entityId: r.id } })).toBe(0);
    const events = await prisma.notificationEventRecord.findMany({ where: { workspaceId: owner.workspace.id, type: "ops.safety_changed" } });
    expect(JSON.stringify(events)).not.toContain(input.description);
    expect(JSON.stringify(events)).not.toContain(input.title);
  });
  it("requires admin follow-ups, completion evidence and closure notes", async () => {
    const r = await createSafety(member,safety());
    await expect(addSafetyAction(member,{ id: r.id, title: "Clear office", assigneeId: owner.user.id, dueAt: new Date() })).rejects.toThrow("access");
    await expect(addSafetyAction(owner,{ id: r.id, title: "Clear office", assigneeId: peer.user.id, dueAt: new Date() })).rejects.toThrow("active admin");
    const a = await addSafetyAction(owner,{ id: r.id, title: "Clear office", assigneeId: manager.user.id, dueAt: new Date() });
    expect((await getSafety(member,r.id))?.actions).toHaveLength(0);
    await expect(updateSafety(owner,{ id: r.id, expectedStatus: "REPORTED", status: "CLOSED", closureNote: "Checked" })).rejects.toThrow("every follow-up");
    await completeSafetyAction(manager,{ id: r.id, actionId: a.id, completionNote: "Checked the route and cleared obstacles." });
    await expect(updateSafety(owner,{ id: r.id, expectedStatus: "REPORTED", status: "CLOSED", closureNote: "" })).rejects.toThrow("closure note");
    await updateSafety(owner,{ id: r.id, expectedStatus: "REPORTED", status: "CLOSED", closureNote: "All follow-ups verified." });
    expect((await getSafety(member,r.id))?.status).toBe("CLOSED");
    await expect(addSafetyAction(owner,{ id: r.id, title: "More", assigneeId: owner.user.id, dueAt: new Date() })).rejects.toThrow("Reopen");
  });
});

describe("volunteer hours", () => {
  it("serialises overlap checks and supports idempotent retries", async () => {
    const v = hours(); const [a,b] = await Promise.all([submitHours(member,v),submitHours(member,v)]); expect(a.id).toBe(b.id);
    const results = await Promise.allSettled([submitHours(member,hours("2026-01-02T09:00:00Z","2026-01-02T11:00:00Z")),submitHours(member,hours("2026-01-02T10:00:00Z","2026-01-02T12:00:00Z"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await getHours(peer,a.id)).toBeNull(); expect(await getHours(other,a.id)).toBeNull();
    expect((await listHours(peer)).rows.some(r => r.id === a.id)).toBe(false);
  });
  it("requires another admin for approval and rejects double decisions", async () => {
    const own = await submitHours(owner,hours()); await expect(reviewHours(owner,{ id: own.id, decision: "APPROVED", reviewNote: "Mine" })).rejects.toThrow("Another admin");
    await reviewHours(manager,{ id: own.id, decision: "APPROVED", reviewNote: "Verified" });
    await expect(reviewHours(manager,{ id: own.id, decision: "REJECTED", reviewNote: "Again" })).rejects.toThrow("already");
    expect((await listHours(owner)).approved).toBeGreaterThanOrEqual(105);
    await expect(withdrawHours(owner,{ id: own.id })).rejects.toThrow("pending");
  });
  it("withdraws only own pending logs and allows corrected resubmission", async () => {
    const r = await submitHours(peer,hours()); await expect(withdrawHours(member,{ id: r.id })).rejects.toThrow("your pending");
    await withdrawHours(peer,{ id: r.id }); const revised = await submitHours(peer,hours()); expect(revised.id).not.toBe(r.id);
    await expect(reviewHours(member,{ id: revised.id, decision: "APPROVED", reviewNote: "No" })).rejects.toThrow("access");
  });
});

describe("shared lifecycle protection", () => {
  it("rejects stale membership and disabled users on reads and writes", async () => {
    await prisma.membership.updateMany({ where: { workspaceId: owner.workspace.id, userId: peer.user.id }, data: { status: "SUSPENDED" } });
    await expect(listTickets(peer)).rejects.toThrow("access"); await expect(createSafety(peer,safety())).rejects.toThrow("access");
    await prisma.membership.updateMany({ where: { workspaceId: owner.workspace.id, userId: peer.user.id }, data: { status: "ACTIVE", role: "GUEST" } });
    await expect(listHours(peer)).rejects.toThrow("access");
    await prisma.membership.updateMany({ where: { workspaceId: owner.workspace.id, userId: peer.user.id }, data: { role: "MEMBER" } });
    await prisma.user.update({ where: { id: peer.user.id }, data: { disabledAt: new Date() } }); await expect(listTickets(peer)).rejects.toThrow("access");
    await prisma.user.update({ where: { id: peer.user.id }, data: { disabledAt: null } });
  });
  it("deduplicates scheduled checklist and target reminders across ticks", async () => {
    const r = await createTicket(member,request()); await prisma.helpTicket.update({ where: { id: r.id }, data: { slaDueAt: new Date("2026-01-01T10:00:00Z") } });
    const now = new Date(); await run(now); const before = await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: { in: ["ops.reminder"] } } }); await run(now);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, type: { in: ["ops.reminder"] } } })).toBe(before); expect(before).toBeGreaterThan(0);
  });
  it("cascades tenant children and rejects mismatched composite tenant relations", async () => {
    const ticket = await createTicket(member,request());
    await expect(prisma.helpTicketComment.create({ data: { workspaceId: other.workspace.id, ticketId: ticket.id, authorId: other.user.id, body: "Cross tenant" } })).rejects.toThrow();
    await prisma.workspace.update({ where: { id: other.workspace.id }, data: { archivedAt: new Date() } }); await expect(listTickets(other)).rejects.toThrow("access");
    await prisma.workspace.update({ where: { id: other.workspace.id }, data: { archivedAt: null } });
  });
});

import { saveLeaveType,saveBalance,leaveData,saveEngagement,cancelLeave } from "@/lib/opsGaps/leave";
import { requestTimeOff,decideTimeOff } from "@/lib/people/timeOff";
import { createOpening,createCandidate,getCandidate,updateCandidate,addInterview,convertCandidate } from "@/lib/opsGaps/hiring";
import { saveFacilityContact,saveLease,facilityData } from "@/lib/opsGaps/facilities";
import { createInspectionTemplate,startInspection,recordFinding,addInspectionAction,finishInspection,inspectionData } from "@/lib/opsGaps/inspections";
import { attachFiles,listAttachments } from "@/lib/opsGaps/attachments";
import { findDownloadableFile } from "@/lib/files";
import { exportBatch,exportResponse } from "@/lib/opsGaps/export";
import { monthlyHours } from "@/lib/opsGaps/volunteering";
import { libraryWhere } from "@/lib/files/service";

describe("leave and yearly balances",()=>{
 it("extends approved Availability, prevents overdrawing and restores cancelled balance",async()=>{
  await saveLeaveType(owner,{name:"Annual leave"});const type=(await leaveData(owner,2027)).types[0];
  await saveBalance(owner,{userId:member.user.id,typeId:type.id,year:2027,allowanceDays:3});
  expect((await requestTimeOff(member,{from:"2027-01-01",to:"2027-01-02",leaveTypeId:type.id,visibility:"PRIVATE"})).ok).toBe(true);
  const run=await prisma.checklistRun.findFirstOrThrow({where:{workspaceId:owner.workspace.id,subjectUserId:member.user.id,items:{some:{sourceType:"availability_request"}}},orderBy:{createdAt:"desc"}});
  expect((await decideTimeOff(owner,{id:run.id,approved:true})).ok).toBe(true);
  expect(await prisma.availability.count({where:{workspaceId:owner.workspace.id,userId:member.user.id}})).toBeGreaterThan(0);
  expect((await leaveData(member,2027)).balances[0].used).toBe(2);
  expect((await requestTimeOff(member,{from:"2027-02-01",to:"2027-02-02",leaveTypeId:type.id})).ok).toBe(false);
  await expect(saveBalance(owner,{userId:member.user.id,typeId:type.id,year:2027,allowanceDays:1})).rejects.toThrow("less than");
  await expect(cancelLeave(peer,{id:run.id})).rejects.toThrow("Only your");await cancelLeave(member,{id:run.id});expect((await leaveData(member,2027)).balances[0].used).toBe(0);
 });
 it("serialises concurrent approvals so balances cannot go negative",async()=>{
  const type=(await leaveData(owner,2027)).types[0];await saveBalance(owner,{userId:peer.user.id,typeId:type.id,year:2027,allowanceDays:1});
  for(const day of ["2027-03-01","2027-03-02"])expect((await requestTimeOff(peer,{from:day,to:day,leaveTypeId:type.id})).ok).toBe(true);
  const rows=await prisma.checklistRun.findMany({where:{workspaceId:owner.workspace.id,subjectUserId:peer.user.id,items:{some:{sourceType:"availability_request"}}}});
  const results=await Promise.all(rows.map(r=>decideTimeOff(owner,{id:r.id,approved:true})));expect(results.filter(r=>r.ok)).toHaveLength(1);
 });
 it("enforces tenant, role and cross-year limits for leave and profile changes",async()=>{
  const type=(await leaveData(owner,2027)).types[0];
  await expect(saveBalance(member,{userId:member.user.id,typeId:type.id,year:2027,allowanceDays:30})).rejects.toThrow("access");
  expect((await requestTimeOff(other,{from:"2027-01-01",to:"2027-01-01",leaveTypeId:type.id})).ok).toBe(false);
  expect((await requestTimeOff(member,{from:"2027-12-31",to:"2028-01-01",leaveTypeId:type.id})).ok).toBe(false);
  await saveEngagement(owner,{userId:member.user.id,engagementType:"STAFF",startsOn:"2026-10-01",endsOn:""});
  expect((await leaveData(member,2027)).profiles[0].engagementType).toBe("STAFF");
  await expect(saveEngagement(manager,{userId:owner.user.id,engagementType:"CONTRACTOR",startsOn:"",endsOn:""})).rejects.toThrow("cannot change");
  expect((await leaveData(peer,2027)).balances.every(b=>b.userId===peer.user.id)).toBe(true);
 });
});

describe("hiring, interviews and onboarding",()=>{
 it("keeps candidate contacts and notes admin-only and tenant isolated",async()=>{
  const opening=await createOpening(owner,{title:"Office coordinator",description:"Internal role",engagementType:"STAFF",ownerId:owner.user.id,dueOn:"2027-01-01",requestKey:randomUUID()});
  const v={openingId:opening.id,name:"Candidate one",email:"candidate@example.test",phone:"",source:"Referral",notes:"Restricted notes",ownerId:owner.user.id,dueOn:"",requestKey:randomUUID()};const r=await createCandidate(owner,v);
  expect((await createCandidate(owner,v)).id).toBe(r.id);await expect(getCandidate(member,r.id)).rejects.toThrow("access");expect(await getCandidate(other,r.id)).toBeNull();
  await addInterview(manager,{id:r.id,heldOn:"2026-10-01",note:"Interviewer-specific notes"});expect((await getCandidate(owner,r.id))?.interviews[0].interviewerId).toBe(manager.user.id);
  expect((await search(member,"Candidate one")).some(h=>h.entityId===r.id)).toBe(false);
  expect((await search(owner,"Candidate one")).some(h=>h.entityId===r.id)).toBe(true);
  await attachFiles(owner,{kind:"candidate",recordId:r.id,files:[new File(["%PDF-1.4\nCV"],"cv.pdf",{type:"application/pdf"}),new File(["%PDF-1.4\nLetter"],"letter.pdf",{type:"application/pdf"})]});
  const cv=(await listAttachments(owner,"candidate",r.id))[0].file;expect(await findDownloadableFile(cv.id,member.user.id)).toBeNull();expect(await findDownloadableFile(cv.id,manager.user.id)).not.toBeNull();
  await expect(createCandidate(other,{...v,requestKey:randomUUID()})).rejects.toThrow("open position");
 });
 it("starts the existing onboarding checklist once for the matching invited account",async()=>{
  const opening=await createOpening(owner,{title:"Volunteer coordinator",description:"Internal team",engagementType:"VOLUNTEER",ownerId:owner.user.id,requestKey:randomUUID()});
  const account=await prisma.user.findUniqueOrThrow({where:{id:member.user.id}});
  const r=await createCandidate(owner,{openingId:opening.id,name:"Known candidate",email:account.email,ownerId:owner.user.id,requestKey:randomUUID()});
  await updateCandidate(owner,{id:r.id,name:r.name,email:r.email,phone:"",source:"",notes:"",ownerId:owner.user.id,stage:"HIRED",offer:"Volunteer role",decision:"Agreed",expectedUpdatedAt:r.updatedAt.toISOString()});
  const t=await prisma.checklistTemplate.create({data:{workspaceId:owner.workspace.id,kind:"ONBOARDING",name:"Team induction",items:[{title:"Read handbook",assigneeRule:"SUBJECT",required:true,dueOffsetDays:0}]}});
  await expect(convertCandidate(owner,{id:r.id,userId:peer.user.id,templateId:t.id})).rejects.toThrow("Invite");
  const a=await convertCandidate(owner,{id:r.id,userId:member.user.id,templateId:t.id});const b=await convertCandidate(owner,{id:r.id,userId:member.user.id,templateId:t.id});expect(a).toBe(b);
  expect(await prisma.checklistRun.count({where:{workspaceId:owner.workspace.id,id:a,subjectUserId:member.user.id,kind:"ONBOARDING"}})).toBe(1);
  await expect(updateCandidate(owner,{id:r.id,name:r.name,email:r.email,phone:"",source:"",notes:"",ownerId:owner.user.id,stage:"HIRED",decision:"Agreed",expectedUpdatedAt:r.updatedAt.toISOString()})).rejects.toThrow("changed");
 });
});

describe("confidential help desk handlers",()=>{
 it("denies unrelated admins across detail, search, comments, export and files",async()=>{
  const r=await createTicket(member,{...request(),title:"Confidential workplace concern",category:"Confidential",handlerId:manager.user.id});
  expect(await getTicket(owner,r.id)).toBeNull();expect(await getTicket(manager,r.id)).not.toBeNull();expect(await getTicket(member,r.id)).not.toBeNull();
  await expect(commentTicket(owner,{id:r.id,body:"Not assigned"})).rejects.toThrow("unavailable");
  expect((await search(owner,"Confidential workplace")).some(h=>h.entityId===r.id)).toBe(false);
  expect((await exportBatch(owner,"helpdesk")).some(h=>h.id===r.id)).toBe(false);
  await attachFiles(member,{kind:"ticket",recordId:r.id,files:[new File(["%PDF-1.4\nproof"],"concern.pdf",{type:"application/pdf"})]});const file=(await listAttachments(member,"ticket",r.id))[0].file;
  expect(await findDownloadableFile(file.id,owner.user.id)).toBeNull();expect(await findDownloadableFile(file.id,manager.user.id)).not.toBeNull();
 });
});

describe("evidence files and facilities",()=>{
 it("serves incident proofs only to reporter and admins and hides them from the file library",async()=>{
  const r=await createSafety(member,safety());await attachFiles(member,{kind:"safety",recordId:r.id,files:[new File(["%PDF-1.4\nevidence"],"incident.pdf",{type:"application/pdf"})]});const file=(await listAttachments(member,"safety",r.id))[0].file;
  expect(await findDownloadableFile(file.id,peer.user.id)).toBeNull();expect(await findDownloadableFile(file.id,owner.user.id)).not.toBeNull();expect(await findDownloadableFile(file.id,member.user.id)).not.toBeNull();
  const downloadable=await findDownloadableFile(file.id,member.user.id);const response=await fileResponse(downloadable!);expect(response.headers.get("Content-Type")).toBe("application/pdf");expect(await response.text()).toContain("%PDF-1.4");
  expect(await prisma.fileObject.findFirst({where:{id:file.id,...await libraryWhere(owner)}})).toBeNull();
  await expect(attachFiles(other,{kind:"safety",recordId:r.id,files:[new File(["a"],"x.pdf",{type:"application/pdf"})]})).rejects.toThrow("unavailable");
  await expect(attachFiles(member,{kind:"safety",recordId:r.id,files:[new File(["a"],"x.txt",{type:"text/plain"})]})).rejects.toThrow("type");
 });
 it("validates lease contact tenancy and permissions, keeping contracts admin-only",async()=>{
  const c=await saveFacilityContact(owner,{name:"Landlord sample",email:"landlord@example.test",phone:"+919000000001",notes:"Office contact"});
  const v={title:"Community office",landlordContactId:c.id,ownerId:owner.user.id,rentMinor:1200000,currency:"INR",startsOn:"2026-01-01",renewalOn:"2027-01-01",notes:"Contract",requestKey:randomUUID()};
  const r=await saveLease(owner,v);expect((await saveLease(owner,v)).id).toBe(r.id);
  await expect(saveLease(other,{...v,ownerId:other.user.id,requestKey:randomUUID()})).rejects.toThrow("contact");await expect(facilityData(member)).rejects.toThrow("access");
  await attachFiles(owner,{kind:"lease",recordId:r.id,files:[new File(["%PDF-1.4\ncontract"],"lease.pdf",{type:"application/pdf"})]});const file=(await listAttachments(owner,"lease",r.id))[0].file;expect(await findDownloadableFile(file.id,member.user.id)).toBeNull();
 });
});

describe("inspection findings and corrective actions",()=>{
 it("extends checklist templates/runs and requires signed findings before closure",async()=>{
  await createInspectionTemplate(owner,{title:"Safety checks",steps:["Clear exits"]});const t=(await inspectionData(owner)).templates[0];const r=await startInspection(owner,{templateId:t.id,ownerId:owner.user.id,date:"2026-10-20"});
  expect((await startInspection(owner,{templateId:t.id,ownerId:owner.user.id,date:"2026-10-20"})).id).toBe(r.id);
  await addInspectionAction(owner,{runId:r.id,title:"Move boxes",ownerId:manager.user.id,dueOn:"2026-10-21",note:"Clear the route"});
  await expect(finishInspection(owner,{id:r.id})).rejects.toThrow("every finding");await expect(inspectionData(member)).rejects.toThrow("access");
  const run=(await inspectionData(owner)).runs.find(v=>v.id===r.id)!;for(const i of run.items)await recordFinding(owner,{runId:r.id,itemId:i.id,note:"Checked and cleared"});
  await finishInspection(owner,{id:r.id});expect((await inspectionData(owner)).runs.find(v=>v.id===r.id)?.status).toBe("DONE");
  await expect(recordFinding(owner,{runId:r.id,itemId:run.items[0].id,note:"Overwrite"})).rejects.toThrow("unavailable");
 });
});

describe("monthly totals and CSV boundaries",()=>{
 it("groups hours by person/month with member scope",async()=>{
  const rows=await monthlyHours(member,"2026-01");expect(rows.every(r=>r.userId===member.user.id)).toBe(true);await expect(monthlyHours(member,"2026-13")).rejects.toThrow("valid month");
  expect((await exportBatch(member,"hours")).every(r=>r.cells[1]===member.user.id)).toBe(true);
 });
 it("restricts exports and returns a private complete CSV",async()=>{
  await expect(exportBatch(member,"hiring")).rejects.toThrow("access");await expect(exportBatch(guest,"hours")).rejects.toThrow("access");
  const response=await exportResponse(member,"hours");expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(await response.text()).toContain('"Worked minutes"');
 });
});


it("seeds manual Indian office examples repeatedly without duplicate records",async()=>{
 const {default:seed}=await import("../../scripts/seed/ops-gaps.mjs");
 const workspaceId=owner.workspace.id;
 await seed(prisma,{workspaceId,workspace:owner.workspace,users:[],channels:[]});
 const before=await prisma.hiringCandidate.count({where:{workspaceId,requestKey:"seed-candidate"}});
 await seed(prisma,{workspaceId,workspace:owner.workspace,users:[],channels:[]});
 expect(await prisma.hiringCandidate.count({where:{workspaceId,requestKey:"seed-candidate"}})).toBe(before);
 expect(before).toBe(1);expect(await prisma.facilityLease.count({where:{workspaceId,currency:"INR",requestKey:"seed-office-lease"}})).toBe(1);
});
