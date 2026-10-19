import { describe, expect, it } from "vitest";
import { afterCursor, beforeCursor, clampLimit, decodeCursor, encodeCursor, takePage } from "@/lib/chat/cursor";
import { dmKey, dmParticipants, dmTitle, participantsFromKey } from "@/lib/chat/dm";
import {
  canAddMembers,
  canCreateChannel,
  canDeleteMessage,
  canEditMessage,
  canPinMessage,
  canRemoveMember,
  canSetTopic,
  channelNameSchema,
  toChannelSlug,
} from "@/lib/chat/policy";
import { isAllowedReaction, summarizeReactions } from "@/lib/chat/reactions";
import { allowsNotification, firstUnreadId, formatBadge, isUnread, laterOf, planRecipients, sidebarState } from "@/lib/chat/unread";

describe("dm keys", () => {
  it("is order independent and includes the starter", () => {
    expect(dmParticipants("u2", ["u1", "u2", " u3 "])).toEqual(["u1", "u2", "u3"]);
    expect(dmKey("ws", ["u2", "u1"])).toBe("ws:u1:u2");
    expect(dmKey("ws", ["u1", "u2", "u1"])).toBe(dmKey("ws", ["u2", "u1"]));
    expect(() => dmKey("ws", [])).toThrow();
  });

  it("reads participants only for its own workspace", () => {
    expect(participantsFromKey("ws:u1:u2", "ws")).toEqual(["u1", "u2"]);
    expect(participantsFromKey("ws:u1:u2", "other")).toEqual([]);
  });

  it("titles from the viewer's side", () => {
    const people = [{ id: "me", name: "Anjali" }, { id: "u1", name: "Meera" }, { id: "u2", name: null }];
    expect(dmTitle(people, "me")).toBe("Meera, Former member");
    expect(dmTitle([{ id: "me", name: "Anjali" }], "me")).toBe("Anjali (you)");
    expect(dmTitle([...people, { id: "u3", name: "Joel" }, { id: "u4", name: "Vivek" }], "me")).toBe("Meera, Former member and 2 others");
  });
});

describe("unread math", () => {
  const read = "2026-10-19T10:00:00.000Z";
  const messages = [
    { id: "a", createdAt: "2026-10-19T09:59:00.000Z", authorId: "u1" },
    { id: "b", createdAt: "2026-10-19T10:01:00.000Z", authorId: "me" },
    { id: "c", createdAt: "2026-10-19T10:02:00.000Z", authorId: "u1" },
  ];

  it("ignores own and already-read messages", () => {
    expect(isUnread(messages[0]!, read, "me")).toBe(false);
    expect(isUnread(messages[1]!, read, "me")).toBe(false);
    expect(isUnread(messages[2]!, read, "me")).toBe(true);
    expect(isUnread(messages[0]!, null, "me")).toBe(true);
  });

  it("places the new-messages divider", () => {
    expect(firstUnreadId(messages, read, "me")).toBe("c");
    expect(firstUnreadId(messages, null, "me")).toBeNull();
    expect(firstUnreadId(messages, "2026-10-19T11:00:00.000Z", "me")).toBeNull();
  });

  it("formats badges and sidebar rows", () => {
    expect(formatBadge(5)).toBe("5");
    expect(formatBadge(120)).toBe("99+");
    expect(sidebarState({ kind: "PUBLIC", unread: 4, mentions: 0, notify: "ALL" })).toEqual({ bold: true, badge: null, muted: false });
    expect(sidebarState({ kind: "PUBLIC", unread: 4, mentions: 2, notify: "MENTIONS" })).toEqual({ bold: true, badge: 2, muted: false });
    expect(sidebarState({ kind: "PUBLIC", unread: 4, mentions: 0, notify: "NONE" })).toEqual({ bold: false, badge: null, muted: true });
    expect(sidebarState({ kind: "DIRECT", unread: 3, mentions: 0, notify: "ALL" })).toEqual({ bold: true, badge: 3, muted: false });
  });

  it("never moves read markers backwards", () => {
    const a = new Date("2026-01-01");
    const b = new Date("2026-02-01");
    expect(laterOf(a, b)).toBe(b);
    expect(laterOf(b, a)).toBe(b);
    expect(laterOf(null, a)).toBe(a);
  });
});

describe("notification levels", () => {
  it("maps levels to reasons", () => {
    expect(allowsNotification("ALL", "thread")).toBe(true);
    expect(allowsNotification("MENTIONS", "mention")).toBe(true);
    expect(allowsNotification("MENTIONS", "broadcast")).toBe(false);
    expect(allowsNotification("MENTIONS", "thread")).toBe(false);
    expect(allowsNotification("NONE", "mention")).toBe(false);
    expect(allowsNotification("NONE", "dm")).toBe(false);
  });

  const members = [
    { userId: "author", notify: "ALL" as const },
    { userId: "all", notify: "ALL" as const },
    { userId: "mentions", notify: "MENTIONS" as const },
    { userId: "muted", notify: "NONE" as const },
  ];

  it("plans one notification per person, mention first", () => {
    const plan = planRecipients({
      authorId: "author",
      kind: "PUBLIC",
      members,
      mentioned: ["mentions", "muted", "author", "outsider", "reader"],
      broadcast: true,
      isReply: true,
      threadParticipants: ["all", "mentions"],
      readersOutsideChannel: new Set(["reader"]),
    });
    expect(plan).toEqual({ mention: ["mentions", "reader", "all"], dm: [], thread: [] });
  });

  it("notifies thread participants who allow it", () => {
    const plan = planRecipients({ authorId: "author", kind: "PRIVATE", members, mentioned: [], broadcast: false, isReply: true, threadParticipants: ["all", "mentions", "muted", "gone"] });
    expect(plan.thread).toEqual(["all"]);
  });

  it("notifies DM participants unless muted", () => {
    const plan = planRecipients({ authorId: "author", kind: "DIRECT", members, mentioned: ["all"], broadcast: true, isReply: false, threadParticipants: [] });
    expect(plan).toEqual({ mention: ["all"], dm: ["mentions"], thread: [] });
  });
});

describe("cursors", () => {
  it("round-trips and rejects junk", () => {
    const cursor = encodeCursor({ createdAt: new Date("2026-10-19T10:00:00.123Z"), id: "m1" });
    expect(decodeCursor(cursor)).toEqual({ createdAt: new Date("2026-10-19T10:00:00.123Z"), id: "m1" });
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-19T10:00:00.000Z|bad id").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("yesterday|m1").toString("base64url"))).toBeNull();
    expect(decodeCursor(42)).toBeNull();
  });

  it("builds keyset filters and pages", () => {
    const c = { createdAt: new Date("2026-10-19T10:00:00.000Z"), id: "m5" };
    expect(beforeCursor(c)).toEqual({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: "m5" } }] });
    expect(afterCursor(c).OR[1]).toEqual({ createdAt: c.createdAt, id: { gt: "m5" } });
    expect(takePage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(takePage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit("x")).toBe(50);
    expect(clampLimit(0)).toBe(1);
  });
});

describe("chat policy", () => {
  const guest = { role: "GUEST" as const };
  const member = { role: "MEMBER" as const };
  const admin = { role: "ADMIN" as const };

  it("gates channel creation", () => {
    expect(canCreateChannel(member, "PRIVATE")).toBe(true);
    expect(canCreateChannel(member, "PUBLIC")).toBe(false);
    expect(canCreateChannel(admin, "PUBLIC")).toBe(true);
    expect(canCreateChannel(guest, "PRIVATE")).toBe(false);
  });

  it("gates membership changes and topics", () => {
    expect(canAddMembers(member, true, "PRIVATE")).toBe(true);
    expect(canAddMembers(member, false, "PRIVATE")).toBe(false);
    expect(canAddMembers(guest, true, "PUBLIC")).toBe(false);
    expect(canAddMembers(admin, false, "DIRECT")).toBe(false);
    expect(canRemoveMember(member, "me", { kind: "PRIVATE", createdById: "me" })).toBe(true);
    expect(canRemoveMember(member, "me", { kind: "PUBLIC", createdById: "me" })).toBe(false);
    expect(canRemoveMember(admin, "me", { kind: "PUBLIC", createdById: null })).toBe(true);
    expect(canSetTopic(guest, true, "PUBLIC")).toBe(false);
    expect(canSetTopic(member, true, "PUBLIC")).toBe(true);
    expect(canSetTopic(member, true, "DIRECT")).toBe(false);
  });

  const own = { authorId: "me", authorKind: "USER" as const, deletedAt: null, origin: null };
  const other = { ...own, authorId: "u1" };

  it("gates message edits, deletes and pins", () => {
    expect(canEditMessage(own, "me")).toBe(true);
    expect(canEditMessage(other, "me")).toBe(false);
    expect(canEditMessage({ ...own, origin: "bridge:x" }, "me")).toBe(false);
    expect(canEditMessage({ ...own, deletedAt: new Date() }, "me")).toBe(false);
    expect(canDeleteMessage(member, other, "me", "PUBLIC")).toBe(false);
    expect(canDeleteMessage(admin, other, "me", "PUBLIC")).toBe(true);
    expect(canDeleteMessage(admin, other, "me", "DIRECT")).toBe(false);
    expect(canPinMessage(member, other, "me", "PUBLIC")).toBe(false);
    expect(canPinMessage(member, own, "me", "PUBLIC")).toBe(true);
    expect(canPinMessage(member, other, "me", "DIRECT")).toBe(true);
    expect(canPinMessage(admin, other, "me", "PRIVATE")).toBe(true);
  });

  it("slugs channel names", () => {
    expect(toChannelSlug("#Build Night 2026!")).toBe("build-night-2026");
    expect(channelNameSchema.safeParse("Laser cutter").data).toBe("laser-cutter");
    expect(channelNameSchema.safeParse("browse").success).toBe(false);
    expect(channelNameSchema.safeParse("!!!").success).toBe(false);
  });
});

describe("reactions", () => {
  it("accepts only the curated set and summarises", () => {
    expect(isAllowedReaction("👍")).toBe(true);
    expect(isAllowedReaction("<script>")).toBe(false);
    const summary = summarizeReactions(
      [
        { emoji: "🎉", userId: "u1" },
        { emoji: "👍", userId: "me" },
        { emoji: "👍", userId: "u1" },
        { emoji: "💩", userId: "u1" },
      ],
      "me",
      { u1: "Meera" },
    );
    expect(summary).toEqual([
      { emoji: "👍", label: "Thumbs up", count: 2, mine: true, names: ["You", "Meera"] },
      { emoji: "🎉", label: "Celebrate", count: 1, mine: false, names: ["Meera"] },
    ]);
  });
});
