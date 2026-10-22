import "server-only";
import { type FundingRecord } from "@prisma/client";
import { type Tx } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import {
  indexSearchDocument,
  removeSearchDocument,
} from "@/lib/search/documents";
import { sectionFor } from "@/lib/funding/schema";
import { type Actor } from "./access";

export async function audit(
  actor: Actor,
  tx: Tx,
  record: { id: string },
  verb: string,
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `funding.${verb}`,
    targetType: "FundingRecord",
    targetId: record.id,
    client: tx,
  });
}
export async function sync(
  actor: Actor,
  tx: Tx,
  row: FundingRecord,
  verb: string,
) {
  await audit(actor, tx, row, verb);
  if (row.archivedAt) await removeSearchDocument("funding", row.id, tx);
  else
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "funding",
        entityId: row.id,
        title: row.title,
        url: `/w/${actor.workspace.slug}/funding/${sectionFor(row.kind)}?edit=${row.id}`,
        visibility: "PRIVATE",
        ownerId: row.ownerId ?? actor.user.id,
      },
      tx,
    );
  await recordActivity(
    {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      entityType: "funding",
      entityId: row.id,
      verb,
      summary: `Funding record ${verb}.`,
      visibility: "PRIVATE",
    },
    tx,
  );
}
