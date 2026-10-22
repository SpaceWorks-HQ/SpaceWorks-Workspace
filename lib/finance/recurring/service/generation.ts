import "server-only";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import type { DbClient } from "@/lib/db";
import type { RecurringCostSchedule } from "@prisma/client";
import { validateTags } from "@/lib/finance/tools/access";
import { recordAuditEvent } from "@/lib/audit";
import { nextDue, taxAmounts } from "../rules";

export async function generateSchedule(
  tx: DbClient,
  s: RecurringCostSchedule,
  today: Date,
) {
  const workspaceId = s.workspaceId;
  if (
    (s.leaseId &&
      !(await tx.facilityLease.findFirst({
        where: { workspaceId, id: s.leaseId, status: "ACTIVE" },
      }))) ||
    (s.insuranceId &&
      !(await tx.governanceRecord.findFirst({
        where: {
          workspaceId,
          id: s.insuranceId,
          kind: "INSURANCE",
          archivedAt: null,
          status: { not: "CANCELLED" },
        },
      })))
  ) {
    await tx.recurringCostSchedule.updateMany({
      where: { workspaceId, id: s.id },
      data: { status: "PAUSED" },
    });
    return;
  }
  await validateTags(tx, workspaceId, s, s.currency, "EXPENSE");
  let due = s.nextDueOn;
  const horizon = new Date(+today + s.leadDays * 86400000);
  let count = await tx.recurringCostDue.count({
    where: { workspaceId, scheduleId: s.id },
  });
  // Bound each catch-up transaction; the persistent cursor resumes on the next beat.
  for (let i = 0; i < 120 && due <= horizon; i++) {
    if ((s.endsOn && due > s.endsOn) || (s.kind === "EMI" && count >= s.tenure))
      break;
    const sourceKey = `schedule:${s.id}:${due.toISOString().slice(0, 10)}`;
    if (
      !(await tx.recurringCostDue.findUnique({
        where: { workspaceId_sourceKey: { workspaceId, sourceKey } },
      }))
    ) {
      const tax = taxAmounts(s.amountMinor, s.gstPercent, s.tdsPercent);
      const bill = await tx.financeBill.create({
        data: {
          workspaceId,
          vendor: s.payee,
          number: `RC-${s.id.slice(-8)}-${due.toISOString().slice(0, 10)}`,
          issuedOn: today < due ? today : due,
          dueOn: due,
          amountMinor: tax.cashMinor,
          currency: s.currency,
          needsActual: s.estimated || s.gstPercent > 0,
          taxableMinor: s.amountMinor,
          igstMinor: 0,
          tdsMinor: tax.tdsMinor,
          categoryId: s.categoryId,
          fundId: s.fundId,
          costCentreId: s.costCentreId,
          accountId: s.accountId,
          ownerId: s.ownerId,
          notes: s.notes,
          purpose: s.title,
          createdById: s.createdById,
        },
      });
      await checkFundRecord(tx, workspaceId, s.createdById, "bill", bill.id);
      await tx.recurringCostDue.create({
        data: {
          workspaceId,
          sourceKey,
          scheduleId: s.id,
          kind: s.kind,
          dueOn: due,
          billId: bill.id,
        },
      });
      await recordAuditEvent({
        client: tx,
        workspaceId,
        action: "finance.recurring_bill_created",
        targetType: "bill",
        targetId: bill.id,
        metadata: { scheduleId: s.id },
      });
      count++;
    }
    due = nextDue(due, s.frequency, s.dueDay);
  }
  await tx.recurringCostSchedule.updateMany({
    where: { workspaceId, id: s.id },
    data: {
      nextDueOn: due,
      ...((s.endsOn && due > s.endsOn) ||
      (s.kind === "EMI" && count >= s.tenure)
        ? { status: "ENDED" }
        : {}),
    },
  });
}
