import "server-only";

import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { safeTimeZone } from "@/lib/timeZone";

/**
 * Who is acting, resolved server-side (a `WorkspaceContext` from
 * `requireWorkspace` / `getWorkspaceForAction` fits). Every people,
 * teams, rota and contacts service takes one and checks the capability
 * itself, so the rules hold for Server Actions, route handlers and tests.
 */
export type PeopleActor = {
  user: { id: string; name: string | null };
  workspace: { id: string; slug: string; name: string; timezone: string; currency?: string };
  membership: { role: WorkspaceRole };
};

export const workspaceZone = (actor: { workspace: { timezone: string } }) => safeTimeZone(actor.workspace.timezone);

export function displayName(name: string | null | undefined, email?: string | null) {
  return name?.trim() || email?.split("@")[0] || "Someone";
}

/** Serialise work per key inside a transaction; false when another worker holds it. */
export async function tryTransactionLock(tx: Prisma.TransactionClient, key: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS "locked"`;
  return rows[0]?.locked === true;
}

/** Active member ids among `userIds` (drops people who left or were suspended). */
export async function activeMemberIdsAmong(workspaceId: string, userIds: string[], client: DbClient = prisma): Promise<string[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", userId: { in: unique } }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

/** Active OWNER/ADMIN ids (people who approve and manage). */
export async function adminIds(workspaceId: string, client: DbClient = prisma): Promise<string[]> {
  const rows = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true }, take: 50 });
  return rows.map((row) => row.userId);
}

/** Is `userId` an active member of the workspace? */
export async function isActiveMember(workspaceId: string, userId: string, client: DbClient = prisma) {
  const row = await client.membership.findFirst({ where: { workspaceId, userId, status: "ACTIVE" }, select: { id: true } });
  return Boolean(row);
}
