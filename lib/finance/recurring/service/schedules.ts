import "server-only";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  lockFinance,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { indexSearchDocument } from "@/lib/search/documents";
import { recordActivity } from "@/lib/activity";
import { scheduleSchema, taxAmounts, firstDue } from "../rules";
import { references } from "./references";
import { note } from "./audit";

export async function saveSchedule(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = scheduleSchema.parse(input);
  taxAmounts(v.amountMinor, v.gstPercent, v.tdsPercent);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "MANAGE", tx);
    await references(tx, actor, v);
    const existing = await tx.recurringCostSchedule.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        ...(v.id ? { id: v.id } : { requestKey: v.requestKey }),
      },
    });
    if (v.id && !existing)
      throw new FinanceError("That schedule is unavailable.");
    if (existing && !v.id) return existing.id;
    const hasDues =
      existing &&
      (await tx.recurringCostDue.count({
        where: { workspaceId: actor.workspace.id, scheduleId: existing.id },
      }));
    if (
      hasDues &&
      (existing!.frequency !== v.frequency ||
        existing!.dueDay !== v.dueDay ||
        existing!.startsOn.toISOString().slice(0, 10) !== v.startsOn ||
        existing!.currency !== v.currency ||
        existing!.kind !== v.kind ||
        existing!.principalMinor !== v.principalMinor ||
        existing!.tenure !== v.tenure ||
        existing!.tdsSection !== v.tdsSection)
    )
      throw new FinanceError(
        "This schedule has bills. Pause it and add a new schedule to change its timing, kind, currency or loan principal.",
      );
    const { id, requestKey, startsOn, endsOn, renewalOn, ...rest } = v;
    void id;
    const data = {
      ...rest,
      startsOn: new Date(startsOn),
      endsOn: endsOn ? new Date(endsOn) : null,
      renewalOn: renewalOn ? new Date(renewalOn) : null,
      nextDueOn: hasDues
        ? existing!.nextDueOn
        : firstDue(new Date(startsOn), v.dueDay),
    };
    const row = existing
      ? await tx.recurringCostSchedule.update({
          where: {
            workspaceId_id: {
              workspaceId: actor.workspace.id,
              id: existing.id,
            },
          },
          data,
        })
      : await tx.recurringCostSchedule.create({
          data: {
            ...data,
            requestKey,
            workspaceId: actor.workspace.id,
            createdById: actor.user.id,
          },
        });
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "recurring_cost",
        entityId: row.id,
        title: row.title,
        visibility: "PRIVATE",
        ownerId: actor.user.id,
        url: `/w/${actor.workspace.slug}/finance/recurring?edit=${row.id}`,
      },
      tx,
    );
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        entityType: "recurring_cost",
        entityId: row.id,
        verb: "saved",
        summary: "A recurring cost schedule changed.",
        visibility: "PRIVATE",
      },
      tx,
    );
    await note(tx, actor, row.id, "saved");
    return row.id;
  });
}
