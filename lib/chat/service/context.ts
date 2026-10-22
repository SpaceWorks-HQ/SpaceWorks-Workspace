import "server-only";

import { channelAudience, type ChatContext } from "@/lib/chat/access";
import { prisma } from "@/lib/db";
import { publish, publishToUser } from "@/lib/realtime";
import { hasRoleAtLeast } from "@/lib/roles";
import { Prisma, type ChannelKind } from "@prisma/client";

export const NOT_FOUND = "That conversation isn't available. It may have been archived or you may have left it.";
export const MESSAGE_GONE = "That message isn't available any more.";

// ───────────── Realtime helpers ─────────────

export async function publishChannel(ctx: ChatContext, channel: { id: string; kind: ChannelKind; teamId: string | null }, type: string, data: Record<string, string | number | boolean | null>) {
  const audience = await channelAudience(channel);
  await publish(ctx.workspace.id, `channel:${channel.id}`, { type, data: { channelId: channel.id, ...data }, actorId: ctx.user.id, ...(audience ? { audience } : {}) });
}

export async function nudgeUsers(ctx: ChatContext, userIds: string[], type: string, data: Record<string, string | number | boolean | null>) {
  await Promise.all([...new Set(userIds)].map((userId) => publishToUser(ctx.workspace.id, userId, { type, data, actorId: ctx.user.id })));
}

export function uniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Active members of this workspace among `ids` (optionally at least `minRole`). */
export async function activeMembers(ctx: ChatContext, ids: string[], minRole: "GUEST" | "MEMBER" = "GUEST") {
  if (ids.length === 0) return [];
  const rows = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspace.id, userId: { in: [...new Set(ids)].slice(0, 200) }, status: "ACTIVE", user: { disabledAt: null } },
    select: { userId: true, role: true },
  });
  return rows.filter((row) => hasRoleAtLeast(row.role, minRole));
}
