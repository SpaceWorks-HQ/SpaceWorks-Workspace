import "server-only";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requestApproval, cancelApproval, isApproverOf } from "@/lib/approvals/engine";
import { approvalStepsSchema } from "@/lib/approvals/machine";
import { isAdmin, type OpsActor } from "@/lib/approvals/context";
import { guard, parse, id, title, minor, currency, optionalId, OpsError, note } from "@/lib/approvals/ops";
import { dispatch } from "@/lib/notify/dispatch";
import type { Prisma } from "@prisma/client";

export const requestSchema = z.object({ kind: z.enum(["purchase_request", "reimbursement"]), title, totalMinor: minor.refine(v => v > 0, "Enter an amount greater than zero."), currency, vendor: z.string().trim().max(200).default(""), justification: z.string().trim().min(1).max(4000), budgetId: optionalId, receiptFileIds: z.array(id).max(10).default([]) });
export async function createRequest(actor: OpsActor, input: unknown) {
 await guard(actor); const v = parse(requestSchema, input);
 const result = await prisma.$transaction(async tx => {
  if (v.budgetId && !await tx.budget.findFirst({ where: { id: v.budgetId, workspaceId: actor.workspace.id, currency: v.currency } })) throw new OpsError("Choose a budget with the same currency.");
  if (await tx.fileObject.count({ where: { id: { in: v.receiptFileIds }, workspaceId: actor.workspace.id, uploadedById: actor.user.id, deletedAt: null } }) !== new Set(v.receiptFileIds).size) throw new OpsError("Choose your uploaded receipts in this workspace.");
  const base = { workspaceId: actor.workspace.id, totalMinor: v.totalMinor, currency: v.currency, budgetId: v.budgetId, status: "SUBMITTED" as const, submittedAt: new Date() };
  const row = v.kind === "purchase_request"
   ? await tx.purchaseRequest.create({ data: { ...base, requesterId: actor.user.id, title: v.title, justification: v.justification, items: [{ description: v.title, vendor: v.vendor, qty: 1, unitMinor: v.totalMinor }], fileIds: v.receiptFileIds } })
   : await tx.reimbursement.create({ data: { ...base, claimantId: actor.user.id, items: [{ description: v.title, vendor: v.vendor, justification: v.justification, amountMinor: v.totalMinor }], receiptFileIds: v.receiptFileIds } });
  const approval = await requestApproval(tx, { workspace: actor.workspace, subjectType: v.kind === "purchase_request" ? "PURCHASE_REQUEST" : "REIMBURSEMENT", subjectId: row.id, title: v.title, requesterId: actor.user.id, requesterName: actor.user.name, amountMinor: v.totalMinor, currency: v.currency });
  await note(actor, v.kind, row.id, "submitted", tx);
  return { id: row.id, afterCommit: approval.afterCommit };
 });
 await result.afterCommit(); return result.id;
}
export async function completeRequest(actor: OpsActor, kind: "purchase_request" | "reimbursement", requestId: string) {
 await guard(actor, true); parse(id, requestId);
 const after = await prisma.$transaction(async tx => {
  // Lock the source: payment and ledger posting are one atomic transition.
  if (kind === "purchase_request") await tx.$queryRaw`SELECT "id" FROM "PurchaseRequest" WHERE "id"=${requestId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "Reimbursement" WHERE "id"=${requestId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  const row = kind === "purchase_request" ? await tx.purchaseRequest.findFirst({ where: { id: requestId, workspaceId: actor.workspace.id } }) : await tx.reimbursement.findFirst({ where: { id: requestId, workspaceId: actor.workspace.id } });
  if (!row) throw new OpsError("That request is unavailable.");
  if (row.ledgerEntryId) return null;
  if (!["APPROVED", "ORDERED"].includes(row.status)) throw new OpsError("Approve this request before recording payment or receipt.");
  const description = "title" in row ? row.title : "Reimbursement";
  const ledger = await tx.ledgerEntry.upsert({ where: { sourceType_sourceId: { sourceType: kind, sourceId: row.id } }, create: { workspaceId: actor.workspace.id, sourceType: kind, sourceId: row.id, kind: "EXPENSE", amountMinor: row.totalMinor, currency: row.currency, budgetId: row.budgetId, description, occurredOn: new Date(`${zonedDatetimeLocalValue(new Date(), actor.workspace.timezone).slice(0,10)}T00:00:00.000Z`), createdById: actor.user.id, receiptFileId: "receiptFileIds" in row ? row.receiptFileIds[0] : row.fileIds[0] }, update: {} });
  if (ledger.workspaceId !== actor.workspace.id) throw new OpsError("That request is unavailable.");
  if (kind === "purchase_request") await tx.purchaseRequest.updateMany({ where: { id: row.id, workspaceId: actor.workspace.id }, data: { ledgerEntryId: ledger.id, status: "RECEIVED" } });
  else await tx.reimbursement.updateMany({ where: { id: row.id, workspaceId: actor.workspace.id }, data: { ledgerEntryId: ledger.id, status: "PAID", paidAt: new Date(), paidById: actor.user.id } });
  await note(actor, kind, row.id, "posted", tx);
  if (kind === "reimbursement" && "claimantId" in row) return (await dispatch(actor.workspace.id, { type: "finance.reimbursement.paid", title: "Your reimbursement has been paid", recipients: [row.claimantId], actorId: actor.user.id, url: `/w/${actor.workspace.slug}/requests`, data: { reimbursementId: row.id, amountMinor: row.totalMinor, currency: row.currency } }, { tx })).afterCommit;
  return null;
 });
 await after?.();
}
export async function listRequests(actor: OpsActor) {
 await guard(actor);
 // An eligible approver can inspect the request they are being asked to decide.
 const approvals = await prisma.approvalRequest.findMany({ where: { workspaceId: actor.workspace.id, subjectType: { in: ["PURCHASE_REQUEST", "REIMBURSEMENT"] } } });
 const visible: string[] = [];
 if (!isAdmin(actor)) for (const r of approvals) if (r.requesterId === actor.user.id || await isApproverOf(actor, r)) visible.push(r.subjectId);
 return {
  purchases: await prisma.purchaseRequest.findMany({ where: { workspaceId: actor.workspace.id, ...(!isAdmin(actor) ? { OR: [{ requesterId: actor.user.id }, { id: { in: visible } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
  reimbursements: await prisma.reimbursement.findMany({ where: { workspaceId: actor.workspace.id, ...(!isAdmin(actor) ? { OR: [{ claimantId: actor.user.id }, { id: { in: visible } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 100 })
 };
}
export async function savePolicy(actor: OpsActor, input: unknown) {
 await guard(actor, true);
 const v = parse(z.object({ name: title, subjectType: z.enum(["PURCHASE_REQUEST", "REIMBURSEMENT", "CUSTOM", "FORM_SUBMISSION", "DOC", "ACCESS_CREDENTIAL", "TIME_OFF"]), steps: approvalStepsSchema }), input);
 for (const step of v.steps) {
  if (step.approverType === "USER" && !await prisma.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: step.ref, status: "ACTIVE" } })) throw new OpsError("Choose an active member for each person step.");
  if ((step.approverType === "TEAM" || step.approverType === "TEAM_LEAD") && step.ref !== "*" && !await prisma.team.findFirst({ where: { id: step.ref, workspaceId: actor.workspace.id, archivedAt: null } })) throw new OpsError("Choose a team in this workspace.");
 }
 return prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`policy:${actor.workspace.id}:${v.subjectType}`}))`;
  await tx.approvalPolicy.deleteMany({ where: { workspaceId: actor.workspace.id, subjectType: v.subjectType, requests: { none: {} } } });
  await tx.approvalPolicy.updateMany({ where: { workspaceId: actor.workspace.id, subjectType: v.subjectType }, data: { isDefault: false } });
  const row = await tx.approvalPolicy.create({ data: { ...v, steps: v.steps as Prisma.InputJsonValue, workspaceId: actor.workspace.id, isDefault: true, createdById: actor.user.id } });
  await note(actor, "approval", row.id, "policy_saved", tx); return row.id;
 });
}
export async function createBudget(actor: OpsActor, input: unknown) {
 await guard(actor, true);
 const v = parse(z.object({ name: title, amountMinor: minor, currency, periodStart: z.coerce.date(), periodEnd: z.coerce.date() }).refine(v => v.periodEnd >= v.periodStart, "The end must follow the start."), input);
 const row = await prisma.budget.create({ data: { ...v, workspaceId: actor.workspace.id, createdById: actor.user.id } }); await note(actor, "budget", row.id, "created"); return row.id;
}
export async function budgetTotals(actor: OpsActor) {
 await guard(actor);
 const rows = await prisma.budget.findMany({ where: { workspaceId: actor.workspace.id }, orderBy: { periodStart: "desc" }, take: 100 });
 if (!isAdmin(actor) && !actor.workspace.financeVisibleToMembers) return rows.map(r => ({ id: r.id, name: r.name, currency: r.currency, amountMinor: null, spentMinor: null, remainingMinor: null }));
 return Promise.all(rows.map(async r => {
  const sum = await prisma.ledgerEntry.aggregate({ where: { workspaceId: actor.workspace.id, budgetId: r.id, currency: r.currency, kind: "EXPENSE", voidedAt: null, occurredOn: { gte: r.periodStart, lte: r.periodEnd } }, _sum: { amountMinor: true } });
  const spentMinor = sum._sum.amountMinor ?? 0; return { ...r, spentMinor, remainingMinor: r.amountMinor - spentMinor };
 }));
}
export async function resubmitRequest(actor: OpsActor, kind: "purchase_request" | "reimbursement", requestId: string, input?: unknown) {
 await guard(actor); parse(id, requestId);
 const changes = input === undefined ? null : parse(requestSchema.omit({ kind: true, receiptFileIds: true }), input);
 const r = await prisma.$transaction(async tx => {
  // Match the engine lock order, then lock the source after its approval.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval:${actor.workspace.id}:${kind === "purchase_request" ? "PURCHASE_REQUEST" : "REIMBURSEMENT"}:${requestId}`}))`;
  await tx.$queryRaw`SELECT "id" FROM "ApprovalRequest" WHERE "subjectId"=${requestId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  const row = kind === "purchase_request" ? await tx.purchaseRequest.findFirst({ where: { id: requestId, workspaceId: actor.workspace.id, requesterId: actor.user.id, status: "DRAFT" } }) : await tx.reimbursement.findFirst({ where: { id: requestId, workspaceId: actor.workspace.id, claimantId: actor.user.id, status: "DRAFT" } });
  if (!row) throw new OpsError("That draft is unavailable.");
  if (changes?.budgetId && !await tx.budget.findFirst({ where: { id: changes.budgetId, workspaceId: actor.workspace.id, currency: changes.currency } })) throw new OpsError("Choose a budget with the same currency.");
  const common = changes ? { totalMinor: changes.totalMinor, currency: changes.currency, budgetId: changes.budgetId } : {};
  if (kind === "purchase_request") await tx.purchaseRequest.updateMany({ where: { id: row.id, workspaceId: actor.workspace.id }, data: { ...common, ...(changes ? { title: changes.title, justification: changes.justification, items: [{ description: changes.title, vendor: changes.vendor, qty: 1, unitMinor: changes.totalMinor }] } : {}), status: "SUBMITTED", submittedAt: new Date() } });
  else await tx.reimbursement.updateMany({ where: { id: row.id, workspaceId: actor.workspace.id }, data: { ...common, ...(changes ? { items: [{ description: changes.title, vendor: changes.vendor, justification: changes.justification, amountMinor: changes.totalMinor }] } : {}), status: "SUBMITTED", submittedAt: new Date() } });
  await note(actor, kind, row.id, "resubmitted", tx);
  return requestApproval(tx, { workspace: actor.workspace, subjectType: kind === "purchase_request" ? "PURCHASE_REQUEST" : "REIMBURSEMENT", subjectId: row.id, requesterId: actor.user.id, title: changes?.title ?? ("title" in row ? row.title : "Reimbursement"), amountMinor: changes?.totalMinor ?? row.totalMinor, currency: changes?.currency ?? row.currency });
 }); await r.afterCommit();
}
export async function withdrawRequest(actor: OpsActor, kind: "purchase_request" | "reimbursement", requestId: string) {
 await guard(actor); parse(id, requestId);
 await prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "ApprovalRequest" WHERE "subjectId"=${requestId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  const where = { id: requestId, workspaceId: actor.workspace.id, status: { in: ["DRAFT", "SUBMITTED"] } };
  const result = kind === "purchase_request" ? await tx.purchaseRequest.updateMany({ where: { ...where, requesterId: actor.user.id, status: { in: ["DRAFT", "SUBMITTED"] } }, data: { status: "CANCELLED" } }) : await tx.reimbursement.updateMany({ where: { ...where, claimantId: actor.user.id, status: { in: ["DRAFT", "SUBMITTED"] } }, data: { status: "CANCELLED" } });
  if (!result.count) throw new OpsError("Only your open requests can be withdrawn.");
  await cancelApproval(tx, { workspaceId: actor.workspace.id, subjectType: kind === "purchase_request" ? "PURCHASE_REQUEST" : "REIMBURSEMENT", subjectId: requestId, actorId: actor.user.id });
 });
}

export async function createGenericRequest(actor: OpsActor, input: unknown) {
 await guard(actor);
 const v = parse(z.object({ title }), input);
 const result = await prisma.$transaction(tx => requestApproval(tx, { workspace: actor.workspace, subjectType: "CUSTOM", subjectId: crypto.randomUUID(), title: v.title, requesterId: actor.user.id, requesterName: actor.user.name }));
 await result.afterCommit(); return result.requestId;
}
