import "server-only";
import type { Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import {
  canEditTasks,
  canManageProject,
  visibleProjectWhere,
  type TaskActor,
} from "@/lib/tasks/access";
import type { LabelRef, ProjectPermissions, ProjectSummary } from "@/lib/tasks/types";
import { dateOnly } from "./formatters";

export function permissionsFor(actor: TaskActor, project: Pick<Project, "ownerId" | "status"> | null): ProjectPermissions {
  const archived = project?.status === "ARCHIVED";
  return {
    canEdit: canEditTasks(actor) && !archived,
    canComment: true,
    canManage: project ? canManageProject(actor, project) : hasRoleAtLeast(actor.membership.role, "ADMIN"),
  };
}

export async function projectSummary(project: Project): Promise<ProjectSummary> {
  const team = project.teamId ? await prisma.team.findUnique({ where: { id: project.teamId }, select: { name: true } }) : null;
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    status: project.status,
    ownerId: project.ownerId,
    teamId: project.teamId,
    teamName: team?.name ?? null,
    cyclesEnabled: project.cyclesEnabled,
    startsOn: dateOnly(project.startsOn),
    dueOn: dateOnly(project.dueOn),
  };
}

export async function workspaceLabels(workspaceId: string): Promise<LabelRef[]> {
  return prisma.label.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, tone: true } });
}

export async function findProjectByKey(actor: TaskActor, key: string) {
  if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(key)) return null;
  return prisma.project.findFirst({ where: { AND: [await visibleProjectWhere(actor), { key: key.toUpperCase() }] } });
}
