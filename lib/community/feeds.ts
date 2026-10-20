import "server-only";

import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { visibleTaskWhere } from "@/lib/tasks/access";
import { taskUrl } from "@/lib/tasks/links";
import { safeTimeZone } from "@/lib/timeZone";
import { canSubscribeToCalendar } from "@/lib/community/access";
import type { CommunityActor } from "@/lib/community/context";
import { eventUrl } from "@/lib/community/events";
import { buildCalendar, type IcsEntry } from "@/lib/community/ics";
import { dayKey, effectiveEnd } from "@/lib/community/schedule";
import { EVENT_KIND_LABELS, feedScopeSchema, type FeedScope } from "@/lib/community/validation";

/**
 * Private calendar subscriptions. Each member can hold one active token per
 * scope:
 * - CALENDAR: every community event in the workspace.
 * - PERSONAL: events they replied to, their meetings, their rota shifts and
 *   the due dates of tasks assigned to them.
 * Only a SHA-256 of the token is stored; the URL is shown once. Revoking (or
 * regenerating) breaks the old URL at once, and the feed also stops when the
 * member leaves, is suspended or the workspace is archived.
 */

const DAY = 24 * 60 * 60 * 1000;
const PAST_WINDOW = 60 * DAY;
const FUTURE_WINDOW = 400 * DAY;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function baseUrl() {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
}

export function feedUrls(token: string, base = baseUrl()) {
  const https = `${base}/ics/${token}.ics`;
  return { url: https, webcalUrl: https.replace(/^https?:\/\//, "webcal://") };
}

export async function listFeeds(actor: CommunityActor) {
  const rows = await prisma.calendarFeedToken.findMany({
    where: { workspaceId: actor.workspace.id, userId: actor.user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { scope: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.scope as FeedScope, row.createdAt] as const));
}

/** Create (or regenerate) a feed URL. The raw token is returned once and never stored. */
export async function createFeed(actor: CommunityActor, input: unknown, now = new Date()): Promise<ActionResult<{ url: string; webcalUrl: string }>> {
  if (!canSubscribeToCalendar(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = feedScopeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const token = randomToken(32);
  await prisma.$transaction(async (tx) => {
    const revoked = await tx.calendarFeedToken.updateMany({
      where: { workspaceId: actor.workspace.id, userId: actor.user.id, scope: parsed.data.scope, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.calendarFeedToken.create({ data: { workspaceId: actor.workspace.id, userId: actor.user.id, scope: parsed.data.scope, tokenHash: sha256Hex(token) } });
    await recordAuditEvent({
      client: tx,
      action: revoked.count > 0 ? "calendar_feed.regenerated" : "calendar_feed.created",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: "CalendarFeedToken",
      metadata: { scope: parsed.data.scope },
    });
  });
  return { ok: true, data: feedUrls(token) };
}

export async function revokeFeed(actor: CommunityActor, input: unknown, now = new Date()): Promise<ActionResult> {
  if (!canSubscribeToCalendar(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = feedScopeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const revoked = await prisma.calendarFeedToken.updateMany({
    where: { workspaceId: actor.workspace.id, userId: actor.user.id, scope: parsed.data.scope, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count > 0) {
    await recordAuditEvent({ action: "calendar_feed.revoked", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "CalendarFeedToken", metadata: { scope: parsed.data.scope } });
  }
  return { ok: true };
}

/** The member and workspace a raw feed token stands for, or null (unknown, revoked, or access ended). */
export async function resolveFeedToken(raw: string) {
  if (!TOKEN_PATTERN.test(raw)) return null;
  const token = await prisma.calendarFeedToken.findUnique({
    where: { tokenHash: sha256Hex(raw) },
    select: { scope: true, revokedAt: true, userId: true, workspace: { select: { id: true, slug: true, name: true, timezone: true, archivedAt: true } } },
  });
  if (!token || token.revokedAt || !token.userId || token.workspace.archivedAt) return null;
  if (token.scope !== "PERSONAL" && token.scope !== "CALENDAR") return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: token.userId, workspaceId: token.workspace.id } },
    select: { status: true, role: true, user: { select: { disabledAt: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.user.disabledAt) return null;
  return { scope: token.scope as FeedScope, userId: token.userId, role: membership.role, workspace: token.workspace };
}

type EventRow = { id: string; title: string; description: string | null; location: string | null; kind: keyof typeof EVENT_KIND_LABELS; startsAt: Date; endsAt: Date | null; cancelledAt: Date | null; updatedAt: Date };

/** The iCalendar entry for one community event (shared by the feed and the per-event download). */
export function eventEntry(event: EventRow, workspaceSlug: string, reply: "GOING" | "MAYBE" | "WAITLIST" | null = null, base = baseUrl()): IcsEntry {
  const url = `${base}${eventUrl(workspaceSlug, event.id)}`;
  const status = event.cancelledAt ? "CANCELLED" : reply === "MAYBE" || reply === "WAITLIST" ? "TENTATIVE" : "CONFIRMED";
  return {
    uid: `community-event-${event.id}@spaceworks-workspace`,
    summary: `${event.cancelledAt ? "Cancelled: " : ""}${event.title}${reply === "WAITLIST" ? " (waitlist)" : ""}`,
    description: [event.description, `${EVENT_KIND_LABELS[event.kind]} · ${url}`].filter(Boolean).join("\n\n"),
    location: event.location,
    url,
    status,
    categories: [EVENT_KIND_LABELS[event.kind]],
    lastModified: event.updatedAt,
    start: event.startsAt,
    end: effectiveEnd(event.startsAt, event.endsAt),
  };
}

const eventSelect = { id: true, title: true, description: true, location: true, kind: true, startsAt: true, endsAt: true, cancelledAt: true, updatedAt: true } as const;

/** Build the feed body for a resolved token. */
export async function buildFeed(feed: NonNullable<Awaited<ReturnType<typeof resolveFeedToken>>>, now = new Date()): Promise<string> {
  const zone = safeTimeZone(feed.workspace.timezone);
  const window = { gte: new Date(now.getTime() - PAST_WINDOW), lte: new Date(now.getTime() + FUTURE_WINDOW) };
  const base = baseUrl();
  const entries: IcsEntry[] = [];

  if (feed.scope === "CALENDAR") {
    const events = await prisma.communityEvent.findMany({ where: { workspaceId: feed.workspace.id, startsAt: window }, orderBy: { startsAt: "asc" }, take: 1000, select: eventSelect });
    entries.push(...events.map((event) => eventEntry(event, feed.workspace.slug, null, base)));
  } else {
    const [replies, meetings, shifts, tasks] = await Promise.all([
      prisma.eventAttendee.findMany({
        where: { userId: feed.userId, status: { in: ["GOING", "MAYBE", "WAITLIST"] }, event: { workspaceId: feed.workspace.id, startsAt: window } },
        take: 500,
        select: { status: true, event: { select: eventSelect } },
      }),
      prisma.meetingAttendee.findMany({
        where: { userId: feed.userId, rsvp: { not: "NO" }, meeting: { workspaceId: feed.workspace.id, startsAt: window } },
        take: 500,
        select: { rsvp: true, meeting: { select: { id: true, title: true, startsAt: true, endsAt: true, location: true, status: true, updatedAt: true } } },
      }),
      prisma.shiftAssignment.findMany({
        where: { userId: feed.userId, status: { in: ["CONFIRMED", "WAITLIST", "SWAP_REQUESTED"] }, shift: { workspaceId: feed.workspace.id, startsAt: window } },
        take: 500,
        select: { status: true, shift: { select: { id: true, startsAt: true, endsAt: true, location: true, notes: true, shiftType: { select: { name: true } } } } },
      }),
      prisma.task.findMany({
        where: { AND: [await visibleTaskWhere({ user: { id: feed.userId, name: null }, workspace: feed.workspace, membership: { role: feed.role } }), { archivedAt: null, completedAt: null, dueAt: window, assignees: { some: { userId: feed.userId } }, OR: [{ projectId: null }, { project: { status: { not: "ARCHIVED" } } }] }] },
        take: 500,
        select: { id: true, number: true, title: true, dueAt: true, updatedAt: true, project: { select: { key: true } } },
      }),
    ]);
    for (const reply of replies) entries.push(eventEntry(reply.event, feed.workspace.slug, reply.status as "GOING" | "MAYBE" | "WAITLIST", base));
    for (const { meeting, rsvp } of meetings) {
      const url = `${base}/w/${feed.workspace.slug}/meetings/${meeting.id}`;
      entries.push({
        uid: `meeting-${meeting.id}@spaceworks-workspace`,
        summary: `${meeting.status === "CANCELLED" ? "Cancelled: " : ""}${meeting.title}`,
        description: `Meeting · ${url}`,
        location: meeting.location,
        url,
        status: meeting.status === "CANCELLED" ? "CANCELLED" : rsvp === "YES" ? "CONFIRMED" : "TENTATIVE",
        lastModified: meeting.updatedAt,
        start: meeting.startsAt,
        end: effectiveEnd(meeting.startsAt, meeting.endsAt),
      });
    }
    for (const { shift, status } of shifts) {
      const url = `${base}/w/${feed.workspace.slug}/rota`;
      entries.push({
        uid: `shift-${shift.id}@spaceworks-workspace`,
        summary: `${shift.shiftType.name} shift${status === "WAITLIST" ? " (waitlist)" : ""}`,
        description: [shift.notes, `Rota · ${url}`].filter(Boolean).join("\n\n"),
        location: shift.location,
        url,
        status: status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE",
        start: shift.startsAt,
        end: effectiveEnd(shift.startsAt, shift.endsAt),
      });
    }
    for (const task of tasks) {
      const ref = task.project ? `${task.project.key}-${task.number}` : `#${task.number}`;
      const url = `${base}${taskUrl(feed.workspace.slug, task.project?.key, task.number)}`;
      entries.push({
        uid: `task-due-${task.id}@spaceworks-workspace`,
        summary: `Due: ${ref} ${task.title}`,
        description: `Task due · ${url}`,
        url,
        lastModified: task.updatedAt,
        allDay: dayKey(task.dueAt!, zone),
      });
    }
  }

  return buildCalendar({
    name: feed.scope === "CALENDAR" ? `${feed.workspace.name} community` : `${feed.workspace.name} · my calendar`,
    description: feed.scope === "CALENDAR" ? "Build nights, meetups and workshops." : "Events you replied to, meetings, shifts and task due dates.",
    timeZone: zone,
    entries,
    now,
  });
}
