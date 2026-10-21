import "server-only";
import type { GovernanceRecord } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { Actor } from "./access";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { sectionFor, sectionPath } from "../schemas";

export async function audit(
  actor: Actor,
  tx: Tx,
  record: GovernanceRecord,
  verb: string,
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `governance.${verb}`,
    targetType: record.kind,
    targetId: record.id,
    client: tx,
  });
}
export async function sync(actor: Actor, tx: Tx, row: GovernanceRecord, verb: string) {
  await audit(actor, tx, row, verb);
  if (row.archivedAt) await removeSearchDocument("governance", row.id, tx);
  else
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "governance",
        entityId: row.id,
        title: row.title,
        url: `/w/${actor.workspace.slug}/governance${sectionPath(sectionFor(row.kind))}?edit=${row.id}`,
        visibility: "PRIVATE",
        ownerId: row.ownerId ?? actor.user.id,
      },
      tx,
    );
  await recordActivity(
    {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      entityType: "governance",
      entityId: row.id,
      verb,
      summary: `Governance record ${verb}.`,
      visibility: "PRIVATE",
    },
    tx,
  );
}
