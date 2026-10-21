import "server-only";
import { randomUUID } from "node:crypto";
import { sealValue, openValue, sealPayload, openPayload } from "./encryption";
import type { Prisma, ApplicationSecret } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import {
  indexSearchDocument,
  removeSearchDocument,
} from "@/lib/search/documents";
import { SecretsError } from "./values";
export type Change = {
  key: string;
  path: string;
  value?: string;
  delete?: boolean;
  comment?: string;
  tags?: string[];
  ownerId?: string;
  rotateEveryDays?: number | null;
};
export async function audit(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  actorId: string | null,
  action: string,
  environmentId?: string,
  targetId?: string,
  secretKey?: string,
  machineId?: string,
) {
  await tx.secretAudit.create({
    data: { workspaceId, projectId, actorId: machineId ? `machine:${machineId}` : actorId, action, environmentId, targetId, secretKey },
  });
  await recordAuditEvent({
    client: tx,
    workspaceId,
    actorId: machineId ? null : actorId,
    action: `secrets.${action}`,
    targetType: "SecretProject",
    targetId: projectId,
    metadata: {
      environmentId: environmentId ?? null,
      recordId: targetId ?? null,
      secretKey: secretKey ?? null,
      machineId: machineId ?? null,
      responsibleUserId: machineId ? actorId : null,
    },
  });
}
export async function snapshot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  environmentId: string,
  actorId: string,
  label: string,
) {
  const env = await tx.secretEnvironment.findFirstOrThrow({
    where: { workspaceId, id: environmentId },
  });
  const rows = await tx.applicationSecret.findMany({
    where: { workspaceId, environmentId, deletedAt: null },
  });
  const id = randomUUID();
  return tx.secretSnapshot.create({
    data: {
      id, workspaceId,
      environmentId,
      revision: env.revision,
      label,
      createdById: actorId,
      ...await sealPayload(workspaceId, environmentId, "snapshot", id, JSON.stringify(rows), tx),
    },
  });
}
export async function applyChanges(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  environmentId: string,
  changes: Change[],
  actorId: string,
  expectedRevision?: number,
) {
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${workspaceId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "SecretEnvironment" WHERE "workspaceId"=${workspaceId} AND "id"=${environmentId} FOR UPDATE`;
  const env = await tx.secretEnvironment.findFirstOrThrow({
    where: { workspaceId, id: environmentId },
  });
  if (expectedRevision !== undefined && expectedRevision !== env.revision)
    throw new SecretsError(
      "This environment changed. Prepare a new change request.",
    );
  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { slug: true },
  });
  const project = await tx.secretProject.findFirstOrThrow({
    where: { workspaceId, id: env.projectId },
  });
  if (env.revision === 0)
    await snapshot(tx, workspaceId, environmentId, actorId, "Initial state");
  for (const change of changes) {
    const existing = await tx.applicationSecret.findFirst({
      where: { workspaceId, environmentId, path: change.path, key: change.key },
    });
    if (change.delete && (!existing || existing.deletedAt)) continue;
    const previousValue =
      existing && !existing.deletedAt ? await openValue(existing, tx) : undefined;
    if (
      !change.delete &&
      existing &&
      !existing.deletedAt &&
      change.value === previousValue &&
      change.comment === undefined &&
      change.tags === undefined &&
      change.ownerId === undefined &&
      change.rotateEveryDays === undefined
    )
      continue;
    if (
      change.ownerId &&
      !(await tx.membership.findFirst({
        where: {
          workspaceId,
          userId: change.ownerId,
          status: "ACTIVE",
          role: { not: "GUEST" },
          user: { disabledAt: null },
        },
      }))
    )
      throw new SecretsError("Choose an active member as owner.");
    const data = change.delete
      ? { deletedAt: new Date() }
      : {
          ...await sealValue(change.value ?? "", { workspaceId, environmentId, path: change.path, key: change.key }, tx),
          deletedAt: null,
          rotatedAt:
            existing && !existing.deletedAt && previousValue === change.value
              ? existing.rotatedAt
              : new Date(),
          ...(change.comment !== undefined ? { comment: change.comment } : {}),
          ...(change.tags !== undefined ? { tags: change.tags } : {}),
          ...(change.ownerId ? { ownerId: change.ownerId } : {}),
          ...(change.rotateEveryDays !== undefined
            ? { rotateEveryDays: change.rotateEveryDays }
            : {}),
        };
    const row = existing
      ? await tx.applicationSecret.update({
          where: { id: existing.id, workspaceId },
          data,
        })
      : await tx.applicationSecret.create({
          data: {
            workspaceId,
            environmentId,
            path: change.path,
            key: change.key,
            ownerId: change.ownerId ?? actorId,
            secretEnc: "",
            dataKeyEnc: "",
            ...data,
          },
        });
    await tx.applicationSecretVersion.create({
      data: {
        workspaceId,
        secretId: row.id,
        secretEnc: row.secretEnc,
        dataKeyEnc: row.dataKeyEnc,
        metadata: {
          comment: row.comment,
          tags: row.tags,
          ownerId: row.ownerId,
          rotateEveryDays: row.rotateEveryDays,
        },
        deleted: !!row.deletedAt,
        createdById: actorId,
      },
    });
    if (!change.delete)
      await tx.secretFolder.upsert({
        where: {
          workspaceId_environmentId_path: {
            workspaceId,
            environmentId,
            path: row.path,
          },
        },
        create: { workspaceId, environmentId, path: row.path },
        update: {},
      });
    await removeSearchDocument("application_secret", row.id, tx);
    if (!row.deletedAt)
      await indexSearchDocument(
        {
          workspaceId,
          entityType: "application_secret",
          entityId: row.id,
          title: `${project.name} / ${env.name} / ${row.path} / ${row.key}`,
          url: `/w/${workspace.slug}/secrets?project=${project.id}&environment=${env.id}&path=${encodeURIComponent(row.path)}`,
          visibility: "PRIVATE",
          ownerId: row.ownerId,
        },
        tx,
      );
    await audit(
      tx,
      workspaceId,
      env.projectId,
      actorId,
      change.delete ? "deleted" : existing ? "updated" : "created",
      environmentId,
      row.id,
    );
  }
  await tx.secretEnvironment.update({
    where: { workspaceId, id: environmentId },
    data: { revision: { increment: 1 } },
  });
  await snapshot(tx, workspaceId, environmentId, actorId, "Automatic snapshot");
}
export async function snapshotRows(value: { id: string; workspaceId: string; environmentId: string; secretEnc: string; dataKeyEnc: string }, client?: import("@/lib/db").DbClient) {
  return JSON.parse(await openPayload(value, "snapshot", client)) as ApplicationSecret[];
}
