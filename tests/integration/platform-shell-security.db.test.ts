import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
import { indexSearchDocument } from "@/lib/search/documents";
import { searchDocuments, listActivity } from "@/lib/search/query";
import { notificationCentre } from "@/lib/shell/notifications";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { purgeWorkspace } from "@/lib/shell/retention";
import { existingOidcMember } from "@/lib/shell/oidc";
import { encryptSecret } from "@/lib/crypto";
import { dispatch } from "@/lib/notify";
import { recordActivity } from "@/lib/activity";
const suffix = uniqueSuffix();
const emailSuffix = `shell-${suffix}.test`;
const slugs = [`shell-${suffix}`, `other-shell-${suffix}`];
let ownerId: string,
  memberId: string,
  guestId: string,
  outsiderId: string,
  workspaceId: string,
  otherId: string,
  privateTeam: string,
  publicDoc: string,
  adminDoc: string,
  projectId: string,
  privateProjectId: string,
  providerId: string;
const actor = () => ({
  workspaceId,
  userId: memberId,
  role: "MEMBER" as const,
});
async function index(
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
  await prisma.ssoProvider.deleteMany({ where: { id: providerId } });
  await cleanup(slugs, emailSuffix);
  await prisma.$disconnect();
});
describe("platform search tenant and permission isolation", () => {
  it("checks current doc and project visibility even with stale index metadata", async () => {
    const hits = await searchDocuments(actor(), "Maker");
    expect(hits.map((h) => h.entityId)).toContain(publicDoc);
    expect(hits.map((h) => h.entityId)).toContain(projectId);
    expect(hits.map((h) => h.entityId)).not.toContain(adminDoc);
    expect(hits.map((h) => h.entityId)).not.toContain(privateProjectId);
  });
  it("includes admin docs and private teams for workspace admins", async () => {
    const hits = await searchDocuments(
      { workspaceId, userId: ownerId, role: "OWNER" },
      "Maker",
    );
    expect(hits.map((h) => h.entityId)).toContain(adminDoc);
    expect(hits.map((h) => h.entityId)).toContain(privateProjectId);
  });
  it("never returns a record from another workspace", async () => {
    const doc = await prisma.doc.create({
      data: { workspaceId: otherId, title: "Maker cross tenant" },
    });
    await index("doc", doc.id);
    const hits = await searchDocuments(actor(), "Maker");
    expect(hits.some((h) => h.entityId === doc.id)).toBe(false);
  });
  it("denies unauthorised and suspended members at query time", async () => {
    expect(
      await searchDocuments(
        { workspaceId, userId: outsiderId, role: "MEMBER" },
        "Maker",
      ),
    ).toEqual([]);
    await prisma.membership.update({
      where: { userId_workspaceId: { workspaceId, userId: memberId } },
      data: { status: "SUSPENDED" },
    });
    expect(await searchDocuments(actor(), "Maker")).toEqual([]);
    await prisma.membership.update({
      where: { userId_workspaceId: { workspaceId, userId: memberId } },
      data: { status: "ACTIVE" },
    });
  });
  it("enforces private and team index visibility", async () => {
    const doc = await prisma.doc.create({
      data: { workspaceId, title: "Maker owned" },
    });
    await index("doc", doc.id, { visibility: "PRIVATE", ownerId: ownerId });
    expect(
      (await searchDocuments(actor(), "Maker")).some(
        (h) => h.entityId === doc.id,
      ),
    ).toBe(false);
    await index("doc", doc.id, { visibility: "TEAM", teamId: privateTeam });
    expect(
      (await searchDocuments(actor(), "Maker")).some(
        (h) => h.entityId === doc.id,
      ),
    ).toBe(false);
    await prisma.teamMember.create({
      data: { teamId: privateTeam, userId: memberId },
    });
    expect(
      (await searchDocuments(actor(), "Maker")).some(
        (h) => h.entityId === doc.id,
      ),
    ).toBe(true);
    await prisma.teamMember.deleteMany({
      where: { teamId: privateTeam, userId: memberId },
    });
  });
  it("checks channel membership including public channels for guests", async () => {
    const c = await prisma.channel.create({
      data: {
        workspaceId,
        name: "Maker secret",
        slug: "maker-secret",
        kind: "PRIVATE",
      },
    });
    const m = await prisma.message.create({
      data: { workspaceId, channelId: c.id, body: "Maker secret" },
    });
    await index("message", m.id);
    expect(
      (await searchDocuments(actor(), "Maker")).some(
        (h) => h.entityId === m.id,
      ),
    ).toBe(false);
    await prisma.channelMember.create({
      data: { channelId: c.id, userId: memberId },
    });
    expect(
      (await searchDocuments(actor(), "Maker")).some(
        (h) => h.entityId === m.id,
      ),
    ).toBe(true);
    await prisma.channel.update({
      where: { id: c.id },
      data: { kind: "PUBLIC" },
    });
    expect(
      (
        await searchDocuments(
          { workspaceId, userId: guestId, role: "GUEST" },
          "Maker",
        )
      ).some((h) => h.entityId === m.id),
    ).toBe(false);
  });
  it("hides file metadata attached to private-team channel messages", async () => {
    const channel = await prisma.channel.create({
      data: {
        workspaceId,
        name: "Maker team",
        slug: "maker-team",
        kind: "PUBLIC",
        teamId: privateTeam,
      },
    });
    const message = await prisma.message.create({
      data: { workspaceId, channelId: channel.id, body: "Maker team file" },
    });
    const file = await prisma.fileObject.create({
      data: {
        workspaceId,
        storageKey: `test/${suffix}/team-file`,
        filename: "Maker private.pdf",
        contentType: "application/pdf",
        size: 10,
      },
    });
    await prisma.messageAttachment.create({
      data: { messageId: message.id, fileId: file.id },
    });
    await index("file", file.id);
    expect(
      (await searchDocuments(actor(), "Maker")).some(
        (h) => h.entityId === file.id,
      ),
    ).toBe(false);
  });
  it("rejects deleted source rows and unknown sensitive types", async () => {
    await index("vault_item", "not-real");
    await index("doc", "deleted-doc");
    const hits = await searchDocuments(actor(), "Maker");
    expect(
      hits.some((h) => ["not-real", "deleted-doc"].includes(h.entityId)),
    ).toBe(false);
  });
  it("filters restricted activity with the same source permissions", async () => {
    await recordActivity({
      workspaceId,
      entityType: "doc",
      entityId: adminDoc,
      summary: "Hidden Maker change",
      verb: "edited",
    });
    await recordActivity({
      workspaceId,
      entityType: "doc",
      entityId: publicDoc,
      summary: "Visible Maker change",
      verb: "edited",
    });
    const rows = await listActivity(actor());
    expect(rows.some((r) => r.summary === "Hidden Maker change")).toBe(false);
    expect(rows.some((r) => r.summary === "Visible Maker change")).toBe(true);
  });
});
describe("notification centre", () => {
  it("counts only this member's active notifications in this tenant", async () => {
    for (const [ws, user] of [
      [workspaceId, memberId],
      [workspaceId, ownerId],
      [otherId, ownerId],
    ])
      await dispatch(ws, {
        type: "mention",
        title: "Maker mention",
        recipients: [user],
        data: { sourceType: "doc", sourceId: publicDoc, channelId: null },
      });
    const centre = await notificationCentre(workspaceId, memberId);
    expect(centre.unread).toBe(1);
    expect(centre.mentions).toBe(1);
    await prisma.notification.updateMany({
      where: { workspaceId, userId: memberId },
      data: { archivedAt: new Date() },
    });
    expect((await notificationCentre(workspaceId, memberId)).unread).toBe(0);
  });
});
describe("export redaction", () => {
  it("exports content while excluding every credential and vault table", async () => {
    await prisma.monitor.create({
      data: {
        workspaceId,
        name: "Maker monitor",
        type: "HTTP",
        secretEnc: "NEVER_EXPORT_SECRET",
        config: { password: "NEVER_EXPORT_PASSWORD" },
        heartbeatTokenHash: "NEVER_EXPORT_HASH",
      },
    });
    await prisma.memberProfile.create({
      data: {
        workspaceId,
        userId: memberId,
        emergencyContactEnc: "NEVER_EXPORT_EMERGENCY",
      },
    });
    const bundle = await buildWorkspaceExport(workspaceId);
    const json = JSON.stringify(bundle);
    expect(json).toContain(publicDoc);
    expect(json).not.toContain("NEVER_EXPORT");
    expect(bundle.entities).not.toHaveProperty("Account");
    expect(bundle.entities).not.toHaveProperty("VaultItem");
    expect(bundle.entities).not.toHaveProperty("Message");
  });
});
describe("retention legal hold", () => {
  it("preserves old records on hold and only purges the configured tenant", async () => {
    const old = new Date("2020-01-01");
    const one = await prisma.linkItem.create({
      data: {
        workspaceId,
        title: "Old",
        url: "https://example.org",
        createdAt: old,
      },
    });
    const two = await prisma.linkItem.create({
      data: {
        workspaceId: otherId,
        title: "Other",
        url: "https://example.org",
        createdAt: old,
      },
    });
    await prisma.retentionPolicy.create({
      data: { workspaceId, entityType: "links", keepDays: 30 },
    });
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { legalHold: true },
    });
    expect(await purgeWorkspace(workspaceId, new Date())).toBe(0);
    expect(
      await prisma.linkItem.findUnique({ where: { id: one.id } }),
    ).not.toBeNull();
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { legalHold: false },
    });
    expect(await purgeWorkspace(workspaceId, new Date())).toBe(1);
    expect(
      await prisma.linkItem.findUnique({ where: { id: two.id } }),
    ).not.toBeNull();
  });
});
describe("OIDC no automatic account creation", () => {
  it("only authenticates verified, existing active members", async () => {
    const provider = await prisma.ssoProvider.create({
      data: {
        name: "Maker SSO",
        issuer: "https://id.example.org",
        clientId: "client",
        clientSecretEnc: encryptSecret("sso-secrets", "secret"),
        allowedDomains: [emailSuffix],
      },
    });
    providerId = provider.id;
    const profile = {
      sub: "subject",
      email: `member@${emailSuffix}`,
      email_verified: true,
    };
    const count = await prisma.user.count();
    expect((await existingOidcMember(`oidc-${providerId}`, profile))?.id).toBe(
      memberId,
    );
    expect(
      await existingOidcMember(`oidc-${providerId}`, {
        ...profile,
        email: `new@${emailSuffix}`,
      }),
    ).toBeNull();
    expect(
      await existingOidcMember(`oidc-${providerId}`, {
        ...profile,
        email: `outside@${emailSuffix}`,
      }),
    ).toBeNull();
    expect(
      await existingOidcMember(`oidc-${providerId}`, {
        ...profile,
        email_verified: false,
      }),
    ).toBeNull();
    expect(await prisma.user.count()).toBe(count);
  });
  it("rejects changed subjects, disabled users and disabled providers", async () => {
    const profile = {
      sub: "subject",
      email: `member@${emailSuffix}`,
      email_verified: true,
    };
    await prisma.account.create({
      data: {
        userId: memberId,
        provider: `oidc-${providerId}`,
        providerAccountId: "original",
        type: "oidc",
      },
    });
    expect(await existingOidcMember(`oidc-${providerId}`, profile)).toBeNull();
    await prisma.account.deleteMany({
      where: { provider: `oidc-${providerId}` },
    });
    await prisma.user.update({
      where: { id: memberId },
      data: { disabledAt: new Date() },
    });
    expect(await existingOidcMember(`oidc-${providerId}`, profile)).toBeNull();
    await prisma.user.update({
      where: { id: memberId },
      data: { disabledAt: null },
    });
    await prisma.ssoProvider.update({
      where: { id: providerId },
      data: { enabled: false },
    });
    expect(await existingOidcMember(`oidc-${providerId}`, profile)).toBeNull();
  });
});
