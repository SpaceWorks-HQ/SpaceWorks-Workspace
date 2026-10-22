import "server-only";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import { Prisma, type LedgerKind } from "@prisma/client";
import { recordActivity } from "@/lib/activity";
import type { DbClient } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import { RASTER_IMAGE_TYPES } from "@/lib/storage";

/**
 * Finance mutations. Callers (Server Actions) have already resolved the
 * workspace from the slug and checked `canManageFinance`; every query here
 * still filters by `workspaceId` so an id from another workspace never
 * resolves.
 */

export const RECEIPT_TYPES: ReadonlySet<string> = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const NOT_FOUND = "That entry isn't available any more. Refresh and try again.";
export const INVOICE_NOT_FOUND = "That invoice isn't available any more. Refresh and try again.";

export type Ctx = Pick<WorkspaceContext, "user" | "workspace">;
export async function financeActivity(client: DbClient, ctx: Ctx, entityType: string, entityId: string, verb: string) {
  if (entityType === "ledger_entry") await checkFundRecord(client,ctx.workspace.id,ctx.user.id,"entry",entityId);
  await recordActivity({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, entityType, entityId, verb, summary: "A finance record changed.", visibility: "PRIVATE" }, client);
}

export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function checkCategory(client: DbClient, workspaceId: string, categoryId: string | null, kind: LedgerKind, keepId: string | null = null): Promise<string | null> {
  if (!categoryId) return null;
  const category = await client.financeCategory.findFirst({ where: { id: categoryId, workspaceId }, select: { kind: true, archivedAt: true } });
  if (!category) return "Choose a category from the list.";
  if (category.kind !== kind) return kind === "INCOME" ? "Choose an income category." : "Choose an expense category.";
  if (category.archivedAt && categoryId !== keepId) return "That category is archived. Choose another one.";
  return null;
}

export async function checkBudget(client: DbClient, workspaceId: string, budgetId: string | null, currency: string): Promise<string | null> {
  if (!budgetId) return null;
  const budget = await client.budget.findFirst({ where: { id: budgetId, workspaceId, currency }, select: { id: true } });
  return budget ? null : "Choose a budget in the entry's currency from this workspace.";
}

/** Soft-delete receipt/cover files we uploaded once nothing links to them, so they never surface in the files library. */
export async function retireUnlinkedFile(client: DbClient, workspaceId: string, fileId: string | null) {
  if (!fileId) return;
  await client.fileObject.updateMany({
    where: { id: fileId, workspaceId, deletedAt: null, ledgerReceipts: { none: {} }, messageAttachments: { none: {} }, docId: null, taskId: null },
    data: { deletedAt: new Date() },
  });
}

