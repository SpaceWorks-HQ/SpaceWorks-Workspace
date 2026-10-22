import "server-only";

import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Remove expired operational records. Never deletes business or audit data. */
export async function purgeExpiredOperationalData(now = new Date()) {
  const retentionDays = Math.min(Math.max(Number(process.env.OUTBOX_RETENTION_DAYS || 30), 1), 365);
  const before = new Date(now.getTime() - retentionDays * DAY_MS);
  const [tokens, sessions, resets, verifications, oauthStates, sent, failed] = await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
    prisma.session.deleteMany({ where: { expires: { lt: now } } }),
    prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE status='SENT' AND "sentAt" < ${before} AND kind <> 'notify.deliver' AND payload->>'workspaceId' IS NULL AND NOT EXISTS (SELECT 1 FROM "Workspace" WHERE "legalHold")`,
    prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE status='FAILED' AND "createdAt" < ${before} AND kind <> 'notify.deliver' AND payload->>'workspaceId' IS NULL AND NOT EXISTS (SELECT 1 FROM "Workspace" WHERE "legalHold")`,
  ]);
  return {
    verificationTokens: tokens.count,
    sessions: sessions.count,
    passwordResetTokens: resets.count,
    emailVerificationTokens: verifications.count,
    oauthStates: oauthStates.count,
    sentOutboxMessages: sent,
    failedOutboxMessages: failed,
  };
}
