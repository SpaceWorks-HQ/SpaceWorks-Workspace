import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { canManageGovernance } from "@/lib/roles";

export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole };
};
export class GovernanceError extends Error {}
export const ensure: (condition: unknown, message?: string) => asserts condition = (
  condition,
  message = "That record is unavailable. Refresh and try again.",
) => {
  if (!condition) throw new GovernanceError(message);
};
/** Recheck current authority inside each transaction, including stale actors. */
export async function assertActor(actor: Actor, tx: Tx = prisma) {
  const m = await tx.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
    select: { role: true },
  });
  ensure(m && canManageGovernance(m), "You don't have access to do that.");
}
export async function lock(actor: Actor, tx: Tx) {
  // One short workspace lock serialises record edits, approvals and recurrence/checklist retries.
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
  await assertActor(actor, tx);
}
