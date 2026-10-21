import "server-only";
import type { Meeting, Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { type Actor, visibilityWhere, admin } from "../core";

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
