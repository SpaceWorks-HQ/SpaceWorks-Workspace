import "server-only";
import type { ApprovalHook } from "@/lib/approvals/types";
import { OpsError } from "@/lib/approvals/ops";
import { openPayload } from "./encryption";
import { applyChanges, audit, type Change } from "./mutations";
import { environmentAccess } from "./access";
import { SecretsError } from "./values";
export const secretsApprovalHook: ApprovalHook = {
  noun: "protected environment change",
  url: (slug, id) => `/w/${slug}/secrets?change=${id}`,
  async onDecided(tx, ctx) {
    try {
      const row = await tx.secretChange.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          id: ctx.request.subjectId,
          status: "PENDING",
        },
      });
      if (!row) return;
      const env = await tx.secretEnvironment.findFirstOrThrow({
        where: { workspaceId: ctx.workspaceId, id: row.environmentId },
      });
      if (ctx.outcome === "APPROVED") {
        const membership = await tx.membership.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            userId: row.createdById,
            status: "ACTIVE",
          },
        });
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { id: ctx.workspaceId },
        });
        if (!membership || !ctx.actorId || ctx.actorId === row.createdById)
          throw new SecretsError(
            "An independent admin must approve this change.",
          );
        await environmentAccess(
          { user: { id: row.createdById, name: null }, workspace, membership },
          env.id,
          "WRITE",
          tx,
        );
        await applyChanges(
          tx,
          ctx.workspaceId,
          env.id,
          JSON.parse(await openPayload(row, "change", tx)) as Change[],
          ctx.actorId,
          row.revision,
        );
      }
      await tx.secretChange.updateMany({
        where: { workspaceId: ctx.workspaceId, id: row.id },
        data: { status: ctx.outcome },
      });
      await audit(
        tx,
        ctx.workspaceId,
        env.projectId,
        ctx.actorId,
        "approval_" + ctx.outcome.toLowerCase(),
        env.id,
        row.id,
      );
    } catch (error) {
      if (error instanceof SecretsError) throw new OpsError(error.message);
      throw error;
    }
  },
};
