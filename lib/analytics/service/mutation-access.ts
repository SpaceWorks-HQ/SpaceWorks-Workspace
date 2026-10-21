import "server-only";
import type { Tx } from "@/lib/db";
import { analyticsAccess, type Actor } from "../access";
import { recordAuditEvent } from "@/lib/audit";
export async function lock(actor: Actor, tx: Tx) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
  return analyticsAccess(actor, tx);
}
export async function audit(actor: Actor, tx: Tx, id: string, action: string) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `analytics.${action}`,
    targetType: "analytics",
    targetId: id,
    client: tx,
  });
}
