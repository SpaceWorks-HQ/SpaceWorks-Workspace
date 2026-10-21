import "server-only";
import { randomUUID } from "node:crypto";
import { openValue, sealPayload } from "./encryption";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";
import { guard } from "@/lib/approvals/ops";
import { canManageSecrets } from "@/lib/roles";
import { requestApproval } from "@/lib/approvals/engine";
import { indexSearchDocument } from "@/lib/search/documents";
import {
  environmentAccess,
  checkPath,
  requireSecretsMfa,
  type SecretsActor,
} from "./access";
import {
  KEY_PATTERN,
  ROLES,
  normalisePath,
  parseDotenv,
  createValueResolver,
  metadataDiff,
  SecretsError,
} from "./values";
import {
  applyChanges,
  audit,
  snapshot,
  snapshotRows,
  type Change,
} from "./mutations";
const slug = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z][a-z0-9_-]*$/);
const name = z.string().trim().min(1).max(100);
const changeSchema = z
  .object({
    key: z.string().regex(KEY_PATTERN),
    path: z.string().transform(normalisePath),
    value: z.string().max(20000).optional(),
    delete: z.boolean().optional(),
    comment: z.string().max(2000).optional(),
    tags: z.array(z.string().max(40)).max(15).optional(),
    ownerId: z.string().max(64).optional(),
    rotateEveryDays: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .refine((v) => v.delete || v.value !== undefined, "Enter a value.");
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SecretsError("Check the fields and try again.");
  return result.data;
}
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
      await tx.$queryRaw`SELECT "id" FROM "SecretEnvironment" WHERE "workspaceId"=${actor.workspace.id} AND "id"=${v.id} FOR UPDATE`;
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
async function submitChanges(
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
export async function readSecrets(
  actor: SecretsActor,
  environmentId: string,
  path: string,
  options: {
    key?: string;
    keys?: string[];
    exporting?: boolean;
    raw?: boolean;
    copying?: boolean;
  } = {},
) {
  normalisePath(path);
  checkPath(actor, path, environmentId);
  try {
    return await prisma.$transaction(
      async (tx) => {
        const env = await environmentAccess(actor, environmentId, "READ", tx);
        await requireSecretsMfa(actor, env.production, !!options.exporting, tx);
        const rows = await tx.applicationSecret.findMany({
          where: {
            workspaceId: actor.workspace.id,
            environmentId,
            path,
            deletedAt: null,
            ...(options.key ? { key: options.key } : options.keys ? { key: { in: options.keys } } : {}),
          },
        });
        if (options.key && !rows.length)
          throw new SecretsError("That key is unavailable.");
        const values: Record<string, string> = Object.create(null);
        const resolve = createValueResolver(async (loc) => {
          const target = await tx.secretEnvironment.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              projectId: env.projectId,
              slug: loc.environment,
            },
          });
          if (!target)
            throw new SecretsError(
              "A referenced key is unavailable or inaccessible.",
            );
          await environmentAccess(actor, target.id, "READ", tx);
          checkPath(actor, loc.path, target.id);
          await requireSecretsMfa(
            actor,
            target.production,
            !!options.exporting,
            tx,
          );
          const secret = await tx.applicationSecret.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              environmentId: target.id,
              path: loc.path,
              key: loc.key,
              deletedAt: null,
            },
          });
          if (!secret)
            throw new SecretsError(
              "A referenced key is unavailable or inaccessible.",
            );
          return openValue(secret, tx);
        });
        for (const row of rows)
          values[row.key] = options.raw
            ? await openValue(row, tx)
            : await resolve({ environment: env.slug, path, key: row.key });
        if (options.keys) for (const row of rows) await audit(tx, actor.workspace.id, env.projectId, actor.user.id, "revealed", environmentId, row.id, row.key, actor.machine?.id);
        else await audit(
          tx,
          actor.workspace.id,
          env.projectId,
          actor.user.id,
          options.exporting ? "exported" : options.copying ? "copied" : "revealed",
          environmentId,
          options.key ? rows[0]?.id : undefined,
          options.key ? rows[0]?.key : undefined,
          actor.machine?.id,
        );
        return values;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error instanceof SecretsError) {
      const env = await prisma.secretEnvironment.findFirst({
        where: { workspaceId: actor.workspace.id, id: environmentId },
        select: { id: true, projectId: true },
      });
      const membership = await prisma.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: actor.user.id,
          status: "ACTIVE",
          user: { disabledAt: null },
          workspace: { archivedAt: null },
        },
      });
      if (env && membership)
        await prisma.$transaction((tx) =>
          audit(
            tx,
            actor.workspace.id,
            env.projectId,
            actor.user.id,
            options.exporting ? "export_denied" : "reveal_denied",
            env.id,
          ),
        );
    }
    throw error;
  }
}
export async function previewImport(
  actor: SecretsActor,
  environmentId: string,
  path: string,
  source: string,
) {
  const permitted = await environmentAccess(actor, environmentId, "WRITE");
  await requireSecretsMfa(actor, permitted.production);
  normalisePath(path);
  checkPath(actor, path, environmentId);
  const values = parseDotenv(source);
  const env = await prisma.secretEnvironment.findFirstOrThrow({
    where: { workspaceId: actor.workspace.id, id: environmentId },
  });
  const existing = await prisma.applicationSecret.findMany({
    where: {
      workspaceId: actor.workspace.id,
      environmentId,
      path,
      deletedAt: null,
    },
  });
  return {
    revision: env.revision,
    diff: await Promise.all(Object.entries(values).map(async ([key, value]) => {
      const old = existing.find((r) => r.key === key);
      return {
        key,
        operation: !old
          ? "add"
          : await openValue(old) === value
            ? "unchanged"
            : "update",
      };
    })),
  };
}
export async function importSecrets(
  actor: SecretsActor,
  environmentId: string,
  path: string,
  source: string,
  revision: number,
) {
  const values = parseDotenv(source);
  return changeSecrets(
    actor,
    environmentId,
    Object.entries(values).map(([key, value]) => ({ key, value, path })),
    revision,
  );
}
export async function takeSnapshot(
  actor: SecretsActor,
  environmentId: string,
  label: string,
) {
  const env = await environmentAccess(actor, environmentId, "WRITE");
  if (actor.machine)
    throw new SecretsError("Use your member account to take snapshots.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${actor.workspace.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "SecretEnvironment" WHERE "workspaceId"=${actor.workspace.id} AND "id"=${environmentId} FOR UPDATE`;
    const row = await snapshot(
      tx,
      actor.workspace.id,
      environmentId,
      actor.user.id,
      parse(name, label),
    );
    await audit(
      tx,
      actor.workspace.id,
      env.projectId,
      actor.user.id,
      "snapshot_created",
      environmentId,
      row.id,
    );
    return row.id;
  });
}
export async function snapshotDiff(
  actor: SecretsActor,
  environmentId: string,
  snapshotId: string,
) {
  await environmentAccess(actor, environmentId, "WRITE");
  if (actor.machine)
    throw new SecretsError("Use your member account to inspect snapshots.");
  const s = await prisma.secretSnapshot.findFirst({
    where: { workspaceId: actor.workspace.id, environmentId, id: snapshotId },
  });
  if (!s) throw new SecretsError("That snapshot is unavailable.");
  const current = await prisma.applicationSecret.findMany({
    where: { workspaceId: actor.workspace.id, environmentId, deletedAt: null },
  });
  const fingerprint = async (r: {
    workspaceId: string; environmentId: string; path: string; key: string;
    secretEnc: string;
    dataKeyEnc: string;
    comment: string;
    tags: string[];
    ownerId: string;
    rotateEveryDays: number | null;
  }) =>
    sha256Hex(
      JSON.stringify([
        await openValue(r),
        r.comment,
        r.tags,
        r.ownerId,
        r.rotateEveryDays,
      ]),
    );
  return metadataDiff(
    await Promise.all(current.map(async (r) => ({ ...r, fingerprint: await fingerprint(r) }))),
    await Promise.all((await snapshotRows(s)).map(async (r) => ({ ...r, fingerprint: await fingerprint(r) }))),
  );
}
async function activeRecoveryOwners(actor: SecretsActor, ids: string[]) {
  const rows = await prisma.membership.findMany({
    where: {
      workspaceId: actor.workspace.id,
      userId: { in: [...new Set(ids)] },
      status: "ACTIVE",
      role: { not: "GUEST" },
      user: { disabledAt: null },
    },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}
function recoveryOwner(
  active: Set<string>,
  historic: string,
  current: string | undefined,
  restorer: string,
) {
  return active.has(historic)
    ? historic
    : current && active.has(current)
      ? current
      : restorer;
}
export async function rollbackSnapshot(
  actor: SecretsActor,
  environmentId: string,
  snapshotId: string,
) {
  await environmentAccess(actor, environmentId, "WRITE");
  if (actor.machine)
    throw new SecretsError("Use your member account to restore snapshots.");
  const s = await prisma.secretSnapshot.findFirst({
    where: { workspaceId: actor.workspace.id, environmentId, id: snapshotId },
  });
  if (!s) throw new SecretsError("That snapshot is unavailable.");
  const currentEnvironment = await prisma.secretEnvironment.findFirstOrThrow({
    where: { workspaceId: actor.workspace.id, id: environmentId },
  });
  const current = await prisma.applicationSecret.findMany({
    where: { workspaceId: actor.workspace.id, environmentId, deletedAt: null },
  });
  const old = await snapshotRows(s);
  const currentOwners = new Map(
    current.map((row) => [row.path + ":" + row.key, row.ownerId]),
  );
  const activeOwners = await activeRecoveryOwners(actor, [
    ...old.map((row) => row.ownerId),
    ...current.map((row) => row.ownerId),
    actor.user.id,
  ]);
  const desired = new Set(old.map((r) => r.path + ":" + r.key));
  const changes: Change[] = await Promise.all(old.map(async (r) => ({
    key: r.key,
    path: r.path,
    value: await openValue(r),
    comment: r.comment,
    tags: r.tags,
    ownerId: recoveryOwner(
      activeOwners,
      r.ownerId,
      currentOwners.get(r.path + ":" + r.key),
      actor.user.id,
    ),
    rotateEveryDays: r.rotateEveryDays,
  })));
  changes.push(
    ...current
      .filter((r) => !desired.has(r.path + ":" + r.key))
      .map((r) => ({ key: r.key, path: r.path, delete: true })),
  );
  if (!changes.length) return { pending: false };
  return submitChanges(
    actor,
    environmentId,
    parse(z.array(changeSchema).min(1), changes),
    currentEnvironment.revision,
  );
}
export async function secretHistory(
  actor: SecretsActor,
  environmentId: string,
  secretId: string,
  cursor?: string,
) {
  await environmentAccess(actor, environmentId, "KEYS");
  const secret = await prisma.applicationSecret.findFirst({
    where: { workspaceId: actor.workspace.id, environmentId, id: secretId },
  });
  if (!secret) throw new SecretsError("That key is unavailable.");
  checkPath(actor, secret.path, environmentId);
  if (
    cursor &&
    !(await prisma.applicationSecretVersion.findFirst({
      where: { workspaceId: actor.workspace.id, secretId, id: cursor },
      select: { id: true },
    }))
  )
    throw new SecretsError("That history page is unavailable.");
  return prisma.applicationSecretVersion.findMany({
    where: { workspaceId: actor.workspace.id, secretId },
    select: { id: true, createdAt: true, createdById: true, deleted: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}
export async function restoreVersion(
  actor: SecretsActor,
  environmentId: string,
  secretId: string,
  versionId: string,
) {
  await environmentAccess(actor, environmentId, "WRITE");
  const s = await prisma.applicationSecret.findFirst({
    where: { workspaceId: actor.workspace.id, environmentId, id: secretId },
  });
  if (!s) throw new SecretsError("That key is unavailable.");
  checkPath(actor, s.path, environmentId);
  const v = await prisma.applicationSecretVersion.findFirst({
    where: { workspaceId: actor.workspace.id, secretId, id: versionId },
  });
  if (!v) throw new SecretsError("That version is unavailable.");
  const meta = v.metadata as {
    comment: string;
    tags: string[];
    ownerId: string;
    rotateEveryDays: number | null;
  };
  const activeOwners = await activeRecoveryOwners(actor, [
    meta.ownerId,
    s.ownerId,
    actor.user.id,
  ]);
  return changeSecrets(actor, environmentId, [
    {
      key: s.key,
      path: s.path,
      value: await openValue(v),
      delete: v.deleted,
      ...meta,
      ownerId: recoveryOwner(
        activeOwners,
        meta.ownerId,
        s.ownerId,
        actor.user.id,
      ),
    },
  ]);
}
export async function revealVersion(
  actor: SecretsActor,
  environmentId: string,
  secretId: string,
  versionId: string,
) {
  const env = await environmentAccess(actor, environmentId, "READ");
  await requireSecretsMfa(actor, env.production);
  const s = await prisma.applicationSecret.findFirst({
    where: { workspaceId: actor.workspace.id, environmentId, id: secretId },
  });
  if (!s) throw new SecretsError("That key is unavailable.");
  checkPath(actor, s.path, environmentId);
  const v = await prisma.applicationSecretVersion.findFirst({
    where: { workspaceId: actor.workspace.id, secretId, id: versionId },
  });
  if (!v) throw new SecretsError("That version is unavailable.");
  await prisma.$transaction((tx) =>
    audit(
      tx,
      actor.workspace.id,
      env.projectId,
      actor.user.id,
      "version_revealed",
      environmentId,
      v.id,
      s.key,
    ),
  );
  return openValue(v);
}
