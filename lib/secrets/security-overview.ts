import "server-only";
import { prisma } from "@/lib/db";
import type { SecretsActor } from "./access";
import type { SecretProjectView, SecretsView } from "./types";

export async function loadSecurityOverview(
  actor: SecretsActor,
  project: SecretProjectView,
  members: SecretsView["members"],
  admin: boolean,
): Promise<SecretsView["overview"]> {
  const now = Date.now();
  const administeredIds = project.environments
    .filter((e) => e.accessRole === "ADMIN")
    .map((e) => e.id);
  const productionIds = project.environments
    .filter((e) => e.production && administeredIds.includes(e.id))
    .map((e) => e.id);
  const [securityRows, securityTokens, productionGrants, securityEvents] = admin
    ? await Promise.all([
        prisma.applicationSecret.findMany({
          where: {
            workspaceId: actor.workspace.id,
            environmentId: { in: administeredIds },
            deletedAt: null,
            rotateEveryDays: { not: null },
          },
          select: {
            environmentId: true,
            path: true,
            key: true,
            rotateEveryDays: true,
            rotatedAt: true,
          },
        }),
        prisma.secretServiceToken.findMany({
          where: {
            workspaceId: actor.workspace.id,
            environmentId: { in: administeredIds },
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { expiresAt: true, lastUsedAt: true },
        }),
        prisma.secretGrant.findMany({
          where: {
            workspaceId: actor.workspace.id,
            projectId: project.id,
            environmentId: { in: productionIds },
            role: { in: ["READ", "WRITE", "ADMIN"] },
          },
          select: { userId: true, environmentId: true },
        }),
        prisma.secretAudit.findMany({
          where: {
            workspaceId: actor.workspace.id,
            projectId: project.id,
            environmentId: { in: administeredIds },
            action: { in: ["revealed", "version_revealed"] },
          },
          select: {
            id: true,
            actorId: true,
            action: true,
            environmentId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ])
    : [[], [], [], []];
  const overview = admin
    ? {
        overdue: securityRows
          .filter(
            (r) =>
              r.rotateEveryDays &&
              now - r.rotatedAt.getTime() > r.rotateEveryDays * 86400000,
          )
          .map(
            (r) =>
              `${project.environments.find((e) => e.id === r.environmentId)?.name} ${r.path} ${r.key}`,
          ),
        tokensWithoutExpiry: securityTokens.filter((t) => !t.expiresAt).length,
        unusedTokens: securityTokens.filter(
          (t) => !t.lastUsedAt || now - t.lastUsedAt.getTime() > 30 * 86400000,
        ).length,
        recentReveals: securityEvents,
        productionHolders: productionIds.length
          ? members
              .filter(
                (m) =>
                  ["ADMIN", "OWNER"].includes(m.role) ||
                  productionGrants.some((g) => g.userId === m.userId),
              )
              .map((m) => m.user.name ?? m.user.email)
          : [],
      }
    : null;
  return overview;
}
