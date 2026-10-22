import "server-only";

import type { DeliveryStatus, PersonalChannel, Prisma } from "@prisma/client";
import { announceNotifications } from "@/lib/notifications";
import { destinationTarget, personalTarget } from "@/lib/notify/dedupe";
import type { Severity } from "@/lib/notify/events";
import { toDbSeverity } from "@/lib/notify/match";
import type { DispatchDelivery, DispatchOptions, DispatchResult, NotificationEvent } from "@/lib/notify/types";
import type { Candidate } from "./dispatch-types";

export const NOTIFY_DELIVER_KIND = "notify.deliver";

export async function persistDispatch(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  event: NotificationEvent,
  severity: Severity,
  options: DispatchOptions,
  now: Date,
  kept: Candidate[],
  skipped: DispatchDelivery[],
): Promise<DispatchResult> {
  const record = await tx.notificationEventRecord.create({
    data: {
      workspaceId,
      type: event.type,
      severity: toDbSeverity(severity),
      title: event.title.slice(0, 150),
      payload: envelope(event, severity, now),
      dedupeKey: event.dedupeKey?.slice(0, 200) ?? null,
      threadKey: event.threadKey?.slice(0, 200) ?? null,
      reminderOf: event.reminderOf ?? null,
      actorId: event.actorId ?? null,
      isTest: Boolean(options.test),
    },
    select: { id: true },
  });

  const inAppUsers = new Set<string>();
  for (const candidate of kept) {
    if (candidate.kind === "in-app") inAppUsers.add(candidate.userId);
    if (candidate.kind === "inline-destination") candidate.userIds.forEach((id) => inAppUsers.add(id));
  }
  const url = safeAppPath(event.url);
  const notificationRows = [...inAppUsers].map((userId) => ({
    userId,
    workspaceId,
    kind: event.type,
    title: `${options.test ? "[Test] " : ""}${event.title}`.slice(0, 200),
    body: event.body?.slice(0, 1000) ?? null,
    url,
    eventId: record.id,
    actorId: event.actorId ?? null,
  }));
  if (notificationRows.length > 0) await tx.notification.createMany({ data: notificationRows });

  const threadKey = event.threadKey?.slice(0, 200) ?? null;
  const isTest = Boolean(options.test);
  const deliveryRows: Prisma.NotificationDeliveryCreateManyInput[] = kept.map((candidate) => {
    const base = { workspaceId, eventId: record.id, threadKey, isTest };
    switch (candidate.kind) {
      case "inline-destination":
        return { ...base, destinationId: candidate.destinationId, ruleId: candidate.ruleId, status: "SENT", attempts: 1, lastAttemptAt: now, scheduledFor: now };
      case "destination":
        return { ...base, destinationId: candidate.destinationId, ruleId: candidate.ruleId, status: "PENDING", scheduledFor: candidate.scheduledFor };
      case "in-app":
        return { ...base, userId: candidate.userId, personalChannel: "IN_APP", status: "SENT", attempts: 1, lastAttemptAt: now, scheduledFor: now };
      case "personal":
        return { ...base, userId: candidate.userId, personalChannel: candidate.channel, status: "PENDING", scheduledFor: candidate.scheduledFor };
      case "digest":
        return { ...base, userId: candidate.userId, personalChannel: candidate.channel, status: "SKIPPED", scheduledFor: candidate.dueAt, lastError: `Held for the ${candidate.frequency.toLowerCase()} digest.` };
    }
  });
  const created = deliveryRows.length
    ? await tx.notificationDelivery.createManyAndReturn({ data: deliveryRows, select: { id: true, status: true, scheduledFor: true, destinationId: true, userId: true, personalChannel: true } })
    : [];
  const targetOf = (row: { destinationId: string | null; userId: string | null; personalChannel: PersonalChannel | null }) =>
    row.destinationId ? destinationTarget(row.destinationId) : personalTarget(row.userId ?? "", row.personalChannel ?? "");

  const digestItems = kept.flatMap((candidate) =>
    candidate.kind === "digest" ? [{ workspaceId, userId: candidate.userId, channel: candidate.channel, eventId: record.id, dueAt: candidate.dueAt }] : [],
  );
  if (digestItems.length > 0) await tx.notificationDigestItem.createMany({ data: digestItems });

  const pending = created.filter((row) => row.status === "PENDING");
  if (pending.length > 0) {
    await tx.outboxMessage.createMany({
      data: pending.map((row) => ({ kind: NOTIFY_DELIVER_KIND, payload: { deliveryId: row.id, workspaceId }, availableAt: row.scheduledFor })),
    });
  }

  const deliveries: DispatchDelivery[] = [
    ...created.map((row) => ({
      id: row.id,
      target: targetOf(row),
      status: row.status as Extract<DeliveryStatus, "PENDING" | "SENT" | "SKIPPED">,
      ...(row.status === "SKIPPED" ? { reason: "digest" } : {}),
    })),
    ...skipped,
  ];
  const announce = notificationRows.map((row) => ({ userId: row.userId, workspaceId, kind: row.kind }));
  return { eventId: record.id, deduped: false, deliveries, afterCommit: () => announceNotifications(announce) };
}

function safeAppPath(url: string | undefined) {
  return url && url.startsWith("/") && !url.startsWith("//") ? url.slice(0, 500) : null;
}

/** The stored copy of the event (rendering, webhooks, the delivery log). */
function envelope(event: NotificationEvent, severity: string, now: Date): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      type: event.type,
      severity,
      title: event.title.slice(0, 150),
      body: event.body?.slice(0, 4000) ?? null,
      url: safeAppPath(event.url),
      actorId: event.actorId ?? null,
      resource: event.resource ?? null,
      scope: event.scope ?? {},
      fields: event.fields?.slice(0, 25) ?? [],
      actions: event.actions?.slice(0, 5) ?? [],
      occurredAt: (event.occurredAt ?? now).toISOString(),
      data: event.data,
    }),
  ) as Prisma.InputJsonValue;
}
