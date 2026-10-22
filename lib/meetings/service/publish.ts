import "server-only";
import type { Meeting } from "@prisma/client";
import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { setScopedDestinations } from "@/lib/notify/scopedRules";
import { type Actor, ensure, changed } from "../core";
import { pickDestinations } from "../destinations";
import { meetingRecipients } from "./access";
import type { meetingCommand } from "./validation";

export async function publishMeeting(
  tx: Tx,
  actor: Actor,
  meeting: Meeting,
  data: Extract<z.infer<typeof meetingCommand>, { op: "publish" }>,
) {
  ensure(
    !meeting.summaryPublishedAt,
    "These notes have already been sent. Edit the linked document to keep them current.",
  );
  ensure(
    (meeting.visibility === "WORKSPACE" && !meeting.teamId) ||
      data.destinationIds.length === 0,
    "Restricted meeting notes can only be sent to attendees in the workspace.",
  );
  const destinationIds = await pickDestinations(
    actor,
    data.destinationIds,
    tx,
  );
  await setScopedDestinations(tx, {
    workspaceId: actor.workspace.id,
    scopeType: "MEETING",
    scopeId: meeting.id,
    destinationIds,
    actorId: actor.user.id,
    eventTypes: ["meeting.summary_published"],
  });
  await tx.meeting.updateMany({
    where: {
      workspaceId: actor.workspace.id,
      id: meeting.id,
      summaryPublishedAt: null,
    },
    data: { summaryPublishedAt: new Date() },
  });
  const attendees = await tx.meetingAttendee.findMany({
    where: {
      meetingId: meeting.id,
      meeting: { workspaceId: actor.workspace.id },
      rsvp: { not: "NO" },
    },
    select: { userId: true },
  });
  const viewers = await meetingRecipients(meeting, tx);
  const notification = await dispatch(
    actor.workspace.id,
    {
      type: "meeting.summary_published",
      title: `Notes ready: ${meeting.title}`.slice(0, 150),
      body: "Read the notes, decisions and action items in the meeting.",
      url: `/w/${actor.workspace.slug}/meetings/${meeting.id}`,
      actorId: actor.user.id,
      recipients: attendees
        .map((a) => a.userId)
        .filter((u): u is string => !!u && viewers.includes(u)),
      scope: { meetingId: meeting.id },
      useWorkspaceRules: false,
      resource: { type: "meeting", id: meeting.id },
      data: { meetingId: meeting.id },
    },
    { tx },
  );
  await changed(
    tx,
    actor,
    "meeting",
    meeting.id,
    meeting.title,
    `meetings/${meeting.id}`,
    "published",
    "",
    {
      visibility: meeting.visibility,
      teamId: meeting.teamId,
      ownerId: meeting.createdById,
    },
  );
  return { id: meeting.id, notification };
}
