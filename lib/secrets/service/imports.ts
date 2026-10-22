import "server-only";
import { openValue } from "@/lib/secrets/encryption";
import { prisma } from "@/lib/db";
import {
  environmentAccess,
  checkPath,
  requireSecretsMfa,
  type SecretsActor,
} from "@/lib/secrets/access";
import { normalisePath, parseDotenv } from "@/lib/secrets/values";
import { changeSecrets } from "./changes";

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
