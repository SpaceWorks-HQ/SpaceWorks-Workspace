import { beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../../helpers/fixtures";
import { saveRecord, type Actor } from "@/lib/governance/service";
import { deleteObjects } from "@/lib/storage";

export const records = {} as {
  caseId: string;
};
export const suffix = uniqueSuffix(),
  domain = `@govextras-${suffix}.test`,
  slugs = [`govex-${suffix}`, `govex-other-${suffix}`];
export let owner: Actor,
  admin: Actor,
  handler: Actor,
  second: Actor,
  other: Actor,
  guest: Actor,
  committee: string,
  docId: string,
  entityId: string;
export const proof = () =>
  new File(["%PDF-1.4\nGovernance evidence"], "proof.pdf", {
    type: "application/pdf",
  });
beforeAll(async () => {
  const users = await Promise.all(
    ["owner", "admin", "handler", "second", "other", "guest"].map((n) =>
      createUser(n + domain, n),
    ),
  );
  const workspace = await createWorkspace(slugs[0], users[0].id),
    otherWorkspace = await createWorkspace(slugs[1], users[4].id);
  owner = { user: users[0], workspace, membership: { role: "OWNER" } };
  admin = {
    user: users[1],
    workspace,
    membership: await addMember(workspace.id, users[1].id, "ADMIN"),
  };
  handler = {
    user: users[2],
    workspace,
    membership: await addMember(workspace.id, users[2].id, "MEMBER"),
  };
  second = {
    user: users[3],
    workspace,
    membership: await addMember(workspace.id, users[3].id, "MEMBER"),
  };
  other = {
    user: users[4],
    workspace: otherWorkspace,
    membership: { role: "OWNER" },
  };
  guest = {
    user: users[5],
    workspace,
    membership: await addMember(workspace.id, users[5].id, "GUEST"),
  };
  committee = (
    await saveRecord(owner, {
      kind: "COMMITTEE",
      title: "Internal Committee",
      status: "ACTIVE",
      details: { committeeType: "COMMITTEE", mandate: "Safeguarding" },
    })
  ).id;
  entityId = (
    await saveRecord(owner, {
      kind: "LEGAL_ENTITY",
      title: "Kochi Community Trust",
      status: "ACTIVE",
      details: { entityType: "TRUST" },
    })
  ).id;
  docId = (
    await prisma.doc.create({
      data: {
        workspaceId: workspace.id,
        title: "Emergency response SOP",
        contentText: "Check exits. Gather outside. Call the designated lead.",
        contentHtml:
          "<p>Check exits. Gather outside. Call the designated lead.</p>",
        createdById: owner.user.id,
        visibility: "ADMINS",
      },
    })
  ).id;
});
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspaceId: { in: [owner.workspace.id, other.workspace.id] } },
    select: { storageKey: true },
  });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup(slugs, domain);
});
