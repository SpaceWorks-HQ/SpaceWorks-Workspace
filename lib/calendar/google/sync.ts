import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getGoogleAccessToken } from "@/lib/integrations/google/tokens";
import { requestJson } from "@/lib/integrations/http";
import { type Actor, assertActor, ensure, serial, changed } from "@/lib/meetings/core";
import { calendarMeetingWhere } from "../access";
import { managesMeeting } from "@/lib/meetings/service";
import { notifyMeeting } from "../service";
import { API, memberGoogle, type GoogleEvent } from "./connection";
import { enqueueMeetLink, failMeetLink, meetUrl, pollMeetEvent, storeMeetLink } from "./meet-links";

/** A member's own copy only; organiser edits may update the source, other copies import RSVP only. */
export async function syncGoogle(actor: Actor, createMeetId?: string) {
  await assertActor(actor);
  const connection = await memberGoogle(actor.workspace.id, actor.user.id);
  ensure(connection, "Connect your Google account first.");
  const token = await getGoogleAccessToken(connection);
  ensure(token.ok, "Reconnect Google to sync meetings.");
  const headers = { Authorization: `Bearer ${token.token}` };
  const meetings = await prisma.meeting.findMany({
    where: {
      AND: [
        await calendarMeetingWhere(actor),
        {
          attendees: { some: { userId: actor.user.id } },
          startsAt: {
            gte: new Date(Date.now() - 60 * 86400000),
            lte: new Date(Date.now() + 400 * 86400000),
          },
        },
      ],
    },
    include: { attendees: { where: { userId: actor.user.id } } },
    orderBy: { startsAt: "asc" },
    take: 500,
  });
  const ownUser = await prisma.user.findUniqueOrThrow({
    where: { id: actor.user.id },
    select: { email: true },
  });
  let synced = 0,
    failed = 0;
  for (const meeting of meetings) {
    const key = {
      workspaceId: actor.workspace.id,
      meetingId: meeting.id,
      userId: actor.user.id,
    };
    const externalId = createHash("sha256")
      .update(`${key.workspaceId}:${key.meetingId}:${key.userId}`)
      .digest("hex");
    const binding = await prisma.calendarMeetingSync.upsert({
      where: { workspaceId_meetingId_userId: key },
      create: { ...key, connectionId: connection.id, externalId },
      update: { connectionId: connection.id },
    });
    const url = `${API}/calendars/primary/events/${externalId}`;
    const remote = await requestJson<GoogleEvent>(url, {
      headers,
      label: "Google Calendar",
    });
    if (!remote.ok && remote.status !== 404 && remote.status !== 410) {
      await prisma.calendarMeetingSync.update({
        where: { id: binding.id, workspaceId: key.workspaceId },
        data: {
          lastError: "Google Calendar could not be read. Try sync again.",
          lastSyncedAt: new Date(),
        },
      });
      failed++;
      continue;
    }
    const event = remote.ok ? remote.data : null;
    if (
      event &&
      binding.sequence === meeting.sequence &&
      binding.etag &&
      event.etag !== binding.etag
    ) {
      const rsvp = {
        accepted: "YES",
        declined: "NO",
        tentative: "MAYBE",
        needsAction: "PENDING",
      } as const;
      const response = event.attendees?.find((a) => a.self)?.responseStatus;
      if (response && response in rsvp)
        await prisma.meetingAttendee.updateMany({
          where: {
            meetingId: meeting.id,
            userId: actor.user.id,
            meeting: { workspaceId: key.workspaceId },
          },
          data: { rsvp: rsvp[response as keyof typeof rsvp] },
        });
      if (
        managesMeeting(actor, meeting) &&
        (event.status === "cancelled" ||
          event.summary !== meeting.title ||
          Date.parse(event.start?.dateTime ?? "") !==
            meeting.startsAt.getTime() ||
          Date.parse(event.end?.dateTime ?? "") !== meeting.endsAt?.getTime() ||
          (event.location ?? "") !== (meeting.location ?? "") ||
          (event.hangoutLink && event.hangoutLink !== meeting.videoUrl)) &&
        (event.status === "cancelled" ||
          (event.start?.dateTime && event.end?.dateTime))
      ) {
        const start = new Date(event.start?.dateTime ?? meeting.startsAt),
          end = new Date(
            event.end?.dateTime ?? meeting.endsAt ?? meeting.startsAt,
          );
        if (
          Number.isFinite(start.getTime()) &&
          end > start &&
          end.getTime() - start.getTime() <= 86400000
        ) {
          const notification = await serial(async (tx) => {
            await assertActor(actor, tx);
            const claim = await tx.meeting.updateMany({
              where: {
                id: meeting.id,
                workspaceId: key.workspaceId,
                sequence: binding.sequence,
                status: { not: "CANCELLED" },
              },
              data: {
                startsAt: start,
                endsAt: end,
                title: event.summary?.trim().slice(0, 200) || meeting.title,
                location: event.location?.slice(0, 500) ?? meeting.location,
                ...(event.hangoutLink?.startsWith("https://meet.google.com/")
                  ? { videoUrl: event.hangoutLink }
                  : {}),
                status:
                  event.status === "cancelled" ? "CANCELLED" : meeting.status,
                sequence: { increment: 1 },
                reminderSentAt: null,
              },
            });
            if (claim.count)
              await changed(
                tx,
                actor,
                "meeting",
                meeting.id,
                event.summary?.trim().slice(0, 200) || meeting.title,
                `meetings/${meeting.id}`,
                event.status === "cancelled" ? "cancelled" : "updated",
                "",
                {
                  visibility: meeting.visibility,
                  teamId: meeting.teamId,
                  projectId: meeting.projectId,
                  ownerId: meeting.createdById,
                },
              );
            return claim.count
              ? notifyMeeting(
                  tx,
                  actor,
                  meeting.id,
                  event.status === "cancelled"
                    ? "meeting.cancelled"
                    : "meeting.updated",
                )
              : null;
          });
          await notification?.afterCommit();
          if (notification) {
            await prisma.calendarMeetingSync.update({
              where: { id: binding.id, workspaceId: key.workspaceId },
              data: {
                sequence: meeting.sequence + 1,
                etag: event.etag,
                lastSyncedAt: new Date(),
                lastError: null,
              },
            });
            synced++;
            continue;
          }
        }
      }
    }
    if (
      event &&
      binding.sequence === meeting.sequence &&
      createMeetId !== meeting.id
    ) {
      await prisma.calendarMeetingSync.update({
        where: { id: binding.id, workspaceId: key.workspaceId },
        data: { etag: event.etag, lastSyncedAt: new Date(), lastError: null },
      });
      if (binding.meetPending) await enqueueMeetLink(binding.id).catch(() => undefined);
      synced++;
      continue;
    }
    if (!event && meeting.status === "CANCELLED") continue;
    const body = {
      ...(event ? {} : { id: externalId }),
      summary: meeting.title,
      start: { dateTime: meeting.startsAt.toISOString() },
      end: {
        dateTime: (
          meeting.endsAt ?? new Date(meeting.startsAt.getTime() + 3600000)
        ).toISOString(),
      },
      location: meeting.location ?? "",
      attendees: [
        {
          email: ownUser.email,
          responseStatus: (
            {
              YES: "accepted",
              NO: "declined",
              MAYBE: "tentative",
              PENDING: "needsAction",
            } as const
          )[meeting.attendees[0]?.rsvp ?? "PENDING"],
        },
      ],
      description:
        meeting.videoUrl ||
        `Space Works · /w/${actor.workspace.slug}/meetings/${meeting.id}`,
      status: meeting.status === "CANCELLED" ? "cancelled" : "confirmed",
      extendedProperties: { private: { spaceWorksMeetingId: meeting.id } },
      ...(createMeetId === meeting.id && managesMeeting(actor, meeting)
        ? {
            conferenceData: {
              createRequest: {
                requestId: externalId,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }
        : {}),
    };
    const requestingMeet = createMeetId === meeting.id && managesMeeting(actor, meeting);
    if (requestingMeet) {
      await prisma.$transaction([
        prisma.calendarMeetingSync.update({ where: { id: binding.id, workspaceId: key.workspaceId }, data: { meetPending: true, meetRequestedAt: new Date() } }),
        prisma.meeting.updateMany({ where: { id: meeting.id, workspaceId: key.workspaceId }, data: { meetPending: true } }),
      ]);
    }
    const response = await requestJson<GoogleEvent>(
      `${event ? url : `${API}/calendars/primary/events`}?conferenceDataVersion=1&sendUpdates=none`,
      {
        method: event ? "PATCH" : "POST",
        headers: {
          ...headers,
          ...(event?.etag ? { "If-Match": event.etag } : {}),
        },
        label: "Google Calendar",
        body,
      },
    );
    await prisma.calendarMeetingSync.update({
      where: { id: binding.id, workspaceId: key.workspaceId },
      data: response.ok
        ? {
            sequence: meeting.sequence,
            etag: response.data.etag,
            lastSyncedAt: new Date(),
            lastError: null,
          }
        : {
            lastError: "Google Calendar could not be updated. Try sync again.",
            lastSyncedAt: new Date(),
          },
    });
    if (response.ok) {
      synced++;
      if (requestingMeet || binding.meetPending) {
        const ready = await pollMeetEvent(async () => {
          const result = await requestJson<GoogleEvent>(url, { headers, label: "Google Calendar", timeoutMs: 1200 });
          return result.ok ? result.data : null;
        }, response.data);
        if (ready?.conferenceData?.createRequest?.status?.statusCode === "failure") { failed++; await failMeetLink(binding.id); }
        else if (ready && meetUrl(ready)) await storeMeetLink(binding.id, ready);
        else await enqueueMeetLink(binding.id).catch(() => undefined);
      } else if (meetUrl(response.data) && managesMeeting(actor, meeting)) await storeMeetLink(binding.id, response.data);
    } else {
      failed++;
      if (requestingMeet) await failMeetLink(binding.id);
    }
  }
  return { synced, failed };
}
