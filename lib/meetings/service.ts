import "server-only";
import { z } from "zod";
import type { Meeting, Prisma } from "@prisma/client";
import { prisma, type DbClient, type Tx } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { setScopedDestinations } from "@/lib/notify/scopedRules";
import { canRecordDecisions } from "@/lib/roles";
import { visibleProjectWhere, assignableMembers } from "@/lib/tasks/access";
import { visibleDocsWhere } from "@/lib/docs/service";
import { nextWorkspaceSequence } from "@/lib/counters";
import { recordAuditEvent } from "@/lib/audit";
import {
  type Actor,
  assertActor,
  ensure,
  id,
  optionalId,
  title,
  text,
  date,
  changed,
  serial,
  visibilityWhere,
  checkMembers,
  checkTeam,
  admin,
} from "./core";
import { expandRecurrence } from "@/lib/calendar/algorithms";
import { templateWhere } from "@/lib/templates/service";
import { pickDestinations } from "./destinations";

export async function meetingWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.MeetingWhereInput> {
  return {
    workspaceId: actor.workspace.id,
    ...(await visibilityWhere(actor, client)),
  };
}
export async function decisionWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.DecisionWhereInput> {
  return {
    workspaceId: actor.workspace.id,
    ...(await visibilityWhere(actor, client)),
    OR: [{ meetingId: null }, { meeting: await meetingWhere(actor, client) }],
  };
}
export const managesMeeting = (
  actor: Actor,
  meeting: Pick<Meeting, "createdById" | "facilitatorId">,
) =>
  admin(actor) ||
  meeting.createdById === actor.user.id ||
  meeting.facilitatorId === actor.user.id;

export const meetingCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    title,
    startsAt: date,
    endsAt: date,
    location: z.string().trim().max(500).default(""),
    teamId: optionalId,
    visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE"),
    facilitatorId: optionalId,
    attendeeIds: z.array(id).max(200).default([]),
    repeat: z
      .enum(["NONE", "WEEKLY", "FORTNIGHTLY", "MONTHLY"])
      .default("NONE"),
    occurrences: z.coerce.number().int().min(1).max(24).default(1),
    templateId: optionalId,
  }),
  z.object({
    op: z.literal("details"),
    meetingId: id,
    title,
    startsAt: date,
    endsAt: date,
    location: z.string().trim().max(500).default(""),
    notesDocId: optionalId,
    status: z.enum(["SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"]),
  }),
  z.object({
    op: z.literal("agenda"),
    meetingId: id,
    title,
    ownerId: optionalId,
    durationMin: z.coerce.number().int().min(1).max(480).default(10),
    notesMd: text,
  }),
  z.object({
    op: z.literal("agendaUpdate"),
    meetingId: id,
    agendaId: id,
    title,
    ownerId: optionalId,
    durationMin: z.coerce.number().int().min(1).max(480),
    notesMd: text,
    status: z.enum(["OPEN", "DISCUSSED", "CARRIED_OVER"]),
  }),
  z.object({
    op: z.literal("reorder"),
    meetingId: id,
    agendaIds: z.array(id).max(200),
  }),
  z.object({
    op: z.literal("decision"),
    meetingId: id,
    title,
    contextMd: text,
    decisionMd: z.string().trim().min(1).max(20_000),
    ownerId: optionalId,
  }),
  z.object({
    op: z.literal("action"),
    meetingId: id,
    title,
    assigneeId: optionalId,
    projectId: optionalId,
    dueAt: z.preprocess((v) => (v === "" ? null : v), date.nullish()),
    requestId: id,
  }),
  z.object({ op: z.literal("attendee"), meetingId: id, userId: id }),
  z.object({
    op: z.literal("rsvp"),
    meetingId: id,
    rsvp: z.enum(["YES", "NO", "MAYBE"]),
  }),
  z.object({
    op: z.literal("attendance"),
    meetingId: id,
    userId: id,
    attended: z.boolean(),
  }),
  z.object({
    op: z.literal("publish"),
    meetingId: id,
    destinationIds: z.array(id).max(50).default([]),
  }),
]);

export async function meetingRecipients(
  meeting: Pick<
    Meeting,
    "workspaceId" | "teamId" | "visibility" | "createdById" | "facilitatorId"
  >,
  client: DbClient,
) {
  const members = await client.membership.findMany({
    where: {
      workspaceId: meeting.workspaceId,
      status: "ACTIVE",
      user: { disabledAt: null },
    },
    select: { userId: true, role: true },
  });
  const team = meeting.teamId
    ? await client.team.findFirst({
        where: { workspaceId: meeting.workspaceId, id: meeting.teamId },
        include: { members: true },
      })
    : null;
  return members
    .filter((m) => {
      if (["OWNER", "ADMIN"].includes(m.role)) return true;
      if (meeting.visibility === "PRIVATE")
        return meeting.createdById === m.userId;
      const inTeam = team?.members.some((t) => t.userId === m.userId);
      if (meeting.visibility === "TEAM" || team?.visibility === "PRIVATE")
        return inTeam;
      return true;
    })
    .map((m) => m.userId);
}

async function addAction(
  tx: Tx,
  actor: Actor,
  meeting: Meeting,
  data: Extract<z.infer<typeof meetingCommand>, { op: "action" }>,
) {
  // A task inherits project visibility; it must never broaden the meeting's audience.
  ensure(
    meeting.visibility !== "PRIVATE",
    "Private meeting actions stay in notes. Use a team meeting to create shared tasks.",
  );
  const existing = await tx.recordLink.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      fromType: "meeting_action",
      fromId: `${meeting.id}:${data.requestId}`,
      toType: "task",
    },
  });
  if (existing) return { id: existing.toId, notification: null };
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
  if (meeting.teamId || meeting.visibility === "TEAM") {
    const team = project?.teamId
      ? await tx.team.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: project.teamId,
            visibility: "PRIVATE",
          },
        })
      : null;
    ensure(
      team && project?.teamId === meeting.teamId,
      "Choose a private-team project with the same audience as this meeting.",
    );
  }
  if (data.assigneeId)
    ensure(
      (await assignableMembers(actor.workspace.id, project, tx)).some(
        (m) => m.id === data.assigneeId,
      ),
      "Choose a member who can see this project.",
    );
  const column = project
    ? await tx.boardColumn.findFirst({
        where: {
          projectId: project.id,
          project: { workspaceId: actor.workspace.id },
          category: "TODO",
        },
        orderBy: { position: "asc" },
      })
    : null;
  const number = await nextWorkspaceSequence(tx, actor.workspace.id, "task");
  const task = await tx.task.create({
    data: {
      workspaceId: actor.workspace.id,
      sourceMeetingId: meeting.id,
      title: data.title,
      number,
      creatorId: actor.user.id,
      projectId: project?.id,
      columnId: column?.id,
      dueAt: data.dueAt,
      assignees: data.assigneeId
        ? { create: { userId: data.assigneeId } }
        : undefined,
    },
  });
  await tx.meetingActionItem.create({
    data: { meetingId: meeting.id, taskId: task.id },
  });
  await tx.recordLink.create({
    data: {
      workspaceId: actor.workspace.id,
      fromType: "meeting_action",
      fromId: `${meeting.id}:${data.requestId}`,
      toType: "task",
      toId: task.id,
      createdById: actor.user.id,
    },
  });
  const url = project ? `projects/${project.key}/${number}` : `t/${number}`;
  await changed(tx, actor, "task", task.id, task.title, url, "created", "", {
    teamId: project?.teamId,
    projectId: project?.id,
  });
  const notification = data.assigneeId
    ? await dispatch(
        actor.workspace.id,
        {
          type: "task.assigned",
          title: `You have a meeting action: ${task.title}`.slice(0, 150),
          actorId: actor.user.id,
          recipients: [data.assigneeId],
          useWorkspaceRules: !meeting.teamId,
          resource: { type: "task", id: task.id },
          scope: {
            taskId: task.id,
            ...(project ? { projectId: project.id } : {}),
          },
          url: `/w/${actor.workspace.slug}/${url}`,
          data: {
            taskId: task.id,
            taskNumber: number,
            projectId: project?.id ?? null,
          },
        },
        { tx },
      )
    : null;
  return { id: task.id, notification };
}

export async function mutateMeeting(actor: Actor, input: unknown) {
  const data = meetingCommand.parse(input);
  const calendarNotifications: Awaited<ReturnType<typeof import("@/lib/calendar/service")["notifyMeeting"]>>[] = [];
  const result = await serial(async (tx) => {
    await assertActor(actor, tx, data.op !== "rsvp");
    if (data.op === "create") {
      ensure(
        data.endsAt > data.startsAt,
        "Choose an end time after the start.",
      );
      await checkTeam(actor, data.teamId, tx);
      ensure(
        data.visibility !== "TEAM" || data.teamId,
        "Choose a team for a team meeting.",
      );
      if (data.visibility === "PRIVATE")
        ensure(
          !data.facilitatorId || data.facilitatorId === actor.user.id,
          "Private meetings use you as facilitator.",
        );
      await checkMembers(
        actor,
        [...data.attendeeIds, data.facilitatorId ?? actor.user.id],
        tx,
        data.visibility === "TEAM" ? data.teamId : undefined,
      );
      ensure(
        await tx.membership.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            userId: data.facilitatorId ?? actor.user.id,
            status: "ACTIVE",
            role: { in: ["MEMBER", "ADMIN", "OWNER"] },
          },
        }),
        "Choose a contributor to facilitate this meeting.",
      );
      const viewers = await meetingRecipients(
        {
          workspaceId: actor.workspace.id,
          visibility: data.visibility,
          teamId: data.teamId ?? null,
          createdById: actor.user.id,
          facilitatorId: data.facilitatorId ?? actor.user.id,
        },
        tx,
      );
      ensure(
        [...data.attendeeIds, data.facilitatorId ?? actor.user.id].every(
          (userId) => viewers.includes(userId),
        ),
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
      ensure(!template || template.scope === "WORKSPACE" || (template.scope === "PRIVATE" && data.visibility === "PRIVATE") || (template.scope === "TEAM" && data.visibility === "TEAM" && template.teamId === data.teamId), "Keep the agenda template's audience for this meeting.");
      const agenda =
        template &&
        typeof template.content === "object" &&
        template.content &&
        "agenda" in template.content
          ? z
              .array(z.string().min(1).max(200))
              .max(100)
              .parse(template.content.agenda)
          : [];
      const count = data.repeat === "NONE" ? 1 : data.occurrences;
      let rootId = "";
      const horizon = new Date(data.startsAt);
      horizon.setUTCFullYear(horizon.getUTCFullYear() + 5);
      const dates = expandRecurrence(data.startsAt, data.repeat === "FORTNIGHTLY" ? "BIWEEKLY" : data.repeat, horizon, actor.workspace.timezone).slice(0, count);
      for (const [index, startsAt] of dates.entries()) {
        const endsAt = new Date(startsAt.getTime() + data.endsAt.getTime() - data.startsAt.getTime());
        const meeting = await tx.meeting.create({
          data: {
            workspaceId: actor.workspace.id,
            timezone: actor.workspace.timezone,
            title: data.title,
            startsAt,
            endsAt,
            location: data.location,
            teamId: data.teamId,
            visibility: data.visibility,
            facilitatorId: data.facilitatorId ?? actor.user.id,
            createdById: actor.user.id,
            seriesId: rootId || null,
            rrule:
              index === 0 && data.repeat !== "NONE"
                ? `FREQ=${data.repeat === "MONTHLY" ? "MONTHLY" : "WEEKLY"};INTERVAL=${data.repeat === "FORTNIGHTLY" ? 2 : 1};COUNT=${count}`
                : null,
            attendees: {
              create: [...new Set([actor.user.id, ...data.attendeeIds])].map(
                (userId) => ({ userId }),
              ),
            },
            agenda: {
              create: agenda.map((title, sortOrder) => ({
                title,
                sortOrder,
                durationMin: 10,
              })),
            },
          },
        });
        if (!rootId) {
          rootId = meeting.id;
          if (count > 1)
            await tx.meeting.update({
              where: { id: rootId, workspaceId: actor.workspace.id },
              data: { seriesId: rootId },
            });
        }
        calendarNotifications.push(await (await import("@/lib/calendar/service")).notifyMeeting(tx, actor, meeting.id, "meeting.scheduled"));
        await changed(
          tx,
          actor,
          "meeting",
          meeting.id,
          meeting.title,
          `meetings/${meeting.id}`,
          "created",
          "",
          {
            visibility: meeting.visibility,
            teamId: meeting.teamId,
            ownerId: meeting.createdById,
          },
        );
      }
      return { id: rootId, notification: null };
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
