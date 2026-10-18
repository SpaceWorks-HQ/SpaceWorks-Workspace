import "server-only";

import type { Visibility } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";

/**
 * Write side of global search (shared by every area). Each area upserts a
 * SearchDocument for its own entities on create/update and removes it on
 * delete; the platform-shell build owns the query side (lib/search/query.ts,
 * the search page and the command palette).
 *
 * Rules: index titles and plain text only, never secrets (vault values,
 * emergency contacts, DM bodies for non-participants), and set visibility /
 * teamId / projectId / channelId / ownerId so the query can filter by access.
 */
export type SearchDocumentInput = {
  workspaceId: string;
  /** "task" | "doc" | "message" | "contact" | "service" | "meeting" | "decision" | … */
  entityType: string;
  entityId: string;
  title: string;
  body?: string;
  /** App-relative link, e.g. /w/kochi/contacts/abc. */
  url: string;
  visibility?: Visibility;
  teamId?: string | null;
  projectId?: string | null;
  channelId?: string | null;
  ownerId?: string | null;
};

export async function indexSearchDocument(input: SearchDocumentInput, client: DbClient = prisma) {
  const data = {
    workspaceId: input.workspaceId,
    title: input.title.slice(0, 300),
    body: (input.body ?? "").slice(0, 20_000),
    url: input.url.slice(0, 500),
    visibility: input.visibility ?? "WORKSPACE",
    teamId: input.teamId ?? null,
    projectId: input.projectId ?? null,
    channelId: input.channelId ?? null,
    ownerId: input.ownerId ?? null,
  };
  await client.searchDocument.upsert({
    where: { entityType_entityId: { entityType: input.entityType, entityId: input.entityId } },
    create: { entityType: input.entityType, entityId: input.entityId, ...data },
    update: data,
  });
}

export async function removeSearchDocument(entityType: string, entityId: string, client: DbClient = prisma) {
  await client.searchDocument.deleteMany({ where: { entityType, entityId } });
}
