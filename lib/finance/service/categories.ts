import "server-only";
import { actionError, SAVE_FAILED, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { z } from "zod";
import type { categorySchema } from "@/lib/finance/schemas";
import { type Ctx, isUniqueViolation } from "./mutation-helpers";

// ───────────── Categories ─────────────

export async function createCategory(ctx: Ctx, values: z.output<typeof categorySchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const category = await prisma.financeCategory.create({ data: { workspaceId: ctx.workspace.id, name: values.name, kind: values.kind } });
    await recordAuditEvent({ action: "finance.category_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "finance_category", targetId: category.id });
    return { ok: true, data: { id: category.id } };
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("A category with that name already exists.", { name: ["A category with that name already exists."] });
    return actionError(SAVE_FAILED);
  }
}

export async function renameCategory(ctx: Ctx, categoryId: string, name: string): Promise<ActionResult> {
  try {
    const changed = await prisma.financeCategory.updateMany({ where: { id: categoryId, workspaceId: ctx.workspace.id }, data: { name } });
    if (changed.count === 0) return actionError("That category isn't available any more.");
    await recordAuditEvent({ action: "finance.category_renamed", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "finance_category", targetId: categoryId });
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("A category with that name already exists.", { name: ["A category with that name already exists."] });
    return actionError(SAVE_FAILED);
  }
}

export async function setCategoryArchived(ctx: Ctx, categoryId: string, archived: boolean): Promise<ActionResult> {
  const changed = await prisma.financeCategory.updateMany({ where: { id: categoryId, workspaceId: ctx.workspace.id }, data: { archivedAt: archived ? new Date() : null } });
  if (changed.count === 0) return actionError("That category isn't available any more.");
  await recordAuditEvent({ action: archived ? "finance.category_archived" : "finance.category_restored", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "finance_category", targetId: categoryId });
  return { ok: true };
}

