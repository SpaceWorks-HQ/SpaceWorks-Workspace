import { beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, type Actor } from "@/lib/governance/service";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../../helpers/fixtures";

export const records = {} as {
  vendorId: string;
};
export const suffix = uniqueSuffix(),
  emailSuffix = `@governance-${suffix}.test`,
  slugs = [`governance-${suffix}`, `gov-other-${suffix}`];
export let actor: Actor, other: Actor, member: Actor, guest: Actor;
export let committeeId = "",
  organisationId = "",
  meetingId = "";
export const obligation = (extra = {}) => ({
  kind: "OBLIGATION",
  title: "Governance annual filing",
  status: "TODO",
  dueOn: "2026-12-31",
  details: { recurrence: "ANNUALLY" },
  ...extra,
});
beforeAll(async () => {
  const owner = await createUser(`owner${emailSuffix}`),
    stranger = await createUser(`other${emailSuffix}`),
    ordinary = await createUser(`member${emailSuffix}`),
    visitor = await createUser(`guest${emailSuffix}`);
  const workspace = await createWorkspace(slugs[0], owner.id),
    workspace2 = await createWorkspace(slugs[1], stranger.id);
  const membership = await prisma.membership.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId: owner.id },
  });
  actor = { user: owner, workspace, membership };
  other = {
    user: stranger,
    workspace: workspace2,
    membership: { role: "OWNER" },
  };
  member = {
    ...actor,
    user: ordinary,
    membership: await addMember(workspace.id, ordinary.id),
  };
  guest = {
    ...actor,
    user: visitor,
    membership: await addMember(workspace.id, visitor.id, "GUEST"),
  };
  committeeId = (
    await saveRecord(actor, {
      kind: "COMMITTEE",
      title: "Governing board",
      status: "ACTIVE",
      details: { committeeType: "BOARD" },
    })
  ).id;
  organisationId = (
    await prisma.organisation.create({
      data: {
        workspaceId: workspace.id,
        name: "Kochi print cooperative",
        ownerId: owner.id,
      },
    })
  ).id;
  meetingId = (
    await prisma.meeting.create({
      data: {
        workspaceId: workspace.id,
        title: "Board meeting",
        startsAt: new Date(),
        createdById: owner.id,
        visibility: "PRIVATE",
      },
    })
  ).id;
});
afterAll(async () => cleanup(slugs, emailSuffix));
