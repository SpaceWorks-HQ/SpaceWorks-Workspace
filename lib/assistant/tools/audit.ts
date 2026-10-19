import "server-only";

import { recordAuditEvent, type AuditMetadata } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import type { ToolContext } from "@/lib/assistant/tools/types";

/**
 * Audit every assistant write. Token writes carry `actorApiTokenId` (and the
 * token's creator as actor); `via` says whether it came from chat, MCP, the
 * REST API or a scheduled job. Metadata stays scalar: never bodies.
 */
export function auditToolWrite(
  ctx: ToolContext,
  entry: { action: string; targetType: string; targetId: string; metadata?: AuditMetadata },
  client?: DbClient,
) {
  return recordAuditEvent({
    action: entry.action,
    workspaceId: ctx.principal.workspace.id,
    actorId: ctx.principal.userId,
    actorApiTokenId: ctx.principal.tokenId ?? null,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: { via: ctx.via, ...(entry.metadata ?? {}) },
    ...(client ? { client } : {}),
  });
}
