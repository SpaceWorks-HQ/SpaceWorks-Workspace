import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { controlRecord } from "@/lib/moneyControls/access";
import { markControlMovement } from "@/lib/moneyControls/service";
import { accountBalance, reconcileAccount } from "@/lib/finance/tools/close";
import { actor, cash, bank, on, date, save, transition, attach } from "./fixtures";

export function registerCashMovementsTests() {
  it("keeps transfers and deposits outside income and expenses, and returns deposits partially", async () => {
    const count = await prisma.ledgerEntry.count({
        where: { workspaceId: actor.workspace.id },
      }),
      before = await accountBalance(prisma, actor.workspace.id, cash, date);
    const transferId = await save("TRANSFER", {
      accountId: bank,
      otherAccountId: cash,
      amountMinor: 30000,
      details: { reference: "Transfer" },
    });
    await attach(transferId);
    await transition(transferId);
    const deposit = await save("DEPOSIT", {
      accountId: cash,
      amountMinor: 10000,
      details: { direction: "GIVEN", counterparty: "Venue" },
    });
    await attach(deposit);
    await transition(deposit);
    const returnKey = randomUUID();
    await Promise.all([
      transition(deposit, "RETURN", {
        amountMinor: 4000,
        operationKey: returnKey,
      }),
      transition(deposit, "RETURN", {
        amountMinor: 4000,
        operationKey: returnKey,
      }),
    ]);
    await expect(
      transition(deposit, "RETURN", { amountMinor: 7000 }),
    ).rejects.toThrow(/outstanding/);
    expect((await controlRecord(actor, deposit)).status).toBe(
      "PARTLY_RETURNED",
    );
    expect(
      (await accountBalance(prisma, actor.workspace.id, cash, date))
        .balanceMinor,
    ).toBe(before.balanceMinor + 24000);
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: actor.workspace.id },
      }),
    ).toBe(count);
  });
  it("requires movement reconciliation and rejects changes to signed account ranges", async () => {
    const isolated = (
      await prisma.financeAccount.create({
        data: {
          workspaceId: actor.workspace.id,
          name: "Reconciliation account",
          currency: "INR",
          openingMinor: 0,
          openingOn: new Date("2026-04-01"),
        },
      })
    ).id;
    const t = await save("TRANSFER", {
      accountId: bank,
      otherAccountId: isolated,
      amountMinor: 100,
      details: { reference: "Reconcile" },
    });
    await attach(t);
    await transition(t);
    await expect(
      reconcileAccount(actor, {
        accountId: isolated,
        upTo: on,
        statementMinor: 100,
        signOff: true,
      }),
    ).rejects.toThrow(/movements reconciled/);
    const movement = await prisma.moneyControlMovement.findFirstOrThrow({
      where: {
        workspaceId: actor.workspace.id,
        recordId: t,
        accountId: isolated,
      },
    });
    await markControlMovement(actor, movement.id);
    await reconcileAccount(actor, {
      accountId: isolated,
      upTo: on,
      statementMinor: 100,
      signOff: true,
    });
    const next = await save("TRANSFER", {
      accountId: bank,
      otherAccountId: isolated,
      amountMinor: 100,
      details: { reference: "Backdated" },
    });
    await attach(next);
    await expect(transition(next)).rejects.toThrow(/reconciled/);
    expect(
      await prisma.moneyControlMovement.count({
        where: { workspaceId: actor.workspace.id, recordId: next },
      }),
    ).toBe(0);
  });
}
