import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null),
}));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/db";
import { subscribe, type RealtimeEvent } from "@/lib/realtime";
import {
  deleteMessageAction,
  editMessageAction,
  loadMessagesAction,
  loadMessagesByIdsAction,
  loadSidebarAction,
  loadThreadAction,
  markReadAction,
  openDirectMessageAction,
  postMessageAction,
  setNotifyLevelAction,
  setPinnedAction,
  toggleReactionAction,
} from "@/app/actions/chat";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

import { registerHistorySearchTests } from "./chat-messages/history-search.cases";

const suffix = uniqueSuffix();
const domain = `@chat-msg-${suffix}.test`;
const slug = `chat-msg-${suffix}`;
const slugB = `chat-msg-b-${suffix}`;
let workspaceId: string;
let owner: string;
let admin: string;
let meera: string;
let joel: string;
let fathima: string;
let outsider: string;
let general: string;
let hardware: string;

const as = (userId: string) => {
  sessionUser.id = userId;
};
const notifications = (userId: string, kind: string) => prisma.notification.findMany({ where: { userId, workspaceId, kind } });

async function post(channelId: string, body: string, extra: { parentId?: string; attachmentIds?: string[] } = {}) {
  const result = await postMessageAction(slug, { channelId, body, ...extra });
  if (!result.ok) throw new Error(result.error);
  return result.data!.message;
}

describe.sequential("chat messages", () => {
  beforeAll(async () => {
    owner = (await createUser(`owner${domain}`, "Anjali Menon")).id;
    admin = (await createUser(`admin${domain}`, "Rahul Varghese")).id;
    meera = (await createUser(`meera${domain}`, "Meera Nair")).id;
    joel = (await createUser(`joel${domain}`, "Joel Thomas")).id;
    fathima = (await createUser(`fathima${domain}`, "Fathima Rahman")).id;
    outsider = (await createUser(`outsider${domain}`, "Out Sider")).id;
    workspaceId = (await createWorkspace(slug, owner)).id;
    await createWorkspace(slugB, outsider);
    await addMember(workspaceId, admin, "ADMIN");
    await addMember(workspaceId, meera, "MEMBER");
    await addMember(workspaceId, joel, "MEMBER");
    await addMember(workspaceId, fathima, "MEMBER");
    general = (await prisma.channel.findFirstOrThrow({ where: { workspaceId, slug: "general" } })).id;
    hardware = (await prisma.channel.create({ data: { workspaceId, name: "hardware", slug: "hardware", kind: "PUBLIC", createdById: owner } })).id;
    for (const userId of [admin, meera, joel, fathima]) await prisma.channelMember.create({ data: { channelId: general, userId } });
    await prisma.channelMember.create({ data: { channelId: hardware, userId: meera } });
  });

  beforeEach(() => as(""));

  afterAll(async () => {
    await cleanup([slug, slugB], domain);
    await prisma.$disconnect();
  });

  it("stores sanitised tokens and renders safe HTML", async () => {
    as(meera);
    const message = await post(general, `Hi <@${joel}> and <@${outsider}>, see #hardware <script>alert(1)</script> **now**`);
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.body).toBe(`Hi <@${joel}> and @unknown, see <#${hardware}> <script>alert(1)</script> **now**`);
    expect(message.html).toContain(`data-user-id="${joel}">@Joel Thomas</span>`);
    expect(message.html).toContain(`<a href="/w/${slug}/chat/hardware" class="sw-channel">#hardware</a>`);
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("<strong>now</strong>");
    expect(message.source?.text).toBe("Hi @Joel Thomas and @unknown, see #hardware <script>alert(1)</script> **now**");
  });

  it("notifies mentions and respects the channel notification level", async () => {
    as(meera);
    const before = (await notifications(joel, "mention")).length;
    await post(general, `Ping <@${joel}>`);
    expect(await notifications(joel, "mention")).toHaveLength(before + 1);
    const [latest] = await prisma.notification.findMany({ where: { userId: joel, kind: "mention" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(latest).toMatchObject({ title: "Meera Nair mentioned you in #general", body: "Ping @Joel Thomas" });

    as(joel);
    expect(await setNotifyLevelAction(slug, { channelId: general, level: "NONE" })).toMatchObject({ ok: true });
    as(meera);
    await post(general, `Muted ping <@${joel}>`);
    expect(await notifications(joel, "mention")).toHaveLength(before + 1);

    // MENTIONS: direct mentions yes, @channel no.
    as(joel);
    await setNotifyLevelAction(slug, { channelId: general, level: "MENTIONS" });
    as(fathima);
    const fathimaBefore = (await notifications(fathima, "mention")).length;
    as(meera);
    await post(general, "Heads up <!channel>");
    expect(await notifications(joel, "mention")).toHaveLength(before + 1);
    expect(await notifications(fathima, "mention")).toHaveLength(fathimaBefore + 1);
    // Mentioning someone who can read a public channel without having joined it.
    await post(hardware, `<@${fathima}> can you check this board?`);
    expect(await notifications(fathima, "mention")).toHaveLength(fathimaBefore + 2);
  });

  it("strips @channel for nobody but keeps it to members and up", async () => {
    await prisma.membership.update({ where: { userId_workspaceId: { userId: fathima, workspaceId } }, data: { role: "GUEST" } });
    as(fathima);
    const message = await post(general, "Everyone <!channel>");
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.body).toBe("Everyone @channel");
    await prisma.membership.update({ where: { userId_workspaceId: { userId: fathima, workspaceId } }, data: { role: "MEMBER" } });
  });

  it("counts thread replies and notifies thread participants", async () => {
    as(joel);
    await setNotifyLevelAction(slug, { channelId: general, level: "ALL" });
    const root = await post(general, "Who has the hot air station?");
    as(meera);
    const reply = await post(general, "It's in the cupboard.", { parentId: root.id });
    as(admin);
    await post(general, "I moved it to the bench.", { parentId: root.id });
    const parent = await prisma.message.findUniqueOrThrow({ where: { id: root.id } });
    expect(parent.replyCount).toBe(2);
    expect(parent.lastReplyAt).not.toBeNull();
    const replies = await prisma.notification.findMany({ where: { workspaceId, kind: "thread.reply" }, select: { userId: true } });
    expect(new Set(replies.map((r) => r.userId))).toEqual(new Set([joel, meera]));

    // Thread replies stay out of the channel timeline.
    const page = await loadMessagesAction(slug, { channelId: general });
    expect(page.ok && page.data!.messages.some((m) => m.id === reply.id)).toBe(false);
    const root2 = page.ok ? page.data!.messages.find((m) => m.id === root.id) : null;
    expect(root2).toMatchObject({ replyCount: 2, replyPeople: expect.arrayContaining([expect.objectContaining({ id: meera })]) });

    as(meera);
    expect(await deleteMessageAction(slug, { messageId: reply.id })).toMatchObject({ ok: true });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: root.id } })).replyCount).toBe(1);
    const thread = await loadThreadAction(slug, { channelId: general, parentId: root.id });
    expect(thread.ok && thread.data!.replies.map((r) => r.id)).not.toContain(reply.id);
  });

  it("lets only the author edit and the author or an admin delete", async () => {
    as(meera);
    const message = await post(general, "Typo hree");
    as(joel);
    expect(await editMessageAction(slug, { messageId: message.id, body: "hijacked" })).toMatchObject({ ok: false });
    expect(await deleteMessageAction(slug, { messageId: message.id })).toMatchObject({ ok: false });
    as(meera);
    const edited = await editMessageAction(slug, { messageId: message.id, body: "Typo here" });
    expect(edited).toMatchObject({ ok: true, data: { message: { editedAt: expect.any(String), html: "<p>Typo here</p>" } } });
    as(admin);
    expect(await deleteMessageAction(slug, { messageId: message.id })).toMatchObject({ ok: true });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId, action: "chat.message_deleted", targetId: message.id } });
    expect(audit.metadata).toMatchObject({ moderated: true });
    const deleted = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(deleted.deletedAt).not.toBeNull();
    // Soft-deleted messages without replies leave the timeline and search.
    const page = await loadMessagesAction(slug, { channelId: general });
    expect(page.ok && page.data!.messages.some((m) => m.id === message.id)).toBe(false);
    expect(await prisma.searchDocument.count({ where: { entityType: "message", entityId: message.id } })).toBe(0);
    as(meera);
    expect(await editMessageAction(slug, { messageId: message.id, body: "back from the dead" })).toMatchObject({ ok: false });
  });

  it("keeps a deleted thread root as a placeholder while it has replies", async () => {
    as(meera);
    const root = await post(general, "Root to delete");
    as(joel);
    await post(general, "A reply", { parentId: root.id });
    as(meera);
    await deleteMessageAction(slug, { messageId: root.id });
    const ids = await loadMessagesByIdsAction(slug, { channelId: general, ids: [root.id] });
    expect(ids).toMatchObject({ ok: true, data: [{ id: root.id, deleted: true, html: "", replyCount: 1 }] });
  });

  it("refuses admin deletes in someone else's DM and notifies DM participants", async () => {
    as(meera);
    const dm = await openDirectMessageAction(slug, { userIds: [joel] });
    const dmId = dm.ok ? dm.data!.id : "";
    const before = (await notifications(joel, "message.dm")).length;
    const message = await post(dmId, "Private note");
    expect(await notifications(joel, "message.dm")).toHaveLength(before + 1);
    // A burst inside the dedupe window does not pile up notifications.
    await post(dmId, "And another");
    expect(await notifications(joel, "message.dm")).toHaveLength(before + 1);
    as(admin);
    expect(await deleteMessageAction(slug, { messageId: message.id })).toMatchObject({ ok: false });
    as(joel);
    expect(await deleteMessageAction(slug, { messageId: message.id })).toMatchObject({ ok: false });
    expect(await setPinnedAction(slug, { messageId: message.id, pinned: true })).toMatchObject({ ok: true });
  });

  it("toggles curated reactions and pins by policy", async () => {
    as(joel);
    const message = await post(general, "Reaction target");
    as(meera);
    expect(await toggleReactionAction(slug, { messageId: message.id, emoji: "<b>" })).toMatchObject({ ok: false });
    const added = await toggleReactionAction(slug, { messageId: message.id, emoji: "👍" });
    expect(added).toMatchObject({ ok: true, data: { message: { reactions: [{ emoji: "👍", count: 1, mine: true }] } } });
    const removed = await toggleReactionAction(slug, { messageId: message.id, emoji: "👍" });
    expect(removed).toMatchObject({ ok: true, data: { message: { reactions: [] } } });
    expect(await setPinnedAction(slug, { messageId: message.id, pinned: true })).toMatchObject({ ok: false });
    as(joel);
    expect(await setPinnedAction(slug, { messageId: message.id, pinned: true })).toMatchObject({ ok: true, data: { message: { pinned: true, pinnedByName: "Joel Thomas" } } });
    as(admin);
    expect(await setPinnedAction(slug, { messageId: message.id, pinned: false })).toMatchObject({ ok: true, data: { message: { pinned: false } } });
  });

  it("counts unread messages and mentions per member and clears them on read", async () => {
    as(fathima);
    await markReadAction(slug, { channelId: general });
    as(meera);
    await post(general, "Unread one");
    await post(general, `Unread two for <@${fathima}>`);
    as(fathima);
    let sidebar = await loadSidebarAction(slug);
    let row = sidebar.ok ? sidebar.data!.channels.find((c) => c.id === general) : undefined;
    expect(row).toMatchObject({ unread: 2, mentions: 1 });
    await markReadAction(slug, { channelId: general });
    sidebar = await loadSidebarAction(slug);
    row = sidebar.ok ? sidebar.data!.channels.find((c) => c.id === general) : undefined;
    expect(row).toMatchObject({ unread: 0, mentions: 0 });
    // Your own messages never count as unread.
    await post(general, "My own message");
    sidebar = await loadSidebarAction(slug);
    row = sidebar.ok ? sidebar.data!.channels.find((c) => c.id === general) : undefined;
    expect(row).toMatchObject({ unread: 0 });
  });

  registerHistorySearchTests(() => ({
    workspaceId,
    owner,
    meera,
    joel,
    outsider,
    hardware,
    general,
    slug,
    slugB,
    as,
    post,
  }));

  it("attaches only your own fresh uploads", async () => {
    const mine = await prisma.fileObject.create({ data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${suffix}-a/photo.png`, filename: "photo.png", contentType: "image/png", size: 10, uploadedById: meera, folder: "/chat" } });
    const theirs = await prisma.fileObject.create({ data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${suffix}-b/notes.pdf`, filename: "notes.pdf", contentType: "application/pdf", size: 10, uploadedById: joel, folder: "/chat" } });
    as(meera);
    await expect(post(general, "", { attachmentIds: [theirs.id] })).rejects.toThrow(/no longer available/);
    const message = await post(general, "", { attachmentIds: [mine.id] });
    expect(message.attachments).toEqual([expect.objectContaining({ id: mine.id, isImage: true, url: `/api/files/${mine.id}` })]);
    await expect(post(general, "again", { attachmentIds: [mine.id] })).rejects.toThrow(/no longer available/);
    await expect(post(general, "   ")).rejects.toThrow(/Write a message/);
  });

  it("publishes id-only realtime events with an audience for private conversations", async () => {
    const events: RealtimeEvent[] = [];
    const unsubscribe = await subscribe(workspaceId, (event) => events.push(event));
    try {
      as(meera);
      await post(general, "Public event body");
      const dm = await openDirectMessageAction(slug, { userIds: [joel] });
      await post(dm.ok ? dm.data!.id : "", "Secret event body");
      const created = events.filter((e) => e.type === "message.created");
      expect(created).toHaveLength(2);
      expect(created[0]).toMatchObject({ channel: `channel:${general}`, data: { channelId: general } });
      expect(created[0]!.audience).toBeUndefined();
      expect(created[1]!.audience?.sort()).toEqual([joel, meera].sort());
      expect(JSON.stringify(events)).not.toContain("event body");
    } finally {
      unsubscribe();
    }
  });
});
