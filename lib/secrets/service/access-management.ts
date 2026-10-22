import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guard } from "@/lib/approvals/ops";
import { canManageSecrets } from "@/lib/roles";
import { environmentAccess, checkPath, type SecretsActor } from "@/lib/secrets/access";
import { ROLES, normalisePath, SecretsError } from "@/lib/secrets/values";
import { audit } from "@/lib/secrets/mutations";
import { parse } from "./validation";

export async function saveGrant(actor: SecretsActor, input: unknown) {
  await guard(actor);
  const v = parse(
    z.object({
      projectId: z.string(),
      environmentId: z.string().default(""),
      userId: z.string(),
      role: z.enum(ROLES),
    }),
    input,
  );
  if (actor.machine)
    throw new SecretsError("Use your member account to manage access.");
  if (v.environmentId) {
    const env = await environmentAccess(actor, v.environmentId, "ADMIN");
    if (env.projectId !== v.projectId)
      throw new SecretsError("That environment is unavailable.");
  } else if (!canManageSecrets(actor.membership))
    throw new SecretsError("Ask a workspace admin to manage project grants.");
  return prisma.$transaction(async (tx) => {
    if (
      !(await tx.secretProject.findFirst({
        where: { workspaceId: actor.workspace.id, id: v.projectId },
      })) ||
      !(await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: v.userId,
          status: "ACTIVE",
          role: { not: "GUEST" },
          user: { disabledAt: null },
        },
      }))
    )
      throw new SecretsError("Choose an active member in this workspace.");
    await tx.secretGrant.upsert({
      where: {
        workspaceId_projectId_environmentId_userId: {
          workspaceId: actor.workspace.id,
          ...{
            projectId: v.projectId,
            environmentId: v.environmentId,
            userId: v.userId,
          },
        },
      },
      create: { workspaceId: actor.workspace.id, ...v },
      update: { role: v.role },
    });
    await audit(
      tx,
      actor.workspace.id,
      v.projectId,
      actor.user.id,
      "access_changed",
      v.environmentId || undefined,
      v.userId,
    );
  });
}
export async function saveFolder(
  actor: SecretsActor,
  environmentId: string,
  path: string,
) {
  const env = await environmentAccess(actor, environmentId, "WRITE");
  normalisePath(path);
  checkPath(actor, path, environmentId);
  return prisma.$transaction(async (tx) => {
    await tx.secretFolder.upsert({
      where: {
        workspaceId_environmentId_path: {
          workspaceId: actor.workspace.id,
          environmentId,
          path,
        },
      },
      create: { workspaceId: actor.workspace.id, environmentId, path },
      update: {},
    });
    await audit(
      tx,
      actor.workspace.id,
      env.projectId,
      actor.user.id,
      "folder_created",
      environmentId,
    );
  });
}
