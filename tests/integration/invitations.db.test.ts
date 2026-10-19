import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { acceptInvitation, createInvitation, findPendingInvitation, revokeInvitation } from "@/lib/invitations";
import { createInvitationToken, invitationExpiry } from "@/lib/invitationTokens";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@inv-${suffix}.test`;
const slug = `inv-${suffix}`;
let workspaceId: string;
let ownerId: string;

async function seedInvitation(email: string, overrides: { expiresAt?: Date; revokedAt?: Date } = {}) {
  const { token, tokenHash } = createInvitationToken();
  await prisma.invitation.create({
    data: { workspaceId, email, role: "MEMBER", tokenHash, expiresAt: overrides.expiresAt ?? invitationExpiry(), revokedAt: overrides.revokedAt, invitedById: ownerId },
  });
  return token;
}

describe.sequential("invitation acceptance", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner");
    ownerId = owner.id;
    workspaceId = (await createWorkspace(slug, owner.id)).id;
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("queues the email and stores only a token hash", async () => {
    const result = await createInvitation({ workspace: { id: workspaceId, name: "Kochi" }, email: `queued${domain}`, role: "GUEST", invitedBy: { id: ownerId, name: "Owner" } });
    expect(result.ok).toBe(true);
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { workspaceId, email: `queued${domain}` } });
    expect(invitation.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const outbox = await prisma.outboxMessage.findFirst({ where: { kind: "workspace-invite", payload: { path: ["to"], equals: `queued${domain}` } } });
    expect(outbox).not.toBeNull();
    await prisma.outboxMessage.deleteMany({ where: { id: outbox!.id } });
  });

  it("refuses to invite an existing member", async () => {
    const result = await createInvitation({ workspace: { id: workspaceId, name: "Kochi" }, email: `owner${domain}`, role: "MEMBER", invitedBy: { id: ownerId, name: "Owner" } });
    expect(result.ok).toBe(false);
  });

  it("creates a verified account, membership and default channel seats for a new person", async () => {
    const email = `newbie${domain}`;
    const token = await seedInvitation(email);
    await expect(findPendingInvitation(token)).resolves.toMatchObject({ email, existingAccount: false });
    const result = await acceptInvitation(token, { kind: "new", name: "New Maker", password: "a long enough password" });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).not.toBeNull();
    expect(await bcrypt.compare("a long enough password", user.passwordHash!)).toBe(true);
    await expect(prisma.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } } })).resolves.toMatchObject({ role: "MEMBER", status: "ACTIVE" });
    await expect(prisma.channelMember.count({ where: { userId: user.id, channel: { workspaceId } } })).resolves.toBe(3);
    await expect(findPendingInvitation(token)).resolves.toBeNull();
  });

  it("accepts for an existing account only when the email matches", async () => {
    const invited = await createUser(`existing${domain}`);
    const other = await createUser(`other${domain}`);
    const token = await seedInvitation(invited.email);
    const wrong = await acceptInvitation(token, { kind: "existing", userId: other.id });
    expect(wrong.ok).toBe(false);
    const right = await acceptInvitation(token, { kind: "existing", userId: invited.id });
    expect(right.ok).toBe(true);
    await expect(prisma.membership.count({ where: { workspaceId, userId: other.id } })).resolves.toBe(0);
  });

  it("grants one membership when the same link is used concurrently", async () => {
    const user = await createUser(`race${domain}`);
    const token = await seedInvitation(user.email);
    const results = await Promise.all([1, 2, 3].map(() => acceptInvitation(token, { kind: "existing", userId: user.id })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await expect(prisma.membership.count({ where: { workspaceId, userId: user.id } })).resolves.toBe(1);
  });

  it("rejects expired, revoked and unknown tokens", async () => {
    const expired = await seedInvitation(`expired${domain}`, { expiresAt: new Date(Date.now() - 1000) });
    expect((await acceptInvitation(expired, { kind: "new", name: "Late", password: "a long enough password" })).ok).toBe(false);
    const revokedToken = await seedInvitation(`revoked${domain}`);
    const row = await prisma.invitation.findFirstOrThrow({ where: { email: `revoked${domain}` } });
    expect((await revokeInvitation({ workspaceId, invitationId: row.id, actorId: ownerId })).ok).toBe(true);
    expect((await acceptInvitation(revokedToken, { kind: "new", name: "Revoked", password: "a long enough password" })).ok).toBe(false);
    expect((await acceptInvitation(createInvitationToken().token, { kind: "new", name: "Nobody", password: "a long enough password" })).ok).toBe(false);
    await expect(prisma.user.count({ where: { email: { in: [`expired${domain}`, `revoked${domain}`] } } })).resolves.toBe(0);
  });

  it("cannot revoke another workspace's invitation", async () => {
    const otherOwner = await createUser(`otherowner${domain}`);
    const otherSlug = `${slug}-b`;
    const other = await createWorkspace(otherSlug, otherOwner.id);
    await seedInvitation(`cross${domain}`);
    const row = await prisma.invitation.findFirstOrThrow({ where: { email: `cross${domain}` } });
    expect((await revokeInvitation({ workspaceId: other.id, invitationId: row.id, actorId: otherOwner.id })).ok).toBe(false);
    await prisma.workspace.delete({ where: { id: other.id } });
  });
});
