import { afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  mutateMeeting,
} from "@/lib/meetings/service";
import type { Actor } from "@/lib/meetings/core";
import {
  addMember,
  cleanup,
  createUser,
  createWorkspace,
  uniqueSuffix,
} from "../../helpers/fixtures";

export const suffix = uniqueSuffix();
export const domain = `@collaboration-${suffix}.test`;
export const slugs = [`collaboration-a-${suffix}`, `collaboration-b-${suffix}`];
export let owner: Actor, member: Actor, guest: Actor, outsider: Actor;
export let projectId: string,
  meetingId: string,
  foreignMeetingId: string,
  docId: string;
export const records = {} as {
  pollId: string;
  cycleId: string;
  nextCycleId: string;
  goalId: string;
};
export const startsAt = new Date(Date.now() + 2 * 86_400_000);
export const endsAt = new Date(startsAt.getTime() + 3_600_000);

async function actor(userId: string, workspaceId: string): Promise<Actor> {
  const [user, workspace, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId, workspaceId } },
    }),
  ]);
  return { user, workspace, membership };
}
export function registerCollaborationFixtures() {
  beforeAll(async () => {
    const [a, b, c, d] = await Promise.all([
      createUser(`owner${domain}`, "Owner"),
      createUser(`member${domain}`, "Maker"),
      createUser(`guest${domain}`, "Guest"),
      createUser(`outsider${domain}`, "Outsider"),
    ]);
    const first = await createWorkspace(slugs[0], a.id),
      second = await createWorkspace(slugs[1], d.id);
    await addMember(first.id, b.id);
    await addMember(first.id, c.id, "GUEST");
    owner = await actor(a.id, first.id);
    member = await actor(b.id, first.id);
    guest = await actor(c.id, first.id);
    outsider = await actor(d.id, second.id);
    const project = await prisma.project.create({
      data: {
        workspaceId: first.id,
        key: "BUILD",
        name: "Community build",
        ownerId: a.id,
        cyclesEnabled: true,
        columns: { create: { name: "To do", position: 0 } },
      },
    });
    projectId = project.id;
    const doc = await prisma.doc.create({
      data: {
        workspaceId: first.id,
        title: "Workshop agreement",
        contentHtml: "<p>Keep the space ready for the next maker.</p>",
        contentText: "Keep the space ready for the next maker.",
        createdById: a.id,
      },
    });
    docId = doc.id;
    meetingId = (
      await mutateMeeting(owner, {
        op: "create",
        title: "Build review",
        startsAt,
        endsAt,
        attendeeIds: [member.user.id],
      })
    ).id;
    foreignMeetingId = (
      await mutateMeeting(outsider, {
        op: "create",
        title: "Other workspace",
        startsAt,
        endsAt,
      })
    ).id;
  });
  afterAll(async () => {
    await cleanup(slugs, domain);
  });
}
