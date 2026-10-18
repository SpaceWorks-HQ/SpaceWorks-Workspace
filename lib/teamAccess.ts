import "server-only";

import type { WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";

/**
 * Private-team visibility, shared by chat (Channel.teamId), projects
 * (Project.teamId) and every team-scoped record. A PRIVATE team's records are
 * visible to its members and to OWNER/ADMIN; PUBLIC teams hide nothing.
 * Teams themselves are managed by the people-relationships build.
 */

/** Ids of teams the user belongs to in this workspace. */
export async function userTeamIds(workspaceId: string, userId: string, client: DbClient = prisma): Promise<string[]> {
  const rows = await client.teamMember.findMany({ where: { userId, team: { workspaceId, archivedAt: null } }, select: { teamId: true } });
  return rows.map((row) => row.teamId);
}

/** PRIVATE team ids whose records this member must not see (empty for admins). */
export async function hiddenTeamIds(workspaceId: string, member: { userId: string; role: WorkspaceRole }, client: DbClient = prisma): Promise<string[]> {
  if (hasRoleAtLeast(member.role, "ADMIN")) return [];
  const rows = await client.team.findMany({
    where: { workspaceId, visibility: "PRIVATE", members: { none: { userId: member.userId } } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Prisma filter for records with a nullable `teamId`: unscoped records plus
 * those of teams the member may see. Use as `where: { workspaceId, ...teamScopeFilter(hidden) }`.
 */
export function teamScopeFilter(hidden: string[]): { OR?: Array<{ teamId: null } | { teamId: { notIn: string[] } }> } {
  if (hidden.length === 0) return {};
  return { OR: [{ teamId: null }, { teamId: { notIn: hidden } }] };
}
