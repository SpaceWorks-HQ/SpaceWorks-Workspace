import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { clip, docWhere, textToHtml, userNames } from "@/lib/assistant/tools/access";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, plural, ToolError } from "@/lib/assistant/tools/types";

const docUrl = (slug: string, id: string) => `/w/${slug}/docs/${id}`;

/** Minimal TipTap document for plain text (one paragraph per blank-line block). */
export function textToTiptap(text: string): Prisma.InputJsonValue {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.map((para) => ({
      type: "paragraph",
      content: para.split("\n").flatMap((line, index) => [...(index > 0 ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]),
    })),
  };
}

export const listDocs = defineTool({
  name: "sw_list_docs",
  title: "Docs",
  description: "List docs the caller can read, optionally under a parent doc or matching words in the title.",
  input: z.object({
    query: z.string().trim().max(100).optional(),
    parentId: z.string().trim().max(64).optional().describe("Only direct children of this doc."),
    limit: z.number().int().min(1).max(50).default(25),
    cursor: z.string().trim().max(64).optional(),
  }),
  write: false,
  scope: "read:docs",
  minRole: "GUEST",
  async run(ctx, input) {
    const where: Prisma.DocWhereInput = {
      ...docWhere(ctx.principal),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.query ? { title: { contains: input.query, mode: "insensitive" } } : {}),
    };
    const rows = await prisma.doc.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: { id: true, title: true, parentId: true, updatedAt: true, updatedById: true, verifiedUntil: true },
    });
    const page = rows.slice(0, input.limit);
    const names = await userNames(page.map((d) => d.updatedById));
    return {
      summary: `Looked up ${plural(page.length, "doc")}`,
      data: {
        docs: page.map((d) => ({
          id: d.id,
          title: d.title,
          parentId: d.parentId,
          updatedAt: d.updatedAt.toISOString(),
          updatedBy: d.updatedById ? names.get(d.updatedById) ?? "Former member" : null,
          verified: Boolean(d.verifiedUntil && d.verifiedUntil > ctx.now),
          url: docUrl(ctx.principal.workspace.slug, d.id),
        })),
        nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      },
    };
  },
});

export const getDoc = defineTool({
  name: "sw_get_doc",
  title: "Doc",
  description: "Read one doc's text (long docs are cut at about 20,000 characters).",
  input: z.object({ id: z.string().trim().min(1).max(64) }),
  write: false,
  scope: "read:docs",
  minRole: "GUEST",
  async run(ctx, input) {
    const doc = await prisma.doc.findFirst({
      where: { ...docWhere(ctx.principal), id: input.id },
      select: { id: true, title: true, contentText: true, updatedAt: true, parentId: true, children: { where: { archivedAt: null }, select: { id: true, title: true }, take: 50 } },
    });
    if (!doc) throw new ToolError("No doc with that id that you can read.", "not_found");
    return {
      summary: `Read “${clip(doc.title, 60)}”`,
      data: {
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt.toISOString(),
        parentId: doc.parentId,
        children: doc.children,
        text: clip(doc.contentText, 20_000),
        url: docUrl(ctx.principal.workspace.slug, doc.id),
      },
    };
  },
});

export const createDoc = defineTool({
  name: "sw_create_doc",
  title: "New doc",
  description: "Create a doc visible to the whole workspace from plain text (blank lines separate paragraphs). The person confirms before it runs.",
  input: z.object({
    title: z.string().trim().min(1).max(200),
    text: z.string().trim().max(50_000).default(""),
    parentId: z.string().trim().max(64).optional().describe("Put it under this doc."),
  }),
  write: true,
  scope: "write:docs",
  minRole: "MEMBER",
  async run(ctx, input) {
    const { principal } = ctx;
    const workspaceId = principal.workspace.id;
    if (input.parentId) {
      const parent = await prisma.doc.findFirst({ where: { ...docWhere(principal), id: input.parentId }, select: { id: true } });
      if (!parent) throw new ToolError("No parent doc with that id that you can read.", "not_found");
    }
    const doc = await prisma.$transaction(async (tx) => {
      const row = await tx.doc.create({
        data: {
          workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          content: textToTiptap(input.text),
          contentHtml: textToHtml(input.text),
          contentText: input.text,
          position: Date.now(),
          createdById: principal.userId,
          updatedById: principal.userId,
          visibility: "WORKSPACE",
        },
        select: { id: true, title: true },
      });
      const url = docUrl(principal.workspace.slug, row.id);
      await indexSearchDocument({ workspaceId, entityType: "doc", entityId: row.id, title: row.title, body: input.text, url, ownerId: principal.userId }, tx);
      await recordActivity({ workspaceId, actorId: principal.userId, verb: "created", entityType: "doc", entityId: row.id, summary: `created the doc ${row.title}` }, tx);
      await auditToolWrite(ctx, { action: "assistant.doc_created", targetType: "Doc", targetId: row.id }, tx);
      return row;
    });
    return { summary: `Created the doc “${clip(doc.title, 60)}”`, data: { id: doc.id, title: doc.title, url: docUrl(principal.workspace.slug, doc.id) } };
  },
});

export const DOC_TOOLS = [listDocs, getDoc, createDoc];
