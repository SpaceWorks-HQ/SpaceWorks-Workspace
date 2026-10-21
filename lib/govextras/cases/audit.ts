import "server-only";
import type { Tx } from "@/lib/db";
import type { Actor } from "@/lib/governance/service";
import { recordAuditEvent } from "@/lib/audit";

export async function audit(actor: Actor, tx: Tx, action: string, id?: string) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `safeguarding.${action}`,
    targetType: "safeguarding",
    targetId: id,
    client: tx,
  });
}
