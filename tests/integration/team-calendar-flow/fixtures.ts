import { afterAll, beforeAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { loadCalendar } from "@/lib/calendar/query";
import { deleteObjects } from "@/lib/storage";
import type { Actor } from "@/lib/meetings/core";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../../helpers/fixtures";

export const suffix = uniqueSuffix(),
  domain = `@calendar-${suffix}.test`,
  slugs = [`calendar-a-${suffix}`, `calendar-b-${suffix}`];
export let owner: Actor,
  member: Actor,
  guest: Actor,
  other: Actor,
  projectId: string,
  taskId: string,
  secretTaskId: string,
  teamId: string;
export const records = {} as {
  meetingId: string;
  entryId: string;
};
export const start = new Date(Date.now() + 3 * 86400000),
  end = new Date(start.getTime() + 86400000);
export const command = (extra: Record<string, unknown> = {}) => ({
  title: "Community office planning",
  startsAt: start,
  duration: 60,
  timezone: "Asia/Kolkata",
  until: start,
  ...extra,
});
export async function calendar(actor: Actor) {
  return loadCalendar(
    actor,
    new Date(Date.now() - 86400000),
    new Date(Date.now() + 14 * 86400000),
  );
}
async function makeActor(userId: string, workspaceId: string): Promise<Actor> {
  const [user, workspace, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId, workspaceId } },
    }),
  ]);
  return { user, workspace, membership };
}
export function registerCalendarFixtures() {
  beforeAll(async () => {
    const [a, b, c, d] = await Promise.all([
      createUser(`owner${domain}`),
      createUser(`member${domain}`),
      createUser(`guest${domain}`),
      createUser(`other${domain}`),
    ]);
    const ws = await createWorkspace(slugs[0], a.id),
      foreign = await createWorkspace(slugs[1], d.id);
    await addMember(ws.id, b.id);
    await addMember(ws.id, c.id, "GUEST");
    [owner, member, guest, other] = await Promise.all([
      makeActor(a.id, ws.id),
      makeActor(b.id, ws.id),
      makeActor(c.id, ws.id),
      makeActor(d.id, foreign.id),
    ]);
    const team = await prisma.team.create({
      data: {
        workspaceId: ws.id,
        name: "Finance team",
        slug: "finance",
        visibility: "PRIVATE",
        members: { create: { userId: a.id } },
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        workspaceId: ws.id,
        name: "Office work",
        key: "OFFICE",
        ownerId: a.id,
      },
    });
    projectId = project.id;
    const secret = await prisma.project.create({
      data: {
        workspaceId: ws.id,
        name: "Private finance",
        key: "FIN",
        teamId: team.id,
        ownerId: a.id,
      },
    });
    taskId = (
      await prisma.task.create({
        data: {
          workspaceId: ws.id,
          number: 990,
          title: "Prepare volunteer schedule",
          projectId: project.id,
          dueAt: start,
          creatorId: a.id,
          assignees: { create: { userId: b.id } },
        },
      })
    ).id;
    secretTaskId = (
      await prisma.task.create({
        data: {
          workspaceId: ws.id,
          number: 991,
          title: "Private team due date",
          projectId: secret.id,
          dueAt: start,
          creatorId: a.id,
          assignees: { create: { userId: b.id } },
        },
      })
    ).id;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    const files = await prisma.fileObject.findMany({
      where: { workspaceId: owner.workspace.id, folder: "/calendar" },
      select: { storageKey: true },
    });
    await deleteObjects(files.map((f) => f.storageKey));
    await cleanup(slugs, domain);
  });
}
