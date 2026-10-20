import { createHash } from "node:crypto";
import { sealEnvelope, vaultMasterKey } from "../../lib/crypto.ts";

/** Add operations examples to the demo workspace without replacing other areas. */
export default async function seedOpsMoney(prisma, { workspaceId, workspace, users }) {
 if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are for local development only.");
 const owner = users.owner ?? Object.values(users)[0];
 const member = users.meera ?? owner;
 const identifier = key => `ops_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0,24)}`;
 const days = n => new Date(Date.now() + n * 86400000);
 const put = (model, key, data) => model.upsert({ where: { id: identifier(key) }, create: { id: identifier(key), ...data }, update: {} });
 const steps = [{ approverType: "ROLE", ref: "ADMIN", minApprovals: 1 }];
 const budget = await put(prisma.budget, "budget", { workspaceId, name: "Build night supplies", periodStart: days(-15), periodEnd: days(75), amountMinor: 2000000, currency: workspace.currency ?? "INR", createdById: owner.id });
 const policy = await put(prisma.approvalPolicy, "policy", { workspaceId, name: "Workshop purchases", subjectType: "PURCHASE_REQUEST", steps, isDefault: true, createdById: owner.id });
 const request = await put(prisma.purchaseRequest, "request", { workspaceId, requesterId: member.id, title: "Soldering station spares", justification: "Keep the six shared stations ready for build nights.", items: [{description:"Tips and brass cleaners", vendor:"Local electronics market", qty:1, unitMinor:185000}], totalMinor:185000, currency: budget.currency, budgetId:budget.id, status:"SUBMITTED", submittedAt:new Date() });
 await put(prisma.approvalRequest, "purchase-approval", {workspaceId, policyId:policy.id, subjectType:"PURCHASE_REQUEST", subjectId:request.id, requesterId:member.id, title:request.title, amountMinor:request.totalMinor, currency:request.currency, steps});
 await put(prisma.reimbursement, "reimbursement", { workspaceId, claimantId:member.id, budgetId:budget.id, items:[{description:"Build night cables",vendor:"Neighbourhood hardware store",justification:"Replacement extension cable",amountMinor:45000}],totalMinor:45000,currency:budget.currency,status:"SUBMITTED",submittedAt:new Date() });
 await put(prisma.approvalRequest, "reimbursement-approval", { workspaceId,subjectType:"REIMBURSEMENT",subjectId:identifier("reimbursement"),requesterId:member.id,title:"Build night cables",amountMinor:45000,currency:budget.currency,steps });
 const service = await put(prisma.serviceCatalogItem, "service", { workspaceId,name:"Community website",slug:"community-website",kind:"WEBSITE",environment:"PROD",criticality:"TIER2",ownerId:owner.id,description:"The public home of Space Works.",urls:["https://spaceworks.community"],costMinor:120000,costCurrency:budget.currency,costPeriod:"YEARLY",renewalAt:days(7),createdById:owner.id });
 await put(prisma.subscription, "subscription", { workspaceId,name:"Website hosting",kind:"HOSTING",amountMinor:120000,currency:budget.currency,period:"YEARLY",nextRenewalAt:days(7),autoRenew:true,ownerId:owner.id,serviceId:service.id,createdById:owner.id });
 const drill = await put(prisma.asset, "drill", { workspaceId,tag:identifier("drill-tag"),name:"Cordless drill",category:"Power tools",location:"Tool wall",condition:"Good" });
 await put(prisma.assetMaintenanceLog, "maintenance", {assetId:drill.id,type:"INSPECTION",note:"Battery contacts cleaned and chuck checked.",byUserId:owner.id,nextDueAt:days(30)});
 await put(prisma.accessCredential, "key", {workspaceId,label:"Workshop front door",type:"KEY",area:"Main entrance",holderUserId:owner.id,status:"ISSUED",issuedAt:new Date()});
 const form = await put(prisma.form, "form", {workspaceId,title:"Suggest a workshop",description:"What would you like to make with the crew?",visibility:"INTERNAL",ownerIds:[owner.id],createdById:owner.id,fields:[{key:"topic",label:"Workshop topic",type:"text",required:true},{key:"experience",label:"Experience level",type:"select",required:true,options:["First build","Some practice","Ready to teach"]},{key:"notes",label:"What should we bring?",type:"textarea",required:false}]});
 await put(prisma.formSubmission, "response", {formId:form.id,submitterUserId:member.id,answers:{topic:"Repair a desk lamp",experience:"Some practice",notes:"A multimeter and spare plugs"}});
 if (process.env.VAULT_MASTER_KEY) {
  const collection = await put(prisma.vaultCollection, "collection", { workspaceId,name:"Demo credentials",createdById:owner.id });
  const item = await put(prisma.vaultItem, "vault", {workspaceId,collectionId:collection.id,type:"SECRET_NOTE",title:"Demo credential — replace before use",ownerId:owner.id,sensitivity:"HIGH",rotateEveryDays:90,...sealEnvelope(vaultMasterKey(),"Demonstration only. This is not a working credential.")});
  await put(prisma.vaultGrant, "vault-list-grant", {workspaceId,itemId:item.id,principalType:"ROLE",principalId:"MEMBER",permission:"LIST",grantedById:owner.id});
 }
}
