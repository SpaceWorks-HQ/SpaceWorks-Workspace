import "server-only";
import { prisma } from "@/lib/db";
import { toolSchemas } from "@/lib/finance/tools-rules";
import {
  FinanceError,
  financeAccess,
  lockFinance,
  unavailable,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import {
  hiddenTeamIds,
  teamScopeFilter,
} from "@/lib/teamAccess";
import { financeNote } from "./notes";

export async function saveFund(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.fund.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const { id, archived, ...data } = v;
    if (id) {
      const existing = await tx.financeFund.findFirst({
        where: { id, workspaceId: actor.workspace.id },
      });
      if (!existing) throw new FinanceError(unavailable);
      if (
        existing.currency !== data.currency &&
        (await tx.ledgerEntry.count({
          where: { workspaceId: actor.workspace.id, fundId: id },
        }))
      )
        throw new FinanceError("This fund has entries. Keep its currency.");
      await tx.financeFund.updateMany({
        where: { id, workspaceId: actor.workspace.id },
        data: { ...data, archivedAt: archived ? new Date() : null },
      });
    }
    const rowId =
      id ??
      (
        await tx.financeFund.create({
          data: { ...data, workspaceId: actor.workspace.id },
        })
      ).id;
    await financeNote(tx, actor, "fund", rowId, "saved", v.name, "funds");
    return rowId;
  });
}

export async function saveCentre(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.centre.parse(input);
  return prisma.$transaction(async (tx) => {
    const { id, archived, ...data } = v;
    if (v.projectId) {
      const hidden = await hiddenTeamIds(
        actor.workspace.id,
        { userId: actor.user.id, role: actor.membership.role },
        tx,
      );
      if (
        !(await tx.project.findFirst({
          where: {
            id: v.projectId,
            workspaceId: actor.workspace.id,
            status: { not: "ARCHIVED" },
            ...teamScopeFilter(hidden),
          },
        }))
      )
        throw new FinanceError(
          "Choose a project you can open in this workspace.",
        );
    }
    if (
      id &&
      !(
        await tx.financeCostCentre.updateMany({
          where: { id, workspaceId: actor.workspace.id },
          data: { ...data, archivedAt: archived ? new Date() : null },
        })
      ).count
    )
      throw new FinanceError(unavailable);
    const rowId =
      id ??
      (
        await tx.financeCostCentre.create({
          data: { ...data, workspaceId: actor.workspace.id },
        })
      ).id;
    await financeNote(tx, actor, "centre", rowId, "saved", v.name, "funds");
    return rowId;
  });
}
