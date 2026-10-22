import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { type Actor, assertActor } from "@/lib/meetings/core";
import { meetingWhere } from "@/lib/meetings/service";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";

export async function calendarMeetingWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.MeetingWhereInput> {
  const base = await meetingWhere(actor, client);
  return {
    AND: [
      base,
      ...(actor.membership.role === "GUEST"
        ? [{ attendees: { some: { userId: actor.user.id } } }]
        : []),
    ],
  };
}
export async function entryWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.CalendarEntryWhereInput> {
  const hidden = await hiddenTeamIds(
    actor.workspace.id,
    { userId: actor.user.id, role: actor.membership.role },
    client,
  );
  return {
    workspaceId: actor.workspace.id,
    AND: [
      teamScopeFilter(hidden),
      {
        OR: [
          { ownerId: actor.user.id },
          ...(actor.membership.role === "GUEST"
            ? []
            : [
                { visibility: "WORKSPACE" as const },
                {
                  visibility: "TEAM" as const,
                  teamId: {
                    in: (
                      await client.teamMember.findMany({
                        where: {
                          userId: actor.user.id,
                          team: { workspaceId: actor.workspace.id },
                        },
                        select: { teamId: true },
                      })
                    ).map((t) => t.teamId),
                  },
                },
              ]),
        ],
      },
    ],
  };
}
export async function assertCalendarReader(actor: Actor) {
  await assertActor(actor, prisma, false);
}
