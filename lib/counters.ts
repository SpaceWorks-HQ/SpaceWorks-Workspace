import "server-only";

import type { DbClient } from "@/lib/db";

/**
 * Next value of a per-workspace sequence ("task", "invoice", …). Atomic via
 * INSERT … ON CONFLICT DO UPDATE, so concurrent creators (even for the first
 * value) never collide. Call inside the transaction that inserts the
 * numbered row (gaps after a rollback are harmless).
 */
export async function nextWorkspaceSequence(client: DbClient, workspaceId: string, name: string): Promise<number> {
  const rows = await client.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "WorkspaceCounter" ("workspaceId", "name", "value")
    VALUES (${workspaceId}, ${name}, 1)
    ON CONFLICT ("workspaceId", "name") DO UPDATE SET "value" = "WorkspaceCounter"."value" + 1
    RETURNING "value"
  `;
  return Number(rows[0]!.value);
}
