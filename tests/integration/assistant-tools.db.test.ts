import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { executeTool } from "@/lib/assistant/tools";
import type { Principal } from "@/lib/assistant/principal";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

const suffix = uniqueSuffix();
let w: World;

const run = (principal: Principal, name: string, input: unknown = {}) => executeTool(principal, name, input, { via: "chat" });
function data<T = Record<string, unknown>>(outcome: Awaited<ReturnType<typeof run>>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error}`);
  return outcome.result.data as T;
}

describe.sequential("assistant tools: permissions and isolation", () => {
  beforeAll(async () => {
    w = await buildWorld(suffix);
  });

  afterAll(async () => {
    await cleanup(w.slugs, w.domain);
    await prisma.$disconnect();
  });

  it("lists only tasks the caller can see (private teams hidden from members)", async () => {
    const asMember = data<{ tasks: Array<{ title: string }> }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_list_tasks", { status: "all" }));
    expect(asMember.tasks.map((t) => t.title)).toEqual(["Calibrate servo"]);
    const asAdmin = data<{ tasks: Array<{ title: string }> }>(await run(w.principal(w.users.admin.id, "ADMIN"), "sw_list_tasks", { status: "all" }));
    expect(asAdmin.tasks.map((t) => t.title).sort()).toEqual(["Calibrate servo", "Hidden task"]);
    const hidden = await run(w.principal(w.users.member.id, "MEMBER"), "sw_get_task", { ref: "SEC-2" });
    expect(hidden).toMatchObject({ ok: false, code: "not_found" });
  });

  it("never crosses workspaces", async () => {
    const doc = await run(w.principal(w.users.owner.id, "OWNER"), "sw_get_doc", { id: w.docs.bDoc.id });
    expect(doc).toMatchObject({ ok: false, code: "not_found" });
    const tasks = data<{ tasks: Array<{ title: string }> }>(await run(w.principal(w.users.owner.id, "OWNER"), "sw_list_tasks", { status: "all" }));
    expect(tasks.tasks.map((t) => t.title)).not.toContain("Other tenant task");
    const created = data<{ number: number }>(await run(w.principal(w.users.owner.id, "OWNER"), "sw_create_task", { title: "Numbered in A" }));
    expect(created.number).toBe(3);
    expect(await prisma.task.count({ where: { workspaceId: w.b.id } })).toBe(1);
  });

  it("refuses writes for guests and lets members create tasks with audit, search and notification", async () => {
    const guest = await run(w.principal(w.users.guest.id, "GUEST"), "sw_create_task", { title: "Guest task" });
    expect(guest).toMatchObject({ ok: false, code: "forbidden" });

    const created = data<{ ref: string; number: number }>(
      await run(w.principal(w.users.member.id, "MEMBER"), "sw_create_task", { title: "Order filament", project: "BOT", assignees: [w.users.owner.id], priority: "HIGH", description: "PLA <b>white</b>" }),
    );
    expect(created.ref).toBe(`BOT-${created.number}`);
    const task = await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, number: created.number }, include: { assignees: true, column: true } });
    expect(task.description).toBe("<p>PLA &lt;b&gt;white&lt;/b&gt;</p>");
    expect(task.column?.category).toBe("TODO");
    expect(task.assignees.map((a) => a.userId)).toEqual([w.users.owner.id]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: w.a.id, action: "assistant.task_created", targetId: task.id } });
    expect(audit.actorId).toBe(w.users.member.id);
    expect(audit.metadata).toMatchObject({ via: "chat" });
    expect(await prisma.searchDocument.count({ where: { entityType: "task", entityId: task.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: w.users.owner.id, kind: "task.assigned" } })).toBe(1);

    const badAssignee = await run(w.principal(w.users.member.id, "MEMBER"), "sw_create_task", { title: "x", project: "BOT", assignees: [w.users.guest.id] });
    expect(badAssignee.ok).toBe(false);
  });

  it("moves tasks between columns on status updates", async () => {
    const updated = data<{ status: string }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_update_task", { ref: "BOT-1", status: "done" }));
    expect(updated.status).toBe("done");
    const task = await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.botTask.id }, include: { column: true } });
    expect(task.column?.category).toBe("DONE");
    expect(task.completedAt).not.toBeNull();
  });

  it("keeps DMs out, private channels for members only, and guests to their channels", async () => {
    const memberChannels = data<{ channels: Array<{ slug: string }> }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_list_channels"));
    expect(memberChannels.channels.map((c) => c.slug).sort()).toEqual(["announcements", "core", "general", "random"]);
    const guestChannels = data<{ channels: Array<{ slug: string }> }>(await run(w.principal(w.users.guest.id, "GUEST"), "sw_list_channels"));
    expect(guestChannels.channels.map((c) => c.slug)).toEqual(["random"]);
    const tokenChannels = data<{ channels: Array<{ slug: string }> }>(await run(w.principal(w.users.owner.id, "OWNER", "token", { scopes: ["read:chat"], tokenId: "t" }), "sw_list_channels"));
    expect(tokenChannels.channels.map((c) => c.slug)).not.toContain("core");
    const dm = await run(w.principal(w.users.member.id, "MEMBER"), "sw_read_channel_messages", { channel: w.channels.dm.id });
    expect(dm).toMatchObject({ ok: false, code: "not_found" });
    const core = data<{ messages: Array<{ text: string }> }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_read_channel_messages", { channel: "#core" }));
    expect(core.messages[0]!.text).toBe("Core team only");
    const guestCore = await run(w.principal(w.users.guest.id, "GUEST"), "sw_read_channel_messages", { channel: "core" });
    expect(guestCore.ok).toBe(false);
  });

  it("posts channel messages as the caller and audits token writes with the token id", async () => {
    const token = await w.makeToken(["write:chat"]);
    const principal = w.principal(w.users.admin.id, "ADMIN", "token", { scopes: ["write:chat"], tokenId: token.id });
    const sent = data<{ messageId: string }>(await executeTool(principal, "sw_send_channel_message", { channel: "general", text: "Doors open at 6" }, { via: "api" }));
    const message = await prisma.message.findUniqueOrThrow({ where: { id: sent.messageId } });
    expect(message).toMatchObject({ authorId: w.users.admin.id, authorKind: "USER", body: "Doors open at 6", channelId: w.channels.general.id });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "assistant.message_sent", targetId: sent.messageId } });
    expect(audit.actorApiTokenId).toBe(token.id);
    expect(audit.metadata).toMatchObject({ via: "api" });
  });

  it("hides admin-only docs from members and creates docs for members", async () => {
    const docs = data<{ docs: Array<{ title: string }> }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_list_docs"));
    expect(docs.docs.map((d) => d.title)).toEqual(["House rules"]);
    expect(await run(w.principal(w.users.member.id, "MEMBER"), "sw_get_doc", { id: w.docs.adminDoc.id })).toMatchObject({ ok: false });
    expect((await run(w.principal(w.users.admin.id, "ADMIN"), "sw_get_doc", { id: w.docs.adminDoc.id })).ok).toBe(true);
    const created = data<{ id: string }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_create_doc", { title: "Laser checklist", text: "1. Fan on\n\n2. Lid closed" }));
    const doc = await prisma.doc.findUniqueOrThrow({ where: { id: created.id } });
    expect(doc).toMatchObject({ workspaceId: w.a.id, visibility: "WORKSPACE", contentHtml: "<p>1. Fan on</p><p>2. Lid closed</p>" });
  });

  it("gates the kitty summary on finance visibility", async () => {
    await prisma.ledgerEntry.create({ data: { workspaceId: w.a.id, kind: "INCOME", amountMinor: 500000, currency: "INR", description: "Dues", occurredOn: new Date() } });
    expect(await run(w.principal(w.users.member.id, "MEMBER"), "sw_finance_summary")).toMatchObject({ ok: false, code: "forbidden" });
    const summary = data<{ balance: string }>(await run(w.principal(w.users.admin.id, "ADMIN"), "sw_finance_summary"));
    expect(summary.balance).toContain("5,000");
  });

  it("remembers, finds and forgets workspace memory (forget is admin only)", async () => {
    const saved = data<{ id: string }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_remember", { content: "Build nights are Thursdays from 6 pm", tags: ["Schedule"] }));
    const found = data<{ memories: Array<{ id: string; tags: string[] }> }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_search_memory", { query: "thursdays" }));
    expect(found.memories.map((m) => m.id)).toContain(saved.id);
    expect(found.memories[0]!.tags).toEqual(["schedule"]);
    expect(await run(w.principal(w.users.member.id, "MEMBER"), "sw_forget", { id: saved.id })).toMatchObject({ ok: false, code: "forbidden" });
    expect((await run(w.principal(w.users.admin.id, "ADMIN"), "sw_forget", { id: saved.id })).ok).toBe(true);
    expect(await prisma.assistantMemory.count({ where: { id: saved.id } })).toBe(0);
  });

  it("filters global search by access", async () => {
    await prisma.searchDocument.createMany({
      data: [
        { workspaceId: w.a.id, entityType: "doc", entityId: w.docs.publicDoc.id, title: "Laser rules", url: "/x" },
        { workspaceId: w.a.id, entityType: "doc", entityId: w.docs.adminDoc.id, title: "Laser lease", url: "/y" },
        { workspaceId: w.a.id, entityType: "vault_item", entityId: "v1", title: "Laser cutter wifi password", url: "/z" },
        { workspaceId: w.b.id, entityType: "doc", entityId: w.docs.bDoc.id, title: "Laser elsewhere", url: "/b" },
      ],
    });
    const hits = data<{ results: Array<{ title: string }> }>(await run(w.principal(w.users.member.id, "MEMBER"), "sw_search_workspace", { query: "laser" }));
    expect(hits.results.map((r) => r.title).sort()).toEqual(["Laser checklist", "Laser rules"]);
  });
});
