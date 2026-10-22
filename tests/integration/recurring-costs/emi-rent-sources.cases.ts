import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  saveSchedule,
  confirmActual,
  scheduleFromSource,
} from "@/lib/finance/recurring/service";
import { payBill } from "@/lib/finance/tools/service";
import {
  owner,
  categoryId,
  accountId,
  schedule,
  generate,
  records,
} from "./fixtures";

export function registerEmiRentSourceTests() {
  it("splits EMI principal into cash movements and interest into expenses", async () => {
    const id = await saveSchedule(
      owner,
      schedule({
        title: "Equipment EMI",
        kind: "EMI",
        amountMinor: 100000,
        principalMinor: 30000000,
        tenure: 36,
        annualRatePercent: 9,
      }),
    );
    await generate(id);
    records.emiBill = (
      await prisma.recurringCostDue.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, scheduleId: id },
      })
    ).billId;
    const p = {
      billId: records.emiBill,
      paymentKey: randomUUID(),
      amountMinor: 100000,
      paidOn: "2026-10-21",
      reference: "EMI 1",
      post: true,
    };
    await expect(payBill(owner, p)).rejects.toThrow(/split/);
    await confirmActual(owner, {
      billId: records.emiBill,
      amountMinor: 100000,
      principalMinor: 75000,
      interestMinor: 25000,
    });
    const pid = await payBill(owner, p);
    expect(
      await prisma.ledgerEntry.findFirst({
        where: { workspaceId: owner.workspace.id, sourceId: pid },
      }),
    ).toMatchObject({ amountMinor: 25000 });
    expect(
      await prisma.moneyControlMovement.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          operationKey: `emi-payment:${pid}`,
        },
      }),
    ).toMatchObject({ amountMinor: -75000 });
  });
  it("creates rent schedules in one source step and preserves TDS in the existing register", async () => {
    const contact = await prisma.contact.create({
      data: {
        workspaceId: owner.workspace.id,
        displayName: "Landlord",
        kinds: ["facilities"],
        createdById: owner.user.id,
      },
    });
    const lease = await prisma.facilityLease.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Office",
        landlordContactId: contact.id,
        ownerId: owner.user.id,
        rentMinor: 4500000,
        startsOn: new Date("2026-01-01"),
        renewalOn: new Date("2027-01-01"),
        notes: "",
        requestKey: randomUUID(),
      },
    });
    const id = await scheduleFromSource(owner, "LEASE", lease.id);
    expect(await scheduleFromSource(owner, "LEASE", lease.id)).toBe(id);
    const s = await prisma.recurringCostSchedule.findFirstOrThrow({
      where: { id },
    });
    await saveSchedule(owner, {
      ...s,
      startsOn: "2026-10-01",
      endsOn: null,
      renewalOn: "2027-01-01",
      tdsPercent: 10,
      accountId,
      categoryId,
    });
    await generate(id, "2026-11-01");
    const d = await prisma.recurringCostDue.findFirstOrThrow({
      where: { scheduleId: id },
      include: { bill: true },
    });
    await payBill(owner, {
      billId: d.billId,
      paymentKey: randomUUID(),
      amountMinor: d.bill.amountMinor,
      paidOn: "2026-11-01",
      reference: "Rent",
      post: true,
    });
    expect(
      await prisma.moneyControlRecord.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          kind: "TDS_DEDUCTION",
          recordKey: `recurring-tds:${d.billId}`,
        },
      }),
    ).toMatchObject({
      amountMinor: 450000,
      details: expect.objectContaining({ section: "194-I", fiscalYear: 2026 }),
    });
  });
}
