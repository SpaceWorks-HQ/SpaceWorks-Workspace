import "server-only";
import { openValue } from "@/lib/secrets/encryption";
import { prisma } from "@/lib/db";
import {
  environmentAccess,
  checkPath,
  requireSecretsMfa,
  type SecretsActor,
} from "@/lib/secrets/access";
import { SecretsError } from "@/lib/secrets/values";
import { audit } from "@/lib/secrets/mutations";

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
