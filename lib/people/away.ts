import "server-only";

import { actionError, NOT_ALLOWED, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { userTeamIds } from "@/lib/teamAccess";
import { canManageAvailabilityFor, canSeeAvailability } from "@/lib/people/access";
import { type Period } from "@/lib/people/availability";
import { type PeopleActor } from "@/lib/people/context";

/** Approved away periods, filtered to the viewer's workspace and visibility. */

export type VisibleAvailability = { id: string; userId: string; type: "AWAY" | "LIMITED" | "TRAVEL" | "BUSY"; startsAt: Date; endsAt: Date; note: string | null; visibility: "PRIVATE" | "TEAM" | "WORKSPACE" };

/** Availability rows for `userIds` overlapping `range`, filtered to what the actor may see. */
export async function visibleAvailability(actor: PeopleActor, userIds: string[], range: Period): Promise<VisibleAvailability[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.availability.findMany({
    where: { workspaceId: actor.workspace.id, userId: { in: userIds }, startsAt: { lt: range.endsAt }, endsAt: { gt: range.startsAt } },
    orderBy: { startsAt: "asc" },
    take: 500,
    select: { id: true, userId: true, type: true, startsAt: true, endsAt: true, note: true, visibility: true },
  });
  if (rows.length === 0) return [];
  const needsTeams = rows.some((row) => row.visibility === "TEAM");
  const [viewerTeams, ownerTeams] = needsTeams
    ? await Promise.all([
        userTeamIds(actor.workspace.id, actor.user.id),
        prisma.teamMember.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.userId))] }, team: { workspaceId: actor.workspace.id, archivedAt: null } }, select: { userId: true, teamId: true } }),
      ])
    : [[], []];
  const teamsByUser = new Map<string, string[]>();
  for (const row of ownerTeams) teamsByUser.set(row.userId, [...(teamsByUser.get(row.userId) ?? []), row.teamId]);
  const viewer = { role: actor.membership, userId: actor.user.id, teamIds: new Set(viewerTeams) };
  return rows.filter((row) => canSeeAvailability(viewer, { userId: row.userId, visibility: row.visibility, ownerTeamIds: teamsByUser.get(row.userId) ?? [] }));
}

/** Remove an away period (its owner or an admin). */
export async function removeAvailability(actor: PeopleActor, id: string): Promise<ActionResult> {
  const row = await prisma.availability.findFirst({ where: { id, workspaceId: actor.workspace.id }, select: { id: true, userId: true } });
  if (!row) return actionError("That away period is already gone.");
  if (!canManageAvailabilityFor(actor.membership, row.userId === actor.user.id)) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async (tx) => {
    await tx.availability.delete({ where: { id: row.id, workspaceId: actor.workspace.id } });
    await recordAuditEvent({ client: tx, action: "people.availability_removed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Availability", targetId: row.id, metadata: { self: row.userId === actor.user.id } });
  });
  await publish(actor.workspace.id, "workspace", { type: "people.availability.changed", data: { userId: row.userId } });
  return { ok: true };
}
