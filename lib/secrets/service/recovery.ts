import "server-only";
import { openValue } from "@/lib/secrets/encryption";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { environmentAccess, checkPath, type SecretsActor } from "@/lib/secrets/access";
import { SecretsError } from "@/lib/secrets/values";
import { snapshotRows, type Change } from "@/lib/secrets/mutations";
import { changeSchema, parse } from "./validation";
import { changeSecrets, submitChanges } from "./changes";

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
