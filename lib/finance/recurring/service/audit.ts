import "server-only";
import type { DbClient } from "@/lib/db";
import type { FinanceActor } from "@/lib/finance/tools/access";
import { recordAuditEvent } from "@/lib/audit";

export async function note(
  tx: DbClient,
  actor: FinanceActor,
  id: string,
  action: string,
) {
  await recordAuditEvent({
    client: tx,
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    targetType: "recurring_cost",
    targetId: id,
    action: `finance.recurring_${action}`,
  });
}
