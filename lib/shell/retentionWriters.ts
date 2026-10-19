import "server-only";

import type { DbClient } from "@/lib/db";

type Writer = (tx: DbClient, workspaceId: string, cutoff: Date) => Promise<number>;

/** All writers run under the framework's workspace/legal-hold row lock. */
export const RETENTION_WRITERS: Record<string, Writer> = {
  chat: async (tx, workspaceId, cutoff) => {
    // Tombstone old text first: deleting a root would cascade newer replies.
    const old = await tx.message.findMany({ where: { workspaceId, createdAt: { lt: cutoff }, OR: [{ deletedAt: null }, { body: { not: "" } }] }, orderBy: { createdAt: "asc" }, take: 2000, select: { id: true } });
    const ids = old.map(row => row.id);
    await tx.searchDocument.deleteMany({ where: { workspaceId, entityType: "message", entityId: { in: ids } } });
    await tx.messageReaction.deleteMany({ where: { message: { workspaceId, id: { in: ids } } } });
    // Private chat uploads follow file cleanup once no retained message uses them.
    await tx.fileObject.updateMany({ where: { workspaceId, folder: "/chat", docId: null, taskId: null, deletedAt: null, messageAttachments: { some: { messageId: { in: ids } }, every: { message: { workspaceId, createdAt: { lt: cutoff } } } } }, data: { deletedAt: new Date() } });
    // Keep attachment ownership so retention never broadens file access.
    return (await tx.message.updateMany({ where: { workspaceId, id: { in: ids }, OR: [{ deletedAt: null }, { body: { not: "" } }] }, data: { body: "", deletedAt: cutoff, pinnedAt: null, pinnedById: null } })).count;
  },
  activity: async (tx, workspaceId, cutoff) => (await tx.activityEvent.deleteMany({ where: { workspaceId, createdAt: { lt: cutoff } } })).count,
  notifications: async (tx, workspaceId, cutoff) => {
    const old = { workspaceId, createdAt: { lt: cutoff } };
    let count = (await tx.notification.deleteMany({ where: old })).count;
    count += await purgeDeliveryOutbox(tx, workspaceId, cutoff);
    count += (await tx.notificationDelivery.deleteMany({ where: { ...old, status: { in: ["SENT", "FAILED", "SKIPPED"] } } })).count;
    count += (await tx.notificationDigestItem.deleteMany({ where: { ...old, sentAt: { not: null } } })).count;
    // Keep event envelopes needed by a pending delivery or digest.
    count += await tx.$executeRaw`DELETE FROM "NotificationEventRecord" e WHERE e."workspaceId"=${workspaceId} AND e."createdAt" < ${cutoff} AND NOT EXISTS (SELECT 1 FROM "NotificationDelivery" d WHERE d."eventId"=e.id) AND NOT EXISTS (SELECT 1 FROM "NotificationDigestItem" d WHERE d."eventId"=e.id)`;
    return count;
  },
  monitor_results: async (tx, workspaceId, cutoff) => (await tx.monitorCheck.deleteMany({ where: { workspaceId, checkedAt: { lt: cutoff } } })).count,
  assistant: async (tx, workspaceId, cutoff) => (await tx.assistantConversation.deleteMany({ where: { workspaceId, updatedAt: { lt: cutoff } } })).count,
  audit: async (tx, workspaceId, cutoff) => (await tx.auditEvent.deleteMany({ where: { workspaceId, createdAt: { lt: cutoff } } })).count,
  inbound: async (tx, workspaceId, cutoff) => (await tx.inboundEvent.deleteMany({ where: { connection: { workspaceId }, receivedAt: { lt: cutoff }, status: { in: ["PROCESSED", "IGNORED", "FAILED"] } } })).count,
  outbox: async (tx, workspaceId, cutoff) => {
    const explicit = await tx.outboxMessage.deleteMany({ where: { payload: { path: ["workspaceId"], equals: workspaceId }, createdAt: { lt: cutoff }, status: { in: ["SENT", "FAILED"] } } });
    return explicit.count + await purgeDeliveryOutbox(tx, workspaceId, cutoff);
  },
};

/** Old jobs did not carry workspaceId; resolve ownership before deleting their delivery. */
async function purgeDeliveryOutbox(tx: DbClient, workspaceId: string, cutoff: Date) {
  return tx.$executeRaw`DELETE FROM "OutboxMessage" o WHERE o.kind='notify.deliver' AND o.status IN ('SENT', 'FAILED') AND o."createdAt" < ${cutoff} AND EXISTS (SELECT 1 FROM "NotificationDelivery" d WHERE d.id=o.payload->>'deliveryId' AND d."workspaceId"=${workspaceId})`;
}
