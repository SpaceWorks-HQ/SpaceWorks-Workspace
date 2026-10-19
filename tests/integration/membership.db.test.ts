import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Membership } from "@prisma/client";
import { prisma } from "@/lib/db";
import { changeMemberRole, LAST_OWNER_ERROR, removeMember, setMemberStatus } from "@/lib/membership";
import { nextWorkspaceSequence } from "@/lib/counters";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@mem-${suffix}.test`;
const slug = `mem-${suffix}`;
let workspaceId: string;
let owner: Membership;
let admin: Membership;
let member: Membership;

const reload = (id: string) => prisma.membership.findUniqueOrThrow({ where: { id } });

describe.sequential("membership management", () => {
  beforeAll(async () => {
    const ownerUser = await createUser(`owner${domain}`);
    workspaceId = (await createWorkspace(slug, ownerUser.id)).id;
    owner = await prisma.membership.findUniqueOrThrow({ where: { userId_workspaceId: { userId: ownerUser.id, workspaceId } } });
    admin = await addMember(workspaceId, (await createUser(`admin${domain}`)).id, "ADMIN");
    member = await addMember(workspaceId, (await createUser(`member${domain}`)).id, "MEMBER");
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("blocks demoting, suspending or removing the last owner", async () => {
    await expect(changeMemberRole({ actor: owner, membershipId: owner.id, role: "ADMIN" })).resolves.toEqual({ ok: false, error: LAST_OWNER_ERROR });
    await expect(removeMember({ actor: owner, membershipId: owner.id })).resolves.toEqual({ ok: false, error: LAST_OWNER_ERROR });
    expect((await reload(owner.id)).role).toBe("OWNER");
  });

  it("lets admins manage members but not other admins or owners", async () => {
    await expect(changeMemberRole({ actor: admin, membershipId: member.id, role: "GUEST" })).resolves.toEqual({ ok: true });
    expect((await reload(member.id)).role).toBe("GUEST");
    expect((await changeMemberRole({ actor: admin, membershipId: member.id, role: "ADMIN" })).ok).toBe(false);
    expect((await changeMemberRole({ actor: admin, membershipId: owner.id, role: "MEMBER" })).ok).toBe(false);
    expect((await setMemberStatus({ actor: admin, membershipId: owner.id, status: "SUSPENDED" })).ok).toBe(false);
    await expect(setMemberStatus({ actor: admin, membershipId: member.id, status: "SUSPENDED" })).resolves.toEqual({ ok: true });
    await expect(setMemberStatus({ actor: admin, membershipId: member.id, status: "ACTIVE" })).resolves.toEqual({ ok: true });
  });

  it("allows an owner to step down once another owner exists", async () => {
    await expect(changeMemberRole({ actor: owner, membershipId: admin.id, role: "OWNER" })).resolves.toEqual({ ok: true });
    admin = await reload(admin.id);
    await expect(changeMemberRole({ actor: owner, membershipId: owner.id, role: "ADMIN" })).resolves.toEqual({ ok: true });
    owner = await reload(owner.id);
    expect(owner.role).toBe("ADMIN");
  });

  it("keeps one owner when two owners demote each other concurrently", async () => {
    await changeMemberRole({ actor: admin, membershipId: owner.id, role: "OWNER" });
    owner = await reload(owner.id);
    const results = await Promise.all([
      changeMemberRole({ actor: owner, membershipId: admin.id, role: "MEMBER" }),
      changeMemberRole({ actor: admin, membershipId: owner.id, role: "MEMBER" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await expect(prisma.membership.count({ where: { workspaceId, role: "OWNER", status: "ACTIVE" } })).resolves.toBe(1);
  });

  it("does not let a suspended owner count as the remaining owner", async () => {
    const owners = await prisma.membership.findMany({ where: { workspaceId, role: "OWNER" } });
    const remaining = owners[0]!;
    const other = remaining.id === owner.id ? admin : owner;
    // Promote a second owner, suspend them, then try to demote the active one.
    await changeMemberRole({ actor: remaining, membershipId: other.id, role: "OWNER" });
    await setMemberStatus({ actor: remaining, membershipId: other.id, status: "SUSPENDED" });
    await expect(changeMemberRole({ actor: remaining, membershipId: remaining.id, role: "MEMBER" })).resolves.toEqual({ ok: false, error: LAST_OWNER_ERROR });
  });

  it("removes a member and their channel seats", async () => {
    await expect(prisma.channelMember.count({ where: { userId: member.userId } })).resolves.toBe(0);
    await prisma.channelMember.create({ data: { userId: member.userId, channelId: (await prisma.channel.findFirstOrThrow({ where: { workspaceId } })).id } });
    const actor = (await prisma.membership.findFirstOrThrow({ where: { workspaceId, role: "OWNER", status: "ACTIVE" } }));
    await expect(removeMember({ actor, membershipId: member.id })).resolves.toEqual({ ok: true });
    await expect(prisma.channelMember.count({ where: { userId: member.userId } })).resolves.toBe(0);
  });

  it("hands out unique per-workspace sequence numbers under concurrency", async () => {
    const values = await Promise.all(Array.from({ length: 20 }, () => nextWorkspaceSequence(prisma, workspaceId, "task")));
    expect(new Set(values).size).toBe(20);
    expect(Math.max(...values)).toBe(20);
  });
});
