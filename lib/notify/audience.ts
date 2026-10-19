import "server-only";

import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { isWorkspaceRole } from "@/lib/roles";

/**
 * Resolve a destination's people selector ({ userIds, roles, teamIds }) to
 * ACTIVE members of the workspace. Used by IN_APP_USERS and role/team EMAIL
 * destinations. Unknown or removed people are silently dropped.
 */
export type PeopleSelector = { userIds?: string[]; roles?: WorkspaceRole[]; teamIds?: string[] };

export function parsePeopleSelector(config: Prisma.JsonValue): PeopleSelector {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const raw = config as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 500) : undefined);
  return { userIds: strings(raw.userIds), roles: strings(raw.roles)?.filter(isWorkspaceRole), teamIds: strings(raw.teamIds) };
}

export async function resolveSelectorMembers(workspaceId: string, selector: PeopleSelector, client: DbClient = prisma) {
  const or: Prisma.MembershipWhereInput[] = [];
  if (selector.userIds?.length) or.push({ userId: { in: selector.userIds } });
  if (selector.roles?.length) or.push({ role: { in: selector.roles } });
  if (selector.teamIds?.length) or.push({ user: { teamMemberships: { some: { teamId: { in: selector.teamIds }, team: { workspaceId } } } } });
  if (or.length === 0) return [];
  return client.membership.findMany({
    where: { workspaceId, status: "ACTIVE", OR: or },
    select: { userId: true, role: true, user: { select: { email: true, name: true } } },
  });
}
