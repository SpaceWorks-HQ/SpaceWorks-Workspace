import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { deleteFile, FILE_NOT_FOUND, libraryWhere, linkFile, moveFiles, purgeDeletedFiles, renameFile, restoreFile, restoreFileVersion, uploadNewVersion } from "@/lib/files/service";
import { createNote, updateNote } from "@/lib/notepad/service";
import { NOTE_CONFLICT } from "@/lib/notepad/saving";
import { recordActivity } from "@/lib/activity";
import { canAccessResource, listActivity, searchDocuments } from "@/lib/search/query";
import { indexSearchDocument } from "@/lib/search/documents";
import { searchWorkspace } from "@/lib/assistant/tools/workspace";
import { createTask } from "@/lib/assistant/tools/tasks";
import { buildFeed } from "@/lib/community/feeds";
import type { Principal, ToolChannel } from "@/lib/assistant/principal";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

vi.mock("@/lib/storage", async (original) => ({ ...await original<typeof import("@/lib/storage")>(), deleteObjects: vi.fn(async () => undefined) }));

const suffix = uniqueSuffix();
const term = `Reviewfixture${suffix}`;
let w: World;
const actor = (who: "owner" | "admin" | "member" | "guest") => ({ workspace: w.a, user: w.users[who], membership: { role: ({ owner: "OWNER", admin: "ADMIN", member: "MEMBER", guest: "GUEST" } as const)[who] } });
const principal = (who: "owner" | "admin" | "member" | "guest") => w.principal(w.users[who].id, actor(who).membership.role);
const searchActor = (who: "owner" | "admin" | "member" | "guest") => ({ workspaceId: w.a.id, userId: w.users[who].id, role: actor(who).membership.role });
async function assistantHits(p: Principal, query: string, via: ToolChannel = "chat") {
  const result = await searchWorkspace.run({ principal: p, via, now: new Date() }, { query, limit: 30 });
  return (result.data as { results: Array<{ id: string; title: string; snippet: string }> }).results;
}
async function file(name: string, extra: { taskId?: string; docId?: string; deletedAt?: Date } = {}) {
  return prisma.fileObject.create({ data: { workspaceId: w.a.id, uploadedById: w.users.admin.id, storageKey: `review/${suffix}/${name}`, filename: `${term}-${name}.txt`, folder: "/", contentType: "text/plain", size: 4, ...extra } });
}
async function indexFile(row: Awaited<ReturnType<typeof file>>) {
  // Deliberately broad/stale metadata must never grant access to its source.
  await indexSearchDocument({ workspaceId: w.a.id, entityType: "file", entityId: row.id, title: row.filename, body: "private folder", url: `/w/${w.a.slug}/files/${row.id}` });
}

beforeAll(async () => { w = await buildWorld(suffix); });
afterAll(async () => { vi.restoreAllMocks(); await cleanup(w.slugs, w.domain); await prisma.$disconnect(); });

describe.sequential("final review regressions", () => {
  it("keeps personal notes owner-only in assistant search and all tool transports", async () => {
    const created = await createNote(actor("member"), { title: `${term} private note`, contentHtml: "<p>Private present ideas</p>" });
    if (!created.ok) throw new Error(created.error);
    const id = created.data!.id;
    expect((await assistantHits(principal("member"), term)).map(h => h.id)).toContain(id);
    for (const who of ["owner", "admin", "guest"] as const) {
      expect((await assistantHits(principal(who), term)).map(h => h.id)).not.toContain(id);
      expect((await searchDocuments(searchActor(who), term)).map(h => h.entityId)).not.toContain(id);
    }
    for (const via of ["api", "mcp"] as const) {
      const token = { ...principal("owner"), kind: "token" as const, scopes: ["read:members" as const] };
      expect((await assistantHits(token, term, via)).map(h => h.id)).not.toContain(id);
    }
    await prisma.searchDocument.update({ where: { entityType_entityId: { entityType: "note", entityId: id } }, data: { visibility: "WORKSPACE", ownerId: w.users.owner.id } });
    expect((await assistantHits(principal("owner"), term)).map(h => h.id)).not.toContain(id);
    expect((await searchDocuments(searchActor("owner"), term)).map(h => h.entityId)).not.toContain(id);
  });

  it.each(["purchase", "reimbursement", "asset"] as const)("excludes %s array references from listing and every library mutation", async (kind) => {
    const row = await file(`array-${kind}`);
    if (kind === "purchase") await prisma.purchaseRequest.create({ data: { workspaceId: w.a.id, requesterId: w.users.admin.id, title: "Quote", items: [], totalMinor: 1000, fileIds: [row.id] } });
    if (kind === "reimbursement") await prisma.reimbursement.create({ data: { workspaceId: w.a.id, claimantId: w.users.admin.id, items: [], totalMinor: 1000, receiptFileIds: [row.id] } });
    if (kind === "asset") await prisma.asset.create({ data: { workspaceId: w.a.id, name: "Camera", tag: `camera-${suffix}`, category: "Tools", photoFileIds: [row.id] } });
    for (const who of ["member", "admin", "owner"] as const) {
      const a = actor(who);
      expect(await prisma.fileObject.count({ where: { AND: [{ id: row.id }, await libraryWhere(a)] } })).toBe(0);
      const denied = { ok: false, error: FILE_NOT_FOUND };
      expect(await renameFile(a, { fileId: row.id, filename: "changed.txt" })).toEqual(denied);
      expect(await moveFiles(a, { fileIds: [row.id], folder: "/changed" })).toEqual(denied);
      expect(await linkFile(a, { fileId: row.id, taskId: null, docId: null })).toEqual(denied);
      expect(await deleteFile(a, { fileId: row.id })).toEqual(denied);
      expect(await uploadNewVersion(a, { fileId: row.id, file: new File(["changed"], "changed.txt", { type: "text/plain" }) })).toEqual(denied);
      expect(await restoreFileVersion(a, { fileId: row.id, version: 1 })).toEqual(denied);
    }
    if (kind !== "asset") {
      expect(await findDownloadableFile(row.id, w.users.admin.id)).not.toBeNull();
      expect(await findDownloadableFile(row.id, w.users.owner.id)).not.toBeNull();
      expect(await findDownloadableFile(row.id, w.users.member.id)).toBeNull();
    }
    await prisma.fileObject.update({ where: { id: row.id }, data: { deletedAt: new Date("2020-01-01") } });
    for (const who of ["member", "admin", "owner"] as const) {
      expect(await restoreFile(actor(who), { fileId: row.id })).toEqual({ ok: false, error: FILE_NOT_FOUND });
      expect(await prisma.fileObject.count({ where: { AND: [{ id: row.id }, await libraryWhere(actor(who), { deleted: true })] } })).toBe(0);
    }
    await purgeDeletedFiles(new Date(), 1000);
    expect(await prisma.fileObject.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("authorises stale file search hits against live private tasks, docs, chat and receipts", async () => {
    const taskFile = await file("task", { taskId: w.tasks.secTask.id });
    const docFile = await file("doc", { docId: w.docs.adminDoc.id });
    const chatFile = await file("chat");
    const message = await prisma.message.create({ data: { workspaceId: w.a.id, channelId: w.channels.privateChannel.id, authorId: w.users.member.id, body: "Attachment" } });
    await prisma.messageAttachment.create({ data: { messageId: message.id, fileId: chatFile.id } });
    const receipt = await file("receipt");
    await prisma.reimbursement.create({ data: { workspaceId: w.a.id, claimantId: w.users.admin.id, totalMinor: 1000, items: [], receiptFileIds: [receipt.id] } });
    await recordActivity({ workspaceId: w.a.id, actorId: w.users.admin.id, verb: "uploaded", entityType: "file", entityId: receipt.id, summary: "Confidential receipt" });
    expect(await canAccessResource(searchActor("member"), "file", receipt.id)).toBe(false);
    expect(await canAccessResource(searchActor("admin"), "file", receipt.id)).toBe(true);
    expect((await listActivity(searchActor("member"), undefined, "file")).map(row => row.summary)).not.toContain("Confidential receipt");
    expect((await listActivity(searchActor("admin"), undefined, "file")).map(row => row.summary)).toContain("Confidential receipt");
    const publicFile = await file("public");
    for (const row of [taskFile, docFile, chatFile, receipt, publicFile]) await indexFile(row);
    const memberIds = (await assistantHits(principal("member"), term)).map(h => h.id);
    expect(memberIds).toContain(publicFile.id);
    expect(memberIds).toContain(chatFile.id);
    expect(memberIds).not.toContain(taskFile.id);
    expect(memberIds).not.toContain(docFile.id);
    expect(memberIds).not.toContain(receipt.id);
    const adminIds = (await assistantHits(principal("admin"), term)).map(h => h.id);
    expect(adminIds).toContain(taskFile.id);
    expect(adminIds).toContain(docFile.id);
    expect(adminIds).toContain(receipt.id);
    expect(adminIds).not.toContain(chatFile.id);
    const searchIds = (await searchDocuments(searchActor("member"), term)).map(h => h.entityId);
    expect(searchIds).toContain(publicFile.id);
    expect(searchIds).not.toContain(receipt.id);
    expect(searchIds).not.toContain(taskFile.id);
    await prisma.teamMember.create({ data: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } });
    expect((await assistantHits(principal("member"), term)).map(h => h.id)).toContain(taskFile.id);
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } } });
    expect((await assistantHits(principal("member"), term)).map(h => h.id)).not.toContain(taskFile.id);
    const job = w.principal(w.users.owner.id, "OWNER", "job");
    expect((await assistantHits(job, term)).map(h => h.id)).not.toContain(docFile.id);
  });

  it("indexes live task team metadata when linking a library file", async () => {
    const row = await file("index-team");
    expect(await linkFile(actor("admin"), { fileId: row.id, taskId: w.tasks.secTask.id, docId: null })).toMatchObject({ ok: true });
    expect(await prisma.searchDocument.findUnique({ where: { entityType_entityId: { entityType: "file", entityId: row.id } } })).toMatchObject({ teamId: w.projects.sec.teamId, projectId: w.projects.sec.id, visibility: "TEAM" });
  });

  it("revokes calendar task entries after team removal and project archival, preserving projectless tasks", async () => {
    const feed = { workspace: w.a, userId: w.users.member.id, role: "MEMBER" as const, scope: "PERSONAL" as const };
    const dueAt = new Date(Date.now() + 86400000);
    await prisma.task.update({ where: { id: w.tasks.secTask.id }, data: { dueAt, assignees: { create: { userId: w.users.member.id } } } });
    const loose = await prisma.task.create({ data: { workspaceId: w.a.id, number: 90, title: "Visible loose task", dueAt, assignees: { create: { userId: w.users.member.id } } } });
    await prisma.teamMember.create({ data: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } });
    expect(await buildFeed(feed)).toContain("Hidden task");
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } } });
    expect(await buildFeed(feed)).not.toContain("Hidden task");
    await prisma.teamMember.create({ data: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } });
    await prisma.project.update({ where: { id: w.projects.sec.id }, data: { status: "ARCHIVED" } });
    const body = await buildFeed(feed);
    expect(body).not.toContain("Hidden task");
    expect(body).toContain("Visible loose task");
    expect(body).toContain(`/w/${w.a.slug}/t/${loose.number}`);
    await prisma.project.update({ where: { id: w.projects.sec.id }, data: { status: "ACTIVE" } });
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } } });
  });

  it("allows exactly one concurrent note save from the same version and indexes the winner", async () => {
    const created = await createNote(actor("member"), { title: "Original" });
    if (!created.ok) throw new Error(created.error);
    const note = created.data!;
    // Hold both source reads until both tabs have captured the same version.
    const original = prisma.personalNote.findFirst.bind(prisma.personalNote);
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(prisma.personalNote, "findFirst").mockImplementation((async (...args: Parameters<typeof original>) => {
      const row = await original(...args);
      if (++reads === 2) release();
      await barrier;
      return row;
    }) as unknown as typeof original);
    let results;
    try {
      results = await Promise.all(["First", "Second"].map(title => updateNote(actor("member"), { id: note.id, title, expectedUpdatedAt: note.updatedAt })));
    } finally { spy.mockRestore(); }
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toEqual({ ok: false, error: NOTE_CONFLICT });
    const saved = await prisma.personalNote.findUniqueOrThrow({ where: { id: note.id } });
    expect(saved.updatedAt.toISOString()).not.toBe(note.updatedAt);
    expect(await prisma.searchDocument.findUnique({ where: { entityType_entityId: { entityType: "note", entityId: note.id } } })).toMatchObject({ title: saved.title });
  });

  it("skips area-owned trash before applying the purge batch limit", async () => {
    const row = await file("purge-batch", { deletedAt: new Date("2021-01-01") });
    await purgeDeletedFiles(new Date(), 1);
    expect(await prisma.fileObject.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("rechecks array ownership acquired after purge candidate selection", async () => {
    const row = await file("purge-new-receipt", { deletedAt: new Date("2020-01-01") });
    const original = prisma.$queryRaw.bind(prisma);
    const spy = vi.spyOn(prisma, "$queryRaw").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      const rows = await original(...args);
      await prisma.reimbursement.create({ data: { workspaceId: w.a.id, claimantId: w.users.admin.id, totalMinor: 1000, items: [], receiptFileIds: [row.id] } });
      return rows;
    }) as typeof original);
    try { await purgeDeletedFiles(new Date(), 1000); } finally { spy.mockRestore(); }
    expect(await prisma.fileObject.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("rechecks a legal hold enabled after purge candidate selection", async () => {
    const row = await file("hold", { deletedAt: new Date("2020-01-01") });
    await prisma.fileVersion.create({ data: { fileId: row.id, version: 1, storageKey: row.storageKey, size: 4, contentType: "text/plain" } });
    await indexFile(row);
    const original = prisma.$queryRaw.bind(prisma);
    const spy = vi.spyOn(prisma, "$queryRaw").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      const rows = await original(...args);
      await prisma.workspace.update({ where: { id: w.a.id }, data: { legalHold: true } });
      return rows;
    }) as typeof original);
    try { await purgeDeletedFiles(new Date(), 1000); } finally { spy.mockRestore(); }
    expect(await prisma.fileObject.findUnique({ where: { id: row.id } })).not.toBeNull();
    expect(await prisma.fileVersion.count({ where: { fileId: row.id } })).toBe(1);
    expect(await prisma.searchDocument.count({ where: { entityType: "file", entityId: row.id } })).toBe(1);
    await prisma.workspace.update({ where: { id: w.a.id }, data: { legalHold: false } });
    await purgeDeletedFiles(new Date(), 1000);
    expect(await prisma.fileObject.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("finds active profiles and visible teams while denying suspended people and cross-tenant or private teams", async () => {
    const profile = await prisma.memberProfile.create({ data: { workspaceId: w.a.id, userId: w.users.admin.id } });
    const publicTeam = await prisma.team.create({ data: { workspaceId: w.a.id, name: term, slug: `public-${suffix}`, visibility: "PUBLIC" } });
    const otherTeam = await prisma.team.create({ data: { workspaceId: w.b.id, name: term, slug: `other-${suffix}`, visibility: "PUBLIC" } });
    for (const [type, id] of [["member", profile.id], ["team", publicTeam.id], ["team", w.projects.sec.teamId!], ["team", otherTeam.id]]) {
      await indexSearchDocument({ workspaceId: w.a.id, entityType: type!, entityId: id!, title: term, url: `/w/${w.a.slug}/members` });
    }
    const ids = (await searchDocuments(searchActor("member"), term)).map(h => h.entityId);
    expect(ids).toContain(profile.id); expect(ids).toContain(publicTeam.id);
    expect(ids).not.toContain(otherTeam.id); expect(ids).not.toContain(w.projects.sec.teamId);
    expect((await searchDocuments(searchActor("owner"), term)).map(h => h.entityId)).toContain(w.projects.sec.teamId);
    await prisma.teamMember.create({ data: { teamId: w.projects.sec.teamId!, userId: w.users.member.id } });
    expect((await searchDocuments(searchActor("member"), term)).map(h => h.entityId)).toContain(w.projects.sec.teamId);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: w.users.admin.id, workspaceId: w.a.id } }, data: { status: "SUSPENDED" } });
    expect((await searchDocuments(searchActor("owner"), term)).map(h => h.entityId)).not.toContain(profile.id);
    expect((await assistantHits(principal("owner"), term)).map(h => h.id)).not.toContain(profile.id);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: w.users.admin.id, workspaceId: w.a.id } }, data: { status: "ACTIVE" } });
    await prisma.user.update({ where: { id: w.users.admin.id }, data: { disabledAt: new Date() } });
    expect((await searchDocuments(searchActor("owner"), term)).map(h => h.entityId)).not.toContain(profile.id);
    await prisma.user.update({ where: { id: w.users.admin.id }, data: { disabledAt: null } });
    await prisma.team.update({ where: { id: publicTeam.id }, data: { archivedAt: new Date() } });
    expect((await searchDocuments(searchActor("owner"), term)).map(h => h.entityId)).not.toContain(publicTeam.id);
  });

  it.each([undefined, "BOT"])("returns and indexes a canonical task detail URL (project: %s)", async (project) => {
    const result = await createTask.run({ principal: principal("member"), via: "chat", now: new Date() }, { title: "Review created task", project, description: "", assignees: [], priority: "NONE" });
    const dto = result.data as { number: number; url: string };
    const url = project ? `/w/${w.a.slug}/projects/BOT/${dto.number}` : `/w/${w.a.slug}/t/${dto.number}`;
    expect(dto.url).toBe(url);
    const task = await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, number: dto.number } });
    expect(await prisma.searchDocument.findUnique({ where: { entityType_entityId: { entityType: "task", entityId: task.id } } })).toMatchObject({ url });
  });
});
