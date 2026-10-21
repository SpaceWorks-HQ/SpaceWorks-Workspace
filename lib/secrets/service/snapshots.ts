import "server-only";
import { openValue } from "@/lib/secrets/encryption";
import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";
import { environmentAccess, type SecretsActor } from "@/lib/secrets/access";
import { metadataDiff, SecretsError } from "@/lib/secrets/values";
import { audit, snapshot, snapshotRows } from "@/lib/secrets/mutations";
import { name, parse } from "./validation";

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
