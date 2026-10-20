import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null),
}));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/db";
import {
  addChannelMembersAction,
  browseChannelsAction,
  createChannelAction,
  joinChannelAction,
  loadMessagesAction,
  loadSidebarAction,
  loadThreadAction,
  openDirectMessageAction,
  postMessageAction,
  removeChannelMemberAction,
  searchMessagesAction,
  setChannelArchivedAction,
  updateChannelAction,
} from "@/app/actions/chat";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@chat-access-${suffix}.test`;
const slugA = `chat-a-${suffix}`;
const slugB = `chat-b-${suffix}`;
let workspaceA: string;
let owner: string;
let admin: string;
let meera: string;
let joel: string;
let guest: string;
let ownerB: string;
let general: string;
let random: string;

const as = (userId: string) => {
  sessionUser.id = userId;
};
const join = (channelId: string, userId: string) => prisma.channelMember.create({ data: { channelId, userId } });

describe.sequential("chat access", () => {
  beforeAll(async () => {
    owner = (await createUser(`owner${domain}`, "Anjali Owner")).id;
    admin = (await createUser(`admin${domain}`, "Rahul Admin")).id;
    meera = (await createUser(`meera${domain}`, "Meera Nair")).id;
    joel = (await createUser(`joel${domain}`, "Joel Thomas")).id;
    guest = (await createUser(`guest${domain}`, "Vivek Guest")).id;
    ownerB = (await createUser(`ownerb${domain}`, "Other Owner")).id;
    workspaceA = (await createWorkspace(slugA, owner)).id;
    await createWorkspace(slugB, ownerB);
    await addMember(workspaceA, admin, "ADMIN");
    await addMember(workspaceA, meera, "MEMBER");
    await addMember(workspaceA, joel, "MEMBER");
    await addMember(workspaceA, guest, "GUEST");
    general = (await prisma.channel.findFirstOrThrow({ where: { workspaceId: workspaceA, slug: "general" } })).id;
    random = (await prisma.channel.findFirstOrThrow({ where: { workspaceId: workspaceA, slug: "random" } })).id;
    for (const userId of [admin, meera, joel, guest]) await join(general, userId);
  });

  beforeEach(() => as(""));

  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  });

  it("refuses everything without a session or membership", async () => {
    expect(await loadSidebarAction(slugA)).toMatchObject({ ok: false });
    as(ownerB);
    expect(await postMessageAction(slugA, { channelId: general, body: "hello" })).toMatchObject({ ok: false });
    expect(await loadMessagesAction(slugA, { channelId: general })).toMatchObject({ ok: false });
  });

  it("never resolves another workspace's channel through your own workspace", async () => {
    as(ownerB);
    const result = await loadMessagesAction(slugB, { channelId: general });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("isn't available") });
    expect(await postMessageAction(slugB, { channelId: general, body: "sneaky" })).toMatchObject({ ok: false });
    expect(await prisma.message.count({ where: { channelId: general, body: "sneaky" } })).toBe(0);
  });

  it("lets members post where they joined and asks them to join elsewhere", async () => {
    as(meera);
    expect(await postMessageAction(slugA, { channelId: general, body: "Soldering station is free." })).toMatchObject({ ok: true });
    const notJoined = await postMessageAction(slugA, { channelId: random, body: "hi" });
    expect(notJoined).toMatchObject({ ok: false, error: "Join the channel to post here." });
    // Public channels are readable before joining.
    expect(await loadMessagesAction(slugA, { channelId: random })).toMatchObject({ ok: true });
    expect(await joinChannelAction(slugA, { channelId: random })).toMatchObject({ ok: true });
    expect(await postMessageAction(slugA, { channelId: random, body: "Now I'm in." })).toMatchObject({ ok: true });
  });

  it("keeps guests to the channels they were added to", async () => {
    as(guest);
    expect(await postMessageAction(slugA, { channelId: general, body: "Hello from a guest." })).toMatchObject({ ok: true });
    expect(await loadMessagesAction(slugA, { channelId: random })).toMatchObject({ ok: false });
    expect(await joinChannelAction(slugA, { channelId: random })).toMatchObject({ ok: false });
    const browse = await browseChannelsAction(slugA, {});
    expect(browse.ok && browse.data!.map((c) => c.id)).toEqual([general]);
    expect(await openDirectMessageAction(slugA, { userIds: [meera] })).toMatchObject({ ok: false });
    const sidebar = await loadSidebarAction(slugA);
    expect(sidebar.ok && sidebar.data!.channels.map((c) => c.id)).toEqual([general]);
  });

  it("lets members create private channels but only admins create public ones", async () => {
    as(meera);
    expect(await createChannelAction(slugA, { name: "Open Lab", kind: "PUBLIC" })).toMatchObject({ ok: false });
    const created = await createChannelAction(slugA, { name: "Robot Arm", kind: "PRIVATE", memberIds: [joel, "not-a-member"] });
    expect(created).toMatchObject({ ok: true, data: { href: `/w/${slugA}/chat/robot-arm` } });
    const duplicate = await createChannelAction(slugA, { name: "robot-arm", kind: "PRIVATE" });
    expect(duplicate).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
    as(admin);
    expect(await createChannelAction(slugA, { name: "laser-cutter", kind: "PUBLIC", topic: "Maintenance and settings" })).toMatchObject({ ok: true });
    expect(await createChannelAction(slugA, { name: "browse", kind: "PUBLIC" })).toMatchObject({ ok: false });
    const audit = await prisma.auditEvent.count({ where: { workspaceId: workspaceA, action: "chat.channel_created" } });
    expect(audit).toBe(2);
  });

  it("keeps private channels invisible to non-members, admins included", async () => {
    const channel = await prisma.channel.findFirstOrThrow({ where: { workspaceId: workspaceA, slug: "robot-arm" } });
    const members = await prisma.channelMember.findMany({ where: { channelId: channel.id }, select: { userId: true } });
    expect(members.map((m) => m.userId).sort()).toEqual([joel, meera].sort());

    as(meera);
    expect(await postMessageAction(slugA, { channelId: channel.id, body: "Servo budget is the secret plan" })).toMatchObject({ ok: true });

    for (const outsider of [admin, owner, guest]) {
      as(outsider);
      expect(await loadMessagesAction(slugA, { channelId: channel.id })).toMatchObject({ ok: false });
      expect(await postMessageAction(slugA, { channelId: channel.id, body: "let me in" })).toMatchObject({ ok: false });
      expect(await joinChannelAction(slugA, { channelId: channel.id })).toMatchObject({ ok: false });
      const browse = await browseChannelsAction(slugA, {});
      expect(browse.ok && browse.data!.some((c) => c.id === channel.id)).toBe(false);
      const search = await searchMessagesAction(slugA, { query: "secret plan" });
      expect(search).toMatchObject({ ok: true, data: [] });
    }

    as(joel);
    const search = await searchMessagesAction(slugA, { query: "secret plan" });
    expect(search.ok && search.data!.length).toBe(1);
    // Private channel messages never reach global search.
    expect(await prisma.searchDocument.count({ where: { workspaceId: workspaceA, channelId: channel.id } })).toBe(0);
  });

  it("lets channel members add people; only admins or the creator remove them", async () => {
    const channel = await prisma.channel.findFirstOrThrow({ where: { workspaceId: workspaceA, slug: "robot-arm" } });
    as(admin);
    expect(await addChannelMembersAction(slugA, { channelId: channel.id, userIds: [admin] })).toMatchObject({ ok: false });
    as(joel);
    expect(await addChannelMembersAction(slugA, { channelId: channel.id, userIds: [guest] })).toMatchObject({ ok: true, data: { added: 1 } });
    expect(await removeChannelMemberAction(slugA, { channelId: channel.id, userId: guest })).toMatchObject({ ok: false });
    as(guest);
    expect(await loadMessagesAction(slugA, { channelId: channel.id })).toMatchObject({ ok: true });
    as(meera);
    expect(await removeChannelMemberAction(slugA, { channelId: channel.id, userId: guest })).toMatchObject({ ok: true });
    as(guest);
    expect(await loadMessagesAction(slugA, { channelId: channel.id })).toMatchObject({ ok: false });
  });

  it("lets admins rename, archive and unarchive; archived channels are read-only", async () => {
    const laser = await prisma.channel.findFirstOrThrow({ where: { workspaceId: workspaceA, slug: "laser-cutter" } });
    as(meera);
    expect(await joinChannelAction(slugA, { channelId: laser.id })).toMatchObject({ ok: true });
    expect(await updateChannelAction(slugA, { channelId: laser.id, name: "lasers" })).toMatchObject({ ok: false });
    expect(await updateChannelAction(slugA, { channelId: laser.id, topic: "Book the cutter here" })).toMatchObject({ ok: true });
    expect(await setChannelArchivedAction(slugA, { channelId: laser.id, archived: true })).toMatchObject({ ok: false });
    as(admin);
    expect(await updateChannelAction(slugA, { channelId: laser.id, name: "Laser Lab", isDefault: true })).toMatchObject({ ok: true, data: { href: `/w/${slugA}/chat/laser-lab` } });
    expect(await setChannelArchivedAction(slugA, { channelId: laser.id, archived: true })).toMatchObject({ ok: true });
    as(meera);
    expect(await postMessageAction(slugA, { channelId: laser.id, body: "still here?" })).toMatchObject({ ok: false, error: expect.stringContaining("archived") });
    expect(await loadMessagesAction(slugA, { channelId: laser.id })).toMatchObject({ ok: true });
    const archived = await prisma.channel.findUniqueOrThrow({ where: { id: laser.id } });
    expect(archived.isDefault).toBe(false);
    expect(await prisma.searchDocument.count({ where: { entityType: "channel", entityId: laser.id } })).toBe(0);
    as(admin);
    expect(await setChannelArchivedAction(slugA, { channelId: laser.id, archived: false })).toMatchObject({ ok: true });
    expect(await prisma.searchDocument.count({ where: { entityType: "channel", entityId: laser.id } })).toBe(1);
  });

  it("finds or creates one DM per group and keeps it to its participants", async () => {
    as(meera);
    const first = await openDirectMessageAction(slugA, { userIds: [joel] });
    expect(first.ok).toBe(true);
    as(joel);
    const again = await openDirectMessageAction(slugA, { userIds: [meera] });
    expect(again.ok && again.data!.id).toBe(first.ok && first.data!.id);
    const dmId = first.ok ? first.data!.id : "";
    const dm = await prisma.channel.findUniqueOrThrow({ where: { id: dmId } });
    expect(dm.kind).toBe("DIRECT");
    expect(dm.dmKey).toBe(`${workspaceA}:${[meera, joel].sort().join(":")}`);

    expect(await postMessageAction(slugA, { channelId: dmId, body: "Bring the multimeter?" })).toMatchObject({ ok: true });
    as(meera);
    expect(await loadMessagesAction(slugA, { channelId: dmId })).toMatchObject({ ok: true, data: { messages: [expect.objectContaining({ html: expect.stringContaining("multimeter") })] } });
    for (const outsider of [owner, admin, guest]) {
      as(outsider);
      expect(await loadMessagesAction(slugA, { channelId: dmId })).toMatchObject({ ok: false });
      expect(await postMessageAction(slugA, { channelId: dmId, body: "hi" })).toMatchObject({ ok: false });
      const search = await searchMessagesAction(slugA, { query: "multimeter" });
      expect(search).toMatchObject({ ok: true, data: [] });
    }
    as(ownerB);
    expect(await loadMessagesAction(slugB, { channelId: dmId })).toMatchObject({ ok: false });

    as(meera);
    expect(await openDirectMessageAction(slugA, { userIds: [guest] })).toMatchObject({ ok: false });
    expect(await openDirectMessageAction(slugA, { userIds: [ownerB] })).toMatchObject({ ok: false });
    const group = await openDirectMessageAction(slugA, { userIds: [joel, admin] });
    expect(group.ok && group.data!.id).not.toBe(dmId);
  });

  it("hides an empty DM from the other person until its first message", async () => {
    as(owner);
    const opened = await openDirectMessageAction(slugA, { userIds: [joel] });
    const id = opened.ok ? opened.data!.id : "";
    const ownSidebar = await loadSidebarAction(slugA);
    expect(ownSidebar.ok && ownSidebar.data!.dms.some((d) => d.id === id)).toBe(true);
    as(joel);
    let sidebar = await loadSidebarAction(slugA);
    expect(sidebar.ok && sidebar.data!.dms.some((d) => d.id === id)).toBe(false);
    as(owner);
    await postMessageAction(slugA, { channelId: id, body: "Welcome aboard" });
    as(joel);
    sidebar = await loadSidebarAction(slugA);
    const row = sidebar.ok ? sidebar.data!.dms.find((d) => d.id === id) : undefined;
    expect(row).toMatchObject({ name: "Anjali Owner", unread: 1 });
  });

  it("refuses thread replies to replies and to other channels", async () => {
    as(meera);
    const root = await postMessageAction(slugA, { channelId: general, body: "Root" });
    const rootId = root.ok ? root.data!.message.id : "";
    const reply = await postMessageAction(slugA, { channelId: general, body: "Reply", parentId: rootId });
    const replyId = reply.ok ? reply.data!.message.id : "";
    expect(await postMessageAction(slugA, { channelId: general, body: "Nested", parentId: replyId })).toMatchObject({ ok: false });
    expect(await postMessageAction(slugA, { channelId: random, body: "Elsewhere", parentId: rootId })).toMatchObject({ ok: false });
    as(guest);
    expect(await loadThreadAction(slugA, { channelId: general, parentId: rootId })).toMatchObject({ ok: true, data: { replies: [expect.objectContaining({ id: replyId })] } });
    expect(await loadThreadAction(slugA, { channelId: random, parentId: rootId })).toMatchObject({ ok: false });
  });
});
