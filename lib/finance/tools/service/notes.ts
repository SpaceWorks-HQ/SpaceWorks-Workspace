import "server-only";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import { type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { type FinanceActor } from "@/lib/finance/tools/access";

export async function financeNote(
  tx: DbClient,
  actor: FinanceActor,
  type: string,
  id: string,
  verb: string,
  title?: string,
  section?: string,
) {
  await checkFundRecord(tx, actor.workspace.id, actor.user.id, type, id);
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `finance.${type}_${verb}`,
    targetType: type,
    targetId: id,
    client: tx,
  });
  await recordActivity(
    {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      entityType: `finance_${type}`,
      entityId: id,
      verb,
      summary: "A finance record changed.",
      visibility: "PRIVATE",
    },
    tx,
  );
  if (title && section)
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: `finance_${type}`,
        entityId: id,
        title,
        url: `/w/${actor.workspace.slug}/finance/${section}`,
        ownerId: actor.user.id,
        visibility: "PRIVATE",
      },
      tx,
    );
}
