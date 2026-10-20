import "server-only";
import { toDateInputValue } from "@/lib/tasks/localDate";
import { prisma, type Tx } from "@/lib/db";
import { canPublishProductChangelog } from "@/lib/roles";
import type { ProductRecord } from "@prisma/client";
import { requestApproval, cancelApproval } from "@/lib/approvals/engine";
import { operationSchema, detailSchemas } from "./schema";
import { lock, ensure, findRecord, type Actor } from "./access";
import { editable, sync } from "./service";
async function releaseReady(tx: Tx, actor: Actor, row: ProductRecord) {
 const details = detailSchemas.RELEASE.parse(row.details), workspaceId = actor.workspace.id;
 ensure(row.ownerId && await tx.membership.findFirst({ where: { workspaceId, userId: row.ownerId, status: "ACTIVE", user: { disabledAt: null }, role: { in: ["OWNER", "ADMIN", "MEMBER"] } } }), "Choose a current technical owner.");
 ensure(details.checklist.length && details.checklist.every(check => check.done), "Complete the release checklist first.");
 const runs = await tx.productRecord.findMany({ where: { workspaceId, releaseId: row.id, kind: "QA_RUN", archivedAt: null } });
 ensure(runs.length && runs.every(run => run.status === "PASSED" && detailSchemas.QA_RUN.parse(run.details).checklist.every(c => c.done)), "Pass every QA run before approving or shipping this release.");
 ensure(!await tx.productRecord.count({ where: { workspaceId, releaseId: row.id, kind: "ISSUE", archivedAt: null, status: { notIn: ["RESOLVED", "CLOSED"] }, details: { path: ["severity"], equals: "CRITICAL" } } }), "Resolve critical issues before shipping this release.");
 for (const taskId of new Set(details.taskIds)) ensure(await tx.task.findFirst({ where: { workspaceId, id: taskId, projectId: row.projectId, archivedAt: null, column: { category: "DONE" } } }), "Complete every scope task first.");
 for (const roadmapId of new Set(details.roadmapIds)) ensure(await tx.productRecord.findFirst({ where: { workspaceId, id: roadmapId, kind: "ROADMAP", projectId: row.projectId, archivedAt: null, status: "DONE" } }), "Complete every scope roadmap item first.");
}
export async function operate(untrusted: Actor, raw: unknown) {
 const input = operationSchema.parse(raw);
 if (input.op === "pdf") { const { generateEstimatePdf } = await import("./exports"); return generateEstimatePdf(untrusted, input.id, input.version); }
 const pending: { afterCommit(): Promise<void> }[] = [];
 const result = await prisma.$transaction(async tx => {
  const actor = await lock(untrusted, tx), workspaceId = actor.workspace.id;
  let row = await findRecord(actor, input.id, tx, input.op === "restore");
  const subjectType = row.kind === "RELEASE" ? "PRODUCT_RELEASE" : "PRODUCT_CHANGE";
  if (input.op === "requestApproval") {
   ensure(["RELEASE", "CHANGE"].includes(row.kind) && !row.shippedAt && !["APPLIED", "ROLLED_BACK"].includes(row.status));
   if (row.kind === "RELEASE") await releaseReady(tx, actor, row);
   const approval = await requestApproval(tx, { workspace: actor.workspace, subjectType, subjectId: row.id, title: `${row.kind === "RELEASE" ? "Release" : "Change"}: ${row.title}`, requesterId: actor.user.id, requesterName: actor.user.name, amountMinor: null, currency: null });
   pending.push(approval);
   row = await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { approvalId: approval.requestId, status: "IN_REVIEW", revision: { increment: 1 } } });
  } else if (input.op === "withdraw") {
   ensure(row.approvalId && ["RELEASE", "CHANGE"].includes(row.kind) && !row.shippedAt && !["APPLIED", "ROLLED_BACK"].includes(row.status));
   const approval = await tx.approvalRequest.findFirst({ where: { workspaceId, id: row.approvalId } }); ensure(approval && approval.requesterId === actor.user.id, "Only the requester can withdraw this approval.");
   // The engine's cancellation API intentionally permits open reviews only.
   ensure(["PENDING", "CHANGES_REQUESTED"].includes(approval.status), "This review is complete. Add a new release or change plan.");
   await cancelApproval(tx, { workspaceId, subjectType, subjectId: row.id, actorId: actor.user.id });
   row = await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { status: row.kind === "RELEASE" ? "DRAFT" : "PLANNED", revision: { increment: 1 } } });
  } else if (input.op === "ship" || input.op === "apply") {
   ensure(row.kind === (input.op === "ship" ? "RELEASE" : "CHANGE"));
   if (row.shippedAt || row.status === "APPLIED") return { id: row.id };
   const change = row.kind === "CHANGE" ? detailSchemas.CHANGE.parse(row.details) : null;
   if (!change || change.risk === "HIGH" || change.requiresApproval || (row.approvalId && row.status === "IN_REVIEW")) {
    ensure(row.approvalId && await tx.approvalRequest.findFirst({ where: { workspaceId, id: row.approvalId, subjectType, subjectId: row.id, status: "APPROVED" } }), "Get approval before completing this plan.");
   }
   if (row.kind === "RELEASE") await releaseReady(tx, actor, row);
   let changelogId: string | null = null;
   if (row.kind === "RELEASE" && input.publish) {
    ensure(canPublishProductChangelog(actor.membership), "Ask an admin to publish the changelog. You can ship without publishing.");
    const details = detailSchemas.RELEASE.parse(row.details);
    ensure(details.releaseNotes, "Add release notes before publishing a changelog entry.");
    // Private-team release contents stay in their project; the existing changelog is workspace-wide.
    if (row.projectId) ensure(await tx.project.findFirst({ where: { workspaceId, id: row.projectId, OR: [{ teamId: null }, { team: { visibility: "PUBLIC" } }] } }), "Private-team releases cannot publish a workspace changelog. Ship without publishing.");
    changelogId = (await tx.changelogEntry.create({ data: { workspaceId, title: row.title, version: details.version, bodyMd: details.releaseNotes, audience: "INTERNAL", publishedAt: new Date(), createdById: actor.user.id } })).id;
    const { indexSearchDocument } = await import("@/lib/search/documents");
    await indexSearchDocument({ workspaceId, entityType: "changelog", entityId: changelogId, title: row.title, body: details.releaseNotes, url: `/w/${actor.workspace.slug}/changelog`, visibility: "WORKSPACE" }, tx);
   }
   row = await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { status: row.kind === "RELEASE" ? "SHIPPED" : "APPLIED", shippedAt: new Date(), changelogId, dateOn: row.kind === "CHANGE" ? row.dateOn ?? new Date(toDateInputValue(new Date(), actor.workspace.timezone)) : row.dateOn, revision: { increment: 1 } } });
  } else if (input.op === "rollback") {
   ensure(row.kind === "CHANGE" && row.status === "APPLIED", "Choose an applied change to record a rollback.");
   row = await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { status: "ROLLED_BACK", revision: { increment: 1 } } });
  } else if (input.op === "archive" || input.op === "restore") {
   await editable(actor, tx, row);
   if (input.op === "archive") {
    ensure(!await tx.productRecord.count({ where: { workspaceId, archivedAt: null, OR: [{ releaseId: row.id }, { parentId: row.id }] } }), "Archive linked runs and items first.");
    ensure(!await tx.productRecord.count({ where: { workspaceId, kind: "RELEASE", archivedAt: null, details: { path: ["roadmapIds"], array_contains: [row.id] } } }), "Remove this roadmap item from release scope first.");
   } else {
    if (row.releaseId) await findRecord(actor, row.releaseId, tx);
    if (row.parentId) await findRecord(actor, row.parentId, tx);
   }
   row = await tx.productRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { archivedAt: input.op === "archive" ? new Date() : null, revision: { increment: 1 } } });
  }
  await sync(actor, tx, row, input.op); return { id: row.id };
 }, { timeout: 20000 });
 for (const notification of pending) await notification.afterCommit();
 return result;
}
