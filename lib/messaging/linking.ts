import "server-only";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import type { MessagingConnection } from "@prisma/client";
export function newLinkCode() { const code = randomToken(18); return { code, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + 600000) }; }
export async function redeemLinkCode(connection: MessagingConnection, code: string, externalUserId: string, dmChannelId: string | null) {
  if (!code || code.length > 100 || !externalUserId || externalUserId.length > 128) return false;
  return redeemLinkHash(connection, sha256Hex(code), externalUserId, dmChannelId);
}
export async function redeemLinkHash(connection: MessagingConnection, codeHash: string, externalUserId: string, dmChannelId: string | null) {
  return prisma.$transaction(async tx => {
    const link = await tx.linkCode.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, provider: connection.provider, codeHash, purpose: "IDENTITY", usedAt: null, expiresAt: { gt: new Date() } } });
    if (!link) return false;
    const member = await tx.membership.findFirst({ where: { workspaceId: connection.workspaceId, userId: link.userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] }, user: { disabledAt: null } } });
    if (!member) return false;
    const existing = await tx.externalIdentityLink.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, OR: [{ externalUserId }, { userId: link.userId }] } });
    if (existing && (existing.userId !== link.userId || existing.externalUserId !== externalUserId)) return false;
    const claim = await tx.linkCode.updateMany({ where: { id: link.id, workspaceId: connection.workspaceId, usedAt: null }, data: { usedAt: new Date() } });
    if (!claim.count) return false;
    await tx.externalIdentityLink.upsert({ where: { connectionId_externalUserId: { connectionId: connection.id, externalUserId } }, create: { workspaceId: connection.workspaceId, userId: link.userId, provider: connection.provider, connectionId: connection.id, externalUserId, dmChannelId, verifiedAt: new Date(), optInAt: connection.provider === "WHATSAPP" ? new Date() : null }, update: { dmChannelId, verifiedAt: new Date() } });
    return true;
  });
}
