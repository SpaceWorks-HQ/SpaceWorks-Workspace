import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { clip, userNames } from "@/lib/assistant/tools/access";
import { defineTool, plural } from "@/lib/assistant/tools/types";

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
