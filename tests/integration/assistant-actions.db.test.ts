import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma } from "@/lib/db";
import { createApiTokenAction, revokeApiTokenAction } from "@/app/actions/apiTokens";
import { createJobAction, createMemoryAction, createSkillAction, deleteConversationAction, installBuiltinSkillsAction } from "@/app/actions/assistant";
import { authenticateApiToken } from "@/lib/apiTokens";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

const suffix = uniqueSuffix();
let w: World;
let slug: string;

describe.sequential("assistant server actions: roles and tenancy", () => {
  beforeAll(async () => {
    w = await buildWorld(suffix);
    slug = w.slugs[0]!;
  });

  beforeEach(() => {
    sessionUser.id = "";
  });

  afterAll(async () => {
    await cleanup(w.slugs, w.domain);
    await prisma.$disconnect();
  });

  it("lets only admins create and revoke API tokens; the secret is shown once and stored hashed", async () => {
    sessionUser.id = w.users.member.id;
    expect(await createApiTokenAction(slug, { name: "x", scopes: ["read:tasks"], expiresInDays: 30 })).toMatchObject({ ok: false });
    sessionUser.id = w.users.ownerB.id;
    expect(await createApiTokenAction(slug, { name: "x", scopes: ["read:tasks"], expiresInDays: 30 })).toMatchObject({ ok: false });

    sessionUser.id = w.users.admin.id;
    expect(await createApiTokenAction(slug, { name: "x", scopes: ["root"], expiresInDays: null })).toMatchObject({ ok: false });
    const created = await createApiTokenAction(slug, { name: "Claude Desktop", scopes: ["mcp", "read:tasks"], expiresInDays: 90 });
    if (!created.ok || !created.data) throw new Error("expected a token");
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { prefix: created.data.prefix } });
    expect(row.secretHash).not.toContain(created.data.token.split("_").at(-1)!);
    expect(row.scopes).toEqual(["read:tasks", "mcp"]);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "api_token.created", targetId: row.id } });
    expect(JSON.stringify(audit.metadata)).not.toContain(created.data.token);
    expect(await authenticateApiToken(`Bearer ${created.data.token}`)).not.toBeNull();

    expect((await revokeApiTokenAction(slug, { tokenId: row.id })).ok).toBe(true);
    expect(await authenticateApiToken(`Bearer ${created.data.token}`)).toBeNull();
    expect(await revokeApiTokenAction(slug, { tokenId: row.id })).toMatchObject({ ok: false });
  });

  it("keeps memory, skills and jobs to admins and validates schedules", async () => {
    sessionUser.id = w.users.member.id;
    expect(await createMemoryAction(slug, { content: "The wifi is on the fridge", tags: [] })).toMatchObject({ ok: false });
    expect(await createSkillAction(slug, { name: "x", description: "y", body: "z" })).toMatchObject({ ok: false });
    expect(await createJobAction(slug, { name: "Digest", cron: "0 8 * * *", timezone: "Asia/Kolkata", prompt: "Write the digest please." })).toMatchObject({ ok: false });

    sessionUser.id = w.users.admin.id;
    expect((await createMemoryAction(slug, { content: "Build nights are Thursdays", tags: ["Schedule"] })).ok).toBe(true);
    const bad = await createJobAction(slug, { name: "Digest", cron: "every morning", timezone: "Asia/Kolkata", prompt: "Write the digest please." });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { cron: expect.any(Array) } });
    const foreignChannel = await prisma.channel.findFirstOrThrow({ where: { workspaceId: w.b.id, slug: "general" } });
    expect(await createJobAction(slug, { name: "Digest", cron: "0 8 * * *", timezone: "Asia/Kolkata", prompt: "Write the digest please.", channelId: foreignChannel.id })).toMatchObject({ ok: false });

    const destination = await prisma.notificationDestination.create({ data: { workspaceId: w.a.id, name: "Ops email", kind: "EMAIL", config: { to: ["ops@example.org"] }, createdById: w.users.owner.id } });
    const job = await createJobAction(slug, { name: "Digest", cron: "0 8 * * *", timezone: "Asia/Kolkata", prompt: "Write the digest please.", channelId: w.channels.general.id, destinationIds: [destination.id] });
    if (!job.ok || !job.data) throw new Error("expected a job");
    const saved = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.data.id } });
    expect(saved.nextRunAt).not.toBeNull();
    const rule = await prisma.notificationRule.findFirstOrThrow({ where: { workspaceId: w.a.id, scopeType: "DIGEST", scopeId: job.data.id }, include: { destinations: true } });
    expect(rule.eventTypes).toEqual(["digest.ready"]);
    expect(rule.destinations.map((d) => d.destinationId)).toEqual([destination.id]);

    const installed = await installBuiltinSkillsAction(slug);
    expect(installed).toMatchObject({ ok: true, data: { added: 3 } });
    expect(await installBuiltinSkillsAction(slug)).toMatchObject({ ok: true, data: { added: 0 } });
    expect(await createSkillAction(slug, { name: "Weekly review", description: "dup", body: "dup" })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array) } });
  });

  it("lets people delete only their own conversations", async () => {
    const mine = await prisma.assistantConversation.create({ data: { workspaceId: w.a.id, userId: w.users.member.id } });
    sessionUser.id = w.users.admin.id;
    expect(await deleteConversationAction(slug, { conversationId: mine.id })).toMatchObject({ ok: false });
    sessionUser.id = w.users.member.id;
    expect((await deleteConversationAction(slug, { conversationId: mine.id })).ok).toBe(true);
    sessionUser.id = w.users.guest.id;
    expect(await deleteConversationAction(slug, { conversationId: mine.id })).toMatchObject({ ok: false });
  });
});
