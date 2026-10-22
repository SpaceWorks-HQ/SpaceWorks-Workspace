import "server-only";
import { Prisma, type ProductRecord } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { canManageProductEstimates } from "@/lib/roles";
import { recordSchema, detailSchemas, sectionFor, object, type Kind } from "./schema";
import { estimateTotals } from "./costs";
import { lock, findRecord, ensure, visibleWhere, projectWhere, type Actor } from "./access";
export { ProductError } from "./access";
export type { Actor } from "./access";
export async function audit(actor: Actor, tx: Tx, recordId: string, verb: string) {
 await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `product_ops.${verb}`, targetType: "ProductRecord", targetId: recordId, client: tx });
}
export async function sync(actor: Actor, tx: Tx, row: ProductRecord, verb: string) {
 await audit(actor, tx, row.id, verb);
 if (row.archivedAt) await removeSearchDocument("product_ops", row.id, tx);
 else await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: "product_ops", entityId: row.id, title: row.title, url: `/w/${actor.workspace.slug}/product-ops/${sectionFor(row.kind)}?edit=${row.id}`, projectId: row.projectId, visibility: row.kind === "ESTIMATE" ? "PRIVATE" : "WORKSPACE", ownerId: row.ownerId ?? row.createdById }, tx);
 await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, entityType: "product_ops", entityId: row.id, verb, summary: `Product record ${verb.replaceAll("_", " ")}.`, visibility: row.kind === "ESTIMATE" ? "PRIVATE" : "WORKSPACE", projectId: row.projectId }, tx);
}
export async function snapshot(actor: Actor, tx: Tx, row: ProductRecord) {
 const files = await tx.productAttachment.findMany({ where: { workspaceId: actor.workspace.id, recordId: row.id, generated: false, file: { deletedAt: null } }, select: { fileId: true } });
 await tx.productEstimateRevision.create({ data: { workspaceId: actor.workspace.id, recordId: row.id, version: row.revision, snapshot: { title: row.title, notes: row.notes, currency: row.currency, projectId: row.projectId, fundingId: row.fundingId, budgetId: row.budgetId, fundId: row.fundId, details: row.details, fileIds: files.map(f => f.fileId) }, createdById: actor.user.id } });
}
export async function editable(actor: Actor, tx: Tx, row: ProductRecord) {
 ensure(!row.shippedAt && !["APPLIED", "ROLLED_BACK"].includes(row.status), "This completed record is locked. Add a new record for the next change.");
 if (row.approvalId) {
  const approval = await tx.approvalRequest.findFirst({ where: { workspaceId: actor.workspace.id, id: row.approvalId }, select: { status: true } });
  ensure(!approval || !["PENDING", "APPROVED"].includes(approval.status), "Withdraw the approval before changing this plan.");
 }
 if (row.kind === "ROADMAP") {
  const releases = await tx.productRecord.findMany({ where: { workspaceId: actor.workspace.id, kind: "RELEASE", archivedAt: null, details: { path: ["roadmapIds"], array_contains: [row.id] } }, select: { shippedAt: true, approvalId: true } });
  for (const release of releases) {
   ensure(!release.shippedAt, "This roadmap item belongs to a shipped release and is locked.");
   if (release.approvalId) ensure(!await tx.approvalRequest.findFirst({ where: { workspaceId: actor.workspace.id, id: release.approvalId, status: { in: ["PENDING", "APPROVED"] } } }), "Withdraw the release approval before editing its roadmap scope.");
  }
 }
 if (row.releaseId && ["QA_RUN", "ROADMAP"].includes(row.kind)) {
  const release = await tx.productRecord.findFirst({ where: { workspaceId: actor.workspace.id, id: row.releaseId } });
  ensure(release && !release.archivedAt && !release.shippedAt, "This release is locked. Add work to a new release.");
  if (release.approvalId) {
   const approval = await tx.approvalRequest.findFirst({ where: { workspaceId: actor.workspace.id, id: release.approvalId } });
   ensure(!approval || !["PENDING", "APPROVED"].includes(approval.status), "Withdraw the release approval before changing its scope or QA.");
  }
 }
}
export async function saveRecord(untrusted: Actor, raw: unknown) {
 const input = recordSchema.parse(raw);
 return prisma.$transaction(async tx => {
  const actor = await lock(untrusted, tx), workspaceId = actor.workspace.id;
  if (input.kind === "ESTIMATE") ensure(canManageProductEstimates(actor.membership), "Ask an admin to manage funding estimates.");
  const old = input.id ? await findRecord(actor, input.id, tx) : null;
  if (old) { ensure(old.kind === input.kind); ensure(old.revision === input.revision, "Someone changed this record. Refresh before saving."); await editable(actor, tx, old); }
  if (old && old.projectId !== (input.projectId || null)) ensure(!await tx.productRecord.count({ where: { workspaceId, OR: [{ releaseId: old.id }, { parentId: old.id }] } }), "This record has linked work. Keep its existing project.");
  const details = detailSchemas[input.kind].parse(input.details);
  if (input.ownerId) ensure(await tx.membership.findFirst({ where: { workspaceId, userId: input.ownerId, status: "ACTIVE", role: { in: input.kind === "ESTIMATE" ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "MEMBER"] }, user: { disabledAt: null } } }), "Choose an active team member as owner.");
  if (input.projectId) ensure(await tx.project.findFirst({ where: { AND: [await projectWhere(actor), { id: input.projectId }] } }), "Choose a project you can read.");
  ensure(!input.releaseId || ["ROADMAP", "ISSUE", "QA_RUN", "CHANGE"].includes(input.kind));
  if (input.releaseId) {
   const release = await findRecord(actor, input.releaseId, tx);
   ensure(release.kind === "RELEASE" && release.projectId === (input.projectId || null), "Use the linked release's project.");
   if (["QA_RUN", "ROADMAP"].includes(input.kind)) await editable(actor, tx, release);
  }
  if (input.parentId) {
   ensure(input.kind === "TEST"); const parent = await findRecord(actor, input.parentId, tx);
   ensure(parent.kind === "PROTOTYPE" && parent.projectId === (input.projectId || null), "Use the prototype's project.");
  }
  if (input.kind !== "ESTIMATE") ensure(!input.fundingId && !input.budgetId && !input.fundId);
  if (input.fundingId) ensure(await tx.fundingRecord.findFirst({ where: { workspaceId, id: input.fundingId, archivedAt: null, kind: { in: ["OPPORTUNITY", "GRANT"] }, currency: input.currency } }), "Choose a current funding application with the same currency.");
  if (input.budgetId) ensure(await tx.budget.findFirst({ where: { workspaceId, id: input.budgetId, currency: input.currency } }), "Choose a budget with the same currency.");
  if (input.fundId) ensure(await tx.financeFund.findFirst({ where: { workspaceId, id: input.fundId, archivedAt: null, currency: input.currency } }), "Choose a finance fund with the same currency.");
  if ("ideaId" in details && details.ideaId) ensure(await tx.idea.findFirst({ where: { workspaceId, id: details.ideaId } }), "Choose an idea in this workspace.");
  if (input.kind === "RELEASE") {
   const release = detailSchemas.RELEASE.parse(details);
   if (release.repoId) {
    const repo = await tx.githubRepo.findFirst({ where: { workspaceId, id: release.repoId } });
    ensure(repo && (!repo.linkedProjectId || repo.linkedProjectId === (input.projectId || null)) && (!repo.private || repo.linkedProjectId || canManageProductEstimates(actor.membership)), "Choose a repository linked to this project or visible in this workspace.");
   }
   if (release.githubEventId) ensure(release.repoId && await tx.githubEvent.findFirst({ where: { workspaceId, id: release.githubEventId, repoId: release.repoId } }), "Choose an event from the linked repository.");
   ensure(input.status === "DRAFT", "Use the approval and Ship release actions for this status.");
   for (const taskId of new Set(release.taskIds)) ensure(await tx.task.findFirst({ where: { workspaceId, id: taskId, archivedAt: null, projectId: input.projectId || null } }), "Choose scope tasks in the release project.");
   for (const roadmapId of new Set(release.roadmapIds)) {
    const row = await findRecord(actor, roadmapId, tx);
    ensure(row.kind === "ROADMAP" && row.projectId === (input.projectId || null), "Choose roadmap items in the release project.");
   }
  }
  if (input.kind === "QA_RUN") {
   const qa = detailSchemas.QA_RUN.parse(details);
   if (input.status === "PASSED") ensure(qa.checklist.every(c => c.done), "Complete every check before passing this QA run.");
  }
  if (input.kind === "CHANGE") {
   const change = detailSchemas.CHANGE.parse(details);
   ensure(input.status === "PLANNED", "Use the approval and Apply change actions for this status.");
   if (change.incidentId) ensure(await tx.incident.findFirst({ where: { workspaceId, id: change.incidentId } }), "Choose an incident in this workspace.");
  }
  if (input.kind === "ESTIMATE") {
   const estimate = detailSchemas.ESTIMATE.parse(details); estimateTotals(estimate);
   for (const line of estimate.lines) if (line.quoteFileId) ensure(old && await tx.productAttachment.findFirst({ where: { workspaceId, recordId: old.id, fileId: line.quoteFileId, generated: false, file: { deletedAt: null } } }), "Upload the quote to this estimate before linking it to a line.");
  }
  const data = { title: input.title, status: input.status, ownerId: input.ownerId || null, projectId: input.projectId || null, releaseId: input.releaseId || null, parentId: input.parentId || null, fundingId: input.fundingId || null, budgetId: input.budgetId || null, fundId: input.fundId || null, dateOn: input.dateOn ? new Date(input.dateOn) : null, dueOn: input.dueOn ? new Date(input.dueOn) : null, notes: input.notes, currency: input.currency, reminderDays: input.reminderDays, details: details as Prisma.InputJsonValue, revision: old ? old.revision + 1 : 1 };
  const row = old ? await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: old.id } }, data }) : await tx.productRecord.create({ data: { ...data, workspaceId, kind: input.kind, createdById: actor.user.id } });
  if (row.kind === "ESTIMATE") await snapshot(actor, tx, row);
  await sync(actor, tx, row, old ? "updated" : "created"); return { id: row.id };
 }, { timeout: 20000 });
}
export type Filters = { group?: string; q?: string; kind?: string; status?: string; owner?: string; project?: string; release?: string; horizon?: string; quarter?: string; severity?: string; archived?: string; page?: string; edit?: string };
export async function recordsWhere(actor: Actor, kinds: Kind[], filters: Filters, tx: Tx = prisma): Promise<Prisma.ProductRecordWhereInput> {
 const detailFilters: Prisma.ProductRecordWhereInput[] = [];
 for (const field of ["horizon", "quarter", "severity"] as const) if (filters[field]) detailFilters.push({ details: { path: [field], equals: filters[field]!.slice(0, 40) } });
 return { AND: [await visibleWhere(actor, tx), { kind: filters.kind && kinds.includes(filters.kind as Kind) ? filters.kind as Kind : { in: kinds }, archivedAt: filters.archived === "1" ? { not: null } : null, ...(filters.q ? { title: { contains: filters.q.slice(0, 200), mode: "insensitive" } } : {}), ...(filters.status ? { status: filters.status.slice(0, 30) } : {}), ...(filters.owner ? { ownerId: filters.owner.slice(0, 64) } : {}), ...(filters.project ? { projectId: filters.project.slice(0, 64) } : {}), ...(filters.release ? { releaseId: filters.release.slice(0, 64) } : {}) }, ...detailFilters] };
}
export function isApprovedStatus(value: unknown) { return object(value).status === "APPROVED"; }
