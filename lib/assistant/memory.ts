import "server-only";

import { prisma } from "@/lib/db";

/**
 * Workspace memory: short facts the assistant (or an admin) saved for later,
 * e.g. "Build nights are Thursdays from 6 pm". Searched with PostgreSQL full
 * text (config `simple`, computed on the fly: the table stays small), plus a
 * substring and tag fallback so short words still match.
 */

export type MemoryRow = { id: string; content: string; tags: string[]; source: string; createdAt: Date; updatedAt: Date; createdById: string | null };

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-")).filter((tag) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(tag)))].slice(0, 8);
}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchMemories(workspaceId: string, query: string, limit = 20): Promise<MemoryRow[]> {
  const q = query.trim().slice(0, 200);
  const take = Math.min(Math.max(limit, 1), 100);
  if (!q) {
    return prisma.assistantMemory.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take,
      select: { id: true, content: true, tags: true, source: true, createdAt: true, updatedAt: true, createdById: true },
    });
  }
  const tag = q.toLowerCase();
  return prisma.$queryRaw<MemoryRow[]>`
    SELECT "id", "content", "tags", "source", "createdAt", "updatedAt", "createdById"
    FROM "AssistantMemory"
    WHERE "workspaceId" = ${workspaceId}
      AND (
        to_tsvector('simple', "content") @@ websearch_to_tsquery('simple', ${q})
        OR "content" ILIKE ${likePattern(q)}
        OR ${tag} = ANY("tags")
      )
    ORDER BY ts_rank(to_tsvector('simple', "content"), websearch_to_tsquery('simple', ${q})) DESC, "updatedAt" DESC
    LIMIT ${take}`;
}
