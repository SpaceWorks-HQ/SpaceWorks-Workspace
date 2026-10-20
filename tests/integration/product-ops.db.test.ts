import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { toDateInputValue } from "@/lib/tasks/localDate";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { saveRecord, type Actor } from "@/lib/productOps/service";
import { operate } from "@/lib/productOps/operations";
import { attachFile, detachFile } from "@/lib/productOps/files";
import { loadProductOps } from "@/lib/productOps/load";
import { exportProductOps, exportEstimate } from "@/lib/productOps/exports";
import { saveOwnership } from "@/lib/productOps/ownership";
import { decide, getApprovalView, approvalInbox, commentOnApproval } from "@/lib/approvals/engine";
import type { OpsActor } from "@/lib/approvals/context";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import { run } from "@/lib/scheduled/productOps";
import { getObject, deleteObjects } from "@/lib/storage";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "../helpers/fixtures";
const suffix=uniqueSuffix(), emails=`@product-${suffix}.test`,slugs=[`product-${suffix}`,`product-other-${suffix}`];
let actor:Actor,member:Actor,other:Actor,guest:Actor,projectId="",estimateId="",releaseId="",qaId="",roadmapId="",reviewer:OpsActor;
const base=(kind:string,details:object={},extra:object={})=>({kind,title:`Engineering ${kind}`,status:({RELEASE:"DRAFT",ISSUE:"OPEN",QA_RUN:"OPEN",ESTIMATE:"DRAFT"} as Record<string,string>)[kind]??"PLANNED",projectId,details,...extra});
const estimateDetails={lines:[{item:"Copper wire",category:"ELECTRICAL",quantityMilli:50000,unit:"metre",unitCostMinor:12000,gstBps:1800,supplier:"Kochi"}],contingencyBps:1000,revisionNote:"Initial funding budget"};
const releaseDetails={version:"0.1.0",scope:"First bench build",taskIds:[],roadmapIds:[],checklist:[{title:"Review safety",done:true,note:"Checked"}],releaseNotes:"Internal bench build is ready."};
const snapshotInput=async(id:string)=>{const row=await prisma.productRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,id}});return {...row,dateOn:row.dateOn?.toISOString().slice(0,10)??"",dueOn:row.dueOn?.toISOString().slice(0,10)??"",ownerId:row.ownerId??"",releaseId:row.releaseId??"",parentId:row.parentId??"",fundingId:row.fundingId??"",budgetId:row.budgetId??"",fundId:row.fundId??""};};
beforeAll(async()=>{
 const owner=await createUser(`owner${emails}`),ordinary=await createUser(`member${emails}`),stranger=await createUser(`other${emails}`),visitor=await createUser(`guest${emails}`);
 const workspace=await createWorkspace(slugs[0],owner.id),workspace2=await createWorkspace(slugs[1],stranger.id);
 actor={user:owner,workspace,membership:{role:"OWNER"}};other={user:stranger,workspace:workspace2,membership:{role:"OWNER"}};
 member={...actor,user:ordinary,membership:await addMember(workspace.id,ordinary.id)};guest={...actor,user:visitor,membership:await addMember(workspace.id,visitor.id,"GUEST")};
 reviewer={user:{id:owner.id,name:owner.name},workspace,membership:{role:"OWNER"}};
 projectId=(await prisma.project.create({data:{workspaceId:workspace.id,key:"OPS",name:"Engineering solar"}})).id;
 estimateId=(await saveRecord(actor,base("ESTIMATE",estimateDetails))).id;
 roadmapId=(await saveRecord(member,base("ROADMAP",{horizon:"NOW",quarter:"2026-Q4",outcome:"Test a demonstrator"},{status:"DONE"}))).id;
 releaseId=(await saveRecord(member,base("RELEASE",{...releaseDetails,roadmapIds:[roadmapId]},{ownerId:member.user.id,dueOn:"2026-11-10"}))).id;
 qaId=(await saveRecord(member,base("QA_RUN",{environment:"Bench",checklist:[{title:"Load test",done:true,note:"30 minutes"}],findings:"No restarts"},{status:"PASSED",releaseId}))).id;
});
afterAll(async()=>{const files=await prisma.fileObject.findMany({where:{workspaceId:{in:[actor.workspace.id,other.workspace.id]},folder:"/product-ops"},select:{storageKey:true}});await deleteObjects(files.map(f=>f.storageKey));await cleanup(slugs,emails);});
describe("product and engineering tools",()=>{
 it("restricts guests and estimates, including a forged role",async()=>{
  await expect(saveRecord(guest,base("ISSUE",{}))).rejects.toThrow();await expect(loadProductOps(guest,"roadmap",{})).rejects.toThrow();
  for(const denied of [member,{...member,membership:{role:"OWNER" as const}}]){await expect(saveRecord(denied,base("ESTIMATE",estimateDetails))).rejects.toThrow();await expect(loadProductOps(denied,"estimates",{})).rejects.toThrow();await expect(exportEstimate(denied,estimateId)).rejects.toThrow();}
 });
 it("rejects cross-workspace record and linked ids",async()=>{
  await expect(saveRecord(other,{...await snapshotInput(estimateId),title:"Forged"})).rejects.toThrow();
  await expect(saveRecord(other,base("ISSUE",{}))).rejects.toThrow();
  await expect(saveRecord(other,base("QA_RUN",{checklist:[{title:"Test",done:true}]},{projectId:"",releaseId}))).rejects.toThrow();
  expect((await loadProductOps(other,"estimates",{},)).records).toHaveLength(0);
 });
 it("rechecks suspended, disabled and archived state",async()=>{
  await prisma.membership.updateMany({where:{workspaceId:actor.workspace.id,userId:member.user.id},data:{status:"SUSPENDED"}});await expect(loadProductOps(member,"issues",{})).rejects.toThrow();
  await prisma.membership.updateMany({where:{workspaceId:actor.workspace.id,userId:member.user.id},data:{status:"ACTIVE"}});
  await prisma.user.update({where:{id:member.user.id},data:{disabledAt:new Date()}});await expect(saveRecord(member,base("ISSUE",{}))).rejects.toThrow();await prisma.user.update({where:{id:member.user.id},data:{disabledAt:null}});
  await prisma.workspace.update({where:{id:actor.workspace.id},data:{archivedAt:new Date()}});await expect(loadProductOps(actor,"roadmap",{})).rejects.toThrow();await prisma.workspace.update({where:{id:actor.workspace.id},data:{archivedAt:null}});
 });
 it("filters private-team projects from reads, links, exports and search",async()=>{
  const team=await prisma.team.create({data:{workspaceId:actor.workspace.id,name:"Private engineering",slug:`private-${suffix}`,visibility:"PRIVATE"}});
  const project=await prisma.project.create({data:{workspaceId:actor.workspace.id,key:"PVT",name:"Private prototype",teamId:team.id}});
  const record=await saveRecord(actor,base("ISSUE",{type:"BUG",severity:"HIGH"},{projectId:project.id,title:"Engineering private fault"}));
  expect((await loadProductOps(member,"issues",{edit:record.id})).selected).toBeNull();
  await expect(saveRecord(member,base("ISSUE",{},{projectId:project.id}))).rejects.toThrow();
  expect(await exportProductOps(member,"issues",{})).not.toContain("Engineering private fault");
  expect(await searchDocuments({workspaceId:actor.workspace.id,userId:member.user.id,role:"MEMBER"},"private fault","product_ops")).toHaveLength(0);
 });
 it("filters roadmap by horizon, quarter and project",async()=>{
  const data=await loadProductOps(member,"roadmap",{horizon:"NOW",quarter:"2026-Q4",project:projectId});expect(data.records.map(r=>r.id)).toContain(roadmapId);
  expect((await loadProductOps(member,"roadmap",{quarter:"2027-Q2"})).records).toHaveLength(0);
 });
 it("rejects stale estimate edits and keeps immutable funding snapshots",async()=>{
  const input=await snapshotInput(estimateId);const results=await Promise.allSettled([saveRecord(actor,{...input,notes:"First revision"}),saveRecord(actor,{...input,notes:"Stale revision"})]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  const history=await prisma.productEstimateRevision.findMany({where:{workspaceId:actor.workspace.id,recordId:estimateId},orderBy:{version:"asc"}});expect(history.map(v=>v.version)).toEqual([1,2]);expect((history[0].snapshot as {notes:string}).notes).toBe("");
 });
 it("reuses funding, funds and budgets with currency and tenant checks",async()=>{
  const funding=await prisma.fundingRecord.create({data:{workspaceId:actor.workspace.id,kind:"OPPORTUNITY",title:"Engineering grant",status:"APPLYING",currency:"INR"}});
  const fund=await prisma.financeFund.create({data:{workspaceId:actor.workspace.id,name:"Engineering funding"}});
  const budget=await prisma.budget.create({data:{workspaceId:actor.workspace.id,name:"Engineering budget",amountMinor:50000000,periodStart:new Date("2026-10-01"),periodEnd:new Date("2027-03-31")}});
  await saveRecord(actor,{...await snapshotInput(estimateId),fundingId:funding.id,fundId:fund.id,budgetId:budget.id});
  await expect(saveRecord(actor,{...await snapshotInput(estimateId),currency:"USD"})).rejects.toThrow();
  await expect(saveRecord(other,base("ESTIMATE",estimateDetails,{projectId:"",fundingId:funding.id}))).rejects.toThrow();
 });
 it("stores quotes privately, retains revision evidence and exports exact numbers",async()=>{
  const quote=await attachFile(actor,estimateId,new File(["%PDF-1.4\nquote"],"solar-quote.pdf",{type:"application/pdf"}));
  expect(await findDownloadableFile(quote.id,actor.user.id)).not.toBeNull();expect(await findDownloadableFile(quote.id,member.user.id)).toBeNull();expect(await findDownloadableFile(quote.id,other.user.id)).toBeNull();
  const where=await libraryWhere({...actor,user:{id:actor.user.id,name:null}});expect(await prisma.fileObject.count({where:{...where,id:quote.id}})).toBe(0);
  await expect(detachFile(actor,estimateId,quote.id)).rejects.toThrow();
  await saveRecord(actor,{...await snapshotInput(estimateId),details:{...estimateDetails,revisionNote:"Supplier quote linked",lines:[{...estimateDetails.lines[0],quoteFileId:quote.id}]}});
  const csv=await exportEstimate(actor,estimateId);expect(csv).toContain("7080.00");expect(csv).toContain("7788.00");expect(csv).toContain(`/api/files/${quote.id}`);expect(await exportEstimate(actor,estimateId,1)).not.toContain(quote.id);
  await expect(attachFile(actor,estimateId,new File(["text"],"text.txt",{type:"text/plain"}))).rejects.toThrow();
 });
 it("saves one stored budget PDF per revision under concurrent requests",async()=>{
  const results=await Promise.all([operate(actor,{op:"pdf",id:estimateId}),operate(actor,{op:"pdf",id:estimateId})]);expect(results[0].id).toBe(estimateId);
  const generated=await prisma.productAttachment.findMany({where:{workspaceId:actor.workspace.id,recordId:estimateId,generated:true}});expect(generated).toHaveLength(1);
  const file=await findDownloadableFile(generated[0].fileId,actor.user.id);const object=await getObject(file!.storageKey);const pdf=await PDFDocument.load(object!.body);expect(pdf.getPageCount()).toBeGreaterThan(0);expect(await findDownloadableFile(generated[0].fileId,member.user.id)).toBeNull();
 });
 it("gates release approval on QA, checklist, tasks and critical issues",async()=>{
  const fail=await saveRecord(member,base("QA_RUN",{checklist:[{title:"Voltage check",done:false}]},{releaseId,status:"FAILED"}));
  await expect(operate(member,{op:"requestApproval",id:releaseId})).rejects.toThrow(/QA/);await operate(member,{op:"archive",id:fail.id});
  const issue=await saveRecord(member,base("ISSUE",{severity:"CRITICAL",type:"BUG"},{releaseId}));await expect(operate(member,{op:"requestApproval",id:releaseId})).rejects.toThrow(/critical/);
  await saveRecord(member,{...await snapshotInput(issue.id),status:"RESOLVED"});
  const todo=await prisma.boardColumn.create({data:{projectId,name:"To do",category:"TODO",position:0}}),done=await prisma.boardColumn.create({data:{projectId,name:"Done",category:"DONE",position:1}});
  const task=await prisma.task.create({data:{workspaceId:actor.workspace.id,projectId,columnId:todo.id,number:1000,title:"Finish release wiring"}});
  await saveRecord(member,{...await snapshotInput(releaseId),details:{...releaseDetails,taskIds:[task.id],roadmapIds:[roadmapId]}});
  await expect(operate(member,{op:"requestApproval",id:releaseId})).rejects.toThrow(/scope task/);
  await prisma.task.updateMany({where:{workspaceId:actor.workspace.id,id:task.id},data:{columnId:done.id}});
  await expect(operate(member,{op:"ship",id:releaseId})).rejects.toThrow(/approval/);
 });
 it("freezes reviewed scope, rejects self-approval and ships once with an internal changelog",async()=>{
  await operate(member,{op:"requestApproval",id:releaseId});const release=await prisma.productRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,id:releaseId}});
  await expect(saveRecord(member,{...await snapshotInput(releaseId),status:"DRAFT"})).rejects.toThrow(/Withdraw/);
  await expect(saveRecord(member,{...await snapshotInput(qaId),status:"FAILED"})).rejects.toThrow(/Withdraw/);
  await expect(saveRecord(member,{...await snapshotInput(roadmapId),title:"New scope"})).rejects.toThrow(/Withdraw/);
  const self={...reviewer,user:{id:member.user.id,name:"Requester"},membership:{role:"MEMBER" as const}};expect((await decide(self,{requestId:release.approvalId!,decision:"APPROVED"})).ok).toBe(false);
  expect((await decide(reviewer,{requestId:release.approvalId!,decision:"APPROVED"})).ok).toBe(true);
  await expect(operate(member,{op:"ship",id:releaseId,publish:true})).rejects.toThrow(/admin/);
  await Promise.all([operate(actor,{op:"ship",id:releaseId,publish:true}),operate(actor,{op:"ship",id:releaseId,publish:true})]);
  expect(await prisma.changelogEntry.count({where:{workspaceId:actor.workspace.id,title:"Engineering RELEASE"}})).toBe(1);expect((await prisma.productRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,id:releaseId}})).status).toBe("SHIPPED");
 });
 it("records prototype failures and photos with record-scoped permissions",async()=>{
  const prototype=await saveRecord(member,base("PROTOTYPE",{version:"B",designRevision:"Re-route cable"},{status:"TESTING"}));
  const test=await saveRecord(member,base("TEST",{testPlan:"Dummy load for 30 minutes",results:"Display reset",findings:"Check cable",designRevision:"Re-terminate cable"},{parentId:prototype.id,status:"FAIL",dateOn:"2026-10-21"}));
  const proof=await attachFile(member,test.id,new File(["%PDF-1.4\nresults"],"test-results.pdf",{type:"application/pdf"}));expect(await findDownloadableFile(proof.id,actor.user.id)).not.toBeNull();expect(await findDownloadableFile(proof.id,guest.user.id)).toBeNull();
  await detachFile(member,test.id,proof.id);expect(await findDownloadableFile(proof.id,member.user.id)).toBeNull();
  const altered=await snapshotInput(prototype.id);await expect(saveRecord(member,{...altered,projectId:""})).rejects.toThrow(/linked/);
 });
 it("requires high-risk change approval, applies and logs a rollback",async()=>{
  const change=await saveRecord(member,base("CHANGE",{environment:"Bench",changed:"Firmware update",risk:"HIGH",rollback:"Restore firmware",requiresApproval:true},{releaseId}));
  await expect(operate(member,{op:"apply",id:change.id})).rejects.toThrow(/approval/);await operate(member,{op:"requestApproval",id:change.id});
  const row=await prisma.productRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,id:change.id}});expect((await decide(reviewer,{requestId:row.approvalId!,decision:"APPROVED"})).ok).toBe(true);
  await operate(member,{op:"apply",id:change.id});expect((await prisma.productRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,id:change.id}})).dateOn?.toISOString().slice(0,10)).toBe(toDateInputValue(new Date(),actor.workspace.timezone));await operate(member,{op:"rollback",id:change.id});expect((await loadProductOps(member,"changes",{edit:change.id})).selected!.status).toBe("ROLLED_BACK");
 });
 it("keeps private-project approval policies from exposing plans to other members",async()=>{
  const team=await prisma.team.create({data:{workspaceId:actor.workspace.id,name:"Private approval team",slug:`approval-${suffix}`,visibility:"PRIVATE"}});
  const project=await prisma.project.create({data:{workspaceId:actor.workspace.id,key:"REVIEW",name:"Private release review",teamId:team.id}});
  const policy=await prisma.approvalPolicy.create({data:{workspaceId:actor.workspace.id,subjectType:"PRODUCT_CHANGE",name:"Peer change review",isDefault:true,steps:[{approverType:"ROLE",ref:"MEMBER",minApprovals:1}]}});
  const change=await saveRecord(actor,base("CHANGE",{environment:"Private bench",changed:"Review private design",risk:"HIGH",rollback:"Restore previous settings",requiresApproval:true},{projectId:project.id}));
  await operate(actor,{op:"requestApproval",id:change.id});const row=await prisma.productRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,id:change.id}});
  const peer={...reviewer,user:{id:member.user.id,name:"Peer"},membership:{role:"MEMBER" as const}};
  expect(await getApprovalView(peer,"PRODUCT_CHANGE",change.id)).toBeNull();expect((await approvalInbox(peer)).some(r=>r.id===row.approvalId)).toBe(false);
  expect((await decide(peer,{requestId:row.approvalId!,decision:"APPROVED"})).ok).toBe(false);expect((await commentOnApproval(peer,{requestId:row.approvalId!,comment:"Should be denied"})).ok).toBe(false);
  expect(await prisma.notification.count({where:{workspaceId:actor.workspace.id,userId:member.user.id,url:{contains:change.id}}})).toBe(0);
  await prisma.teamMember.create({data:{teamId:team.id,userId:member.user.id}});expect((await decide(peer,{requestId:row.approvalId!,decision:"APPROVED"})).ok).toBe(true);
  await prisma.approvalPolicy.updateMany({where:{workspaceId:actor.workspace.id,id:policy.id},data:{isDefault:false}});
 });
 it("links existing GitHub records without opening a connection or crossing tenants",async()=>{
  const connection=await prisma.integrationConnection.create({data:{workspaceId:actor.workspace.id,provider:"GITHUB",accountLabel:"Existing engineering link",externalId:`github-${suffix}`}});
  const repo=await prisma.githubRepo.create({data:{workspaceId:actor.workspace.id,connectionId:connection.id,fullName:"space-works/solar",installationId:"manual-existing",linkedProjectId:projectId}});
  const event=await prisma.githubEvent.create({data:{workspaceId:actor.workspace.id,repoId:repo.id,deliveryId:`event-${suffix}`,kind:"release",title:"Existing first build"}});
  const record=await saveRecord(member,base("RELEASE",{...releaseDetails,repoId:repo.id,githubEventId:event.id},{ownerId:member.user.id,dueOn:"2026-12-01",title:"Engineering linked release"}));
  expect((await loadProductOps(member,"releases",{edit:record.id})).repos.some(r=>r.id===repo.id)).toBe(true);
  await expect(saveRecord(other,base("RELEASE",{...releaseDetails,repoId:repo.id,githubEventId:event.id},{projectId:"",ownerId:other.user.id,dueOn:"2026-12-01"}))).rejects.toThrow();
 });
 it("updates owners and backups on the existing catalogue without duplicating systems",async()=>{
  const service=await prisma.serviceCatalogItem.create({data:{workspaceId:actor.workspace.id,slug:`engineering-${suffix}`,name:"Engineering bench",kind:"DEVICE"}});
  await expect(saveOwnership(member,{serviceId:service.id,ownerId:member.user.id,backupOwnerId:actor.user.id})).rejects.toThrow();
  await expect(saveOwnership(actor,{serviceId:service.id,ownerId:member.user.id,backupOwnerId:member.user.id})).rejects.toThrow();
  await saveOwnership(actor,{serviceId:service.id,ownerId:member.user.id,backupOwnerId:actor.user.id});expect((await loadProductOps(member,"ownership",{})).services.find(s=>s.id===service.id)!.backupOwnerId).toBe(actor.user.id);
 });
 it("archives and restores search with live source access",async()=>{
  const issue=await saveRecord(member,base("ISSUE",{},{title:"Engineering searchable issue"}));expect((await searchDocuments({workspaceId:actor.workspace.id,userId:member.user.id,role:"MEMBER"},"searchable issue","product_ops")).some(r=>r.entityId===issue.id)).toBe(true);
  await operate(member,{op:"archive",id:issue.id});expect((await searchDocuments({workspaceId:actor.workspace.id,userId:member.user.id,role:"MEMBER"},"searchable issue","product_ops")).some(r=>r.entityId===issue.id)).toBe(false);await operate(member,{op:"restore",id:issue.id});
 });
 it("deduplicates reminders across concurrent worker runs and limits estimate recipients",async()=>{
  await saveRecord(actor,{...await snapshotInput(estimateId),ownerId:actor.user.id,dueOn:"2026-10-22"});
  const issue=await saveRecord(member,base("ISSUE",{},{ownerId:member.user.id,dueOn:"2026-10-22",title:"Engineering reminder"}));await Promise.all([run(new Date("2026-10-21T04:30:00Z")),run(new Date("2026-10-21T04:30:00Z"))]);
  expect(await prisma.notificationEventRecord.count({where:{workspaceId:actor.workspace.id,dedupeKey:`product-ops:${issue.id}:2026-10-22:due`}})).toBe(1);
  const estimateEvent=await prisma.notificationEventRecord.findFirstOrThrow({where:{workspaceId:actor.workspace.id,dedupeKey:`product-ops:${estimateId}:2026-10-22:due`}});
  expect(await prisma.notification.count({where:{eventId:estimateEvent.id,userId:member.user.id}})).toBe(0);
  expect(await prisma.notification.count({where:{eventId:estimateEvent.id,userId:actor.user.id}})).toBe(1);
 });
});
