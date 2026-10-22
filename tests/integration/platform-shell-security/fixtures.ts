import { beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../../helpers/fixtures";
import { indexSearchDocument } from "@/lib/search/documents";

export const records = {} as {
  providerId: string;
};
export const suffix = uniqueSuffix();
export const emailSuffix = `shell-${suffix}.test`;
export const slugs = [`shell-${suffix}`, `other-shell-${suffix}`];
export let ownerId: string,
  memberId: string,
  guestId: string,
  outsiderId: string,
  workspaceId: string,
  otherId: string,
  privateTeam: string,
  publicDoc: string,
  adminDoc: string,
  projectId: string,
  privateProjectId: string;
export const actor = () => ({
  workspaceId,
  userId: memberId,
  role: "MEMBER" as const,
});
export async function index(
  type: string,
  id: string,
  extras: Record<string, unknown> = {},
) {
  await indexSearchDocument({
    workspaceId,
    entityType: type,
    entityId: id,
    title: `Maker ${id}`,
    url: `/w/${slugs[0]}/docs/${id}`,
    ...extras,
  });
}
beforeAll(async () => {
  ownerId = (await createUser(`owner@${emailSuffix}`)).id;
  memberId = (await createUser(`member@${emailSuffix}`)).id;
  guestId = (await createUser(`guest@${emailSuffix}`)).id;
  outsiderId = (await createUser(`outside@${emailSuffix}`)).id;
  workspaceId = (await createWorkspace(slugs[0], ownerId)).id;
  otherId = (await createWorkspace(slugs[1], ownerId)).id;
  await addMember(workspaceId, memberId);
  await addMember(workspaceId, guestId, "GUEST");
  privateTeam = (
    await prisma.team.create({
      data: {
        workspaceId,
        name: "Private",
        slug: "private",
        visibility: "PRIVATE",
      },
    })
  ).id;
  projectId = (
    await prisma.project.create({
      data: { workspaceId, key: "OPEN", name: "Maker public" },
    })
  ).id;
  privateProjectId = (
    await prisma.project.create({
      data: {
        workspaceId,
        key: "HIDE",
        name: "Maker private",
        teamId: privateTeam,
      },
    })
  ).id;
  publicDoc = (
    await prisma.doc.create({
      data: { workspaceId, title: "Maker public", contentText: "maker text" },
    })
  ).id;
  adminDoc = (
    await prisma.doc.create({
      data: { workspaceId, title: "Maker admin", visibility: "ADMINS" },
    })
  ).id;
  await index("doc", publicDoc);
  await index("doc", adminDoc);
  await index("project", privateProjectId);
  await index("project", projectId);
});
afterAll(async () => {
  await prisma.ssoProvider.deleteMany({ where: { id: records.providerId } });
  await cleanup(slugs, emailSuffix);
  await prisma.$disconnect();
});
