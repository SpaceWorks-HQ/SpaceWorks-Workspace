import "server-only";

import { prisma } from "@/lib/db";

/**
 * The signed-in member's own data, allow-listed field by field. Never
 * includes password hashes, MFA seeds, recovery codes, tokens or other
 * members' private data.
 */
export async function buildAccountExport(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, emailVerified: true, image: true, bio: true, pronouns: true, skills: true, timezone: true,
      mfaEnabledAt: true, createdAt: true, lastSeenAt: true,
      memberships: { select: { role: true, title: true, status: true, joinedAt: true, workspace: { select: { slug: true, name: true } } } },
    },
  });
  if (!user) return null;
  const [tasksCreated, comments, messages, docs, notifications] = await Promise.all([
    prisma.task.findMany({ where: { creatorId: userId }, select: { number: true, title: true, createdAt: true, completedAt: true, workspace: { select: { slug: true } } }, take: 5000 }),
    prisma.taskComment.findMany({ where: { authorId: userId, deletedAt: null }, select: { body: true, createdAt: true, task: { select: { number: true, workspace: { select: { slug: true } } } } }, take: 5000 }),
    prisma.message.findMany({ where: { authorId: userId, deletedAt: null }, select: { body: true, createdAt: true, channel: { select: { slug: true, kind: true } }, workspace: { select: { slug: true } } }, take: 10000 }),
    prisma.doc.findMany({ where: { createdById: userId }, select: { title: true, contentText: true, createdAt: true, workspace: { select: { slug: true } } }, take: 2000 }),
    prisma.notification.findMany({ where: { userId }, select: { kind: true, title: true, createdAt: true, readAt: true }, take: 2000 }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    format: "space-works-account-export/v1",
    profile: { ...user, memberships: undefined },
    memberships: user.memberships,
    tasksCreated,
    taskComments: comments,
    messages: messages.map((m) => ({ ...m, channel: m.channel.kind === "DIRECT" ? { kind: "DIRECT" } : m.channel })),
    docsCreated: docs,
    notifications,
  };
}
