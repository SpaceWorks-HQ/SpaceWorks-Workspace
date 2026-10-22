import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { expandRecurrence } from "@/lib/calendar/algorithms";
import { templateWhere } from "@/lib/templates/service";
import { type Actor, ensure, changed, checkMembers, checkTeam } from "../core";
import { meetingRecipients } from "./access";
import type { meetingCommand } from "./validation";

export async function createMeeting(
  tx: Tx,
  actor: Actor,
  data: Extract<z.infer<typeof meetingCommand>, { op: "create" }>,
  calendarNotifications: Awaited<ReturnType<typeof import("@/lib/calendar/service")["notifyMeeting"]>>[],
) {
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
