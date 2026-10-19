import { randomUUID } from "node:crypto";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createWorkspaceWithDefaults } from "@/lib/workspaces";

/** Unique suffix per test file so integration suites never collide. */
export function uniqueSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function createUser(email: string, name = "Test Member") {
  return prisma.user.create({ data: { email, name, emailVerified: new Date() } });
}

export async function createWorkspace(slug: string, ownerId: string) {
  return prisma.$transaction((tx) => createWorkspaceWithDefaults(tx, { name: `Workspace ${slug}`, slug, ownerId }));
}

export async function addMember(workspaceId: string, userId: string, role: WorkspaceRole = "MEMBER") {
  return prisma.membership.create({ data: { workspaceId, userId, role } });
}

export async function cleanup(workspaceSlugs: string[], emailSuffix: string) {
  await prisma.workspace.deleteMany({ where: { slug: { in: workspaceSlugs } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: emailSuffix } } });
}
