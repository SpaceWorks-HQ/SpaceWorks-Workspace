import "server-only";

import type { AttendanceStatus, Prisma } from "@prisma/client";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { formatDayTime, formatTimeZoneName } from "@/lib/format/datetime";
import { dispatch } from "@/lib/notify/dispatch";
import type { DispatchResult } from "@/lib/notify/types";
import { publish } from "@/lib/realtime";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { safeTimeZone, zonedInputToIso } from "@/lib/timeZone";
import { canCreateEvents, canEditEvent, canRsvp } from "@/lib/community/access";
import { tryTransactionLock, workspaceZone, type CommunityActor } from "@/lib/community/context";
import { promotionsFor, resolveRsvp, waitlistPosition, type AttendeeState } from "@/lib/community/rsvp";
import { dueReminders, effectiveEnd, REMINDERS, reminderDedupeKey } from "@/lib/community/schedule";
import { EVENT_KIND_LABELS, eventInputSchema, rsvpInputSchema } from "@/lib/community/validation";

/**
 * Community events (build nights, meetups, workshops): members create them,
 * the organiser or an admin edits and cancels, everyone RSVPs. Capacity is
 * enforced inside a transaction that locks the event row, so two people
 * racing for the last spot cannot both get it; freed spots promote the
 * waitlist in arrival order.
 */

export const eventUrl = (slug: string, id: string) => `/w/${slug}/calendar/${id}`;

type Notify = Array<DispatchResult | null>;

async function lockEvent(tx: Prisma.TransactionClient, workspaceId: string, eventId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CommunityEvent" WHERE "id" = ${eventId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  return rows.length > 0;
}

async function attendeesOf(tx: Prisma.TransactionClient, eventId: string): Promise<AttendeeState[]> {
  return tx.eventAttendee.findMany({ where: { eventId }, select: { userId: true, status: true, respondedAt: true } });
}

/** Move waitlisted people into freed spots and tell each of them. */
async function promoteWaitlist(
  tx: Prisma.TransactionClient,
  workspace: CommunityActor["workspace"],
  event: { id: string; title: string; startsAt: Date; capacity: number | null },
  actorId: string | null,
  now: Date,
): Promise<Notify> {
  const promoted = promotionsFor(event.capacity, await attendeesOf(tx, event.id));
  if (promoted.length === 0) return [];
  await tx.eventAttendee.updateMany({ where: { eventId: event.id, userId: { in: promoted }, status: "WAITLIST" }, data: { status: "GOING", respondedAt: now } });
  const zone = safeTimeZone(workspace.timezone);
  const results: Notify = [];
  for (const userId of promoted) {
    results.push(
      await dispatch(
        workspace.id,
        {
          type: "rsvp.changed",
          title: `A spot opened up: you're going to ${event.title}`.slice(0, 150),
          body: `${formatDayTime(event.startsAt, zone)} ${formatTimeZoneName(event.startsAt, zone)}. Change your reply on the event page if your plans changed.`,
          url: eventUrl(workspace.slug, event.id),
          actorId,
          recipients: [userId],
          resource: { type: "community_event", id: event.id },
          data: { eventId: event.id, userId, status: "GOING" },
        },
        { tx, now },
      ),
    );
  }
  return results;
}

async function settle(workspaceId: string, eventId: string, results: Notify) {
  for (const result of results) await result?.afterCommit();
  await publish(workspaceId, "workspace", { type: "community.event.changed", data: { eventId } });
}

function indexEvent(tx: Prisma.TransactionClient, workspace: CommunityActor["workspace"], event: { id: string; title: string; description: string | null; location: string | null; createdById: string | null }) {
  return indexSearchDocument(
    {
      workspaceId: workspace.id,
      entityType: "community_event",
      entityId: event.id,
      title: event.title,
      body: [event.location, event.description].filter(Boolean).join("\n"),
      url: eventUrl(workspace.slug, event.id),
      ownerId: event.createdById,
    },
    tx,
  );
}

/** Events overlapping [start, end) with going counts and the viewer's own reply. */
export async function listEvents(actor: CommunityActor, range: { start: Date; end: Date }, options: { includeCancelled?: boolean } = {}) {
  const events = await prisma.communityEvent.findMany({
    where: {
      workspaceId: actor.workspace.id,
      startsAt: { lt: range.end, gte: new Date(range.start.getTime() - 14 * 24 * 60 * 60 * 1000) },
      ...(options.includeCancelled === false ? { cancelledAt: null } : {}),
    },
    orderBy: { startsAt: "asc" },
    take: 500,
    select: { id: true, title: true, kind: true, location: true, startsAt: true, endsAt: true, capacity: true, cancelledAt: true, createdById: true },
  });
  const visible = events.filter((event) => effectiveEnd(event.startsAt, event.endsAt).getTime() > range.start.getTime());
  const ids = visible.map((event) => event.id);
  const [counts, mine] = ids.length
    ? await Promise.all([
        prisma.eventAttendee.groupBy({ by: ["eventId", "status"], where: { eventId: { in: ids } }, _count: { _all: true } }),
        prisma.eventAttendee.findMany({ where: { eventId: { in: ids }, userId: actor.user.id }, select: { eventId: true, status: true } }),
      ])
    : [[], []];
  const going = new Map<string, number>();
  for (const row of counts) if (row.status === "GOING") going.set(row.eventId, row._count._all);
  const myStatus = new Map(mine.map((row) => [row.eventId, row.status] as const));
  return visible.map((event) => ({ ...event, going: going.get(event.id) ?? 0, myStatus: myStatus.get(event.id) ?? null }));
}

export async function getEventDetail(actor: CommunityActor, id: string) {
  const event = await prisma.communityEvent.findFirst({
    where: { id, workspaceId: actor.workspace.id },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      kind: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      cancelledAt: true,
      createdAt: true,
      createdById: true,
      createdBy: { select: { id: true, name: true, image: true } },
      attendees: {
        orderBy: { respondedAt: "asc" },
        select: { userId: true, status: true, respondedAt: true, user: { select: { id: true, name: true, image: true } } },
      },
    },
  });
  if (!event) return null;
  const mine = event.attendees.find((attendee) => attendee.userId === actor.user.id) ?? null;
  return {
    ...event,
    myStatus: mine?.status ?? null,
    myWaitlistPosition: waitlistPosition(event.attendees, actor.user.id),
    canEdit: canEditEvent(actor.membership, event, actor.user.id),
  };
}

function parseTimes(actor: CommunityActor, startsLocal: string, endsLocal: string | undefined) {
  const zone = workspaceZone(actor);
  const startsIso = zonedInputToIso(startsLocal, zone);
  if (!startsIso) return { error: actionError("That start time doesn't exist in the workspace time zone. Pick another.", { startsAt: ["Pick another time."] }) };
  const startsAt = new Date(startsIso);
  let endsAt: Date | null = null;
  if (endsLocal) {
    const endsIso = zonedInputToIso(endsLocal, zone);
    if (!endsIso) return { error: actionError("That end time doesn't exist in the workspace time zone. Pick another.", { endsAt: ["Pick another time."] }) };
    endsAt = new Date(endsIso);
    if (endsAt.getTime() <= startsAt.getTime()) return { error: actionError("The event has to end after it starts.", { endsAt: ["End after the start time."] }) };
    if (endsAt.getTime() - startsAt.getTime() > 14 * 24 * 60 * 60 * 1000) return { error: actionError("Keep events shorter than two weeks.", { endsAt: ["Pick an earlier end."] }) };
  }
  return { startsAt, endsAt };
}

export async function saveEvent(actor: CommunityActor, input: unknown, existingId: string | null, now = new Date()): Promise<ActionResult<{ id: string }>> {
  if (!canCreateEvents(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  const times = parseTimes(actor, data.startsAt, data.endsAt || undefined);
  if ("error" in times) return times.error!;

  const existing = existingId
    ? await prisma.communityEvent.findFirst({
        where: { id: existingId, workspaceId: actor.workspace.id },
        select: { id: true, title: true, startsAt: true, endsAt: true, location: true, capacity: true, cancelledAt: true, createdById: true },
      })
    : null;
  if (existingId && !existing) return actionError("That event no longer exists.");
  if (existing && !canEditEvent(actor.membership, existing, actor.user.id)) return actionError(NOT_ALLOWED);
  if (existing?.cancelledAt) return actionError("This event was cancelled, so it can't be edited.");

  const fields = { title: data.title, kind: data.kind, startsAt: times.startsAt, endsAt: times.endsAt, location: data.location, description: data.description, capacity: data.capacity };
  const zone = workspaceZone(actor);
  const when = `${formatDayTime(times.startsAt, zone)} ${formatTimeZoneName(times.startsAt, zone)}`;

  const { event, results } = await prisma.$transaction(
    async (tx) => {
      const results: Notify = [];
      if (!existing) {
        const event = await tx.communityEvent.create({ data: { ...fields, workspaceId: actor.workspace.id, createdById: actor.user.id } });
        results.push(
          await dispatch(
            actor.workspace.id,
            {
              type: "event.created",
              title: `${EVENT_KIND_LABELS[data.kind]}: ${data.title}`.slice(0, 150),
              body: [when, data.location].filter(Boolean).join(" · "),
              url: eventUrl(actor.workspace.slug, event.id),
              actorId: actor.user.id,
              resource: { type: "community_event", id: event.id },
              data: { eventId: event.id, startsAt: event.startsAt.toISOString() },
            },
            { tx, now },
          ),
        );
        await recordActivity(
          { workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "created", entityType: "community_event", entityId: event.id, summary: `${EVENT_KIND_LABELS[data.kind]}: ${data.title}` },
          tx,
        );
        await indexEvent(tx, actor.workspace, event);
        await recordAuditEvent({ client: tx, action: "community_event.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "CommunityEvent", targetId: event.id, metadata: { kind: data.kind, capacity: data.capacity } });
        return { event, results };
      }

      await lockEvent(tx, actor.workspace.id, existing.id);
      const event = await tx.communityEvent.update({ where: { id: existing.id }, data: fields });
      const changed =
        existing.title !== event.title ||
        existing.startsAt.getTime() !== event.startsAt.getTime() ||
        (existing.endsAt?.getTime() ?? null) !== (event.endsAt?.getTime() ?? null) ||
        existing.location !== event.location;
      if (changed) {
        const attendees = await tx.eventAttendee.findMany({ where: { eventId: event.id, status: { in: ["GOING", "MAYBE", "WAITLIST"] } }, select: { userId: true } });
        results.push(
          await dispatch(
            actor.workspace.id,
            {
              type: "event.changed",
              title: `${event.title} changed`.slice(0, 150),
              body: [when, event.location].filter(Boolean).join(" · "),
              url: eventUrl(actor.workspace.slug, event.id),
              actorId: actor.user.id,
              recipients: attendees.map((row) => row.userId),
              resource: { type: "community_event", id: event.id },
              data: { eventId: event.id, startsAt: event.startsAt.toISOString() },
            },
            { tx, now },
          ),
        );
      }
      if (event.capacity === null || (existing.capacity !== null && event.capacity > existing.capacity)) {
        results.push(...(await promoteWaitlist(tx, actor.workspace, event, actor.user.id, now)));
      }
      await indexEvent(tx, actor.workspace, event);
      await recordAuditEvent({ client: tx, action: "community_event.updated", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "CommunityEvent", targetId: event.id, metadata: { rescheduled: changed, capacity: event.capacity } });
      return { event, results };
    },
    { timeout: 15_000 },
  );
  await settle(actor.workspace.id, event.id, results);
  return { ok: true, data: { id: event.id } };
}

export async function cancelEvent(actor: CommunityActor, id: string, now = new Date()): Promise<ActionResult> {
  const existing = await prisma.communityEvent.findFirst({ where: { id, workspaceId: actor.workspace.id }, select: { id: true, title: true, startsAt: true, cancelledAt: true, createdById: true } });
  if (!existing) return actionError("That event no longer exists.");
  if (!canEditEvent(actor.membership, existing, actor.user.id)) return actionError(NOT_ALLOWED);
  if (existing.cancelledAt) return { ok: true };
  const results = await prisma.$transaction(
    async (tx) => {
      await lockEvent(tx, actor.workspace.id, existing.id);
      await tx.communityEvent.update({ where: { id: existing.id }, data: { cancelledAt: now } });
      const attendees = await tx.eventAttendee.findMany({ where: { eventId: existing.id, status: { in: ["GOING", "MAYBE", "WAITLIST"] } }, select: { userId: true } });
      const zone = workspaceZone(actor);
      const result = await dispatch(
        actor.workspace.id,
        {
          type: "event.changed",
          title: `${existing.title} was cancelled`.slice(0, 150),
          body: `It was planned for ${formatDayTime(existing.startsAt, zone)} ${formatTimeZoneName(existing.startsAt, zone)}.`,
          url: eventUrl(actor.workspace.slug, existing.id),
          actorId: actor.user.id,
          recipients: attendees.map((row) => row.userId),
          resource: { type: "community_event", id: existing.id },
          data: { eventId: existing.id, startsAt: existing.startsAt.toISOString() },
        },
        { tx, now },
      );
      await removeSearchDocument("community_event", existing.id, tx);
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "cancelled", entityType: "community_event", entityId: existing.id, summary: `Cancelled ${existing.title}` }, tx);
      await recordAuditEvent({ client: tx, action: "community_event.cancelled", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "CommunityEvent", targetId: existing.id });
      return [result];
    },
    { timeout: 15_000 },
  );
  await settle(actor.workspace.id, existing.id, results);
  return { ok: true };
}

export type RsvpOutcome = { status: AttendanceStatus; waitlistPosition: number | null };

export async function respondToEvent(actor: CommunityActor, input: unknown, now = new Date()): Promise<ActionResult<RsvpOutcome>> {
  if (!canRsvp(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = rsvpInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { eventId, status: requested } = parsed.data;

  const outcome = await prisma.$transaction(
    async (tx) => {
      if (!(await lockEvent(tx, actor.workspace.id, eventId))) return { error: "That event no longer exists." } as const;
      const event = await tx.communityEvent.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, title: true, startsAt: true, capacity: true, cancelledAt: true } });
      if (event.cancelledAt) return { error: "This event was cancelled." } as const;
      if (event.startsAt.getTime() <= now.getTime()) return { error: "This event has already started, so replies are closed." } as const;

      const attendees = await attendeesOf(tx, event.id);
      const current = attendees.find((attendee) => attendee.userId === actor.user.id) ?? null;
      const next = resolveRsvp({ userId: actor.user.id, requested, capacity: event.capacity, attendees });
      if (current?.status !== next) {
        await tx.eventAttendee.upsert({
          where: { eventId_userId: { eventId: event.id, userId: actor.user.id } },
          create: { eventId: event.id, userId: actor.user.id, status: next, respondedAt: now },
          update: { status: next, respondedAt: now },
        });
      }
      const results = current?.status === "GOING" && next !== "GOING" ? await promoteWaitlist(tx, actor.workspace, event, actor.user.id, now) : [];
      const position = waitlistPosition(await attendeesOf(tx, event.id), actor.user.id);
      return { status: next, position, results, changed: current?.status !== next } as const;
    },
    { timeout: 15_000 },
  );
  if ("error" in outcome) return actionError(outcome.error!);
  if (outcome.changed) await settle(actor.workspace.id, eventId, outcome.results);
  return { ok: true, data: { status: outcome.status, waitlistPosition: outcome.position } };
}

/** Scheduler: day-before and hour-before reminders to people going (or maybe going). */
export async function sendDueReminders(now: Date) {
  const horizon = Math.max(...REMINDERS.map((reminder) => reminder.beforeMs));
  const events = await prisma.communityEvent.findMany({
    where: { cancelledAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + horizon) }, workspace: { archivedAt: null } },
    orderBy: { startsAt: "asc" },
    take: 200,
    select: { id: true, title: true, location: true, startsAt: true, createdAt: true, cancelledAt: true, workspace: { select: { id: true, slug: true, timezone: true } } },
  });
  const pending = events.flatMap((event) => dueReminders(event, now).map((kind) => ({ event, kind, key: reminderDedupeKey(event.id, kind, event.startsAt) })));
  if (pending.length === 0) return 0;
  const sent = new Set(
    (await prisma.notificationEventRecord.findMany({ where: { type: "event.reminder", dedupeKey: { in: pending.map((item) => item.key) } }, select: { dedupeKey: true } })).map((row) => row.dedupeKey),
  );
  let count = 0;
  for (const { event, kind, key } of pending) {
    if (sent.has(key)) continue;
    const result = await prisma.$transaction(
      async (tx) => {
        if (!(await tryTransactionLock(tx, key))) return null;
        const already = await tx.notificationEventRecord.findFirst({ where: { workspaceId: event.workspace.id, type: "event.reminder", dedupeKey: key }, select: { id: true } });
        if (already) return null;
        const attendees = await tx.eventAttendee.findMany({ where: { eventId: event.id, status: { in: ["GOING", "MAYBE"] } }, select: { userId: true } });
        const zone = safeTimeZone(event.workspace.timezone);
        const label = REMINDERS.find((reminder) => reminder.kind === kind)!.label;
        return dispatch(
          event.workspace.id,
          {
            type: "event.reminder",
            title: `${event.title} starts ${label}`.slice(0, 150),
            body: [`${formatDayTime(event.startsAt, zone)} ${formatTimeZoneName(event.startsAt, zone)}`, event.location].filter(Boolean).join(" · "),
            url: eventUrl(event.workspace.slug, event.id),
            actorId: null,
            recipients: attendees.map((row) => row.userId),
            resource: { type: "community_event", id: event.id },
            dedupeKey: key,
            data: { eventId: event.id, startsAt: event.startsAt.toISOString() },
          },
          { tx, now },
        );
      },
      { timeout: 15_000 },
    );
    if (result) {
      count += 1;
      await result.afterCommit();
    }
  }
  return count;
}

