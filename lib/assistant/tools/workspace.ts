import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { canViewFinance, canViewServices, hasRoleAtLeast } from "@/lib/roles";
import { userTeamIds } from "@/lib/teamAccess";
import { formatMoney } from "@/lib/format/money";
import { hasScope, type ApiScope } from "@/lib/apiTokens/scopes";
import type { Principal } from "@/lib/assistant/principal";
import { channelWhere, clip, hiddenTeamsFor, userNames } from "@/lib/assistant/tools/access";
import { defineTool, plural, ToolError } from "@/lib/assistant/tools/types";

/* ───────────── Global search (SearchDocument, filtered at query time) ───────────── */

const TOKEN_SCOPE_BY_TYPE: Record<string, ApiScope> = {
  task: "read:tasks",
  project: "read:tasks",
  doc: "read:docs",
  message: "read:chat",
  channel: "read:chat",
  member: "read:members",
  event: "read:members",
  announcement: "read:members",
};
const GUEST_TYPES = new Set(["task", "project", "doc", "message", "channel", "announcement", "event", "meeting", "member"]);
const FINANCE_TYPES = new Set(["ledger", "ledger_entry", "invoice", "budget", "purchase_request", "reimbursement", "expense"]);
const NEVER_TYPES = (type: string) => type.startsWith("vault") || type === "emergency_contact";

export type SearchHit = {
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  url: string;
  visibility: "PRIVATE" | "TEAM" | "WORKSPACE";
  teamId: string | null;
  channelId: string | null;
  ownerId: string | null;
};

/** Pure access filter for search hits (unit-tested). */
export function filterSearchHits(
  hits: SearchHit[],
  principal: Pick<Principal, "kind" | "userId" | "role" | "scopes" | "workspace">,
  access: { hiddenTeams: Set<string>; myTeams: Set<string>; readableChannels: Set<string>; adminOnlyDocs: Set<string> },
): SearchHit[] {
  const admin = hasRoleAtLeast(principal.role, "ADMIN") && principal.kind === "user";
  const finance = canViewFinance(principal, principal.workspace);
  return hits.filter((hit) => {
    if (NEVER_TYPES(hit.entityType)) return false;
    if (principal.kind === "token") {
      const scope = TOKEN_SCOPE_BY_TYPE[hit.entityType];
      if (!scope || !hasScope(principal.scopes ?? [], scope)) return false;
    }
    if (principal.role === "GUEST" && !GUEST_TYPES.has(hit.entityType)) return false;
    if (FINANCE_TYPES.has(hit.entityType) && !finance) return false;
    if (hit.teamId && access.hiddenTeams.has(hit.teamId)) return false;
    if (hit.channelId && !access.readableChannels.has(hit.channelId)) return false;
    if (hit.entityType === "doc" && !admin && access.adminOnlyDocs.has(hit.entityId)) return false;
    if (hit.visibility === "PRIVATE" && !admin && hit.ownerId !== principal.userId) return false;
    if (hit.visibility === "TEAM" && !admin && !(hit.teamId && access.myTeams.has(hit.teamId))) return false;
    return true;
  });
}

export const searchWorkspace = defineTool({
  name: "sw_search_workspace",
  title: "Search",
  description: "Full-text search across the workspace (tasks, docs, messages, meetings, contacts and more), limited to what the caller can see.",
  input: z.object({
    query: z.string().trim().min(1).max(200),
    types: z.array(z.string().trim().max(40)).max(10).optional().describe('Only these entity types, e.g. ["task","doc"].'),
    limit: z.number().int().min(1).max(30).default(10),
  }),
  write: false,
  // Tokens may search with any read scope; hits are limited to the entity types their scopes cover.
  scope: ["read:tasks", "read:docs", "read:chat", "read:members"],
  minRole: "GUEST",
  async run(ctx, input) {
    const { principal } = ctx;
    const like = `%${input.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const raw = await prisma.$queryRaw<SearchHit[]>`
      SELECT "entityType", "entityId", "title", "body", "url", "visibility"::text AS "visibility", "teamId", "channelId", "ownerId"
      FROM "SearchDocument"
      WHERE "workspaceId" = ${principal.workspace.id}
        AND ("searchVector" @@ websearch_to_tsquery('simple', ${input.query}) OR "title" ILIKE ${like})
      ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${input.query})) DESC, "updatedAt" DESC
      LIMIT 200`;
    const typed = input.types?.length ? raw.filter((hit) => input.types!.includes(hit.entityType)) : raw;
    const docIds = typed.filter((h) => h.entityType === "doc").map((h) => h.entityId);
    const channelIds = [...new Set(typed.map((h) => h.channelId).filter((id): id is string => Boolean(id)))];
    const [hidden, mine, readable, adminDocs] = await Promise.all([
      hiddenTeamsFor(principal),
      principal.kind === "job" ? Promise.resolve([]) : userTeamIds(principal.workspace.id, principal.userId),
      channelIds.length
        ? prisma.channel.findMany({ where: { AND: [await channelWhere(principal), { id: { in: channelIds } }] }, select: { id: true } })
        : Promise.resolve([]),
      docIds.length ? prisma.doc.findMany({ where: { workspaceId: principal.workspace.id, id: { in: docIds }, OR: [{ visibility: "ADMINS" }, { archivedAt: { not: null } }] }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const hits = filterSearchHits(typed, principal, {
      hiddenTeams: new Set(hidden),
      myTeams: new Set(mine),
      readableChannels: new Set(readable.map((c) => c.id)),
      adminOnlyDocs: new Set(adminDocs.map((d) => d.id)),
    }).slice(0, input.limit);
    return {
      summary: `Found ${plural(hits.length, "result")} for “${clip(input.query, 40)}”`,
      data: { results: hits.map((h) => ({ type: h.entityType, id: h.entityId, title: h.title, snippet: clip(h.body, 300), url: h.url })) },
    };
  },
});

/* ───────────── Members and community ───────────── */

export const listMembers = defineTool({
  name: "sw_list_members",
  title: "Members",
  description: "List active members (name, role, title, skills, short bio). Filter by words in the name or a skill. Never returns contact details.",
  input: z.object({
    query: z.string().trim().max(80).optional().describe("Name or skill, e.g. \"soldering\"."),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: z.string().trim().max(64).optional(),
  }),
  write: false,
  scope: "read:members",
  minRole: "GUEST",
  async run(ctx, input) {
    const q = input.query?.toLowerCase();
    const rows = await prisma.membership.findMany({
      where: {
        workspaceId: ctx.principal.workspace.id,
        status: "ACTIVE",
        user: { disabledAt: null },
        ...(q ? { OR: [{ user: { name: { contains: q, mode: "insensitive" } } }, { user: { skills: { has: q } } }, { title: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: { id: true, role: true, title: true, joinedAt: true, user: { select: { id: true, name: true, pronouns: true, skills: true, bio: true, timezone: true } } },
    });
    const page = rows.slice(0, input.limit);
    return {
      summary: `Looked up ${plural(page.length, "member")}`,
      data: {
        members: page.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          pronouns: m.user.pronouns,
          role: m.role,
          title: m.title,
          skills: m.user.skills,
          bio: m.user.bio ? clip(m.user.bio, 300) : null,
          timezone: m.user.timezone,
          joinedAt: m.joinedAt.toISOString().slice(0, 10),
        })),
        nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      },
    };
  },
});

export const listAnnouncements = defineTool({
  name: "sw_list_announcements",
  title: "Announcements",
  description: "List published announcements, pinned first, then newest.",
  input: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
  write: false,
  scope: "read:members",
  minRole: "GUEST",
  async run(ctx, input) {
    const rows = await prisma.announcement.findMany({
      where: { workspaceId: ctx.principal.workspace.id, publishedAt: { not: null } },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: input.limit,
      select: { id: true, title: true, body: true, pinned: true, publishedAt: true, authorId: true },
    });
    const names = await userNames(rows.map((r) => r.authorId));
    return {
      summary: `Looked up ${plural(rows.length, "announcement")}`,
      data: {
        announcements: rows.map((a) => ({
          id: a.id,
          title: a.title,
          pinned: a.pinned,
          publishedAt: a.publishedAt!.toISOString(),
          author: a.authorId ? names.get(a.authorId) ?? "Former member" : null,
          text: clip(a.body.replace(/<[^>]+>/g, ""), 1200),
        })),
      },
    };
  },
});

/* ───────────── Finance (only when the caller may see the kitty) ───────────── */

export const financeSummary = defineTool({
  name: "sw_finance_summary",
  title: "Kitty summary",
  description: "Summarise the community kitty: income, expenses and balance per month for the last few months, top categories and the all-time balance.",
  input: z.object({ months: z.number().int().min(1).max(12).default(3) }),
  write: false,
  scope: "read:finance",
  minRole: "MEMBER",
  available: (principal) => canViewFinance(principal, principal.workspace),
  async run(ctx, input) {
    const { workspace } = ctx.principal;
    const since = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth() - (input.months - 1), 1));
    const [months, categories, totals] = await Promise.all([
      prisma.$queryRaw<Array<{ month: string; kind: string; total: bigint }>>`
        SELECT to_char(date_trunc('month', "occurredOn"), 'YYYY-MM') AS month, "kind"::text AS kind, SUM("amountMinor")::bigint AS total
        FROM "LedgerEntry"
        WHERE "workspaceId" = ${workspace.id} AND "voidedAt" IS NULL AND "currency" = ${workspace.currency} AND "occurredOn" >= ${since}
        GROUP BY 1, 2 ORDER BY 1`,
      prisma.$queryRaw<Array<{ name: string | null; kind: string; total: bigint }>>`
        SELECT c."name" AS name, e."kind"::text AS kind, SUM(e."amountMinor")::bigint AS total
        FROM "LedgerEntry" e LEFT JOIN "FinanceCategory" c ON c."id" = e."categoryId"
        WHERE e."workspaceId" = ${workspace.id} AND e."voidedAt" IS NULL AND e."currency" = ${workspace.currency} AND e."occurredOn" >= ${since}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
      prisma.$queryRaw<Array<{ kind: string; total: bigint }>>`
        SELECT "kind"::text AS kind, SUM("amountMinor")::bigint AS total FROM "LedgerEntry"
        WHERE "workspaceId" = ${workspace.id} AND "voidedAt" IS NULL AND "currency" = ${workspace.currency}
        GROUP BY 1`,
    ]);
    const money = (minor: number) => formatMoney(minor, workspace.currency);
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const row of months) {
      const entry = byMonth.get(row.month) ?? { income: 0, expense: 0 };
      entry[row.kind === "INCOME" ? "income" : "expense"] += Number(row.total);
      byMonth.set(row.month, entry);
    }
    const income = Number(totals.find((t) => t.kind === "INCOME")?.total ?? 0);
    const expense = Number(totals.find((t) => t.kind === "EXPENSE")?.total ?? 0);
    return {
      summary: `Summarised the kitty for ${plural(input.months, "month")}`,
      data: {
        currency: workspace.currency,
        balance: money(income - expense),
        months: [...byMonth.entries()].map(([month, v]) => ({ month, income: money(v.income), expenses: money(v.expense), net: money(v.income - v.expense) })),
        topCategories: categories.map((c) => ({ category: c.name ?? "Uncategorised", kind: c.kind.toLowerCase(), total: money(Number(c.total)) })),
      },
    };
  },
});

/* ───────────── Services monitor (read models; empty until monitors exist) ───────────── */

export const listMonitors = defineTool({
  name: "sw_list_monitors",
  title: "Monitors",
  description: "List service monitors with their latest status (up, degraded, down, paused).",
  input: z.object({ status: z.enum(["any", "UP", "DEGRADED", "DOWN", "PAUSED", "MAINTENANCE", "PENDING", "UNKNOWN"]).default("any"), limit: z.number().int().min(1).max(100).default(50) }),
  write: false,
  scope: null,
  minRole: "MEMBER",
  available: (principal) => canViewServices(principal),
  async run(ctx, input) {
    const rows = await prisma.monitor.findMany({
      where: { workspaceId: ctx.principal.workspace.id, ...(input.status === "any" ? {} : { lastStatus: input.status }) },
      orderBy: [{ lastStatus: "asc" }, { name: "asc" }],
      take: input.limit,
      select: { id: true, name: true, type: true, enabled: true, lastStatus: true, lastCheckedAt: true, lastLatencyMs: true, tags: true },
    });
    return {
      summary: rows.length ? `Looked up ${plural(rows.length, "monitor")}` : "No monitors set up yet",
      data: {
        monitors: rows.map((m) => ({ id: m.id, name: m.name, type: m.type, enabled: m.enabled, status: m.lastStatus, lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null, latencyMs: m.lastLatencyMs, tags: m.tags })),
      },
    };
  },
});

export const listIncidents = defineTool({
  name: "sw_list_incidents",
  title: "Incidents",
  description: "List service incidents, open ones by default.",
  input: z.object({ status: z.enum(["open", "resolved", "all"]).default("open"), limit: z.number().int().min(1).max(50).default(20) }),
  write: false,
  scope: null,
  minRole: "MEMBER",
  available: (principal) => canViewServices(principal),
  async run(ctx, input) {
    const rows = await prisma.incident.findMany({
      where: {
        workspaceId: ctx.principal.workspace.id,
        ...(input.status === "open" ? { status: { not: "RESOLVED" } } : input.status === "resolved" ? { status: "RESOLVED" } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: input.limit,
      select: { number: true, title: true, status: true, severity: true, impact: true, startedAt: true, acknowledgedAt: true, resolvedAt: true },
    });
    return {
      summary: rows.length ? `Looked up ${plural(rows.length, "incident")}` : "No incidents",
      data: {
        incidents: rows.map((i) => ({
          number: i.number,
          title: i.title,
          status: i.status,
          severity: i.severity,
          impact: i.impact,
          startedAt: i.startedAt.toISOString(),
          acknowledged: Boolean(i.acknowledgedAt),
          resolvedAt: i.resolvedAt?.toISOString() ?? null,
          url: `/w/${ctx.principal.workspace.slug}/services`,
        })),
      },
    };
  },
});

/* ───────────── Web search (SearXNG, only when SEARXNG_URL is set) ───────────── */

export function searxngUrl(): string | null {
  const value = process.env.SEARXNG_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export const webSearch = defineTool({
  name: "sw_web_search",
  title: "Web search",
  description: "Search the public web through the workspace's SearXNG instance. Use for facts outside the workspace; cite the links you use.",
  input: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(10).default(5) }),
  write: false,
  scope: null,
  minRole: "MEMBER",
  available: () => searxngUrl() !== null,
  async run(_ctx, input) {
    const base = searxngUrl();
    if (!base) throw new ToolError("Web search is not set up on this instance.", "unavailable");
    const url = `${base}/search?${new URLSearchParams({ q: input.query, format: "json", safesearch: "1" })}`;
    let payload: { results?: Array<{ title?: string; url?: string; content?: string }> };
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw new Error(String(response.status));
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new ToolError("Web search didn't answer. Try again in a moment.", "unavailable");
    }
    const results = (payload.results ?? [])
      .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
      .slice(0, input.limit)
      .map((r) => ({ title: clip(r.title ?? r.url!, 200), url: r.url!, snippet: clip(r.content ?? "", 400) }));
    return { summary: `Searched the web for “${clip(input.query, 40)}”`, data: { results } };
  },
});

export const WORKSPACE_TOOLS = [searchWorkspace, listMembers, listAnnouncements, financeSummary, listMonitors, listIncidents, webSearch];
