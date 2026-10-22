import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listControls } from "@/lib/moneyControls/queries";
import { other, save, transition, attach } from "./fixtures";

export function registerRevocationRetentionTests() {
  it("fails closed for archived workspaces and cascades control descendants", async () => {
    await prisma.workspace.update({
      where: { id: other.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(listControls(other, { section: "cash" })).rejects.toThrow();
    await prisma.workspace.update({
      where: { id: other.workspace.id },
      data: { archivedAt: null },
    });
    const id = await save(
      "FILING",
      { details: { fiscalYear: 2026, quarter: "Q1", form: "Return" } },
      other,
    );
    await attach(id, other);
    await transition(id, "POST", {}, other);
    await prisma.workspace.delete({ where: { id: other.workspace.id } });
    expect(
      await prisma.moneyControlRecord.count({
        where: { workspaceId: other.workspace.id },
      }),
    ).toBe(0);
    expect(
      await prisma.moneyControlEvent.count({
        where: { workspaceId: other.workspace.id },
      }),
    ).toBe(0);
  });
}
