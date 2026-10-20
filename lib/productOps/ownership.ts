import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManageProductEstimates } from "@/lib/roles";
import { id } from "./schema";
import { lock, ensure, type Actor } from "./access";
import { recordAuditEvent } from "@/lib/audit";
export async function saveOwnership(untrusted: Actor, raw: unknown) {
 const input = z.object({ serviceId: id.min(1), ownerId: id.min(1), backupOwnerId: id.min(1) }).parse(raw);
 return prisma.$transaction(async tx => {
  const actor = await lock(untrusted, tx), workspaceId = actor.workspace.id;
  ensure(canManageProductEstimates(actor.membership), "Ask an admin to update technical ownership.");
  ensure(input.ownerId !== input.backupOwnerId, "Choose a different person as backup.");
  ensure(await tx.serviceCatalogItem.findFirst({ where: { workspaceId, id: input.serviceId } }));
  for (const userId of [input.ownerId, input.backupOwnerId]) ensure(await tx.membership.findFirst({ where: { workspaceId, userId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } } }), "Choose current team members.");
  await tx.serviceCatalogItem.updateMany({ where: { workspaceId, id: input.serviceId }, data: { ownerId: input.ownerId, backupOwnerId: input.backupOwnerId } });
  await recordAuditEvent({ workspaceId, actorId: actor.user.id, action: "product_ops.ownership_updated", targetType: "ServiceCatalogItem", targetId: input.serviceId, client: tx }); return { id: input.serviceId };
 });
}
