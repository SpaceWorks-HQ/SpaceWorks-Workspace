import "server-only";

import type { Prisma, WorkspaceRole } from "@prisma/client";
import { safeTimeZone } from "@/lib/timeZone";

/**
 * Who is acting, resolved server-side (a `WorkspaceContext` from
 * `requireWorkspace` / `getWorkspaceForAction` fits). Every community
 * service takes one and checks the capability itself, so the rules hold
 * for Server Actions, route handlers and tests alike.
 */
export type CommunityActor = {
  user: { id: string; name: string | null };
  workspace: { id: string; slug: string; name: string; timezone: string };
  membership: { role: WorkspaceRole };
};

export const workspaceZone = (actor: { workspace: { timezone: string } }) => safeTimeZone(actor.workspace.timezone);

/** Serialise row-lock style work per key inside a transaction; false when another worker holds it. */
export async function tryTransactionLock(tx: Prisma.TransactionClient, key: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS "locked"`;
  return rows[0]?.locked === true;
}

/** Ids of active members, for personal notifications that go to everyone. */
export async function activeMemberIds(tx: Prisma.TransactionClient, workspaceId: string): Promise<string[]> {
  const rows = await tx.membership.findMany({ where: { workspaceId, status: "ACTIVE" }, select: { userId: true }, take: 1000 });
  return rows.map((row) => row.userId);
}

export function displayName(name: string | null | undefined) {
  return name?.trim() || "Someone";
}
