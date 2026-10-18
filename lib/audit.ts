import "server-only";

import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { prisma, type DbClient } from "@/lib/db";
import { getClientIpFromHeaders } from "@/lib/rateLimit";

export type AuditMetadata = Record<string, string | number | boolean | null>;

export type AuditEventInput = {
  /** Dotted verb, e.g. "member.role_changed", "invite.created", "task.deleted". */
  action: string;
  workspaceId?: string | null;
  actorId?: string | null;
  actorApiTokenId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Small scalar facts only. Never secrets, tokens, emails of third parties or message bodies. */
  metadata?: AuditMetadata;
  /** Pass a transaction client to commit the audit row with the change. */
  client?: DbClient;
  /** Override the request IP (defaults to the trusted proxy header when called in a request). */
  ip?: string | null;
};

async function requestIp(): Promise<string | null> {
  try {
    const ip = getClientIpFromHeaders(await headers());
    return ip === "unknown" ? null : ip;
  } catch {
    // Outside a request (worker, script, test).
    return null;
  }
}

/** Write a deliberately minimal, append-only audit record. */
export async function recordAuditEvent(input: AuditEventInput) {
  const client = input.client ?? prisma;
  return client.auditEvent.create({
    data: {
      action: input.action,
      workspaceId: input.workspaceId ?? null,
      actorId: input.actorId ?? null,
      actorApiTokenId: input.actorApiTokenId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: input.ip !== undefined ? input.ip : await requestIp(),
    },
  });
}

export async function listAuditEvents(workspaceId: string, options: { take?: number; cursor?: string } = {}) {
  const take = Math.min(Math.max(options.take ?? 50, 1), 200);
  return prisma.auditEvent.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, name: true, email: true } },
      actorApiToken: { select: { id: true, name: true } },
    },
  });
}
