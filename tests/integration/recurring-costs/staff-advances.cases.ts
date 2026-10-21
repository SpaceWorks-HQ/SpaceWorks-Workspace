import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  saveAdvance,
  requestAdvanceApproval,
  payAdvance,
  recoverAdvance,
  readAdvance,
} from "@/lib/finance/recurring/advances";
import { advancesView } from "@/lib/finance/recurring/queries";
import { uploadFinanceFiles } from "@/lib/finance/tools/files";
import { findDownloadableFile } from "@/lib/files";
import { accountBalance } from "@/lib/finance/tools/close";
import { decide } from "@/lib/approvals/engine";
import {
  owner,
  manager,
  person,
  outsider,
  accountId,
  profileId,
  pdf,
  records,
} from "./fixtures";

export function registerStaffAdvanceTests() {
  it("supports a private staff advance with independent approval and cash-only payout", async () => {
    records.advanceId = await saveAdvance(owner, {
      requestKey: randomUUID(),
      profileId,
      reason: "Urgent travel",
      amountMinor: 2000000,
      instalments: 4,
      startsOn: "2026-10-01",
      accountId,
    });
    await expect(
      requestAdvanceApproval(owner, records.advanceId, owner.user.id),
    ).rejects.toThrow(/another/);
    await requestAdvanceApproval(owner, records.advanceId, manager.user.id);
    const row = await prisma.staffAdvance.findFirstOrThrow({
      where: { id: records.advanceId },
    });
    await decide(manager, {
      requestId: row.approvalId!,
      decision: "APPROVED",
      comment: "Reviewed",
    });
    await expect(
      payAdvance(owner, records.advanceId, "2026-10-01", "Advance payout"),
    ).rejects.toThrow(/proof/);
    await uploadFinanceFiles(owner, "ADVANCE", records.advanceId, [pdf()]);
    const before = await accountBalance(
      prisma,
      owner.workspace.id,
      accountId,
      new Date("2026-12-31"),
    );
    await payAdvance(owner, records.advanceId, "2026-10-01", "Advance payout");
    const after = await accountBalance(
      prisma,
      owner.workspace.id,
      accountId,
      new Date("2026-12-31"),
    );
    expect(before.balanceMinor - after.balanceMinor).toBe(2000000);
    expect(await readAdvance(person, records.advanceId)).toMatchObject({
      amountMinor: 2000000,
    });
    await expect(readAdvance(outsider, records.advanceId)).rejects.toThrow(
      /unavailable/,
    );
    expect((await advancesView(person)).rows).toHaveLength(1);
  });
  it("a payroll view grant does not reveal another person's advance", async () => {
    await prisma.financePayrollGrant.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { manage: false },
    });
    await expect(readAdvance(manager, records.advanceId)).rejects.toThrow(
      /unavailable/,
    );
    const proof = await prisma.financeAttachment.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        recordType: "ADVANCE",
        recordId: records.advanceId,
      },
    });
    expect(
      await findDownloadableFile(proof.fileId, manager.user.id),
    ).toBeNull();
    expect(
      await findDownloadableFile(proof.fileId, person.user.id),
    ).not.toBeNull();
    expect(
      await findDownloadableFile(proof.fileId, outsider.user.id),
    ).toBeNull();
    expect((await advancesView(manager)).rows).toHaveLength(0);
    await prisma.financePayrollGrant.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { manage: true },
    });
  });
  it("recovers against a paid run once without posting another cash movement", async () => {
    const recovery = await prisma.staffAdvanceRecovery.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, advanceId: records.advanceId },
      orderBy: { instalment: "asc" },
    });
    const data = {
      id: recovery.id,
      amountMinor: 500000,
      paidOn: "2026-10-01",
      reference: "Salary deduction",
      operationKey: randomUUID(),
      payRunId: records.runId,
    };
    const before = await prisma.moneyControlMovement.count({
      where: { workspaceId: owner.workspace.id },
    });
    await recoverAdvance(owner, data);
    await recoverAdvance(owner, data);
    expect(
      await prisma.moneyControlMovement.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(before);
    await expect(
      recoverAdvance(owner, {
        ...data,
        operationKey: randomUUID(),
        amountMinor: 1,
      }),
    ).rejects.toThrow(/balance/);
  });
  it("recovers manually with bounded, idempotent cash movements", async () => {
    const recovery = await prisma.staffAdvanceRecovery.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, advanceId: records.advanceId, instalment: 2 },
    });
    const data = {
      id: recovery.id,
      amountMinor: 500000,
      paidOn: "2026-10-21",
      reference: "Cash return",
      operationKey: randomUUID(),
    };
    await Promise.all([
      recoverAdvance(manager, data),
      recoverAdvance(manager, data),
    ]);
    expect(
      await prisma.moneyControlMovement.count({
        where: {
          workspaceId: owner.workspace.id,
          operationKey: data.operationKey,
        },
      }),
    ).toBe(1);
  });
}
