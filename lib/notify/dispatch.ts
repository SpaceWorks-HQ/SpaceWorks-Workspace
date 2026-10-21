import "server-only";

import type { DeliveryStatus, PersonalChannel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { announceNotifications } from "@/lib/notifications";
import { parsePeopleSelector, resolveSelectorMembers } from "@/lib/notify/audience";
import { destinationTarget, partitionDuplicates, PERSONAL_DEDUPE_WINDOW_SEC, personalTarget } from "@/lib/notify/dedupe";
import { audienceIncludesBroadcast, audienceIncludesPersonal, EVENT_CATALOG, type EventSpec, type EventType } from "@/lib/notify/events";
import { selectBroadcastTargets, toDbSeverity } from "@/lib/notify/match";
import { digestDueAt, resolvePersonalChannels } from "@/lib/notify/preferences";
import { deliveryTime, parseQuietHours } from "@/lib/notify/quietHours";
import type { DispatchDelivery, DispatchOptions, DispatchResult, NotificationEvent } from "@/lib/notify/types";
import { hasRoleAtLeast } from "@/lib/roles";

/**
 * The single notification entry point. Producers describe what happened;
 * workspace rules, entity "Send to" rules and member preferences decide where
 * it goes. See docs/ARCHITECTURE.md › Notification routing.
 *
 * 1. Validate against the catalogue and fill the default severity.
 * 2. Broadcast: matching rules → destinations (quiet hours per rule).
 * 3. Personal: recipients minus the actor, active members at or above the
 *    event's minimum role, not muted → in-app always, plus their preferred
 *    channels (quiet hours, snooze, digest).
 * 4. Dedupe repeats of `dedupeKey` per target inside each window.
 * 5. Persist the event, in-app notifications and delivery rows; queue an
 *    outbox job ("notify.deliver") per external delivery. Realtime nudges run
 *    after commit.
 */

export const NOTIFY_DELIVER_KIND = "notify.deliver";

type Tx = Prisma.TransactionClient;

type Candidate =
  | { kind: "inline-destination"; target: string; windowSec: number; destinationId: string; ruleId: string | null; userIds: string[] }
  | { kind: "destination"; target: string; windowSec: number; destinationId: string; ruleId: string | null; scheduledFor: Date }
  | { kind: "in-app"; target: string; windowSec: number; userId: string }
  | { kind: "personal"; target: string; windowSec: number; userId: string; channel: PersonalChannel; scheduledFor: Date }
  | { kind: "digest"; target: string; windowSec: number; userId: string; channel: PersonalChannel; frequency: string; dueAt: Date };

const noop = async () => undefined;

function safeAppPath(url: string | undefined) {
  return url && url.startsWith("/") && !url.startsWith("//") ? url.slice(0, 500) : null;
}

export async function dispatch<T extends EventType>(workspaceId: string, event: NotificationEvent<T>, options: DispatchOptions = {}): Promise<DispatchResult> {
  const spec: EventSpec | undefined = EVENT_CATALOG[event.type];
  if (!spec) throw new Error(`Unknown notification event type "${String(event.type)}".`);
  if (options.tx) return dispatchWith(options.tx, workspaceId, event, spec, options);
  const result = await prisma.$transaction((tx) => dispatchWith(tx, workspaceId, event, spec, options), { timeout: 15_000 });
  await result.afterCommit();
  return { ...result, afterCommit: noop };
}

/** Test send for one destination: bypasses rules, quiet hours and dedupe; deliveries are flagged `isTest`. */
export async function sendTest(workspaceId: string, destinationId: string, actorId: string) {
  return dispatch(
    workspaceId,
    {
      type: "notification.test",
      title: "Test notification from Space Works",
      body: "If you can read this, the destination works.",
      actorId,
      data: { destinationId },
    },
    { onlyDestinationIds: [destinationId], test: true },
  );
}

async function dispatchWith<T extends EventType>(tx: Tx, workspaceId: string, event: NotificationEvent<T>, spec: EventSpec, options: DispatchOptions): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const severity = event.severity ?? spec.severity;
  const explicit = options.onlyDestinationIds;
  const meetsRole = (role: Parameters<typeof hasRoleAtLeast>[0]) => !spec.minRole || hasRoleAtLeast(role, spec.minRole);
  const candidates: Candidate[] = [];
  const skipped: DispatchDelivery[] = [];

  // ── Broadcast ──
  const destinationCandidate = async (
    destination: { id: string; kind: string; config: Prisma.JsonValue },
    ruleId: string | null,
    scheduledFor: Date,
    windowSec: number,
  ) => {
    const target = destinationTarget(destination.id);
    if (destination.kind === "IN_APP_USERS") {
      const members = await resolveSelectorMembers(workspaceId, parsePeopleSelector(destination.config), tx);
      const userIds = members.filter((member) => meetsRole(member.role) && member.userId !== event.actorId).map((member) => member.userId);
      candidates.push({ kind: "inline-destination", target, windowSec, destinationId: destination.id, ruleId, userIds });
    } else {
      candidates.push({ kind: "destination", target, windowSec, destinationId: destination.id, ruleId, scheduledFor });
    }
  };

  if (explicit) {
    const destinations = await tx.notificationDestination.findMany({
      where: { workspaceId, id: { in: explicit.slice(0, 50) } },
      select: { id: true, kind: true, config: true },
    });
    for (const destination of destinations) await destinationCandidate(destination, null, now, 0);
  } else if (audienceIncludesBroadcast(spec.audience)) {
    const rules = await tx.notificationRule.findMany({
      where: { workspaceId, enabled: true },
      include: { destinations: { select: { destination: { select: { id: true, kind: true, config: true, enabled: true } } } } },
    });
    const destinations = new Map(rules.flatMap((rule) => rule.destinations.map(({ destination }) => [destination.id, destination] as const)));
    const targets = selectBroadcastTargets(
      rules.map((rule) => ({ ...rule, destinationIds: rule.destinations.filter(({ destination }) => destination.enabled).map(({ destination }) => destination.id) })),
      { type: event.type, severity, scope: event.scope, useWorkspaceRules: event.useWorkspaceRules },
      now,
    );
    for (const target of targets) await destinationCandidate(destinations.get(target.destinationId)!, target.ruleId, target.scheduledFor, target.dedupeWindowSec);
  }

  // ── Personal ──
  const recipientIds = [...new Set(event.recipients ?? [])].filter((id) => id && id !== event.actorId).slice(0, 1000);
  if (!explicit && audienceIncludesPersonal(spec.audience) && recipientIds.length > 0) {
    const members = (await tx.membership.findMany({ where: { workspaceId, status: "ACTIVE", userId: { in: recipientIds } }, select: { userId: true, role: true } })).filter((member) =>
      meetsRole(member.role),
    );
    const userIds = members.map((member) => member.userId);
    const windowSec = event.dedupeWindowSec ?? PERSONAL_DEDUPE_WINDOW_SEC;
    if (userIds.length > 0) {
      const preferences = await tx.notificationPreference.findMany({ where: { workspaceId, category: spec.category, OR: [{ userId: null }, { userId: { in: userIds } }] } });
      const settings = new Map((await tx.notificationUserSettings.findMany({ where: { workspaceId, userId: { in: userIds } } })).map((row) => [row.userId, row]));
      const links = await tx.externalIdentityLink.findMany({ where: { workspaceId, userId: { in: userIds }, connection: { status: "ACTIVE" } }, select: { userId: true, provider: true } });
      const muteKeys = muteKeysFor(event);
      const muted = new Set(
        muteKeys.length === 0
          ? []
          : (
              await tx.notificationMute.findMany({
                where: { workspaceId, userId: { in: userIds }, OR: muteKeys, AND: [{ OR: [{ until: null }, { until: { gt: now } }] }] },
                select: { userId: true },
              })
            ).map((row) => row.userId),
      );
      const workspaceDefault = preferences.find((row) => row.userId === null) ?? null;

      for (const member of members) {
        if (muted.has(member.userId)) {
          skipped.push({ id: null, target: personalTarget(member.userId, "*"), status: "SKIPPED", reason: "muted" });
          continue;
        }
        candidates.push({ kind: "in-app", target: personalTarget(member.userId, "IN_APP"), windowSec, userId: member.userId });
        const resolved = resolvePersonalChannels({
          category: spec.category,
          eventType: event.type,
          role: member.role,
          userPreference: preferences.find((row) => row.userId === member.userId) ?? null,
          workspaceDefault,
          linkedProviders: links.filter((link) => link.userId === member.userId).map((link) => link.provider),
        });
        if (resolved.digestFrequency === "OFF") continue;
        const userSettings = settings.get(member.userId);
        const bypassesQuiet = userSettings?.criticalBypassesQuiet ?? true;
        const urgent = severity === "critical" && bypassesQuiet;
        const dueAt = urgent ? null : digestDueAt(resolved.digestFrequency, now);
        for (const channel of resolved.channels) {
          if (channel === "IN_APP") continue;
          const target = personalTarget(member.userId, channel);
          if (dueAt) {
            candidates.push({ kind: "digest", target, windowSec, userId: member.userId, channel, frequency: resolved.digestFrequency, dueAt });
          } else {
            const scheduledFor = deliveryTime({
              at: now,
              severity,
              quietHours: parseQuietHours(userSettings?.quietHours),
              criticalBypasses: bypassesQuiet,
              snoozedUntil: userSettings?.snoozedUntil ?? null,
            });
            candidates.push({ kind: "personal", target, windowSec, userId: member.userId, channel, scheduledFor });
          }
        }
      }
    }
  }

  // ── Dedupe ──
  let kept = candidates;
  if (event.dedupeKey && !event.reminderOf && !explicit && !options.test) {
    const maxWindow = Math.max(PERSONAL_DEDUPE_WINDOW_SEC, event.dedupeWindowSec ?? 0, ...candidates.map((candidate) => candidate.windowSec));
    const prior = await tx.notificationEventRecord.findMany({
      where: { workspaceId, dedupeKey: event.dedupeKey, isTest: false, createdAt: { gte: new Date(now.getTime() - maxWindow * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, deliveries: { select: { destinationId: true, userId: true, personalChannel: true, createdAt: true } } },
    });
    if (prior.length > 0) {
      const priorDeliveries = prior.flatMap((record) =>
        record.deliveries.map((delivery) => ({
          target: delivery.destinationId ? destinationTarget(delivery.destinationId) : personalTarget(delivery.userId ?? "", delivery.personalChannel ?? ""),
          at: delivery.createdAt,
        })),
      );
      const partition = partitionDuplicates(candidates, priorDeliveries, now);
      kept = partition.kept;
      const dropped = partition.dropped.map((candidate) => ({ id: null, target: candidate.target, status: "SKIPPED" as const, reason: "duplicate" }));
      if (kept.length === 0) return { eventId: prior[0]!.id, deduped: true, deliveries: [...dropped, ...skipped], afterCommit: noop };
      skipped.push(...dropped);
    }
  }

  // ── Persist ──
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

function muteKeysFor(event: NotificationEvent): Prisma.NotificationMuteWhereInput[] {
  const keys: Prisma.NotificationMuteWhereInput[] = [];
  if (event.resource) keys.push({ resourceType: event.resource.type, resourceId: event.resource.id });
  const scope = event.scope ?? {};
  if (scope.projectId) keys.push({ resourceType: "project", resourceId: scope.projectId });
  if (scope.channelId) keys.push({ resourceType: "channel", resourceId: scope.channelId });
  if (scope.monitorId) keys.push({ resourceType: "monitor", resourceId: scope.monitorId });
  if (scope.taskId) keys.push({ resourceType: "task", resourceId: scope.taskId });
  return keys;
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
