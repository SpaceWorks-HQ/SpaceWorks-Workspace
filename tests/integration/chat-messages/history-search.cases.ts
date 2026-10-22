import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadMessagesAction, searchMessagesAction } from "@/app/actions/chat";

type HistorySearchFixture = {
  workspaceId: string;
  owner: string;
  meera: string;
  joel: string;
  outsider: string;
  hardware: string;
  general: string;
  slug: string;
  slugB: string;
  as: (userId: string) => void;
  post: (channelId: string, body: string) => Promise<{ id: string }>;
};

export function registerHistorySearchTests(fixture: () => HistorySearchFixture) {
  it("pages through history with stable cursors", async () => {
    const { workspaceId, owner, meera, slug, as } = fixture();
    const channel = await prisma.channel.create({ data: { workspaceId, name: "history", slug: "history", kind: "PUBLIC", createdById: owner, members: { create: [{ userId: meera }] } } });
    const base = Date.UTC(2026, 0, 1);
    await prisma.message.createMany({
      data: Array.from({ length: 62 }, (_, i) => ({ workspaceId, channelId: channel.id, authorId: meera, body: `Message ${i}`, createdAt: new Date(base + Math.floor(i / 2) * 1000) })),
    });
    as(meera);
    const latest = await loadMessagesAction(slug, { channelId: channel.id });
    expect(latest.ok).toBe(true);
    const page1 = latest.ok ? latest.data! : null;
    expect(page1!.messages).toHaveLength(50);
    expect(page1!.hasOlder).toBe(true);
    expect(page1!.messages.at(-1)!.html).toBe("<p>Message 61</p>");
    const older = await loadMessagesAction(slug, { channelId: channel.id, before: page1!.messages[0]!.cursor });
    const page2 = older.ok ? older.data! : null;
    expect(page2!.messages).toHaveLength(12);
    expect(page2!.hasOlder).toBe(false);
    const all = [...page2!.messages, ...page1!.messages].map((m) => m.html);
    expect(new Set(all).size).toBe(62);
    expect(all[0]).toBe("<p>Message 0</p>");
    const newer = await loadMessagesAction(slug, { channelId: channel.id, after: page2!.messages[5]!.cursor, limit: 10 });
    expect(newer).toMatchObject({ ok: true, data: { hasNewer: true } });
    expect(newer.ok && newer.data!.messages[0]!.html).toBe("<p>Message 6</p>");
    const around = await loadMessagesAction(slug, { channelId: channel.id, around: page2!.messages[3]!.id, limit: 10 });
    expect(around.ok && around.data!.messages.some((m) => m.id === page2!.messages[3]!.id)).toBe(true);
    expect(await loadMessagesAction(slug, { channelId: channel.id, before: "garbage" })).toMatchObject({ ok: true, data: { messages: expect.any(Array) } });
  });

  it("searches readable messages with full text and indexes public ones globally", async () => {
    const { workspaceId, meera, joel, outsider, hardware, general, slug, slugB, as, post } = fixture();
    as(meera);
    const message = await post(general, "The stepper driver overheats at 2A");
    as(joel);
    const hits = await searchMessagesAction(slug, { query: "stepper driver" });
    expect(hits.ok && hits.data!.map((h) => h.id)).toContain(message.id);
    expect(hits.ok && hits.data![0]!.href).toBe(`/w/${slug}/chat/general?m=${message.id}`);
    const scoped = await searchMessagesAction(slug, { query: "stepper", channelId: hardware });
    expect(scoped).toMatchObject({ ok: true, data: [] });
    expect(await searchMessagesAction(slug, { query: "x" })).toMatchObject({ ok: false });
    const doc = await prisma.searchDocument.findUniqueOrThrow({ where: { entityType_entityId: { entityType: "message", entityId: message.id } } });
    expect(doc).toMatchObject({ workspaceId, channelId: general, title: "#general · Meera Nair" });
    as(outsider);
    expect(await searchMessagesAction(slugB, { query: "stepper driver" })).toMatchObject({ ok: true, data: [] });
  });

}
