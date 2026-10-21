import "server-only";

import { escapeHtml } from "@/lib/email/templates";
import type { Tx } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { enqueueEmail } from "@/lib/outbox";
import type { Actor } from "@/lib/meetings/core";
import { meetingRecipients } from "@/lib/meetings/service";
import { meetingInvitation } from "../ics";

export async function notifyMeeting(
  tx: Tx,
  actor: Actor,
  meetingId: string,
  type:
    | "meeting.scheduled"
    | "meeting.updated"
    | "meeting.cancelled"
    | "meeting.reminder",
) {
  const meeting = await tx.meeting.findFirstOrThrow({
    where: { id: meetingId, workspaceId: actor.workspace.id },
    include: { attendees: { include: { user: true } } },
  });
  const visible = await meetingRecipients(meeting, tx);
  const attendees = meeting.attendees.filter(
    (a) =>
      a.userId &&
      visible.includes(a.userId) &&
      (type !== "meeting.reminder" || a.rsvp !== "NO"),
  );
  const notification = await dispatch(
    actor.workspace.id,
    {
      type,
      title:
        `${type === "meeting.cancelled" ? "Cancelled" : type === "meeting.reminder" ? "Upcoming" : type === "meeting.updated" ? "Updated" : "Scheduled"}: ${meeting.title}`.slice(
          0,
          150,
        ),
      actorId: type === "meeting.reminder" ? null : actor.user.id,
      recipients: attendees.map((a) => a.userId!),
      useWorkspaceRules: false,
      scope: { meetingId },
      resource: { type: "meeting", id: meetingId },
      url: `/w/${actor.workspace.slug}/meetings/${meetingId}`,
      dedupeKey: `${type}:${meetingId}:${meeting.sequence}`,
      data: { meetingId, startsAt: meeting.startsAt.toISOString() },
    },
    { tx },
  );
  if (type !== "meeting.reminder") {
    const organizer = await tx.user.findFirst({
      where: { id: meeting.createdById ?? actor.user.id },
      select: { email: true },
    });
    const emails = [
      ...new Set([
        ...attendees.flatMap((a) => (a.user ? [a.user.email] : [])),
        ...meeting.externalEmails,
      ]),
    ];
    for (const to of emails) {
      const cancelled = type === "meeting.cancelled";
      await enqueueEmail(tx, {
        workspaceId: actor.workspace.id,
        to,
        subject: `${cancelled ? "Cancelled: " : ""}${meeting.title}`.slice(
          0,
          300,
        ),
        html: "<p>A Space Works team meeting invitation is attached.</p>" + (meeting.videoUrl ? `<p><a href="${escapeHtml(meeting.videoUrl)}">Join ${meeting.videoUrl.startsWith("https://meet.google.com/") ? "Google Meet" : "video meeting"}</a><br>${escapeHtml(meeting.videoUrl)}</p>` : meeting.meetPending ? "<p>Meet link being created…</p>" : ""),
        text: `${meeting.title}\n${meeting.startsAt.toISOString()}\n${meeting.location ?? ""}\n${meeting.videoUrl ?? ""}`,
        calendarInvite: {
          method: cancelled ? "CANCEL" : "REQUEST",
          content: meetingInvitation({
            ...meeting,
            endsAt:
              meeting.endsAt ?? new Date(meeting.startsAt.getTime() + 3600000),
            organizer: organizer?.email ?? to,
            attendee: to,
            cancelled,
          }),
        },
      });
    }
  }
  return notification;
}
