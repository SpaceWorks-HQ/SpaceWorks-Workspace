import { beforeAll, afterAll, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/db";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "@/tests/helpers/fixtures";
import type { OpsActor } from "@/lib/approvals/context";
import { saveItem, createCollection, grantAccess, listVault, revealItem, requestAccess } from "@/lib/vault/service";
import { verifyVaultMfa } from "@/lib/vault/mfa";
import { encryptMfaSecret } from "@/lib/mfa";
import { createRequest, completeRequest, resubmitRequest, savePolicy, createGenericRequest } from "@/lib/requests/service";
import { decide, commentOnApproval, getApprovalView, eligibleApproverIds } from "@/lib/approvals/engine";
import { saveAsset, bookAsset, checkoutAsset } from "@/lib/assets/service";
import { saveForm, submitForm, convertToTask, publicForm, exportCsv } from "@/lib/forms/service";
import { saveService, listCatalogue } from "@/lib/catalogue/service";
import { saveSubscription, listSubscriptions } from "@/lib/subscriptions/service";
import { run } from "@/lib/scheduled/opsMoney";
const suffix=uniqueSuffix();const emailSuffix=`${suffix}@ops.test`;const slugs=[`ops-${suffix}`,`ops-other-${suffix}`];
let owner:OpsActor,member:OpsActor,other:OpsActor,guest:OpsActor;
beforeAll(async()=>{
 process.env.VAULT_MASTER_KEY=Buffer.alloc(32,11).toString("base64");
 const o=await createUser(`owner-${emailSuffix}`);const m=await createUser(`member-${emailSuffix}`);const g=await createUser(`guest-${emailSuffix}`);
 const w=await createWorkspace(slugs[0],o.id);const w2=await createWorkspace(slugs[1],o.id);
 await addMember(w.id,m.id);await addMember(w.id,g.id,"GUEST");
 owner={user:o,workspace:w,membership:{role:"OWNER"}};member={user:m,workspace:w,membership:{role:"MEMBER"}};guest={user:g,workspace:w,membership:{role:"GUEST"}};other={...owner,workspace:w2};
});
afterAll(async()=>{await cleanup(slugs,emailSuffix);await prisma.$disconnect();});
describe("ops security and atomic transitions",()=>{
 it("requires scoped grants and recent MFA; records reveal, copy and denials without secrets",async()=>{
  const itemId=await saveItem(owner,{title:"Test item",type:"LOGIN",secret:"ops-secret-value",sensitivity:"HIGH"});
  expect(await listVault(member)).toEqual([]);await expect(revealItem(member,itemId)).rejects.toThrow("access");
  await grantAccess(owner,{itemId,principalType:"USER",principalId:member.user.id,permission:"LIST",durationHours:24});
  expect((await listVault(member)).map(i=>i.id)).toContain(itemId);await expect(revealItem(member,itemId)).rejects.toThrow("access");
  await requestAccess(member,{itemId,reason:"Need to maintain service",durationHours:1});
  const a=await prisma.approvalRequest.findFirstOrThrow({where:{workspaceId:owner.workspace.id,subjectType:"VAULT_ACCESS"}});
  expect((await decide(owner,{requestId:a.id,decision:"APPROVED"})).ok).toBe(true);
  await expect(revealItem(member,itemId)).rejects.toThrow("two-step");
  const secret=new OTPAuth.Secret({size:20}).base32;
  await prisma.user.update({where:{id:member.user.id},data:{mfaEnabledAt:new Date(),mfaSecretEncrypted:encryptMfaSecret(secret)}});
  const totp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret),digits:6,period:30,algorithm:"SHA1"});
  const proof=await verifyVaultMfa(member.user.id,totp.generate());
  expect(await revealItem(member,itemId,proof)).toBe("ops-secret-value");expect(await revealItem(member,itemId,proof,"COPY")).toBe("ops-secret-value");
  await expect(revealItem(member,itemId,proof,"REVEAL",new Date(Date.now()+301000))).rejects.toThrow("two-step");
  await expect(revealItem(other,itemId,proof)).rejects.toThrow("unavailable");await expect(revealItem(guest,itemId,proof)).rejects.toThrow("access");
  const logs=await prisma.vaultAccessLog.findMany({where:{workspaceId:owner.workspace.id,itemId}});expect(logs.filter(l=>l.action==="REVEAL")).toHaveLength(1);expect(logs.filter(l=>l.action==="COPY")).toHaveLength(1);expect(logs.some(l=>l.action==="DENIED")).toBe(true);
  expect(await prisma.searchDocument.count({where:{workspaceId:owner.workspace.id,entityId:itemId}})).toBe(0);
  const events=await prisma.notificationEventRecord.findMany({where:{workspaceId:owner.workspace.id}});expect(JSON.stringify(events)).not.toContain("ops-secret-value");
 });
 it("supports team and role collection grants with expiry and tenant boundaries",async()=>{
  const collectionId=await createCollection(owner,{name:"Shared"});const itemId=await saveItem(owner,{title:"Normal note",type:"SECRET_NOTE",collectionId,secret:"normal-note",sensitivity:"NORMAL"});
  const team=await prisma.team.create({data:{workspaceId:owner.workspace.id,name:"Ops",slug:`ops-${suffix}`}});await prisma.teamMember.create({data:{teamId:team.id,userId:member.user.id}});
  await grantAccess(owner,{collectionId,principalType:"TEAM",principalId:team.id,permission:"REVEAL",durationHours:1});expect(await revealItem(member,itemId)).toBe("normal-note");
  await prisma.vaultGrant.updateMany({where:{workspaceId:owner.workspace.id,collectionId},data:{expiresAt:new Date(0)}});await expect(revealItem(member,itemId)).rejects.toThrow("access");
  await grantAccess(owner,{collectionId,principalType:"ROLE",principalId:"MEMBER",permission:"REVEAL",durationHours:1});expect(await revealItem(member,itemId)).toBe("normal-note");await expect(grantAccess(other,{itemId,principalType:"USER",principalId:other.user.id,permission:"MANAGE"})).rejects.toThrow();
 });
 it("posts one ledger entry after approval and concurrent completion; blocks self decisions",async()=>{
  for(const kind of ["purchase_request","reimbursement"] as const){
   const receipt = kind === "reimbursement" ? await prisma.fileObject.create({ data: { workspaceId: owner.workspace.id, uploadedById: member.user.id, storageKey: `ops-proof/${suffix}`, filename: "receipt.pdf", contentType: "application/pdf", size: 100, folder: "/requests" } }) : null;
   const id=await createRequest(member,{kind,title:"Workshop materials",totalMinor:10000,currency:"INR",vendor:"Local vendor",justification:"Build night",receiptFileIds:receipt?[receipt.id]:[]});
   const approval=await prisma.approvalRequest.findFirstOrThrow({where:{workspaceId:owner.workspace.id,subjectId:id}});
   expect((await decide(member,{requestId:approval.id,decision:"APPROVED"})).ok).toBe(false);
   await expect(completeRequest(owner,kind,id)).rejects.toThrow("Approve");
   expect((await decide(other,{requestId:approval.id,decision:"APPROVED"})).ok).toBe(false);
   expect((await decide(owner,{requestId:approval.id,decision:"APPROVED"})).ok).toBe(true);
   await Promise.all([completeRequest(owner,kind,id),completeRequest(owner,kind,id)]);
   expect(await prisma.ledgerEntry.count({where:{workspaceId:owner.workspace.id,sourceType:kind,sourceId:id}})).toBe(1);
  }
 });
 it("serializes overlapping bookings and checkout attempts",async()=>{
  const assetId=await saveAsset(owner,{name:"Drill",category:"Tools",bookable:true});const startsAt=new Date(Date.now()+86400000),endsAt=new Date(Date.now()+90000000);
  const results=await Promise.allSettled([bookAsset(member,{assetId,startsAt,endsAt}),bookAsset(owner,{assetId,startsAt,endsAt})]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  await expect(bookAsset(other,{assetId,startsAt,endsAt})).rejects.toThrow("unavailable");
  const drill2=await saveAsset(owner,{name:"Soldering iron",category:"Tools"});const checkouts=await Promise.allSettled([checkoutAsset(member,{assetId:drill2,dueAt:endsAt}),checkoutAsset(owner,{assetId:drill2,dueAt:endsAt})]);expect(checkouts.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 });
 it("hashes public links, enforces rate limits and response caps, and converts once",async()=>{
  const result=await saveForm(owner,{title:"Intake",visibility:"PUBLIC_LINK",fields:[{key:"name",label:"Name",type:"text",required:true}]});const token=result.publicPath!.split("/").pop()!;
  expect(await publicForm(token)).toMatchObject({id:result.id});const stored=await prisma.form.findFirstOrThrow({where:{id:result.id,workspaceId:owner.workspace.id}});expect(stored.publicSlug).not.toBe(token);
  for(let n=0;n<5;n++)await submitForm({token,answers:{name:"Test"},ip:`public-${suffix}`});
  await expect(submitForm({token,answers:{name:"Test"},ip:`public-${suffix}`})).rejects.toThrow("Too many");
  await submitForm({token,answers:{name:"Ignored"},honeypot:"robot",ip:`public-${suffix}`});expect(await prisma.formSubmission.count({where:{formId:result.id}})).toBe(5);
  const s=await prisma.formSubmission.findFirstOrThrow({where:{formId:result.id}});const tasks=await Promise.all([convertToTask(owner,s.id,"Review intake"),convertToTask(owner,s.id,"Review intake")]);expect(tasks[0]).toBe(tasks[1]);await expect(convertToTask(other,s.id,"No access")).rejects.toThrow("unavailable");
  const capped=await saveForm(owner,{title:"Limited",visibility:"PUBLIC_LINK",maxResponses:1,fields:[{key:"x",label:"X",type:"text"}]});const t=capped.publicPath!.split("/").pop()!;const responses=await Promise.allSettled([submitForm({token:t,answers:{},ip:"one"}),submitForm({token:t,answers:{},ip:"two"})]);expect(responses.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 });
 it("isolates catalogue and subscription references and sends renewal once",async()=>{
  const serviceId=await saveService(owner,{name:"Test service",slug:`service-${suffix}`,kind:"INTERNAL_APP",environment:"PROD",criticality:"TIER2"});
  await expect(saveSubscription(other,{name:"Invalid link",period:"MONTHLY",amountMinor:100,serviceId})).rejects.toThrow("workspace");
  const id=await saveSubscription(owner,{name:"Annual hosting",period:"YEARLY",amountMinor:12000,ownerId:owner.user.id,nextRenewalAt:new Date(Date.now()+86400000),serviceId,reminderOffsets:[7]});
  expect((await listCatalogue(other)).some(s=>s.id===serviceId)).toBe(false);expect((await listSubscriptions(other)).some(s=>s.id===id)).toBe(false);
  await run(new Date());await run(new Date());expect(await prisma.notificationEventRecord.count({where:{workspaceId:owner.workspace.id,type:"renewal.due"}})).toBe(1);
 });
 it("keeps quorum and named approvers, preserves earlier reviews on correction", async () => {
  expect(await eligibleApproverIds(prisma, owner.workspace.id, {approverType:"USER",ref:"missing-member",minApprovals:1}, member.user.id)).toEqual([]);
  const requestId = await createRequest(member, {kind:"purchase_request",title:"Initial proposal",totalMinor:1000,currency:"INR",justification:"First version"});
  const approval = await prisma.approvalRequest.findFirstOrThrow({where:{workspaceId:owner.workspace.id,subjectId:requestId}});
  expect((await commentOnApproval(member,{requestId:approval.id,comment:"Can we review the quantity?"})).ok).toBe(true);
  expect((await commentOnApproval(other,{requestId:approval.id,comment:"Outside this workspace"})).ok).toBe(false);
  expect((await decide(owner,{requestId:approval.id,decision:"CHANGES_REQUESTED",comment:"Please update the quantity."})).ok).toBe(true);
  await resubmitRequest(member,"purchase_request",requestId,{title:"Corrected proposal",totalMinor:2000,currency:"INR",justification:"Updated quantity"});
  const history = await getApprovalView(member,"PURCHASE_REQUEST",requestId);
  expect(history?.decisions.some(d=>d.step<0&&d.comment==="Please update the quantity.")).toBe(true);
  expect((await decide(owner,{requestId:approval.id,decision:"APPROVED"})).ok).toBe(true);
  const subject=await prisma.purchaseRequest.findFirstOrThrow({where:{workspaceId:owner.workspace.id,id:requestId}});
  expect(subject).toMatchObject({title:"Corrected proposal",totalMinor:2000,status:"APPROVED"});
  const outsider=await createUser(`outsider-${emailSuffix}`);await addMember(owner.workspace.id,outsider.id);
  expect(await getApprovalView({user:outsider,workspace:owner.workspace,membership:{role:"MEMBER"}},"PURCHASE_REQUEST",requestId)).toBeNull();
  await savePolicy(owner,{name:"Two reviewers",subjectType:"CUSTOM",steps:[{approverType:"ROLE",ref:"ADMIN",minApprovals:2}]});
  const genericId=await createGenericRequest(member,{title:"Approve a workshop plan"});
  expect(await decide(owner,{requestId:genericId,decision:"APPROVED"})).toMatchObject({ok:true,data:{status:"PENDING"}});
  const reviewer=await createUser(`reviewer-${emailSuffix}`);await addMember(owner.workspace.id,reviewer.id,"ADMIN");
  expect(await decide({user:reviewer,workspace:owner.workspace,membership:{role:"ADMIN"}},{requestId:genericId,decision:"APPROVED"})).toMatchObject({ok:true,data:{status:"APPROVED"}});
 });
 it("rejects stale MFA after a session change and never stores full card details", async () => {
  await expect(saveItem(owner,{title:"Card",type:"CARD_REFERENCE",secret:"1234567812345678"})).rejects.toThrow("last four");
  const itemId=await saveItem(owner,{title:"Card reference",type:"CARD_REFERENCE",secret:"1234",sensitivity:"HIGH"});
  const secret=new OTPAuth.Secret({size:20}).base32;
  await prisma.user.update({where:{id:owner.user.id},data:{mfaEnabledAt:new Date(),mfaSecretEncrypted:encryptMfaSecret(secret)}});
  const proof=await verifyVaultMfa(owner.user.id,new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret),digits:6,period:30,algorithm:"SHA1"}).generate());
  await expect(revealItem(owner,itemId,proof+"tampered")).rejects.toThrow("two-step");
  await prisma.user.update({where:{id:owner.user.id},data:{sessionVersion:{increment:1}}});
  await expect(revealItem(owner,itemId,proof)).rejects.toThrow("two-step");
 });

 it("streams a complete CSV snapshot and neutralises formula answers", async () => {
  const form=await saveForm(owner,{title:"Export test",visibility:"INTERNAL",fields:[{key:"answer",label:"Answer",type:"text"}]});
  await prisma.formSubmission.createMany({data:Array.from({length:1005},(_,n)=>({formId:form.id,answers:{answer:n===0?"=1+1":`Response ${n}`}}))});
  const csv=await new Response(await exportCsv(owner,form.id)).text();
  expect(csv.trim().split("\r\n")).toHaveLength(1006);
  expect(csv).toContain('"\'=1+1"');
  await expect(exportCsv(other,form.id)).rejects.toThrow("unavailable");
 });

});
