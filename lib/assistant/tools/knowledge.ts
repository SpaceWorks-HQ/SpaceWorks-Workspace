import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeTags, searchMemories } from "@/lib/assistant/memory";
import { clip } from "@/lib/assistant/tools/access";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, plural, ToolError } from "@/lib/assistant/tools/types";

export const remember = defineTool({
  name: "sw_remember",
  title: "Remember",
  description:
    "Save a short, durable fact about this workspace to shared memory (for example \"Build nights are Thursdays 6–9 pm\"). Only save what the person asked you to remember or clearly wants kept. Never save passwords, keys or personal contact details.",
  input: z.object({
    content: z.string().trim().min(3).max(1000),
    tags: z.array(z.string().trim().max(32)).max(8).optional(),
  }),
  write: true,
  scope: "write:docs",
  minRole: "MEMBER",
  async run(ctx, input) {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.assistantMemory.create({
        data: {
          workspaceId: ctx.principal.workspace.id,
          content: input.content,
          tags: normalizeTags(input.tags),
          createdById: ctx.principal.userId,
          source: ctx.via === "job" ? "job" : "assistant",
        },
        select: { id: true },
      });
      await auditToolWrite(ctx, { action: "assistant.memory_saved", targetType: "AssistantMemory", targetId: created.id }, tx);
      return created;
    });
    return { summary: "Saved to workspace memory", data: { id: row.id } };
  },
});

export const searchMemory = defineTool({
  name: "sw_search_memory",
  title: "Memory",
  description: "Search the workspace's shared memory for saved facts. An empty query returns the most recent ones.",
  input: z.object({ query: z.string().trim().max(200).default(""), limit: z.number().int().min(1).max(30).default(10) }),
  write: false,
  scope: "read:docs",
  minRole: "MEMBER",
  async run(ctx, input) {
    const rows = await searchMemories(ctx.principal.workspace.id, input.query, input.limit);
    return {
      summary: `Found ${plural(rows.length, "memory", "memories")}`,
      data: { memories: rows.map((m) => ({ id: m.id, content: m.content, tags: m.tags, savedAt: m.updatedAt.toISOString() })) },
    };
  },
});

export const forget = defineTool({
  name: "sw_forget",
  title: "Forget",
  description: "Delete one saved memory by id (admins only). The person confirms before it runs.",
  input: z.object({ id: z.string().trim().min(1).max(64) }),
  write: true,
  scope: "write:docs",
  minRole: "ADMIN",
  async run(ctx, input) {
    const existing = await prisma.assistantMemory.findFirst({ where: { id: input.id, workspaceId: ctx.principal.workspace.id }, select: { id: true, content: true } });
    if (!existing) throw new ToolError("No memory with that id.", "not_found");
    await prisma.$transaction(async (tx) => {
      await tx.assistantMemory.delete({ where: { id: existing.id } });
      await auditToolWrite(ctx, { action: "assistant.memory_deleted", targetType: "AssistantMemory", targetId: existing.id }, tx);
    });
    return { summary: "Removed from workspace memory", data: { id: existing.id, content: clip(existing.content, 200) } };
  },
});

export const listSkills = defineTool({
  name: "sw_list_skills",
  title: "Skills",
  description: "List the workspace's enabled assistant skills (playbooks).",
  input: z.object({}),
  write: false,
  scope: "read:docs",
  minRole: "MEMBER",
  async run(ctx) {
    const rows = await prisma.assistantSkill.findMany({ where: { workspaceId: ctx.principal.workspace.id, enabled: true }, orderBy: { name: "asc" }, select: { name: true, description: true } });
    return { summary: `Looked up ${plural(rows.length, "skill")}`, data: { skills: rows } };
  },
});

export const getSkill = defineTool({
  name: "sw_get_skill",
  title: "Skill",
  description: "Read one enabled skill's full playbook by name.",
  input: z.object({ name: z.string().trim().min(1).max(80) }),
  write: false,
  scope: "read:docs",
  minRole: "MEMBER",
  async run(ctx, input) {
    const skill = await prisma.assistantSkill.findFirst({
      where: { workspaceId: ctx.principal.workspace.id, enabled: true, name: { equals: input.name, mode: "insensitive" } },
      select: { name: true, description: true, body: true },
    });
    if (!skill) throw new ToolError(`No enabled skill called ${input.name}.`, "not_found");
    return { summary: `Read the ${skill.name} skill`, data: skill };
  },
});

export const KNOWLEDGE_TOOLS = [remember, searchMemory, forget, listSkills, getSkill];
