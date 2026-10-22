import "server-only";
import { randomUUID } from "node:crypto";
import { sealPayload } from "@/lib/secrets/encryption";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requestApproval } from "@/lib/approvals/engine";
import { environmentAccess, checkPath, type SecretsActor } from "@/lib/secrets/access";
import { SecretsError } from "@/lib/secrets/values";
import { applyChanges, audit, type Change } from "@/lib/secrets/mutations";
import { changeSchema, parse } from "./validation";

export async function changeSecrets(
  actor: SecretsActor,
  environmentId: string,
  input: unknown,
  expectedRevision?: number,
) {
  const changes = parse(z.array(changeSchema).min(1).max(500), input);
  return submitChanges(actor, environmentId, changes, expectedRevision);
}
// Shared by bounded user changes and complete, server-derived recovery sets.
export async function submitChanges(
  actor: SecretsActor,
  environmentId: string,
  changes: Change[],
  expectedRevision?: number,
) {
  const env = await environmentAccess(actor, environmentId, "WRITE");
  changes.forEach((c) => checkPath(actor, c.path, environmentId, true));
  const result = await prisma.$transaction(
    async (tx) => {
      await environmentAccess(actor, environmentId, "WRITE", tx);
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${actor.workspace.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "SecretEnvironment" WHERE "workspaceId"=${actor.workspace.id} AND "id"=${environmentId} FOR UPDATE`;
      const current = await tx.secretEnvironment.findFirstOrThrow({
        where: { workspaceId: actor.workspace.id, id: environmentId },
      });
      if (
        expectedRevision !== undefined &&
        expectedRevision !== current.revision
      )
        throw new SecretsError(
          "The environment changed. Refresh the preview and try again.",
        );
      if (!current.protected) {
        await applyChanges(
          tx,
          actor.workspace.id,
          environmentId,
          changes,
          actor.user.id,
          current.revision,
        );
        return { pending: false };
      }
      const changeId = randomUUID();
      const change = await tx.secretChange.create({
        data: {
          workspaceId: actor.workspace.id,
          environmentId,
          revision: current.revision,
          createdById: actor.user.id,
          diff: changes.map((c) => ({
            key: c.key,
            path: c.path,
            operation: c.delete ? "delete" : "set",
          })),
          ...await sealPayload(actor.workspace.id, environmentId, "change", changeId, JSON.stringify(changes), tx),
          id: changeId,
        },
      });
      const project = await tx.secretProject.findFirstOrThrow({
        where: { workspaceId: actor.workspace.id, id: current.projectId },
        select: { name: true },
      });
      const approval = await requestApproval(tx, {
        workspace: actor.workspace,
        subjectType: "SECRET_CHANGE",
        subjectId: change.id,
        title: `${project.name.slice(0, 80)} / ${current.name.slice(0, 60)} change`,
        requesterId: actor.user.id,
        requesterName: actor.user.name,
        steps: [{ approverType: "ROLE", ref: "ADMIN", minApprovals: 1 }],
      });
      await audit(
        tx,
        actor.workspace.id,
        env.projectId,
        actor.user.id,
        "approval_requested",
        environmentId,
        change.id,
      );
      return {
        pending: true,
        changeId: change.id,
        afterCommit: approval.afterCommit,
      };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  if ("afterCommit" in result) await result.afterCommit?.();
  return {
    pending: result.pending,
    changeId: "changeId" in result ? result.changeId : undefined,
  };
}
