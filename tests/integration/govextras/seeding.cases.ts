import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { owner } from "./fixtures";

export function registerSeedingTests() {
  it("seeds every manual tool repeatably without inventing evidence", async () => {
    // The demo loader discovers this standard module automatically.
    const modulePath = "../../../scripts/seed/govextras.mjs";
    const seed = (await import(modulePath)).default;
    const context = {
      workspaceId: owner.workspace.id,
      workspace: owner.workspace,
      users: { owner: owner.user },
      channels: {},
    };
    await seed(prisma, context);
    const count = await prisma.governanceRecord.count({
      where: { workspaceId: owner.workspace.id },
    });
    await seed(prisma, context);
    expect(
      await prisma.governanceRecord.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(count);
  });
}
