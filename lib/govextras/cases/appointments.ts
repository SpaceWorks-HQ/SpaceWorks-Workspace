import "server-only";
import { prisma } from "@/lib/db";
import { canManageSafeguardingHandlers } from "@/lib/roles";
import { GovernanceError, type Actor } from "@/lib/governance/service";
import { dayInZone } from "@/lib/governance/schemas";
import { appointmentSchema } from "../rules";
import { caseLock } from "./access";
import { audit } from "./audit";

export async function appointHandler(actor: Actor, raw: unknown) {
  const input = appointmentSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const member = await caseLock(actor, tx);
    if (!canManageSafeguardingHandlers(member))
      throw new GovernanceError(
        "Only an owner can record committee appointments.",
      );
    if (input.revoke) {
      await tx.safeguardingHandler.updateMany({
        where: { workspaceId: actor.workspace.id, userId: input.userId },
        data: { revokedAt: new Date() },
      });
    } else {
      const eligible = await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: input.userId,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN", "MEMBER"] },
          user: { disabledAt: null },
        },
      });
      const committee = await tx.governanceRecord.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: input.committeeId,
          kind: "COMMITTEE",
          status: "ACTIVE",
          archivedAt: null,
        },
      });
      if (
        !eligible ||
        !committee ||
        input.endsOn < dayInZone(new Date(), actor.workspace.timezone)
      )
        throw new GovernanceError(
          "Choose an active member, committee and current appointment end date.",
        );
      await tx.safeguardingHandler.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: actor.workspace.id,
            userId: input.userId,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          userId: input.userId,
          committeeId: input.committeeId,
          endsOn: new Date(input.endsOn),
          appointedById: actor.user.id,
        },
        update: {
          committeeId: input.committeeId,
          endsOn: new Date(input.endsOn),
          appointedById: actor.user.id,
          revokedAt: null,
        },
      });
    }
    await audit(
      actor,
      tx,
      input.revoke ? "handler_revoked" : "handler_appointed",
      input.userId,
    );
  });
}
