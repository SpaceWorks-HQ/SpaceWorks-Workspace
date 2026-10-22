import "server-only";

import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { canManageCalendarDeadlines } from "@/lib/roles";
import { type Actor, assertActor, ensure, serial, changed, checkTeam } from "@/lib/meetings/core";
import { visibleProjectWhere } from "@/lib/tasks/access";
import { isValidTimeZone } from "@/lib/timeZone";
import { entryWhere } from "../access";
import { expandRecurrence, recurrenceRule } from "../algorithms";

const optionalId = z.string().max(100).nullish();
const entrySchema = z.object({
  id: optionalId,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["DEADLINE", "REMINDER"]),
  startsAt: z.coerce.date(),
  timezone: z.string().refine(isValidTimeZone),
  notes: z.string().trim().max(10000).default(""),
  visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("PRIVATE"),
  teamId: optionalId,
  projectId: optionalId,
  repeat: z
    .enum(["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"])
    .default("NONE"),
  until: z.coerce.date(),
  reminderMinutes: z.coerce.number().int().min(0).max(10080).default(30),
});
export async function saveEntry(actor: Actor, input: unknown) {
  const data = entrySchema.parse(input);
  ensure(
    data.kind !== "DEADLINE" || canManageCalendarDeadlines(actor.membership),
  );
  ensure(
    data.until >= data.startsAt &&
      data.until.getTime() - data.startsAt.getTime() <= 366 * 86400000,
    "Choose an end within one year.",
  );
  return serial(async (tx) => {
    await assertActor(actor, tx, false);
    await checkTeam(actor, data.teamId, tx);
    ensure(
      data.kind !== "REMINDER" || data.visibility === "PRIVATE",
      "Personal reminders stay private.",
    );
    ensure(data.visibility !== "TEAM" || data.teamId, "Choose a team.");
    if (data.projectId)
      ensure(
        await tx.project.findFirst({
          where: {
            AND: [
              await visibleProjectWhere(actor, tx),
              { id: data.projectId, teamId: data.teamId ?? null },
            ],
          },
        }),
      );
    if (data.id) {
      const old = await tx.calendarEntry.findFirst({
        where: {
          AND: [
            await entryWhere(actor, tx),
            { id: data.id, ownerId: actor.user.id },
          ],
        },
      });
      ensure(
        old && old.kind === data.kind,
        "Keep this occurrence's original kind.",
      );
    }
    const starts = data.id
      ? [data.startsAt]
      : expandRecurrence(data.startsAt, data.repeat, data.until, data.timezone);
    ensure(starts.length && starts.length <= 100, "Choose 1–100 occurrences.");
    let root = "";
    for (const startsAt of starts) {
      const values = {
        title: data.title,
        kind: data.kind,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 1800000),
        timezone: data.timezone,
        notes: data.notes,
        visibility: data.visibility,
        teamId: data.teamId ?? null,
        projectId: data.projectId ?? null,
        reminderMinutes: data.reminderMinutes,
        reminderSentAt: null,
      };
      const entry = data.id
        ? await tx.calendarEntry.update({
            where: { id: data.id, workspaceId: actor.workspace.id },
            data: values,
          })
        : await tx.calendarEntry.create({
            data: {
              ...values,
              workspaceId: actor.workspace.id,
              ownerId: actor.user.id,
              seriesId: root || null,
              rrule: root ? null : recurrenceRule(data.repeat, starts.length),
            },
          });
      if (!root) root = entry.id;
      await changed(
        tx,
        actor,
        "calendar_entry",
        entry.id,
        entry.title,
        "calendar",
        data.id ? "updated" : "created",
        data.notes,
        {
          visibility: entry.visibility,
          teamId: entry.teamId,
          ownerId: actor.user.id,
          projectId: entry.projectId,
        },
      );
    }
    return { id: root };
  });
}
export async function deleteEntry(actor: Actor, id: string) {
  await serial(async (tx) => {
    await assertActor(actor, tx, false);
    const entry = await tx.calendarEntry.findFirst({
      where: {
        AND: [await entryWhere(actor, tx), { id, ownerId: actor.user.id }],
      },
    });
    ensure(entry);
    await tx.calendarEntry.deleteMany({
      where: { workspaceId: actor.workspace.id, id },
    });
    await recordAuditEvent({
      client: tx,
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "calendar.entry_deleted",
      targetType: "CalendarEntry",
      targetId: id,
    });
    await tx.searchDocument.deleteMany({
      where: {
        workspaceId: actor.workspace.id,
        entityType: "calendar_entry",
        entityId: id,
      },
    });
    await tx.activityEvent.deleteMany({
      where: {
        workspaceId: actor.workspace.id,
        entityType: "calendar_entry",
        entityId: id,
      },
    });
  });
}
