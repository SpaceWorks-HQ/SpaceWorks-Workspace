import "server-only";
import { encryptionSummary } from "@/lib/vault/hierarchy";
import type { SecretsView } from "./types";
import { prisma } from "@/lib/db";
import { guard } from "@/lib/approvals/ops";
import { canManageSecrets } from "@/lib/roles";
import { environmentAccess, type SecretsActor } from "./access";
import { zonedInputToIso } from "@/lib/timeZone";
import { SecretsError, normalisePath } from "./values";
export async function loadSecrets(
  actor: SecretsActor,
  projectId?: string,
  environmentId?: string,
  path = "/",
  snapshotCursor?: string,
  keysCursor?: string,
): Promise<SecretsView> {
  await guard(actor);
  normalisePath(path);
  const all = await prisma.secretProject.findMany({
    where: { workspaceId: actor.workspace.id },
    select: {
      id: true,
      name: true,
      slug: true,
      environments: {
        select: {
          id: true,
          name: true,
          slug: true,
          production: true,
          protected: true,
          position: true,
          revision: true,
        },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  const projects = [];
  for (const p of all) {
    const environments = [];
    for (const env of p.environments)
      try {
        const permitted = await environmentAccess(actor, env.id, "KEYS");
        environments.push({ ...env, accessRole: permitted.accessRole });
      } catch {}
    if (environments.length || canManageSecrets(actor.membership))
      projects.push({ ...p, environments });
  }
  const project =
    projects.find((p) => p.id === projectId) ??
    projects.find((p) => p.environments.some((e) => e.id === environmentId)) ??
    projects[0] ??
    null;
  const environment =
    project?.environments.find((e) => e.id === environmentId) ??
    project?.environments[0] ??
    null;
  const members = await prisma.membership.findMany({
    where: {
      workspaceId: actor.workspace.id,
      status: "ACTIVE",
      role: { not: "GUEST" },
      user: { disabledAt: null },
    },
    select: {
      userId: true,
      role: true,
      user: { select: { name: true, email: true } },
    },
    take: 2000,
  });
  if (!project || !environment)
    return {
      projects,
      project,
      environment,
      path,
      rows: [],
      comparison: [],
      folders: [],
      snapshots: [],
      changes: [],
      grants: [],
      tokens: [],
      audit: [],
      members,
      canManage: canManageSecrets(actor.membership),
      overview: null,
      identities: [],
      encryption: null,
    };
  if (
    snapshotCursor &&
    !(await prisma.secretSnapshot.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        environmentId: environment.id,
        id: snapshotCursor,
      },
      select: { id: true },
    }))
  )
    throw new SecretsError("That snapshot page is unavailable.");
  if (
    keysCursor &&
    !(await prisma.applicationSecret.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        environmentId: environment.id,
        path,
        deletedAt: null,
        id: keysCursor,
      },
      select: { id: true },
    }))
  )
    throw new SecretsError("That keys page is unavailable.");
  const envIds = project.environments.map((e) => e.id);
  const [rows, keys, folders, snapshots, changes] = await Promise.all([
    prisma.applicationSecret.findMany({
      where: {
        workspaceId: actor.workspace.id,
        environmentId: environment.id,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
        deletedAt: true,
        path: true,
        comment: true,
        tags: true,
        ownerId: true,
        rotateEveryDays: true,
        rotatedAt: true,
        updatedAt: true,
      },
      orderBy: [{ key: "asc" }, { id: "asc" }],
      take: 2001,
      ...(keysCursor ? { cursor: { id: keysCursor }, skip: 1 } : {}),
    }),
    prisma.applicationSecret.groupBy({
      by: ["key", "environmentId"],
      where: {
        workspaceId: actor.workspace.id,
        environmentId: { in: envIds },
        path,
        deletedAt: null,
      },
    }),
    prisma.secretFolder.findMany({
      where: { workspaceId: actor.workspace.id, environmentId: environment.id },
      select: { path: true },
      orderBy: { path: "asc" },
    }),
    prisma.secretSnapshot.findMany({
      where: { workspaceId: actor.workspace.id, environmentId: environment.id },
      select: {
        id: true,
        label: true,
        revision: true,
        createdAt: true,
        createdById: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      ...(snapshotCursor ? { cursor: { id: snapshotCursor }, skip: 1 } : {}),
    }),
    prisma.secretChange.findMany({
      where: { workspaceId: actor.workspace.id, environmentId: environment.id },
      select: {
        id: true,
        status: true,
        diff: true,
        revision: true,
        createdAt: true,
        createdById: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const admin = environment.accessRole === "ADMIN";
  const [grants, tokens, events] = await Promise.all([
    admin
      ? prisma.secretGrant.findMany({
          where: {
            workspaceId: actor.workspace.id,
            projectId: project.id,
            OR: [{ environmentId: environment.id }, { environmentId: "" }],
          },
          select: { id: true, environmentId: true, userId: true, role: true },
        })
      : [],
    admin
      ? prisma.secretServiceToken.findMany({
          where: {
            workspaceId: actor.workspace.id,
            environmentId: environment.id,
          },
          select: {
            id: true,
            name: true,
            path: true,
            writable: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
            ipAllowlist: true,
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        })
      : [],
    admin
      ? prisma.secretAudit.findMany({
          where: {
            workspaceId: actor.workspace.id,
            projectId: project.id,
            environmentId: environment.id,
          },
          select: {
            id: true,
            action: true,
            actorId: true,
            targetId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 300,
        })
      : [],
  ]);
  const presence = new Map<string, string[]>();
  for (const { key, environmentId } of keys) {
    const environments = presence.get(key) ?? [];
    environments.push(environmentId);
    presence.set(key, environments);
  }
  const comparison = [...presence].sort(([a], [b]) => a.localeCompare(b)).map(([key, environmentIds]) => ({ key, environmentIds }));
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
  return {
    projects,
    project,
    environment,
    path,
    rows: rows.slice(0, 2000),
    keysCursor,
    nextKeysCursor: rows.length > 2000 ? rows[1999].id : undefined,
    comparison,
    folders,
    snapshots,
    snapshotCursor,
    changes,
    grants,
    tokens,
    audit: events,
    members,
    canManage: canManageSecrets(actor.membership),
    overview,
    encryption: canManageSecrets(actor.membership) ? await encryptionSummary(actor.workspace.id, project.id) : null,
    identities: canManageSecrets(actor.membership) ? (await prisma.secretIdentity.findMany({ where: { workspaceId: actor.workspace.id, projectId: project.id }, select: { id: true, name: true, clientId: true, accessTtl: true, maxTtl: true, tokenUses: true, secretUses: true, secretTtl: true, loginIps: true, tokenIps: true, failureLimit: true, lockoutSeconds: true, lockedUntil: true, revokedAt: true, permissions: { select: { environmentId: true, path: true, role: true } }, credentials: { select: { id: true, remainingUses: true, expiresAt: true, revokedAt: true } }, tokens: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true, remainingUses: true }, take: 100 } }, take: 200 })).map(({ credentials, ...identity }) => ({ ...identity, clientSecretMetadata: credentials })) : [],
  };
}
export async function projectAudit(
  actor: SecretsActor,
  projectId: string,
  action?: string,
  environmentId?: string,
  from?: string,
  until?: string,
) {
  await guard(actor);
  const project = await prisma.secretProject.findFirst({
    where: { workspaceId: actor.workspace.id, id: projectId },
    include: { environments: { select: { id: true } } },
  });
  if (!project) return [];
  const ids = [];
  for (const e of project.environments)
    try {
      await environmentAccess(actor, e.id, "ADMIN");
      ids.push(e.id);
    } catch {}
  const start = from
    ? zonedInputToIso(from + "T00:00", actor.workspace.timezone)
    : null;
  const end = until
    ? zonedInputToIso(until + "T23:59", actor.workspace.timezone)
    : null;
  if ((from && !start) || (until && !end) || (start && end && start > end))
    throw new SecretsError("Choose a valid audit date range.");
  const result = await prisma.secretAudit.findMany({
    where: {
      workspaceId: actor.workspace.id,
      projectId,
      ...(action ? { action: { contains: action } } : {}),
      ...(start || end
        ? {
            createdAt: {
              ...(start ? { gte: new Date(start) } : {}),
              ...(end
                ? { lt: new Date(new Date(end).getTime() + 60_000) }
                : {}),
            },
          }
        : {}),
      OR: [
        {
          environmentId: {
            in: environmentId ? ids.filter((id) => id === environmentId) : ids,
          },
        },
        ...(canManageSecrets(actor.membership)
          ? [{ environmentId: null }]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10001,
  });
  if (result.length > 10000)
    throw new SecretsError(
      "There are too many audit records. Narrow the date range and try again.",
    );
  return result;
}
