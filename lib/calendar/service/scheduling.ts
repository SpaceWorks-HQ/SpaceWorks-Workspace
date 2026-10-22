import "server-only";

import { templateWhere } from "@/lib/templates/service";
import { z } from "zod";
import { enqueueEmail } from "@/lib/outbox";
import { canScheduleMeetings } from "@/lib/roles";
import { type Actor, assertActor, ensure, serial, changed, checkTeam, checkMembers } from "@/lib/meetings/core";
import { meetingWhere, meetingRecipients, managesMeeting } from "@/lib/meetings/service";
import { visibleProjectWhere } from "@/lib/tasks/access";
import { isValidTimeZone } from "@/lib/timeZone";
import { expandRecurrence, recurrenceRule } from "../algorithms";
import { meetingInvitation } from "../ics";
import { notifyMeeting } from "./notifications";

const optionalId = z.string().max(100).nullish();
const scheduling = z.object({
  id: optionalId,
  title: z.string().trim().min(1).max(200),
  startsAt: z.coerce.date(),
  duration: z.coerce.number().int().min(5).max(1440),
  timezone: z.string().refine(isValidTimeZone),
  repeat: z
    .enum(["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"])
    .default("NONE"),
  until: z.coerce.date(),
  attendeeIds: z.array(z.string().min(1).max(100)).max(200).default([]),
  externalEmails: z.array(z.email().max(254)).max(30).default([]),
  location: z.string().trim().max(500).default(""),
  videoUrl: z
    .union([
      z.literal(""),
      z.url().refine((v) => new URL(v).protocol === "https:"),
    ])
    .default(""),
  teamId: optionalId,
  projectId: optionalId,
  templateId: optionalId,
  visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE"),
  reminderMinutes: z.coerce.number().int().min(0).max(10080).default(30),
});

export async function saveMeeting(actor: Actor, input: unknown) {
  const data = scheduling.parse(input);
  ensure(canScheduleMeetings(actor.membership));
  ensure(
    data.until >= data.startsAt &&
      data.until.getTime() - data.startsAt.getTime() <= 366 * 86400000,
    "Choose a recurrence end within one year of the start.",
  );
  const results = await serial(async (tx) => {
    await assertActor(actor, tx);
    await checkTeam(actor, data.teamId, tx);
    ensure(data.visibility !== "TEAM" || data.teamId, "Choose a team.");
    const project = data.projectId
      ? await tx.project.findFirst({
          where: {
            AND: [
              await visibleProjectWhere(actor, tx),
              { id: data.projectId, status: { not: "ARCHIVED" } },
            ],
          },
        })
      : null;
    if (data.projectId) ensure(project);
    ensure(
      !project?.teamId || project.teamId === data.teamId,
      "Use the project's team for this meeting.",
    );
    const people = [...new Set([actor.user.id, ...data.attendeeIds])];
    await checkMembers(actor, people, tx);
    const viewers = await meetingRecipients(
      {
        workspaceId: actor.workspace.id,
        teamId: data.teamId ?? null,
        visibility: data.visibility,
        createdById: actor.user.id,
        facilitatorId: actor.user.id,
      },
      tx,
    );
    ensure(
      people.every((p) => viewers.includes(p)),
      "Choose attendees who can open this meeting.",
    );
    const template = data.templateId
      ? await tx.template.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: data.templateId,
            kind: "MEETING",
            ...(await templateWhere(actor, tx)),
          },
        })
      : null;
    if (data.templateId) ensure(template);
    ensure(
      !template ||
        template.scope === "WORKSPACE" ||
        (template.scope === "PRIVATE" && data.visibility === "PRIVATE") ||
        (template.scope === "TEAM" &&
          data.visibility === "TEAM" &&
          template.teamId === data.teamId),
      "Keep the agenda template's audience when scheduling this meeting.",
    );
    const topics =
      template &&
      template.content &&
      typeof template.content === "object" &&
      "agenda" in template.content
        ? z
            .array(z.string().min(1).max(200))
            .max(100)
            .parse(template.content.agenda)
        : [];
    const starts = data.id
      ? [data.startsAt]
      : expandRecurrence(data.startsAt, data.repeat, data.until, data.timezone);
    ensure(
      starts.length > 0 && starts.length <= 100,
      "Choose a series with 1–100 meetings.",
    );
    const notifications = [];
    let root = "";
    for (const startsAt of starts) {
      const endsAt = new Date(startsAt.getTime() + data.duration * 60000);
      const values = {
        title: data.title,
        startsAt,
        endsAt,
        location: data.location,
        videoUrl: data.videoUrl,
        teamId: data.teamId ?? null,
        projectId: data.projectId ?? null,
        timezone: data.timezone,
        externalEmails: [
          ...new Set(data.externalEmails.map((e) => e.toLowerCase())),
        ],
        reminderMinutes: data.reminderMinutes,
        reminderSentAt: null,
      };
      let meeting;
      if (data.id) {
        const old = await tx.meeting.findFirst({
          where: { AND: [await meetingWhere(actor, tx), { id: data.id }] },
        });
        ensure(old && managesMeeting(actor, old) && old.status !== "CANCELLED");
        // Scope stays fixed when editing an occurrence.
        ensure(
          old.teamId === values.teamId && old.visibility === data.visibility,
          "Keep this occurrence's original audience.",
        );
        const removed = await tx.meetingAttendee.findMany({
          where: {
            meetingId: old.id,
            userId: { notIn: people },
            meeting: { workspaceId: actor.workspace.id },
          },
          include: { user: true },
        });
        const removedEmails = old.externalEmails.filter(
          (email) => !values.externalEmails.includes(email),
        );
        const organizerEmail = (
          await tx.user.findUniqueOrThrow({
            where: { id: old.createdById ?? actor.user.id },
          })
        ).email;
        for (const email of removedEmails)
          await enqueueEmail(tx, {
            workspaceId: actor.workspace.id,
            to: email,
            subject: `Cancelled: ${old.title}`.slice(0, 300),
            html: "<p>Your meeting invitation has been cancelled.</p>",
            text: old.title,
            calendarInvite: {
              method: "CANCEL",
              content: meetingInvitation({
                ...old,
                endsAt: old.endsAt ?? endsAt,
                sequence: old.sequence + 1,
                cancelled: true,
                organizer: organizerEmail,
                attendee: email,
              }),
            },
          });
        for (const attendee of removed)
          if (attendee.user)
            await enqueueEmail(tx, {
              workspaceId: actor.workspace.id,
              to: attendee.user.email,
              subject: `Cancelled: ${old.title}`.slice(0, 300),
              html: "<p>Your meeting invitation has been cancelled.</p>",
              text: old.title,
              calendarInvite: {
                method: "CANCEL",
                content: meetingInvitation({
                  ...old,
                  endsAt: old.endsAt ?? endsAt,
                  sequence: old.sequence + 1,
                  cancelled: true,
                  organizer: (
                    await tx.user.findUniqueOrThrow({
                      where: { id: old.createdById ?? actor.user.id },
                    })
                  ).email,
                  attendee: attendee.user.email,
                }),
              },
            });
        await tx.meetingAttendee.deleteMany({
          where: {
            meetingId: old.id,
            userId: { notIn: people },
            meeting: { workspaceId: actor.workspace.id },
          },
        });
        for (const userId of people)
          await tx.meetingAttendee.upsert({
            where: { meetingId_userId: { meetingId: old.id, userId } },
            create: { meetingId: old.id, userId },
            update: {},
          });
        meeting = await tx.meeting.update({
          where: { id: old.id, workspaceId: actor.workspace.id },
          data: { ...values, sequence: { increment: 1 } },
        });
      } else
        meeting = await tx.meeting.create({
          data: {
            ...values,
            workspaceId: actor.workspace.id,
            visibility: data.visibility,
            createdById: actor.user.id,
            facilitatorId: actor.user.id,
            seriesId: root || null,
            rrule: root ? null : recurrenceRule(data.repeat, starts.length),
            attendees: { create: people.map((userId) => ({ userId })) },
            agenda: {
              create: topics.map((title, sortOrder) => ({
                title,
                sortOrder,
                durationMin: 10,
              })),
            },
          },
        });
      if (!root) root = meeting.id;
      await changed(
        tx,
        actor,
        "meeting",
        meeting.id,
        meeting.title,
        `meetings/${meeting.id}`,
        data.id ? "updated" : "created",
        "",
        {
          visibility: meeting.visibility,
          teamId: meeting.teamId,
          ownerId: meeting.createdById,
          projectId: meeting.projectId,
        },
      );
      notifications.push(
        await notifyMeeting(
          tx,
          actor,
          meeting.id,
          data.id ? "meeting.updated" : "meeting.scheduled",
        ),
      );
    }
    if (starts.length > 1)
      await tx.meeting.updateMany({
        where: { workspaceId: actor.workspace.id, id: root },
        data: { seriesId: root },
      });
    return { id: root, notifications };
  });
  await Promise.all(results.notifications.map((n) => n.afterCommit()));
  return { id: results.id };
}
