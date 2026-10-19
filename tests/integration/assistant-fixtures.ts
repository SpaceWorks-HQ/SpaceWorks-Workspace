import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createDefaultBoardColumns } from "@/lib/workspaces";
import { generateTokenSecret } from "@/lib/apiTokens";
import type { ApiScope } from "@/lib/apiTokens/scopes";
import { effectiveJobRole, type Principal, type PrincipalKind } from "@/lib/assistant/principal";
import { addMember, createUser, createWorkspace } from "../helpers/fixtures";

/**
 * A small community for assistant integration tests: workspace A with an
 * owner, admin, member and guest, a public project (BOT) and a project owned
 * by a private team the member is not in (SEC), a private channel, a DM, a
 * public and an admin-only doc; workspace B with its own owner, task and doc.
 */
export async function buildWorld(suffix: string) {
  const domain = `@assist-${suffix}.test`;
  const slugA = `assist-a-${suffix}`;
  const slugB = `assist-b-${suffix}`;
  const owner = await createUser(`owner${domain}`, "Anjali");
  const admin = await createUser(`admin${domain}`, "Rahul");
  const member = await createUser(`member${domain}`, "Meera");
  const guest = await createUser(`guest${domain}`, "Vivek");
  const ownerB = await createUser(`ownerb${domain}`, "Other owner");
  const a = await createWorkspace(slugA, owner.id);
  const b = await createWorkspace(slugB, ownerB.id);
  await addMember(a.id, admin.id, "ADMIN");
  await addMember(a.id, member.id, "MEMBER");
  await addMember(a.id, guest.id, "GUEST");

  const general = await prisma.channel.findFirstOrThrow({ where: { workspaceId: a.id, slug: "general" } });
  const random = await prisma.channel.findFirstOrThrow({ where: { workspaceId: a.id, slug: "random" } });
  await prisma.channelMember.createMany({ data: [{ channelId: general.id, userId: member.id }, { channelId: random.id, userId: guest.id }] });
  const privateChannel = await prisma.channel.create({
    data: { workspaceId: a.id, name: "core", slug: "core", kind: "PRIVATE", members: { create: [{ userId: member.id }, { userId: owner.id }] } },
  });
  const dm = await prisma.channel.create({
    data: { workspaceId: a.id, name: "dm", slug: `dm-${suffix}`, kind: "DIRECT", dmKey: `${a.id}:${member.id}:${owner.id}`, members: { create: [{ userId: member.id }, { userId: owner.id }] } },
  });
  await prisma.message.createMany({
    data: [
      { workspaceId: a.id, channelId: general.id, authorId: owner.id, body: "Build night on Thursday" },
      { workspaceId: a.id, channelId: privateChannel.id, authorId: owner.id, body: "Core team only" },
      { workspaceId: a.id, channelId: dm.id, authorId: owner.id, body: "Private DM" },
    ],
  });

  const team = await prisma.team.create({ data: { workspaceId: a.id, name: "Secret", slug: "secret", visibility: "PRIVATE", members: { create: { userId: admin.id, role: "LEAD" } } } });
  const bot = await prisma.project.create({ data: { workspaceId: a.id, key: "BOT", name: "Robot arm", ownerId: owner.id } });
  const sec = await prisma.project.create({ data: { workspaceId: a.id, key: "SEC", name: "Secret build", teamId: team.id } });
  await prisma.$transaction(async (tx) => {
    await createDefaultBoardColumns(tx, bot.id);
    await createDefaultBoardColumns(tx, sec.id);
  });
  const todo = await prisma.boardColumn.findFirstOrThrow({ where: { projectId: bot.id, category: "TODO" } });
  const botTask = await prisma.task.create({ data: { workspaceId: a.id, projectId: bot.id, columnId: todo.id, number: 1, title: "Calibrate servo", creatorId: owner.id } });
  const secTask = await prisma.task.create({ data: { workspaceId: a.id, projectId: sec.id, number: 2, title: "Hidden task", creatorId: admin.id } });
  await prisma.workspaceCounter.create({ data: { workspaceId: a.id, name: "task", value: 2 } });
  const bTask = await prisma.task.create({ data: { workspaceId: b.id, number: 1, title: "Other tenant task", creatorId: ownerB.id } });
  await prisma.workspaceCounter.create({ data: { workspaceId: b.id, name: "task", value: 1 } });

  const publicDoc = await prisma.doc.create({ data: { workspaceId: a.id, title: "House rules", contentText: "Clean the laser bed after use.", createdById: owner.id } });
  const adminDoc = await prisma.doc.create({ data: { workspaceId: a.id, title: "Lease terms", contentText: "Rent details", visibility: "ADMINS", createdById: owner.id } });
  const bDoc = await prisma.doc.create({ data: { workspaceId: b.id, title: "Other tenant doc", contentText: "Not yours" } });

  const workspaceOf = (w: typeof a) => ({ id: w.id, slug: w.slug, name: w.name, timezone: w.timezone, currency: w.currency, financeVisibleToMembers: w.financeVisibleToMembers });
  const principal = (userId: string, role: WorkspaceRole, kind: PrincipalKind = "user", extra: Partial<Principal> = {}): Principal => ({
    kind,
    workspace: workspaceOf(a),
    userId,
    userName: "Test",
    role: kind === "job" ? effectiveJobRole(role) : role,
    ...extra,
  });

  async function makeToken(scopes: ApiScope[], createdById = admin.id, workspaceId = a.id) {
    const secret = generateTokenSecret();
    const row = await prisma.apiToken.create({ data: { workspaceId, name: "Test token", prefix: secret.prefix, secretHash: secret.secretHash, scopes, createdById } });
    return { id: row.id, token: secret.token };
  }

  return {
    domain,
    slugs: [slugA, slugB],
    a,
    b,
    users: { owner, admin, member, guest, ownerB },
    channels: { general, random, privateChannel, dm },
    projects: { bot, sec },
    tasks: { botTask, secTask, bTask },
    docs: { publicDoc, adminDoc, bDoc },
    principal,
    makeToken,
  };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;
