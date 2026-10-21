import "server-only";
import type { MoneyControlRecord } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import type { ControlsActor } from "../access";
import { sectionFor } from "../rules";

export async function note(
  tx: DbClient,
  actor: ControlsActor,
  row: MoneyControlRecord,
  action: string,
  reference = "",
  notes = "",
) {
  await tx.moneyControlEvent.create({
    data: {
      workspaceId: actor.workspace.id,
      recordId: row.id,
      actorId: actor.user.id,
      action,
      reference,
      notes,
    },
  });
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `moneycontrols.${action.toLowerCase()}`,
    targetType: "money_control",
    targetId: row.id,
    client: tx,
  });
  if (row.payroll) await removeSearchDocument("money_control", row.id, tx);
  if (!row.payroll) {
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "money_control",
        entityId: row.id,
        title: row.title,
        url: `/w/${actor.workspace.slug}/money-controls/${sectionFor(row.kind)}?edit=${row.id}`,
        visibility: "PRIVATE",
        ownerId: row.ownerId ?? actor.user.id,
      },
      tx,
    );
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        entityType: "money_control",
        entityId: row.id,
        verb: action.toLowerCase(),
        summary: "An internal control record changed.",
        visibility: "PRIVATE",
      },
      tx,
    );
  }
}
