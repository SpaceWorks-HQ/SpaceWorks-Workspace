import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { type Actor, assertActor, checkMembers } from "@/lib/meetings/core";
import { googleBusy } from "./google";
import { type Busy, findTimes } from "./algorithms";
import { isValidTimeZone } from "@/lib/timeZone";
export async function availabilityFor(actor: Actor, input: unknown) {
  await assertActor(actor);
  const data = z
    .object({
      attendeeIds: z.array(z.string().min(1).max(100)).min(1).max(30),
      duration: z.coerce.number().int().min(5).max(480),
      timezone: z.string().refine(isValidTimeZone),
      excludeMeetingId: z.string().max(100).optional(),
      startHour: z.coerce.number().int().min(0).max(22).default(9),
      endHour: z.coerce.number().int().min(1).max(24).default(18),
    })
    .refine((d) => d.endHour > d.startHour)
    .parse(input);
  await checkMembers(actor, data.attendeeIds, prisma);
  const start = new Date(),
    end = new Date(start.getTime() + 14 * 86400000),
    workspaceId = actor.workspace.id;
  // Busy intervals deliberately omit titles, notes, locations and absence reasons.
  const [meetings, away, shifts] = await Promise.all([
    prisma.meeting.findMany({
      where: {
        workspaceId,
        id: { not: data.excludeMeetingId },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startsAt: { lt: end },
        endsAt: { gt: start },
        attendees: {
          some: { userId: { in: data.attendeeIds }, rsvp: { not: "NO" } },
        },
      },
      select: {
        startsAt: true,
        endsAt: true,
        attendees: {
          where: { userId: { in: data.attendeeIds }, rsvp: { not: "NO" } },
          select: { userId: true },
        },
      },
    }),
    prisma.availability.findMany({
      where: {
        workspaceId,
        userId: { in: data.attendeeIds },
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      select: { startsAt: true, endsAt: true, userId: true },
    }),
    prisma.shiftAssignment.findMany({
      where: {
        userId: { in: data.attendeeIds },
        status: { in: ["CONFIRMED", "SWAP_REQUESTED"] },
        shift: { workspaceId, startsAt: { lt: end }, endsAt: { gt: start } },
      },
      select: {
        userId: true,
        shift: { select: { startsAt: true, endsAt: true } },
      },
    }),
  ]);
  const blocks: Busy[] = [
    ...meetings.flatMap((m) =>
      m.attendees.map((a) => ({
        start: m.startsAt.toISOString(),
        end: m.endsAt!.toISOString(),
        userId: a.userId!,
      })),
    ),
    ...away.map((a) => ({
      start: a.startsAt.toISOString(),
      end: a.endsAt.toISOString(),
      userId: a.userId,
    })),
    ...shifts.map((a) => ({
      start: a.shift.startsAt.toISOString(),
      end: a.shift.endsAt.toISOString(),
      userId: a.userId,
    })),
  ];
  const unavailable: string[] = [];
  await Promise.all(
    data.attendeeIds.map(async (userId) => {
      try {
        blocks.push(...(await googleBusy(workspaceId, userId, start, end)));
      } catch {
        unavailable.push(userId);
      }
    }),
  );
  return {
    blocks,
    suggestions: unavailable.length
      ? []
      : findTimes(
          blocks,
          start,
          data.duration,
          data.timezone,
          data.startHour,
          data.endHour,
        ),
    unavailable,
  };
}
