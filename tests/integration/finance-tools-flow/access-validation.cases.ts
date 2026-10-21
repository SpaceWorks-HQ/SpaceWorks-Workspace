import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { financeAccess } from "@/lib/finance/tools/access";
import { addEntry, saveBudget, saveBill, payBill } from "@/lib/finance/tools/service";
import { financeToolAction } from "@/app/actions/finance-tools";
import {
  session,
  owner,
  admin,
  member,
  guest,
  foreign,
  foreignCategoryId,
  centreId,
  accountId,
  entry,
  bill,
} from "./fixtures";

export function registerAccessValidationTests() {
  it.each(["member", "guest"])(
    "denies %s writes even with forged context roles",
    async (role) => {
      const a = role === "member" ? member : guest;
      await expect(
        addEntry({ ...a, membership: { role: "OWNER" } }, entry()),
      ).rejects.toThrow("access");
    },
  );
  it("rechecks suspension and archive state", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(financeAccess(admin, "MANAGE")).rejects.toThrow("access");
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: foreign.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(financeAccess(foreign)).rejects.toThrow("access");
    await prisma.workspace.update({
      where: { id: foreign.workspace.id },
      data: { archivedAt: null },
    });
  });
  it("enforces finance visibility independently of general membership", async () => {
    await expect(financeAccess(member)).rejects.toThrow("access");
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { financeVisibleToMembers: true },
    });
    expect((await financeAccess(member)).member.role).toBe("MEMBER");
    await expect(financeAccess(guest)).rejects.toThrow("access");
  });
  it("rejects foreign categories, funds, accounts, centres and bills", async () => {
    await expect(
      addEntry(owner, entry({ categoryId: foreignCategoryId })),
    ).rejects.toThrow("category");
    await expect(addEntry(foreign, entry())).rejects.toThrow();
    await expect(
      saveBudget(foreign, {
        name: "Denied",
        amountMinor: 100,
        currency: "INR",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        costCentreId: centreId,
      }),
    ).rejects.toThrow();
    const b = await saveBill(owner, bill());
    await expect(
      payBill(foreign, {
        billId: b,
        paymentKey: randomUUID(),
        amountMinor: 10,
        paidOn: "2026-06-10",
        reference: "NO",
      }),
    ).rejects.toThrow("unavailable");
  });
  it("validates date-only values and money through the action boundary", async () => {
    session.id = owner.user.id;
    const f = new FormData();
    Object.entries({
      kind: "EXPENSE",
      currency: "INR",
      amountMinor: "1.25",
      occurredOn: "2026-06-10",
      description: "Action entry",
      accountId,
    }).forEach(([k, v]) => f.set(k, v));
    const r = await financeToolAction(owner.workspace.slug, "entry", f);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        (
          await prisma.ledgerEntry.findFirstOrThrow({
            where: { id: r.data!.id, workspaceId: owner.workspace.id },
          })
        ).amountMinor,
      ).toBe(125);
    f.set("occurredOn", "2026-02-30");
    expect((await financeToolAction(owner.workspace.slug, "entry", f)).ok).toBe(
      false,
    );
  });
}
