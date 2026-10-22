import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guard } from "@/lib/approvals/ops";
import { canManageSecrets } from "@/lib/roles";
import { indexSearchDocument } from "@/lib/search/documents";
import { environmentAccess, type SecretsActor } from "@/lib/secrets/access";
import { SecretsError } from "@/lib/secrets/values";
import { audit } from "@/lib/secrets/mutations";
import { slug, name, parse } from "./validation";

export async function createProject(actor: SecretsActor, input: unknown) {
  await guard(actor, true);
  const v = parse(z.object({ name, slug }), input);
  return prisma.$transaction(async (tx) => {
    const project = await tx.secretProject.create({
      data: {
        ...v,
        workspaceId: actor.workspace.id,
        createdById: actor.user.id,
      },
    });
    for (const [position, key] of ["dev", "staging", "production"].entries()) {
      const env = await tx.secretEnvironment.create({
        data: {
          workspaceId: actor.workspace.id,
          projectId: project.id,
          name: key,
          slug: key,
          position,
          production: key === "production",
          protected: key === "production",
        },
      });
      await indexSearchDocument(
        {
          workspaceId: actor.workspace.id,
          entityType: "secret_environment",
          entityId: env.id,
          title: `${project.name} / ${env.name}`,
          url: `/w/${actor.workspace.slug}/secrets?project=${project.id}&environment=${env.id}`,
          visibility: "PRIVATE",
          ownerId: actor.user.id,
        },
        tx,
      );
    }
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "secret_project",
        entityId: project.id,
        title: project.name,
        url: `/w/${actor.workspace.slug}/secrets?project=${project.id}`,
        visibility: "PRIVATE",
        ownerId: actor.user.id,
      },
      tx,
    );
    await audit(
      tx,
      actor.workspace.id,
      project.id,
      actor.user.id,
      "project_created",
    );
    return project.id;
  });
}
export async function saveEnvironment(actor: SecretsActor, input: unknown) {
  await guard(actor);
  const v = parse(
    z.object({
      id: z.string().optional(),
      projectId: z.string(),
      name,
      slug,
      position: z.number().int().min(0).max(1000),
      production: z.boolean(),
      protected: z.boolean(),
    }),
    input,
  );
  if (actor.machine)
    throw new SecretsError("Use your member account to manage environments.");
  if (!v.id && !canManageSecrets(actor.membership)) {
    const grant = await prisma.secretGrant.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        projectId: v.projectId,
        userId: actor.user.id,
        environmentId: "",
        role: "ADMIN",
      },
    });
    if (!grant)
      throw new SecretsError("Ask a project admin to add an environment.");
  }
  return prisma.$transaction(async (tx) => {
    if (v.id) {
      await tx.$queryRaw`SELECT "id" FROM "SecretEnvironment" WHERE "workspaceId"=${actor.workspace.id} AND "id"=${v.id} FOR NO KEY UPDATE`;
      const current = await environmentAccess(actor, v.id, "ADMIN", tx);
      if (current.projectId !== v.projectId)
        throw new SecretsError("That project is unavailable.");
      // Read under the update lock so a concurrent promotion stays sticky.
      v.production = v.production || current.production;
    }
    const project = await tx.secretProject.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.projectId },
    });
    if (!project) throw new SecretsError("That project is unavailable.");
    const { id, ...data } = v;
    const env = id
      ? await tx.secretEnvironment.update({
          where: { workspaceId: actor.workspace.id, id },
          data,
        })
      : await tx.secretEnvironment.create({
          data: { ...data, workspaceId: actor.workspace.id },
        });
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "secret_environment",
        entityId: env.id,
        title: `${project.name} / ${env.name}`,
        url: `/w/${actor.workspace.slug}/secrets?project=${project.id}&environment=${env.id}`,
        visibility: "PRIVATE",
        ownerId: actor.user.id,
      },
      tx,
    );
    const keys = await tx.applicationSecret.findMany({
      where: {
        workspaceId: actor.workspace.id,
        environmentId: env.id,
        deletedAt: null,
      },
      select: { id: true, key: true, path: true, ownerId: true },
    });
    for (const key of keys)
      await indexSearchDocument(
        {
          workspaceId: actor.workspace.id,
          entityType: "application_secret",
          entityId: key.id,
          title: `${project.name} / ${env.name} / ${key.path} / ${key.key}`,
          url: `/w/${actor.workspace.slug}/secrets?project=${project.id}&environment=${env.id}&path=${encodeURIComponent(key.path)}`,
          visibility: "PRIVATE",
          ownerId: key.ownerId,
        },
        tx,
      );
    await audit(
      tx,
      actor.workspace.id,
      project.id,
      actor.user.id,
      "environment_saved",
      env.id,
    );
    return env.id;
  });
}
