import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, operate, loadGovernance } from "@/lib/governance/service";
import { run } from "@/lib/scheduled/governance";
import { actor, other, obligation, records } from "./fixtures";

export function registerRemindersRestorationTests() {
  it("reminds for due filings and contract notice dates once across concurrent ticks", async () => {
    const filing = await saveRecord(
      actor,
      obligation({
        ownerId: actor.user.id,
        dueOn: "2027-06-15",
        reminderDays: 7,
      }),
    );
    const contract = await saveRecord(actor, {
      kind: "CONTRACT",
      title: "Printing agreement",
      status: "ACTIVE",
      ownerId: actor.user.id,
      startsOn: "2027-01-01",
      endsOn: "2027-07-15",
      reminderDays: 7,
      details: {
        vendorId: records.vendorId,
        amountMinor: 125000,
        currency: "INR",
        noticeDays: 30,
      },
    });
    await Promise.all([
      run(new Date("2027-06-08T04:00:00Z")),
      run(new Date("2027-06-08T04:00:00Z")),
    ]);
    for (const recordId of [filing.id, contract.id])
      expect(
        await prisma.notificationEventRecord.count({
          where: {
            workspaceId: actor.workspace.id,
            dedupeKey: { startsWith: `governance:${recordId}:` },
          },
        }),
      ).toBe(1);
    await run(new Date("2027-06-16T04:00:00Z"));
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: actor.workspace.id,
          dedupeKey: { startsWith: `governance:${filing.id}:` },
        },
      }),
    ).toBe(2);
  });
  it("restores archived records and their search entries without duplicating them", async () => {
    const record = await saveRecord(
      actor,
      obligation({ title: "Restore this filing" }),
    );
    await operate(actor, { op: "archive", id: record.id });
    expect(
      (await loadGovernance(actor, "compliance", {}, record.id)).selected,
    ).toBeNull();
    expect(
      (await loadGovernance(actor, "compliance", { archived: "1" }, record.id))
        .selected?.id,
    ).toBe(record.id);
    await expect(
      operate(other, { op: "restore", id: record.id }),
    ).rejects.toThrow();
    await operate(actor, { op: "restore", id: record.id });
    expect(
      (await loadGovernance(actor, "compliance", {}, record.id)).selected?.id,
    ).toBe(record.id);
    expect(
      await prisma.searchDocument.count({
        where: { workspaceId: actor.workspace.id, entityId: record.id },
      }),
    ).toBe(1);
  });
}
