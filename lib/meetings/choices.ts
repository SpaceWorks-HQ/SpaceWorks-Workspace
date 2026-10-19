import "server-only";
import { prisma } from "@/lib/db";
import { visibleProjectWhere, visibleTaskWhere } from "@/lib/tasks/access";
import { visibleDocsWhere } from "@/lib/docs/service";
import { taskUrl } from "@/lib/tasks/links";
import { type Actor, teamWhere } from "./core";

export async function collaborationChoices(actor: Actor) {
  const [members, projects, docs, teams, tasks] = await Promise.all([
    prisma.membership.findMany({
      where: {
        workspaceId: actor.workspace.id,
        status: "ACTIVE",
        user: { disabledAt: null },
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.project.findMany({
      where: {
        AND: [
          await visibleProjectWhere(actor),
          { status: { not: "ARCHIVED" } },
        ],
      },
      select: {
        id: true,
        name: true,
        cyclesEnabled: true,
        key: true,
        teamId: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.doc.findMany({
      where: {
        ...visibleDocsWhere(actor.workspace.id, actor.membership.role),
        archivedAt: null,
      },
      select: { id: true, title: true, visibility: true },
      orderBy: { title: "asc" },
      take: 300,
    }),
    prisma.team.findMany({
      where: { workspaceId: actor.workspace.id, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.task.findMany({
      where: { AND: [await visibleTaskWhere(actor), { archivedAt: null }] },
      select: {
        id: true,
        title: true,
        number: true,
        project: { select: { key: true } },
      },
      orderBy: { number: "desc" },
      take: 300,
    }),
  ]);
  const hidden = await teamWhere(actor);
  const hiddenIds = hidden.OR?.find((v) => v.teamId !== null)?.teamId;
  return {
    members: members.map((m) => ({
      value: m.user.id,
      label: m.user.name ?? "Member",
    })),
    projects,
    docs,
    teams: teams
      .filter((t) => !hiddenIds || !hiddenIds.notIn.includes(t.id))
      .map((t) => ({ value: t.id, label: t.name })),
    tasks: tasks.map((t) => ({
      value: t.id,
      label: `#${t.number} ${t.title}`,
      href: taskUrl(actor.workspace.slug, t.project?.key, t.number),
    })),
  };
}

export const optionalChoice = (label = "None") => ({ value: "", label });
export const options = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/^./, (s) => s.toUpperCase()),
  }));
