import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isSetupOpen, performSetup } from "@/lib/setup";
import { uniqueSuffix } from "../helpers/fixtures";

/**
 * First-run setup only works on an instance with zero users, so this suite
 * empties the disposable test database first.
 */
const suffix = uniqueSuffix();

describe.sequential("first-run setup", () => {
  beforeAll(async () => {
    await prisma.workspace.deleteMany({});
    await prisma.user.deleteMany({});
  });

  afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug: { startsWith: `setup-${suffix}` } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@setup-${suffix}.test` } } });
    await prisma.$disconnect();
  });

  it("is open on an empty instance", async () => {
    await expect(isSetupOpen()).resolves.toBe(true);
  });

  it("succeeds exactly once under concurrent submissions", async () => {
    const attempts = await Promise.all(
      [1, 2, 3].map((n) =>
        performSetup({
          name: `Owner ${n}`,
          email: `owner${n}@setup-${suffix}.test`,
          password: "correct horse battery",
          workspaceName: `Setup ${n}`,
          workspaceSlug: `setup-${suffix}-${n}`,
        }),
      ),
    );
    expect(attempts.filter((result) => result.ok)).toHaveLength(1);
    expect(attempts.filter((result) => !result.ok)).toHaveLength(2);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(isSetupOpen()).resolves.toBe(false);
  });

  it("creates the owner, default channels, labels and starter categories", async () => {
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { slug: { startsWith: `setup-${suffix}` } }, include: { memberships: true, channels: { include: { members: true } } } });
    expect(workspace.memberships).toHaveLength(1);
    expect(workspace.memberships[0]!.role).toBe("OWNER");
    expect(workspace.channels.map((c) => c.slug).sort()).toEqual(["announcements", "general", "random"]);
    expect(workspace.channels.every((c) => c.isDefault && c.members.length === 1)).toBe(true);
    await expect(prisma.label.count({ where: { workspaceId: workspace.id } })).resolves.toBeGreaterThan(0);
    await expect(prisma.financeCategory.count({ where: { workspaceId: workspace.id } })).resolves.toBeGreaterThan(0);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: workspace.memberships[0]!.userId } });
    expect(owner.emailVerified).not.toBeNull();
    expect(owner.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("refuses a second setup", async () => {
    const result = await performSetup({ name: "Late", email: `late@setup-${suffix}.test`, password: "correct horse battery", workspaceName: "Late", workspaceSlug: `setup-${suffix}-late` });
    expect(result.ok).toBe(false);
  });
});
