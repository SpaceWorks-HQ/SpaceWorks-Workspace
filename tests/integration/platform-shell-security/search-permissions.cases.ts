import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { searchDocuments, listActivity } from "@/lib/search/query";
import { recordActivity } from "@/lib/activity";
import {
  suffix,
  ownerId,
  memberId,
  guestId,
  outsiderId,
  workspaceId,
  otherId,
  privateTeam,
  publicDoc,
  adminDoc,
  projectId,
  privateProjectId,
  actor,
  index,
} from "./fixtures";

export function registerSearchPermissionsTests() {
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
}
