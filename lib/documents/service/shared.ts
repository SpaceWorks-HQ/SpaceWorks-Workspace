import "server-only";
import { recordAuditEvent } from "@/lib/audit";
import { prisma, type DbClient } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { type DocumentsActor } from "../access";
export const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const object = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const date = (s: string) => new Date(`${s}T00:00:00Z`);
export async function audit(
  actor: DocumentsActor,
  action: string,
  id: string,
  tx: DbClient = prisma,
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `documents.${action}`,
    targetType: "business_document",
    targetId: id,
    client: tx,
  });
}
