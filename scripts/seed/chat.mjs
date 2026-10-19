// Demo chat data for the seeded "TinkerSpace Kochi" workspace: a thread,
// reactions, a pin, a mention, a private channel and a direct message.
//
// Idempotent through seed-demo.mjs, which deletes and recreates the demo
// workspace on every run. seed-demo.mjs loads every module in scripts/seed/.
//
// `users` maps the PEOPLE keys (owner, admin, meera, joel, fathima, guest) to
// User rows and `channels` maps channel slugs to Channel rows, as seed-demo builds them.
import { createHash } from "node:crypto";

function at(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60_000);
}

export async function seedChat(prisma, { workspaceId, users, channels }) {
  const general = channels.general;
  const hardware = channels.hardware;

  const root = await prisma.message.create({
    data: { workspaceId, channelId: general.id, authorId: users.joel.id, body: "Who has the hot air station this week?", createdAt: at(90), replyCount: 2, lastReplyAt: at(60) },
  });
  await prisma.message.createMany({
    data: [
      { workspaceId, channelId: general.id, parentId: root.id, authorId: users.meera.id, body: "It's on the hardware bench. Bring your own tips.", createdAt: at(75) },
      { workspaceId, channelId: general.id, parentId: root.id, authorId: users.admin.id, body: "I'll restock flux tonight.", createdAt: at(60) },
    ],
  });
  const pinned = await prisma.message.create({
    data: {
      workspaceId,
      channelId: general.id,
      authorId: users.owner.id,
      body: `**Build night** every Saturday from 6 PM. Sign up for a bench in <#${hardware.id}>.`,
      createdAt: at(45),
      pinnedAt: at(44),
      pinnedById: users.owner.id,
    },
  });
  await prisma.messageReaction.createMany({
    data: [
      { messageId: pinned.id, userId: users.meera.id, emoji: "🎉" },
      { messageId: pinned.id, userId: users.joel.id, emoji: "🎉" },
      { messageId: pinned.id, userId: users.fathima.id, emoji: "👍" },
    ],
    skipDuplicates: true,
  });
  await prisma.channel.update({ where: { id: general.id }, data: { lastMessageAt: at(45) } });
  await prisma.message.create({
    data: { workspaceId, channelId: hardware.id, authorId: users.meera.id, body: `<@${users.joel.id}> the sensor bar needs a second pair of eyes before we order.`, createdAt: at(30) },
  });
  await prisma.channel.update({ where: { id: hardware.id }, data: { lastMessageAt: at(30) } });

  await prisma.channel.create({
    data: {
      workspaceId,
      name: "robot-arm",
      slug: "robot-arm",
      kind: "PRIVATE",
      topic: "The six-axis arm for the maker fair.",
      createdById: users.meera.id,
      lastMessageAt: at(20),
      members: { create: [{ userId: users.meera.id }, { userId: users.joel.id }, { userId: users.fathima.id }] },
      messages: { create: [{ workspaceId, authorId: users.fathima.id, body: "Servo order is in the kitty request queue.", createdAt: at(20) }] },
    },
  });

  const participants = [users.meera.id, users.owner.id].sort();
  const dmKey = `${workspaceId}:${participants.join(":")}`;
  await prisma.channel.create({
    data: {
      workspaceId,
      kind: "DIRECT",
      name: "Direct message",
      slug: `dm-${createHash("sha256").update(dmKey).digest("hex").slice(0, 24)}`,
      dmKey,
      createdById: users.meera.id,
      lastMessageAt: at(10),
      members: { create: participants.map((userId) => ({ userId })) },
      messages: { create: [{ workspaceId, authorId: users.meera.id, body: "Can I borrow the bench power supply on Sunday?", createdAt: at(10) }] },
    },
  });
}
