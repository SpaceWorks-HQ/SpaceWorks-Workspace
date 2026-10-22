import "server-only";
import { canRecordDecisions } from "@/lib/roles";
import { visibleDocsWhere } from "@/lib/docs/service";
import { recordAuditEvent } from "@/lib/audit";
import { type Actor, assertActor, ensure, changed, serial, checkMembers } from "../core";
import { meetingCommand } from "./validation";
import { meetingWhere, managesMeeting, meetingRecipients } from "./access";
import { addAction } from "./actionItems";
import { createMeeting } from "./create";
import { publishMeeting } from "./publish";

export async function mutateMeeting(actor: Actor, input: unknown) {
  const data = meetingCommand.parse(input);
  const calendarNotifications: Awaited<ReturnType<typeof import("@/lib/calendar/service")["notifyMeeting"]>>[] = [];
  const result = await serial(async (tx) => {
    await assertActor(actor, tx, data.op !== "rsvp");
    if (data.op === "create") {
      return createMeeting(tx, actor, data, calendarNotifications);
    }
    const meeting = await tx.meeting.findFirst({
      where: { ...(await meetingWhere(actor, tx)), id: data.meetingId },
    });
    ensure(meeting);
    if (data.op === "rsvp") {
      ensure(meeting.status !== "CANCELLED", "This meeting was cancelled. Open the calendar for another date.");
      ensure(
        await tx.meetingAttendee.findFirst({
          where: {
            meetingId: meeting.id,
            userId: actor.user.id,
            meeting: { workspaceId: actor.workspace.id },
          },
        }),
        "Ask the facilitator to add you as an attendee.",
      );
      await tx.meetingAttendee.updateMany({
        where: {
          meetingId: meeting.id,
          userId: actor.user.id,
          meeting: { workspaceId: actor.workspace.id },
        },
        data: { rsvp: data.rsvp },
      });
      await tx.calendarMeetingSync.updateMany({ where: { workspaceId: actor.workspace.id, meetingId: meeting.id, userId: actor.user.id }, data: { sequence: -1 } });
      await recordAuditEvent({
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        action: "meeting.rsvp",
        targetType: "Meeting",
        targetId: meeting.id,
        client: tx,
      });
      return { id: meeting.id, notification: null };
    }
    if (data.op !== "agenda") ensure(managesMeeting(actor, meeting));
    if (data.op === "details") {
      ensure(
        data.endsAt > data.startsAt,
        "Choose an end time after the start.",
      );
      if (data.notesDocId)
        ensure(
          await tx.doc.findFirst({
            where: {
              ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
              id: data.notesDocId,
              visibility: "WORKSPACE",
              archivedAt: null,
            },
          }),
          "Choose a workspace document everyone at the meeting can read.",
        );
      await tx.meeting.updateMany({
        where: { workspaceId: actor.workspace.id, id: meeting.id },
        data: {
          title: data.title,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          location: data.location,
          notesDocId: data.notesDocId ?? null,
          status: data.status,
          sequence: { increment: 1 },
          reminderSentAt: null,
        },
      });
      calendarNotifications.push(await (await import("@/lib/calendar/service")).notifyMeeting(tx, actor, meeting.id, data.status === "CANCELLED" ? "meeting.cancelled" : "meeting.updated"));
    } else if (data.op === "agenda" || data.op === "agendaUpdate") {
      if (data.ownerId)
        await checkMembers(
          actor,
          [data.ownerId],
          tx,
          meeting.visibility === "TEAM" ? meeting.teamId : undefined,
        );
      if (data.op === "agenda") {
        const last = await tx.agendaItem.aggregate({
          where: {
            meetingId: meeting.id,
            meeting: { workspaceId: actor.workspace.id },
          },
          _max: { sortOrder: true },
        });
        await tx.agendaItem.create({
          data: {
            meetingId: meeting.id,
            title: data.title,
            ownerId: data.ownerId,
            durationMin: data.durationMin,
            notesMd: data.notesMd,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
        });
      } else {
        ensure(
          (
            await tx.agendaItem.updateMany({
              where: {
                meetingId: meeting.id,
                id: data.agendaId,
                meeting: { workspaceId: actor.workspace.id },
              },
              data: {
                title: data.title,
                ownerId: data.ownerId,
                durationMin: data.durationMin,
                notesMd: data.notesMd,
                status: data.status,
              },
            })
          ).count === 1,
        );
      }
    } else if (data.op === "reorder") {
      const items = await tx.agendaItem.findMany({
        where: {
          meetingId: meeting.id,
          meeting: { workspaceId: actor.workspace.id },
        },
        select: { id: true },
      });
      ensure(
        new Set(data.agendaIds).size === items.length &&
          data.agendaIds.length === items.length &&
          items.every((a) => data.agendaIds.includes(a.id)),
        "Reload the agenda before reordering.",
      );
      for (const [sortOrder, agendaId] of data.agendaIds.entries())
        await tx.agendaItem.updateMany({
          where: {
            meetingId: meeting.id,
            id: agendaId,
            meeting: { workspaceId: actor.workspace.id },
          },
          data: { sortOrder },
        });
    } else if (data.op === "decision") {
      ensure(
        canRecordDecisions(actor.membership) ||
          meeting.facilitatorId === actor.user.id,
      );
      if (data.ownerId)
        await checkMembers(
          actor,
          [data.ownerId],
          tx,
          meeting.visibility === "TEAM" ? meeting.teamId : undefined,
        );
      const decision = await tx.decision.create({
        data: {
          workspaceId: actor.workspace.id,
          meetingId: meeting.id,
          title: data.title,
          contextMd: data.contextMd,
          decisionMd: data.decisionMd,
          deciderIds: [data.ownerId ?? actor.user.id],
          teamId: meeting.teamId,
          visibility: meeting.visibility,
          createdById: meeting.createdById,
        },
      });
      await changed(
        tx,
        actor,
        "decision",
        decision.id,
        decision.title,
        `meetings/decisions`,
        "decided",
        `${data.contextMd}\n${data.decisionMd}`,
        {
          visibility: meeting.visibility,
          teamId: meeting.teamId,
          ownerId: meeting.createdById,
        },
      );
    } else if (data.op === "action") {
      const task = await addAction(tx, actor, meeting, data);
      return { id: meeting.id, notification: task.notification };
    } else if (data.op === "attendee" || data.op === "attendance") {
      await checkMembers(
        actor,
        [data.userId],
        tx,
        meeting.visibility === "TEAM" ? meeting.teamId : undefined,
      );
      ensure(
        (await meetingRecipients(meeting, tx)).includes(data.userId),
        "That member cannot open this meeting.",
      );
      if (data.op === "attendee")
        await tx.meetingAttendee.upsert({
          where: {
            meetingId_userId: { meetingId: meeting.id, userId: data.userId },
          },
          create: { meetingId: meeting.id, userId: data.userId },
          update: {},
        });
      else
        await tx.meetingAttendee.updateMany({
          where: {
            meetingId: meeting.id,
            userId: data.userId,
            meeting: { workspaceId: actor.workspace.id },
          },
          data: { attended: data.attended },
        });
    } else {
      return publishMeeting(tx, actor, meeting, data);
    }
    await changed(
      tx,
      actor,
      "meeting",
      meeting.id,
      meeting.title,
      `meetings/${meeting.id}`,
      data.op,
      "",
      {
        visibility: meeting.visibility,
        teamId: meeting.teamId,
        ownerId: meeting.createdById,
      },
    );
    return { id: meeting.id, notification: null };
  });
  await result.notification?.afterCommit();
  await Promise.all(calendarNotifications.map(n => n.afterCommit()));
  return { id: result.id };
}
