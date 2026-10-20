import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { ALL_TOOLS, getTool, toolJsonSchema, toolsFor } from "@/lib/assistant/tools";
import { toolAccess, tokenHasToolScope } from "@/lib/assistant/tools/policy";
import { parseTaskNumber } from "@/lib/assistant/tools/tasks";
import { filterSearchHits, type SearchHit } from "@/lib/assistant/tools/workspace";
import type { Principal } from "@/lib/assistant/principal";
import { effectiveJobRole } from "@/lib/assistant/principal";
import { bearerToken, normalizeScopes, parseTokenString, type ApiScope } from "@/lib/apiTokens/scopes";

const workspace = { id: "ws1", slug: "kochi", name: "Kochi", timezone: "Asia/Kolkata", currency: "INR", financeVisibleToMembers: false };
const user = (role: WorkspaceRole): Principal => ({ kind: "user", workspace, userId: "u1", userName: "Meera", role });
const token = (scopes: ApiScope[], role: WorkspaceRole = "ADMIN"): Principal => ({ kind: "token", workspace, userId: "admin1", userName: "Rahul", role, tokenId: "t1", scopes });
const job = (role: WorkspaceRole = "OWNER"): Principal => ({ kind: "job", workspace, userId: "u1", userName: "Anjali", role: effectiveJobRole(role) });

describe("tool registry", () => {
  it("names every tool with the sw_ prefix, uniquely, with an object JSON schema", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^sw_[a-z_]+$/);
      const schema = toolJsonSchema(tool);
      expect(schema.type).toBe("object");
      expect(schema).not.toHaveProperty("$schema");
    }
    expect(names).toEqual(expect.arrayContaining(["sw_list_tasks", "sw_create_task", "sw_search_workspace", "sw_send_channel_message", "sw_remember", "sw_forget", "sw_finance_summary", "sw_web_search"]));
  });

  it("validates tool inputs with zod", () => {
    const create = getTool("sw_create_task")!;
    expect(create.input.safeParse({ title: "Fix the 3D printer" }).success).toBe(true);
    expect(create.input.safeParse({ title: "" }).success).toBe(false);
    expect(create.input.safeParse({ title: "x", priority: "SOON" }).success).toBe(false);
    expect(create.input.safeParse({ title: "x", dueAt: "next tuesday" }).success).toBe(false);
    expect(create.input.safeParse({ title: "x", dueAt: "2026-11-02" }).success).toBe(true);
    const list = getTool("sw_list_tasks")!;
    expect(list.input.parse({})).toMatchObject({ status: "open", limit: 20 });
    expect(list.input.safeParse({ limit: 500 }).success).toBe(false);
    const send = getTool("sw_send_channel_message")!;
    expect(send.input.safeParse({ channel: "general", text: "a".repeat(4001) }).success).toBe(false);
  });

  it("parses task references", () => {
    expect(parseTaskNumber("BOT-12")).toBe(12);
    expect(parseTaskNumber("#7")).toBe(7);
    expect(parseTaskNumber("42")).toBe(42);
    expect(parseTaskNumber("BOT 12")).toBeNull();
    expect(parseTaskNumber("12; drop table")).toBeNull();
  });
});

describe("tool access policy", () => {
  const create = getTool("sw_create_task")!;
  const list = getTool("sw_list_tasks")!;
  const forget = getTool("sw_forget")!;
  const finance = getTool("sw_finance_summary")!;
  const monitors = getTool("sw_list_monitors")!;

  it("needs MEMBER+ for writes and the tool's minimum role", () => {
    expect(toolAccess(create, user("GUEST")).ok).toBe(false);
    expect(toolAccess(create, user("MEMBER")).ok).toBe(true);
    expect(toolAccess(list, user("GUEST")).ok).toBe(true);
    expect(toolAccess(forget, user("MEMBER")).ok).toBe(false);
    expect(toolAccess(forget, user("ADMIN")).ok).toBe(true);
  });

  it("limits tokens to their scopes and MCP to tokens with the mcp scope", () => {
    expect(toolAccess(list, token(["read:tasks"])).ok).toBe(true);
    expect(toolAccess(create, token(["read:tasks"])).ok).toBe(false);
    expect(toolAccess(create, token(["write:tasks"])).ok).toBe(true);
    expect(toolAccess(list, token(["read:tasks"]), { requireMcp: true }).ok).toBe(false);
    expect(toolAccess(list, token(["read:tasks", "mcp"]), { requireMcp: true }).ok).toBe(true);
    // Tools without a token scope never reach tokens.
    expect(toolAccess(monitors, token(["read:tasks", "read:docs", "read:chat", "read:members", "read:finance", "mcp"])).ok).toBe(false);
    expect(tokenHasToolScope(["read:chat"], ["read:tasks", "read:chat"])).toBe(true);
    expect(tokenHasToolScope(["read:chat"], null)).toBe(false);
  });

  it("gates the kitty on finance visibility and keeps jobs read-only", () => {
    expect(toolAccess(finance, user("MEMBER")).ok).toBe(false);
    expect(toolAccess(finance, user("ADMIN")).ok).toBe(true);
    expect(toolAccess(finance, { ...user("MEMBER"), workspace: { ...workspace, financeVisibleToMembers: true } }).ok).toBe(true);
    // Jobs run with member-level rights at most, so an owner's job can't read an admin-only kitty.
    expect(toolAccess(finance, job("OWNER")).ok).toBe(false);
    expect(toolAccess(create, job("OWNER")).ok).toBe(false);
    expect(toolsFor(job("OWNER")).some((t) => t.write)).toBe(false);
  });

  it("only offers web search when SearXNG is configured", () => {
    const previous = process.env.SEARXNG_URL;
    delete process.env.SEARXNG_URL;
    expect(toolsFor(user("MEMBER")).some((t) => t.name === "sw_web_search")).toBe(false);
    process.env.SEARXNG_URL = "http://searxng.local";
    expect(toolsFor(user("MEMBER")).some((t) => t.name === "sw_web_search")).toBe(true);
    if (previous === undefined) delete process.env.SEARXNG_URL;
    else process.env.SEARXNG_URL = previous;
  });
});

describe("search hit filtering", () => {
  const hit = (over: Partial<SearchHit>): SearchHit => ({ entityType: "doc", entityId: "d1", title: "T", body: "", url: "/x", visibility: "WORKSPACE", teamId: null, channelId: null, ownerId: null, ...over });
  const access = { hiddenTeams: new Set(["secret-team"]), myTeams: new Set(["crew"]), readableChannels: new Set(["c-general"]), adminOnlyDocs: new Set(["d-admin"]) };
  const hits = [
    hit({ entityId: "d1" }),
    hit({ entityId: "d-admin" }),
    hit({ entityType: "vault_item", entityId: "v1" }),
    hit({ entityType: "invoice", entityId: "i1" }),
    hit({ entityType: "message", entityId: "m1", channelId: "c-private" }),
    hit({ entityType: "message", entityId: "m2", channelId: "c-general" }),
    hit({ entityType: "task", entityId: "t1", teamId: "secret-team" }),
    hit({ entityType: "contact", entityId: "p1", visibility: "PRIVATE", ownerId: "someone-else" }),
    hit({ entityType: "contact", entityId: "p2", visibility: "TEAM", teamId: "crew" }),
  ];

  it("applies visibility, teams, channels, admin-only docs, finance and never vault", () => {
    const ids = filterSearchHits(hits, user("MEMBER"), access).map((h) => h.entityId);
    expect(ids).toEqual(["d1", "m2", "p2"]);
  });

  it.each(["GUEST", "MEMBER", "ADMIN", "OWNER"] as const)("keeps personal notes owner-only for %s, regardless of index visibility", (role) => {
    const principal = user(role);
    const own = hit({ entityType: "note", entityId: "own", ownerId: principal.userId, visibility: "PRIVATE" });
    const other = hit({ entityType: "note", entityId: "other", ownerId: "someone-else", visibility: "PRIVATE" });
    const stale = hit({ ...other, entityId: "stale", visibility: "WORKSPACE" });
    expect(filterSearchHits([own, other, stale], principal, access).map(h => h.entityId)).toEqual(["own"]);
  });

  it("keeps guests to everyday types and tokens to their scopes", () => {
    expect(filterSearchHits(hits, user("GUEST"), access).map((h) => h.entityId)).toEqual(["d1", "m2"]);
    expect(filterSearchHits(hits, token(["read:chat"]), access).map((h) => h.entityId)).toEqual(["m2"]);
  });
});

describe("api token strings", () => {
  it("parses only well-formed bearer tokens", () => {
    const secret = "A".repeat(43);
    expect(parseTokenString(`sww_abcdefghjkmn_${secret}`)).toEqual({ prefix: "sww_abcdefghjkmn", secret });
    expect(parseTokenString(`sww_short_${secret}`)).toBeNull();
    expect(parseTokenString("sww_abcdefghjkmn_tooshort")).toBeNull();
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(normalizeScopes(["mcp", "bogus", "read:tasks", "mcp"])).toEqual(["read:tasks", "mcp"]);
  });
});
