import "server-only";

import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { Prisma, type WorkspaceRole } from "@prisma/client";

import { visibleDocsWhere } from "./context";

// ───────────── Reads ─────────────

export async function listTreeDocs(workspaceId: string, role: WorkspaceRole) {
  return prisma.doc.findMany({
    where: { ...visibleDocsWhere(workspaceId, role), archivedAt: null },
    select: { id: true, parentId: true, title: true, position: true, visibility: true },
    orderBy: [{ position: "asc" }, { title: "asc" }],
  });
}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Full-text + title search over live docs the role may see. */
export async function searchDocs(workspaceId: string, role: WorkspaceRole, query: string, take = 30) {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const adminFilter = hasRoleAtLeast(role, "ADMIN") ? Prisma.empty : Prisma.sql`AND "visibility" = 'WORKSPACE'`;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Doc"
    WHERE "workspaceId" = ${workspaceId} AND "archivedAt" IS NULL ${adminFilter}
      AND ("searchVector" @@ websearch_to_tsquery('simple', ${q}) OR "title" ILIKE ${likePattern(q)})
    ORDER BY ("title" ILIKE ${likePattern(q)}) DESC, ts_rank("searchVector", websearch_to_tsquery('simple', ${q})) DESC, "updatedAt" DESC
    LIMIT ${take}`;
  if (rows.length === 0) return [];
  const docs = await prisma.doc.findMany({
    where: { id: { in: rows.map((row) => row.id) }, workspaceId },
    select: { id: true, title: true, contentText: true, updatedAt: true, visibility: true },
  });
  const order = new Map(rows.map((row, index) => [row.id, index]));
  return docs.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
