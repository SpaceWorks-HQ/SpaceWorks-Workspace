import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
import { purgeWorkspace } from "@/lib/shell/retention";
import { runRetention } from "@/lib/monitor/rollups";
import { indexSearchDocument } from "@/lib/search/documents";

const suffix = uniqueSuffix(), slugs = [`finish-${suffix}`, `held-${suffix}`], domain = `@finish-${suffix}.test`;
const now = new Date("2026-10-19T12:00:00Z"), old = new Date("2026-07-01T12:00:00Z");
let userId: string, workspaceId: string, heldId: string;
async function records(id: string) {
  const channel = await prisma.channel.findFirstOrThrow({ where: { workspaceId: id } });
  const message = await prisma.message.create({ data: { workspaceId: id, channelId: channel.id, authorId: userId, body: "Old private text", createdAt: old } });
  await indexSearchDocument({ workspaceId: id, entityType: "message", entityId: message.id, title: "Old private text", url: "/w/example/chat" });
  const attachment = await prisma.fileObject.create({ data: { workspaceId: id, filename: "old-chat.txt", contentType: "text/plain", size: 3, storageKey: `finish/${message.id}`, folder: "/chat", messageAttachments: { create: { messageId: message.id } } } });
  const reply = await prisma.message.create({ data: { workspaceId: id, channelId: channel.id, authorId: userId, body: "Recent reply", parentId: message.id, createdAt: now } });
  const conversation = await prisma.assistantConversation.create({ data: { workspaceId: id, userId, createdAt: old, updatedAt: old } });
  await prisma.auditEvent.create({ data: { workspaceId: id, action: "finish.fixture", createdAt: old } });
  const event = await prisma.notificationEventRecord.create({ data: { workspaceId: id, type: "notification.test", title: "Old event", severity: "INFO", payload: {}, createdAt: old } });
  const delivery = await prisma.notificationDelivery.create({ data: { workspaceId: id, eventId: event.id, status: "SENT", createdAt: old } });
  const job = await prisma.outboxMessage.create({ data: { kind: "notify.deliver", payload: { deliveryId: delivery.id }, status: "SENT", createdAt: old } });
  const connection = await prisma.messagingConnection.create({ data: { workspaceId: id, provider: "TELEGRAM", label: "Retention fixture", credentialsEnc: "unused" } });
  const inbound = await prisma.inboundEvent.create({ data: { provider: "TELEGRAM", connectionId: connection.id, externalEventId: "fixture", kind: "message", payload: {}, status: "PROCESSED", receivedAt: old } });
  await prisma.retentionPolicy.createMany({ data: ["chat", "notifications", "assistant"].map(entityType => ({ workspaceId: id, entityType, keepDays: 30 })) });
  return { message, reply, attachment, conversation, job, event, inbound };
}
let own: Awaited<ReturnType<typeof records>>, held: Awaited<ReturnType<typeof records>>;
beforeAll(async () => {
  userId = (await createUser(`owner${domain}`)).id;
  workspaceId = (await createWorkspace(slugs[0]!, userId)).id;
  heldId = (await createWorkspace(slugs[1]!, userId)).id;
  own = await records(workspaceId); held = await records(heldId);
  await prisma.workspace.update({ where: { id: heldId }, data: { legalHold: true } });
});
afterAll(async () => {
  await prisma.outboxMessage.deleteMany({ where: { id: { in: [own?.job.id, held?.job.id].filter((id): id is string => Boolean(id)) } } });
  await cleanup(slugs, domain); await prisma.$disconnect();
});
describe.sequential("cross-area retention", () => {
  it("purges selected content and terminal jobs, preserving recent replies and audit by default", async () => {
    await purgeWorkspace(workspaceId, now);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: own.message.id } })).toMatchObject({ body: "", deletedAt: expect.any(Date) });
    expect(await prisma.message.findUniqueOrThrow({ where: { id: own.reply.id } })).toMatchObject({ body: "Recent reply", deletedAt: null });
    expect(await prisma.fileObject.findUniqueOrThrow({ where: { id: own.attachment.id } })).toMatchObject({ deletedAt: expect.any(Date) });
    expect(await prisma.searchDocument.count({ where: { entityId: own.message.id } })).toBe(0);
    expect(await prisma.assistantConversation.count({ where: { id: own.conversation.id } })).toBe(0);
    expect(await prisma.outboxMessage.count({ where: { id: own.job.id } })).toBe(0);
    expect(await prisma.notificationEventRecord.count({ where: { id: own.event.id } })).toBe(0);
    expect(await prisma.inboundEvent.count({ where: { id: own.inbound.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceId, action: "finish.fixture" } })).toBe(1);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: held.message.id } })).toMatchObject({ body: "Old private text" });
  });
  it("legal hold pauses all writers and explicit audit deletion applies only to its workspace", async () => {
    expect(await purgeWorkspace(heldId, now)).toBe(0);
    expect(await prisma.outboxMessage.count({ where: { id: held.job.id } })).toBe(1);
    expect(await prisma.assistantConversation.count({ where: { id: held.conversation.id } })).toBe(1);
    await prisma.retentionPolicy.create({ data: { workspaceId, entityType: "audit", keepDays: 30 } });
    await purgeWorkspace(workspaceId, now);
    expect(await prisma.auditEvent.count({ where: { workspaceId, action: "finish.fixture" } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceId: heldId, action: "finish.fixture" } })).toBe(1);
  });
  it("monitor raw retention honours the longer workspace period and policy, including legacy worker", async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { monitorRetentionDays: 30 } });
    const monitor = await prisma.monitor.create({ data: { workspaceId, name: "Retention check", type: "HTTP", config: { url: "https://example.org" } } });
    const recent = new Date(now.getTime() - 20 * 86400000);
    await prisma.monitorCheck.createMany({ data: [old, recent].map(checkedAt => ({ workspaceId, monitorId: monitor.id, status: "UP", checkedAt })) });
    await prisma.retentionPolicy.create({ data: { workspaceId, entityType: "monitor_results", keepDays: 7 } });
    await purgeWorkspace(workspaceId, now);
    expect(await prisma.monitorCheck.count({ where: { monitorId: monitor.id } })).toBe(1);
    await prisma.retentionPolicy.update({ where: { workspaceId_entityType: { workspaceId, entityType: "monitor_results" } }, data: { keepDays: 365, action: "ARCHIVE" } });
    await runRetention(new Date("2027-01-01T12:00:00Z"), { force: true });
    expect(await prisma.monitorCheck.count({ where: { monitorId: monitor.id } })).toBe(1);
  });
});
