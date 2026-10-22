import "server-only";
import { type WorkspaceRole } from "@prisma/client";
import {
  prisma,
  type Tx,
} from "@/lib/db";
import { canManageFunding } from "@/lib/roles";

export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole };
};
export class FundingError extends Error {}
export const ensure: (value: unknown, message?: string) => asserts value = (
  value,
  message = "That record is unavailable. Refresh and try again.",
) => {
  if (!value) throw new FundingError(message);
};
export async function assertActor(actor: Actor, tx: Tx = prisma) {
  const member = await tx.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
    select: { role: true },
  });
  ensure(
    member && canManageFunding(member),
    "You don't have access to do that.",
  );
}
export async function lock(actor: Actor, tx: Tx) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
  await assertActor(actor, tx);
}
