import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { loadGovernance } from "@/lib/governance/service";
import { loadCases } from "@/lib/govextras/cases";
import { owner, handler, other } from "./fixtures";

export function registerAccessRevocationTests() {
  it("denies stale suspended handlers and archived workspaces", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: handler.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(loadCases(handler, {})).rejects.toThrow();
    await prisma.workspace.updateMany({
      where: { id: other.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(loadGovernance(other, "risk", {})).rejects.toThrow();
  });
}
