import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { listControls } from "@/lib/moneyControls/queries";
import { reportEntries } from "@/lib/finance/tools/queries";
import {
  actor,
  member,
  guest,
  cash,
  bank,
  category,
  foreignAccount,
  on,
  save,
  transition,
  attach,
} from "./fixtures";

export function registerAccessVouchersTests() {
  it("rechecks membership and rejects role forgery, guests and foreign references", async () => {
    await expect(
      save(
        "TRANSFER",
        {
          accountId: cash,
          otherAccountId: bank,
          amountMinor: 10,
          details: { reference: "x" },
        },
        { ...member, membership: { role: "OWNER" } },
      ),
    ).rejects.toThrow();
    await expect(
      save(
        "COUNT",
        { accountId: cash, details: { denominations: "500=1" } },
        guest,
      ),
    ).rejects.toThrow();
    await expect(
      save("TRANSFER", {
        accountId: cash,
        otherAccountId: foreignAccount,
        amountMinor: 10,
        details: { reference: "x" },
      }),
    ).rejects.toThrow();
    await expect(listControls(guest, { section: "cash" })).rejects.toThrow();
  });
  it("numbers vouchers concurrently and posts proof-backed expenses once", async () => {
    const ids = await Promise.all([
      save("VOUCHER", {
        accountId: cash,
        amountMinor: 10000,
        categoryId: category,
        details: { payee: "Office supplier" },
      }),
      save("VOUCHER", {
        accountId: cash,
        amountMinor: 20000,
        categoryId: category,
        details: { payee: "Office supplier" },
      }),
    ]);
    const rows = await prisma.moneyControlRecord.findMany({
      where: { workspaceId: actor.workspace.id, id: { in: ids } },
    });
    expect(new Set(rows.map((r) => r.number)).size).toBe(2);
    await expect(transition(ids[0])).rejects.toThrow(/proof/);
    await attach(ids[0]);
    const operationKey = randomUUID(),
      input = { operationKey };
    await Promise.all([
      transition(ids[0], "POST", input),
      transition(ids[0], "POST", input),
    ]);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          workspaceId: actor.workspace.id,
          sourceType: "cash_voucher",
          sourceId: ids[0],
        },
      }),
    ).toBe(1);
    await expect(
      transition(ids[0], "POST", { operationKey, reference: "Changed" }),
    ).rejects.toThrow(/different details/);
    const report = await reportEntries(actor, { from: on, to: on });
    expect(
      report.entries.find((e) => e.sourceId === ids[0])?.receipts,
    ).toHaveLength(1);
  });
}
